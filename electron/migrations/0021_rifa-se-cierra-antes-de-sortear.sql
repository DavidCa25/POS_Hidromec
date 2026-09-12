/* ============================================================
   0021 — rifa se cierra antes de sortear

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0021_rifa-se-cierra-antes-de-sortear.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0021_rifa-se-cierra-antes-de-sortear.sql ========== */
/* ============================================================
   0021 — cerrar una rifa es un acto propio, no un efecto del sorteo

   Hasta ahora una rifa pasaba de OPEN a DRAWN de un salto: el sorteo la
   cerraba y elegia ganador en la misma operacion. Son dos decisiones
   distintas y normalmente las toma gente distinta en momentos distintos:

     "ya no se reparten mas boletos"        -> cerrar
     "el ganador es el boleto 341"          -> sortear

   Mezclarlas obliga a sortear en el instante en que quieres dejar de
   repartir, y deja sin respuesta la pregunta que siempre aparece despues:
   ¿cuantos boletos participaban exactamente cuando se cerro?

   Estas tres columnas guardan esa respuesta EN EL MOMENTO DEL CIERRE, no
   cuando alguien se acuerde de sortear. Un sorteo que ocurre una semana mas
   tarde sigue usando el universo congelado aquel dia.
   ============================================================ */

IF COL_LENGTH('dbo.raffle_definitions', 'closed_at') IS NULL
ALTER TABLE dbo.raffle_definitions ADD closed_at DATETIME2(0) NULL;

IF COL_LENGTH('dbo.raffle_definitions', 'closed_entries_count') IS NULL
ALTER TABLE dbo.raffle_definitions ADD closed_entries_count INT NULL;

/* El ultimo boleto que entro antes del cierre. El sorteo no mira mas alla
   de este id, asi que un boleto insertado despues -por un camino que no
   deberia existir- no puede colarse en un sorteo ya congelado. */
IF COL_LENGTH('dbo.raffle_definitions', 'closed_max_entry_id') IS NULL
ALTER TABLE dbo.raffle_definitions ADD closed_max_entry_id INT NULL;
GO

/* ---------- sp_raffle_close (SQL_STORED_PROCEDURE) ---------- */
/* sp_raffle_close
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_raffle_close — dejar de repartir boletos, sin sortear todavia.

   Cerrar y sortear son dos actos distintos. Cerrar dice "ya no entran mas
   participaciones" y congela el universo; sortear elige. Entre los dos
   pueden pasar semanas, y durante ese tiempo el numero de participantes no
   puede moverse, porque es el numero que se anuncio.

   QUE CONGELA
   -----------
   `closed_entries_count`  cuantos boletos validos habia al cerrar
   `closed_max_entry_id`   el ultimo boleto admitido
   `closed_at`             cuando se cerro

   `sp_raffle_draw` sortea SOBRE ESO, no sobre lo que haya en la tabla el dia
   que alguien pulse el boton.

   IDEMPOTENTE
   -----------
   Cerrar una rifa ya cerrada no vuelve a congelar nada: devuelve la foto que
   ya se tomo. Si recontara, dos pulsaciones separadas darian dos universos
   distintos, que es justo lo que este procedure existe para impedir.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_raffle_close]
    @raffle_id INT,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @estado NVARCHAR(10);

    BEGIN TRY
        BEGIN TRAN;

        /* UPDLOCK sobre la rifa: dos cajas pulsando "cerrar" a la vez deben
           producir UNA foto, no dos. La segunda espera y encuentra la rifa ya
           cerrada. */
        SELECT @estado = status
        FROM dbo.raffle_definitions WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @raffle_id;

        IF @estado IS NULL
        BEGIN
            IF XACT_STATE() <> 0 ROLLBACK TRAN;
            RAISERROR('La rifa no existe.', 16, 1);
            RETURN;
        END

        IF @estado = 'DRAFT'
        BEGIN
            IF XACT_STATE() <> 0 ROLLBACK TRAN;
            RAISERROR('Esta rifa todavia no se ha activado: no hay nada que cerrar.', 16, 1);
            RETURN;
        END

        IF @estado = 'DRAWN'
        BEGIN
            IF XACT_STATE() <> 0 ROLLBACK TRAN;
            RAISERROR('Esta rifa ya se sorteo.', 16, 1);
            RETURN;
        END

        /* Ya cerrada: no se recuenta. La foto es la que se tomo entonces. */
        IF @estado = 'OPEN'
        BEGIN
            UPDATE r
               SET status = 'CLOSED',
                   closed_at = SYSDATETIME(),   /* hora local: misma politica que sp_loyalty_evaluate_sale */
                   closed_entries_count = ISNULL(e.n, 0),
                   closed_max_entry_id = ISNULL(e.maxid, 0)
            FROM dbo.raffle_definitions r
            OUTER APPLY (
                SELECT COUNT(*) AS n, MAX(id) AS maxid
                FROM dbo.raffle_entries WITH (UPDLOCK, HOLDLOCK)
                WHERE raffle_id = @raffle_id AND status = 'VALID'
            ) e
            WHERE r.id = @raffle_id;
        END

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(400) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
        RETURN;
    END CATCH

    SELECT id, name, status, closed_at, closed_entries_count, closed_max_entry_id, winners_count
    FROM dbo.raffle_definitions
    WHERE id = @raffle_id;
