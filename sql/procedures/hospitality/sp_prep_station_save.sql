/* sp_prep_station_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_prep_station_save
    @id INT = NULL,
    @nombre NVARCHAR(40),
    @salida NVARCHAR(10) = 'PANTALLA',
    @impresora NVARCHAR(200) = NULL,
    @ancho_mm INT = NULL,
    @orden INT = 0,
    @activa BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET @nombre = LTRIM(RTRIM(ISNULL(@nombre, '')));
    SET @salida = UPPER(LTRIM(RTRIM(ISNULL(@salida, 'PANTALLA'))));
    SET @impresora = NULLIF(LTRIM(RTRIM(@impresora)), '');
    IF @nombre = '' BEGIN RAISERROR('La estación necesita un nombre.', 16, 1); RETURN; END
    IF @salida NOT IN ('PANTALLA', 'IMPRESORA', 'AMBOS')
    BEGIN RAISERROR('La salida debe ser pantalla, impresora o ambas.', 16, 1); RETURN; END
    IF @salida IN ('IMPRESORA', 'AMBOS') AND @impresora IS NULL
    BEGIN RAISERROR('Elige la impresora de esta estación.', 16, 1); RETURN; END

    IF @activa = 0 AND EXISTS (SELECT 1 FROM dbo.comandas WHERE station_id = @id AND estado IN ('NUEVA', 'PREPARANDO', 'LISTA'))
    BEGIN RAISERROR('Esta estación tiene comandas sin entregar.', 16, 1); RETURN; END

    IF @activa = 1 AND EXISTS (SELECT 1 FROM dbo.prep_stations WHERE nombre = @nombre AND activa = 1 AND id <> ISNULL(@id, 0))
    BEGIN RAISERROR('Ya hay una estación con ese nombre.', 16, 1); RETURN; END

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.prep_stations (nombre, salida, impresora, ancho_mm, orden, activa)
        VALUES (@nombre, @salida, @impresora, @ancho_mm, ISNULL(@orden, 0), ISNULL(@activa, 1));
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.prep_stations
           SET nombre = @nombre, salida = @salida, impresora = @impresora, ancho_mm = @ancho_mm,
               orden = ISNULL(@orden, orden), activa = ISNULL(@activa, activa)
         WHERE id = @id;
        /* Una estacion retirada deja de recibir: sus productos pasan a «sin
           preparacion» en vez de apuntar a algo que ya no existe. */
        IF @activa = 0 DELETE FROM dbo.product_prep_station WHERE station_id = @id;
    END

    SELECT id, nombre, salida, impresora, ancho_mm, orden, activa FROM dbo.prep_stations WHERE id = @id;
END
GO
