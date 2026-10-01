/* sp_import_batch_list
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El riel: las vivas primero, el historial despues. CAPTURANDO cuenta como
   viva, que es justo lo que hace que se pueda volver a ella. */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_list
    @incluir_historial BIT = 1,
    @tope INT = 40
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@tope)
        b.*,
        (SELECT COUNT(*) FROM dbo.import_rows r
          WHERE r.batch_id = b.id AND r.accion IN ('CONFLICT','PENDIENTE')) AS pendientes,
        (SELECT COUNT(*) FROM dbo.import_rows r
          WHERE r.batch_id = b.id AND r.accion IN ('CREATE','UPDATE') AND r.aplicada = 0) AS listas,
        u.usuario AS usuario
    FROM dbo.import_batches b
    LEFT JOIN dbo.users u ON u.id = b.user_id
    WHERE (@incluir_historial = 1 OR b.estado <> 'IMPORTADA')
      AND b.estado <> 'DESCARTADA'
    ORDER BY CASE WHEN b.estado = 'IMPORTADA' THEN 1 ELSE 0 END, b.created_at DESC;
END
GO
