/* sp_sync_outbox_next
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_sync_outbox_next ======================
   0051. El siguiente lote de eventos por enviar, en orden de captura, y la
   identidad de la instancia para el sobre (empresa, ubicacion, instancia).

   El orden importa: un turno se abre antes de cerrarse y una venta se registra
   antes de editarse. La nube aplica "la version mayor gana" por agregado, asi
   que un desorden no corrompe nada, pero enviar en orden evita estados
   intermedios raros en el tablero.
   ================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_sync_outbox_next
    @max_rows INT = 100
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@max_rows)
           o.event_uuid, o.event_type, o.aggregate_type, o.aggregate_uuid, o.aggregate_version,
           o.occurred_at, o.payload_version, o.payload, o.attempts
      FROM dbo.sync_outbox o
     WHERE o.status = 'PENDING'
     ORDER BY o.id;

    SELECT
        (SELECT valor FROM dbo.database_metadata WHERE clave = 'instance_uuid') AS instance_uuid,
        (SELECT valor FROM dbo.database_metadata WHERE clave = 'company_uuid')  AS company_uuid,
        (SELECT valor FROM dbo.database_metadata WHERE clave = 'location_uuid') AS location_uuid;
END
GO
