/* sp_delete_product_presentation
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Si alguna compra la uso, se desactiva (el historial la referencia);
-- si no, se borra.
CREATE OR ALTER PROCEDURE dbo.sp_delete_product_presentation
    @id INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.product_presentations WHERE id = @id)
    BEGIN RAISERROR('La presentacion no existe.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.purchase_detail WHERE presentation_id = @id)
    BEGIN
        UPDATE dbo.product_presentations SET active = 0, is_default = 0 WHERE id = @id;
        SELECT @id AS id, 'DEACTIVATED' AS result;
        RETURN;
    END
    DELETE FROM dbo.product_presentations WHERE id = @id;
    SELECT @id AS id, 'DELETED' AS result;
END
GO