END
GO

/* ---------- sp_raffle_detail (SQL_STORED_PROCEDURE) ---------- */
/* sp_raffle_detail
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Una rifa con sus participaciones, sus sorteos y sus ganadores.

   Tres resultsets:
     1 la rifa y sus conteos
     2 participaciones (las ultimas primero, con su caja de origen)
     3 ganadores de todos los sorteos, con la evidencia de cada uno

   Las participaciones se limitan: una rifa de un mes puede tener miles y la
   pantalla no necesita pintarlas todas para responder "¿cuantas llevo y de
   que cajas salieron?". */
CREATE OR ALTER PROCEDURE [dbo].[sp_raffle_detail]
    @raffle_id INT,
    @top_entries INT = 200
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@top_entries, 0) < 1 SET @top_entries = 200;

    SELECT r.id, r.name, r.description, r.prize, r.starts_at, r.ends_at,
           r.status, r.winners_count, r.code_prefix, r.created_at,
           /* La foto del cierre: cuantos boletos quedaron dentro y cuando. */
           r.closed_at, r.closed_entries_count, r.closed_max_entry_id,
           (SELECT COUNT(*) FROM dbo.raffle_entries e WHERE e.raffle_id = r.id AND e.status = 'VALID') AS participaciones,
           (SELECT COUNT(DISTINCT e.customer_id) FROM dbo.raffle_entries e WHERE e.raffle_id = r.id AND e.customer_id IS NOT NULL) AS clientes,
           (SELECT COUNT(DISTINCT e.register_id) FROM dbo.raffle_entries e WHERE e.raffle_id = r.id) AS cajas
    FROM dbo.raffle_definitions r
    WHERE r.id = @raffle_id;

    SELECT TOP (@top_entries)
           e.id, e.entry_number,
           CONCAT(rf.code_prefix, '-', RIGHT(CONCAT('0000000', CAST(e.entry_number AS NVARCHAR(20))), 8)) AS boleto,
           e.customer_id, c.customerName AS cliente,
           e.sale_id, e.register_id, rg.name AS caja, e.machine_id,
           e.campaign_id, cp.name AS campana,
           e.status, e.created_at
    FROM dbo.raffle_entries e
    JOIN dbo.raffle_definitions rf ON rf.id = e.raffle_id
    LEFT JOIN dbo.customers c ON c.id = e.customer_id
    LEFT JOIN dbo.registers rg ON rg.id = e.register_id
    LEFT JOIN dbo.campaigns cp ON cp.id = e.campaign_id
    WHERE e.raffle_id = @raffle_id
    ORDER BY e.entry_number DESC;

    SELECT w.id AS winner_id, w.draw_id, w.position, w.status, w.delivered_at, w.notes,
           e.entry_number,
           CONCAT(rf.code_prefix, '-', RIGHT(CONCAT('0000000', CAST(e.entry_number AS NVARCHAR(20))), 8)) AS boleto,
           e.customer_id, c.customerName AS cliente, e.sale_id,
           d.drawn_at, d.entries_count, d.max_entry_id, d.algorithm, d.algorithm_version, d.seed,
           u.usuario AS sorteado_por
    FROM dbo.raffle_winners w
    JOIN dbo.raffle_draws d ON d.id = w.draw_id
    JOIN dbo.raffle_entries e ON e.id = w.entry_id
    JOIN dbo.raffle_definitions rf ON rf.id = d.raffle_id
    LEFT JOIN dbo.customers c ON c.id = e.customer_id
    LEFT JOIN dbo.users u ON u.id = d.drawn_by_user_id
    WHERE d.raffle_id = @raffle_id
    ORDER BY d.id DESC, w.position;
