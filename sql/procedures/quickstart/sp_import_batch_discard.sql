/* sp_import_batch_discard
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Descartar una carga. No borra: marca. El historial es historial. */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_discard
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.import_batches
       SET estado = 'DESCARTADA', updated_at = SYSDATETIME()
     WHERE id = @batch_id AND estado <> 'IMPORTADA';
    SELECT @@ROWCOUNT AS descartadas;
END
GO
