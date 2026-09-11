/* sp_raffle_draw
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_raffle_draw — sortear, y poder explicar despues como se sorteo.

   POR QUE NO BASTA CON GUARDAR EL GANADOR
   ---------------------------------------
   Un sorteo que solo deja escrito "gano el boleto 412" no se puede defender
   ante nadie. Si un cliente pregunta, la unica respuesta seria "confia". Aqui
   queda registrado sobre QUE conjunto se sorteo, CUANDO, QUIEN lo ejecuto,
   con que algoritmo y con que semilla.

   COMO SE CONGELA EL UNIVERSO
   ---------------------------
   Se guarda `max_entry_id`: la ultima participacion que existia en ese
   momento. El conjunto sorteado queda definido como "participaciones validas
   de esta rifa con id <= max_entry_id", que ya no puede cambiar porque los
   ids son crecientes y las filas no se borran. Ademas la rifa pasa a DRAWN y
   deja de admitir entradas.

   Se descarto copiar las participaciones a una tabla de snapshot: seria el
   mismo dato dos veces, con la posibilidad de que discrepen. Aqui el snapshot
   es una FRONTERA, no una copia.

   EL AZAR
   -------
   `CRYPTO_UNIFORM v1` = ordenar por `CHECKSUM(NEWID())`, que en SQL Server da
   una permutacion uniforme sin sesgo de modulo. La semilla que se guarda es
   el identificador del sorteo mas su instante: no reproduce la permutacion
   -NEWID no lo permite- pero sella el acto. Queda anotado como tal: si algun
   dia se exige reproducibilidad total, sube `algorithm_version` y se
   distingue de los sorteos anteriores sin reescribir ninguno.

   NO SE BORRA HISTORIA: un sorteo repetido crea otro `raffle_draw`; el
   anterior sigue ahi.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_raffle_draw]
    @raffle_id INT,
    @user_id INT = NULL,
    @register_id INT = NULL,
    @machine_id NVARCHAR(64) = NULL,
    @winners INT = NULL,
    @alternates INT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @estado NVARCHAR(10), @cuantos INT;
    SELECT @estado = status, @cuantos = ISNULL(@winners, winners_count)
    FROM dbo.raffle_definitions WHERE id = @raffle_id;

    IF @estado IS NULL
    BEGIN RAISERROR('La rifa no existe.', 16, 1); RETURN; END

    IF @estado = 'DRAWN'
    BEGIN RAISERROR('Esta rifa ya se sorteo. Consulta el resultado anterior.', 16, 1); RETURN; END

    IF @estado = 'DRAFT'
    BEGIN RAISERROR('Esta rifa todavia no se ha activado: no tiene participaciones.', 16, 1); RETURN; END

    /* Se sortea SOBRE UNA RIFA CERRADA, nunca sobre una abierta.

       Antes el sorteo cerraba y elegia de un tiron, lo que obligaba a sortear
       en el mismo instante en que querias dejar de repartir boletos. Ahora
       cerrar es un acto propio (`sp_raffle_close`) que congela el universo, y
       el sorteo puede ocurrir cuando toque. */
    IF @estado = 'OPEN'
    BEGIN
        RAISERROR('Cierra la rifa antes de sortearla: mientras siga abierta pueden entrar mas boletos.', 16, 1);
        RETURN;
    END

    /* El universo es el que se congelo AL CERRAR, no el que haya ahora.

       La diferencia importa aunque hoy nada pueda insertar boletos en una
       rifa cerrada: el numero de participantes es el que se anuncio ese dia,
       y un sorteo que ocurre una semana despues tiene que seguir usandolo. */
    DECLARE @total INT, @maxId INT;
    SELECT @total = closed_entries_count, @maxId = closed_max_entry_id
    FROM dbo.raffle_definitions WHERE id = @raffle_id;

    /* Una rifa cerrada por una version anterior no tiene la foto. Se toma
       ahora: sigue siendo el universo correcto porque cerrada ya no admite
       boletos nuevos. */
    IF @total IS NULL OR @maxId IS NULL
    BEGIN
        SELECT @total = COUNT(*), @maxId = ISNULL(MAX(id), 0)
        FROM dbo.raffle_entries
        WHERE raffle_id = @raffle_id AND status = 'VALID';
    END

    IF ISNULL(@total, 0) = 0
    BEGIN RAISERROR('Esta rifa se cerro sin participaciones validas: no hay nada que sortear.', 16, 1); RETURN; END

    IF @cuantos < 1 SET @cuantos = 1;
    IF @cuantos > @total SET @cuantos = @total;
    IF @alternates < 0 SET @alternates = 0;
    IF @cuantos + @alternates > @total SET @alternates = @total - @cuantos;

    DECLARE @draw_id INT;

    BEGIN TRY
        BEGIN TRAN;

        /* Solo desde CLOSED. La condicion en el propio UPDATE es lo que hace
           que dos cajas sorteando a la vez no produzcan dos sorteos: la
           segunda no encuentra fila que actualizar. */
        UPDATE dbo.raffle_definitions
           SET status = 'DRAWN'
         WHERE id = @raffle_id AND status = 'CLOSED';

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRAN;
            RAISERROR('Otra caja sorteo esta rifa al mismo tiempo. Consulta el resultado.', 16, 1);
            RETURN;
        END

        INSERT INTO dbo.raffle_draws
            (raffle_id, entries_count, max_entry_id, drawn_at, drawn_by_user_id,
             register_id, machine_id, algorithm, algorithm_version, seed, status)
        VALUES
            (@raffle_id, @total, @maxId, SYSDATETIME(), @user_id,
             @register_id, @machine_id, 'CRYPTO_UNIFORM', 1,
             CONCAT('raffle:', @raffle_id, '|max:', @maxId, '|n:', @total,
                    '|at:', CONVERT(NVARCHAR(30), SYSDATETIME(), 126)),
             'DONE');

        SET @draw_id = SCOPE_IDENTITY();

        /* Titulares y suplentes salen de la MISMA permutacion: los primeros
           son ganadores y los siguientes quedan como reserva ordenada. Asi un
           premio no reclamado tiene sucesor sin repetir el sorteo. */
        INSERT INTO dbo.raffle_winners (draw_id, entry_id, position, status)
        SELECT @draw_id, t.id, t.pos,
               CASE WHEN t.pos <= @cuantos THEN 'WINNER' ELSE 'ALTERNATE' END
        FROM (
            SELECT e.id, ROW_NUMBER() OVER (ORDER BY CHECKSUM(NEWID())) AS pos
            FROM dbo.raffle_entries e
            WHERE e.raffle_id = @raffle_id AND e.status = 'VALID' AND e.id <= @maxId
        ) t
        WHERE t.pos <= (@cuantos + @alternates);

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(400) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
        RETURN;
    END CATCH

    /* El resultado, ya legible: numero de boleto y cliente si lo hubo. */
    SELECT w.id AS winner_id, w.position, w.status,
           e.entry_number,
           CONCAT(rf.code_prefix, '-', RIGHT(CONCAT('0000000', CAST(e.entry_number AS NVARCHAR(20))), 8)) AS boleto,
           e.customer_id, c.customerName AS cliente,
           e.sale_id, e.register_id,
           d.id AS draw_id, d.entries_count, d.drawn_at, d.seed
    FROM dbo.raffle_winners w
    JOIN dbo.raffle_draws d ON d.id = w.draw_id
    JOIN dbo.raffle_entries e ON e.id = w.entry_id
    JOIN dbo.raffle_definitions rf ON rf.id = d.raffle_id
    LEFT JOIN dbo.customers c ON c.id = e.customer_id
    WHERE w.draw_id = @draw_id
    ORDER BY w.position;
END
GO
