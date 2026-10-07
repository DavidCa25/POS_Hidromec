/* sp_transfer_list
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_transfer_list ======================
   0052. Transferencias con eventos: lo enviado, lo recibido y la diferencia.
   Primer resultset: encabezados (los mas recientes primero).
   Segundo resultset: lineas de esas transferencias.
   ============================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_transfer_list
    @event_location_uuid UNIQUEIDENTIFIER = NULL,
    @max_rows INT = 100
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@max_rows) t.id, t.uuid AS transfer_uuid, t.kind, t.status, t.event_location_uuid, t.event_name, t.note,
           t.created_at, t.received_at, u.usuario AS created_by_name, t.created_machine_name,
           (SELECT SUM(l.qty_sent) FROM dbo.stock_transfer_lines l WHERE l.transfer_id = t.id) AS total_sent,
           (SELECT SUM(l.qty_received) FROM dbo.stock_transfer_lines l WHERE l.transfer_id = t.id) AS total_received
      INTO #t
      FROM dbo.stock_transfers t LEFT JOIN dbo.users u ON u.id = t.created_by
     WHERE @event_location_uuid IS NULL OR t.event_location_uuid = @event_location_uuid
     ORDER BY t.created_at DESC, t.id DESC;

    SELECT transfer_uuid, kind, status, event_location_uuid, event_name, note, created_at, received_at,
           created_by_name, created_machine_name, total_sent, total_received,
           total_sent - ISNULL(total_received, total_sent) AS difference
      FROM #t ORDER BY created_at DESC, id DESC;

    SELECT t.transfer_uuid, p.uuid AS product_uuid, p.nombre AS product_name, l.qty_sent, l.qty_received
      FROM #t t JOIN dbo.stock_transfer_lines l ON l.transfer_id = t.id JOIN dbo.products p ON p.id = l.product_id
     ORDER BY t.id, l.id;
END
GO
