/* sp_salon_area_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_salon_area_save
    @id INT = NULL,
    @nombre NVARCHAR(60),
    @orden INT = 0,
    @activa BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET @nombre = LTRIM(RTRIM(ISNULL(@nombre, '')));
    IF @nombre = '' BEGIN RAISERROR('El área necesita un nombre.', 16, 1); RETURN; END

    IF @activa = 0 AND EXISTS (
        SELECT 1 FROM dbo.salon_mesas m JOIN dbo.hosp_cuentas c ON c.mesa_id = m.id
         WHERE m.area_id = @id AND c.estado IN ('ABIERTA', 'POR_COBRAR'))
    BEGIN
        RAISERROR('Esta área tiene mesas con cuenta abierta: cóbralas antes de quitarla.', 16, 1); RETURN;
    END

    IF EXISTS (SELECT 1 FROM dbo.salon_areas WHERE nombre = @nombre AND activa = 1 AND id <> ISNULL(@id, 0)) AND @activa = 1
    BEGIN
        RAISERROR('Ya hay un área con ese nombre.', 16, 1); RETURN;
    END

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.salon_areas (nombre, orden, activa) VALUES (@nombre, ISNULL(@orden, 0), ISNULL(@activa, 1));
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.salon_areas SET nombre = @nombre, orden = ISNULL(@orden, orden), activa = ISNULL(@activa, activa)
         WHERE id = @id;
        IF @activa = 0 UPDATE dbo.salon_mesas SET activa = 0 WHERE area_id = @id;
    END

    SELECT id, nombre, orden, activa FROM dbo.salon_areas WHERE id = @id;
END
GO
