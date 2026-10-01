/* sp_import_batch_touch
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Recalcula el estado. Una carga de captura sin filas vuelve a CAPTURANDO en
   vez de caer en LISTA, que significaria «lista para importar» sobre nada. */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_touch
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @total INT, @pend INT, @aplic INT, @origen NVARCHAR(12);
    SELECT @origen = origen FROM dbo.import_batches WHERE id = @batch_id;

    SELECT @total = COUNT(*),
           @pend  = SUM(CASE WHEN accion IN ('PENDIENTE','CONFLICT') THEN 1 ELSE 0 END),
           @aplic = SUM(CASE WHEN aplicada = 1 THEN 1 ELSE 0 END)
      FROM dbo.import_rows WHERE batch_id = @batch_id;

    UPDATE dbo.import_batches
       SET total_filas = ISNULL(@total, 0),
           updated_at = SYSDATETIME(),
           estado = CASE
               WHEN estado = 'DESCARTADA' THEN 'DESCARTADA'
               /* Sin una sola fila, una captura sigue siendo una captura. */
               WHEN ISNULL(@total, 0) = 0 AND @origen IN ('MANUAL','LECTOR') THEN 'CAPTURANDO'
               /* Importada solo cuando NO queda nada por hacer: si entraron
                  412 y quedan 16, la carga sigue viva. */
               WHEN @aplic > 0 AND ISNULL(@pend, 0) = 0
                    AND NOT EXISTS (SELECT 1 FROM dbo.import_rows
                                     WHERE batch_id = @batch_id AND aplicada = 0
                                       AND accion IN ('CREATE','UPDATE'))
                    THEN 'IMPORTADA'
               WHEN ISNULL(@pend, 0) > 0 THEN 'REVISION'
               ELSE 'LISTA' END
     WHERE id = @batch_id;
END
GO
