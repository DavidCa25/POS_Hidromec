/* sp_set_register_active
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Activar / desactivar caja ---- */
CREATE OR ALTER PROCEDURE [dbo].[sp_set_register_active]
    @id        INT,
    @is_active BIT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.registers WHERE id = @id)
    BEGIN
        RAISERROR('La caja no existe.', 16, 1);
        RETURN;
    END

    UPDATE dbo.registers SET is_active = @is_active WHERE id = @id;

    SELECT id, code, name, is_active, created_at
    FROM dbo.registers
    WHERE id = @id;
END
GO
