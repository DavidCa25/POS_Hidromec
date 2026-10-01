/* sp_import_batch_set_mapping
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_set_mapping
    @batch_id INT,
    @mapping_json NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.import_batches
       SET mapping_json = @mapping_json, updated_at = SYSDATETIME()
     WHERE id = @batch_id;
END
GO
