/* sp_supplier_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_supplier_save
    @id       INT = NULL,
    @nombre   NVARCHAR(100),
    @telefono NVARCHAR(20)  = NULL,
    @correo   NVARCHAR(100) = NULL,
    @rfc      NVARCHAR(20)  = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF (@id IS NULL OR @id = 0)
    BEGIN
        INSERT INTO CAT_suppliers (nombre, telefono, correo, rfc)
        VALUES (@nombre, @telefono, @correo, @rfc);
        SELECT SCOPE_IDENTITY() AS id;
    END
    ELSE
    BEGIN
        UPDATE CAT_suppliers
        SET nombre = @nombre, telefono = @telefono, correo = @correo, rfc = @rfc
        WHERE id = @id;
        SELECT @id AS id;
    END
END
GO
