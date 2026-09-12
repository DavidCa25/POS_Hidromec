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
    @status NVARCHAR(10) = NULL,
    @tickets_total INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF LTRIM(RTRIM(ISNULL(@name, N''))) = N''
    BEGIN RAISERROR('La rifa necesita un nombre.', 16, 1); RETURN; END
    IF ISNULL(@winners_count, 0) < 1 SET @winners_count = 1;
    IF LTRIM(RTRIM(ISNULL(@code_prefix, N''))) = N'' SET @code_prefix = N'RF';
    /* Un tope de cero no significa nada: o hay boletos o no hay rifa. Se
       guarda NULL, que es lo mismo que decir "sin tope". */
    IF ISNULL(@tickets_total, 0) < 1 SET @tickets_total = NULL;

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.raffle_definitions (name, description, prize, starts_at, ends_at, status, winners_count, code_prefix, tickets_total)
        VALUES (@name, @description, @prize, @starts_at, @ends_at, ISNULL(@status, N'DRAFT'), @winners_count, @code_prefix, @tickets_total);
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

        /* Bajar el tope por debajo de los boletos ya repartidos dejaria a
           la rifa pasada de su propio limite y a nadie le cuadraria la
           cuenta. Subirlo, o quitarlo, no rompe nada. */
        DECLARE @repartidos INT =
            (SELECT COUNT(*) FROM dbo.raffle_entries WHERE raffle_id = @id AND status = 'VALID');
        IF @tickets_total IS NOT NULL AND @tickets_total < @repartidos
        BEGIN
            RAISERROR('Ya hay %d boletos repartidos: el total no puede quedar por debajo.', 16, 1, @repartidos);
            RETURN;
        END

        UPDATE dbo.raffle_definitions
           SET name = @name, description = @description, prize = @prize,
               starts_at = @starts_at, ends_at = @ends_at,
               winners_count = @winners_count, code_prefix = @code_prefix,
               tickets_total = @tickets_total,
               status = ISNULL(@status, status)
         WHERE id = @id;
    END

    SELECT id, name, status, winners_count, code_prefix, tickets_total FROM dbo.raffle_definitions WHERE id = @id;
END
GO
