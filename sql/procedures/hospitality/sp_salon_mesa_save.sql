/* sp_salon_mesa_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_salon_mesa_save
    @id INT = NULL,
    @area_id INT,
    @nombre NVARCHAR(40),
    @capacidad INT = NULL,
    @orden INT = 0,
    @activa BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET @nombre = LTRIM(RTRIM(ISNULL(@nombre, '')));
    IF @nombre = '' BEGIN RAISERROR('La mesa necesita un nombre.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.salon_areas WHERE id = @area_id AND activa = 1)
    BEGIN RAISERROR('El área no existe.', 16, 1); RETURN; END

    IF @activa = 0 AND EXISTS (SELECT 1 FROM dbo.hosp_cuentas WHERE mesa_id = @id AND estado IN ('ABIERTA', 'POR_COBRAR'))
    BEGIN
        RAISERROR('Esta mesa tiene una cuenta abierta: cóbrala antes de quitarla.', 16, 1); RETURN;
    END

    IF @activa = 1 AND EXISTS (SELECT 1 FROM dbo.salon_mesas
                                WHERE area_id = @area_id AND nombre = @nombre AND activa = 1 AND id <> ISNULL(@id, 0))
    BEGIN
        RAISERROR('Ya hay una mesa con ese nombre en esta área.', 16, 1); RETURN;
    END

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.salon_mesas (area_id, nombre, capacidad, orden, activa)
        VALUES (@area_id, @nombre, @capacidad, ISNULL(@orden, 0), ISNULL(@activa, 1));
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
        UPDATE dbo.salon_mesas
           SET area_id = @area_id, nombre = @nombre, capacidad = @capacidad,
               orden = ISNULL(@orden, orden), activa = ISNULL(@activa, activa)
         WHERE id = @id;

    SELECT id, area_id, nombre, capacidad, orden, activa FROM dbo.salon_mesas WHERE id = @id;
END
GO
