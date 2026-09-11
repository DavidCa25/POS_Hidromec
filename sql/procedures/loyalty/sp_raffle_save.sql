/* sp_raffle_save
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Crear o actualizar una rifa, y cambiar su estado.

   El estado NO se puede mover a cualquier sitio:

     DRAFT  -> OPEN     se abre y empieza a admitir participaciones
     OPEN   -> CLOSED   deja de admitir, todavia sin sortear
     CLOSED -> OPEN     reabrir es legitimo mientras no se haya sorteado
     *      -> DRAWN    SOLO lo hace `sp_raffle_draw`

   Volver a DRAFT o a OPEN despues de sortear cambiaria el universo de un
   sorteo ya hecho, que es exactamente lo que no puede pasar. */
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