END
GO

/* ---------- sp_raffle_draw (SQL_STORED_PROCEDURE) ---------- */
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

/* ---------- sp_raffle_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_raffle_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Crear o actualizar una rifa, y activarla.

   El ciclo de vida es de una sola direccion:

     DRAFT  -> OPEN     se activa y empieza a admitir participaciones
     OPEN   -> CLOSED   SOLO lo hace `sp_raffle_close`, que congela el universo
     CLOSED -> DRAWN    SOLO lo hace `sp_raffle_draw`

   Esta edicion solo puede hacer el primer paso. Los otros dos pertenecen a
   procedures propios porque cada uno deja constancia de algo -la foto de
   participantes, el resultado- y llegar ahi por un UPDATE de edicion se la
   saltaria.

   NO se puede reabrir una rifa cerrada. Se penso permitirlo "mientras no se
   haya sorteado", pero reabrir mueve el universo que ya se anuncio: la gente
   que pregunto cuantos boletos participaban recibio una respuesta, y esa
   respuesta dejaria de ser cierta sin que nadie se entere. Si algun dia hace
   falta, tendra que ser una operacion explicita y auditada, no un efecto de
   guardar el formulario. */
CREATE OR ALTER PROCEDURE [dbo].[sp_raffle_save]
    @id INT = NULL,
    @name NVARCHAR(120),
    @description NVARCHAR(400) = NULL,
    @prize NVARCHAR(200) = NULL,
    @starts_at DATETIME2(0) = NULL,
    @ends_at DATETIME2(0) = NULL,
    @winners_count INT = 1,
    @code_prefix NVARCHAR(8) = NULL,
    @status NVARCHAR(10) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF LTRIM(RTRIM(ISNULL(@name, N''))) = N''
    BEGIN RAISERROR('La rifa necesita un nombre.', 16, 1); RETURN; END
    IF ISNULL(@winners_count, 0) < 1 SET @winners_count = 1;
    IF LTRIM(RTRIM(ISNULL(@code_prefix, N''))) = N'' SET @code_prefix = N'RF';

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.raffle_definitions (name, description, prize, starts_at, ends_at, status, winners_count, code_prefix)
        VALUES (@name, @description, @prize, @starts_at, @ends_at, ISNULL(@status, N'DRAFT'), @winners_count, @code_prefix);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        DECLARE @actual NVARCHAR(10);
        SELECT @actual = status FROM dbo.raffle_definitions WHERE id = @id;
        IF @actual IS NULL
        BEGIN RAISERROR('La rifa no existe.', 16, 1); RETURN; END

        /* Una rifa sorteada es historia: se puede renombrar, no revivir. */
        IF @actual = 'DRAWN' AND @status IS NOT NULL AND @status <> 'DRAWN'
        BEGIN
            RAISERROR('Esta rifa ya se sorteo: su estado no se puede cambiar.', 16, 1);
            RETURN;
        END
        IF @status = 'DRAWN'
        BEGIN
            RAISERROR('El estado sorteada lo pone el sorteo, no la edicion.', 16, 1);
            RETURN;
        END
        IF @status = 'CLOSED' AND @actual <> 'CLOSED'
        BEGIN
            RAISERROR('Para cerrar una rifa usa Cerrar: el cierre congela cuantos boletos participaban.', 16, 1);
            RETURN;
        END
        IF @actual = 'CLOSED' AND @status IS NOT NULL AND @status <> 'CLOSED'
        BEGIN
            RAISERROR('Esta rifa esta cerrada y no se puede reabrir: cambiaria el universo que ya se anuncio.', 16, 1);
            RETURN;
        END
        IF @status = 'DRAFT' AND @actual <> 'DRAFT'
        BEGIN
            RAISERROR('Una rifa ya activada no vuelve a borrador.', 16, 1);
            RETURN;
        END

        UPDATE dbo.raffle_definitions
           SET name = @name, description = @description, prize = @prize,
               starts_at = @starts_at, ends_at = @ends_at,
               winners_count = @winners_count, code_prefix = @code_prefix,
               status = ISNULL(@status, status)
         WHERE id = @id;
    END

    SELECT id, name, status, winners_count, code_prefix FROM dbo.raffle_definitions WHERE id = @id;
END
GO
