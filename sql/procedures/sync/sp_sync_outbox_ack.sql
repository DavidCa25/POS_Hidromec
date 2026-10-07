/* sp_sync_outbox_ack
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_sync_outbox_ack ======================
   0051. Lo que respondio la nube, evento por evento:

       APPLIED / DUPLICATE   -> SENT      (las dos son exito: la nube ya lo tiene)
       REJECTED              -> REJECTED  (la nube no lo acepta: no se reintenta)
       cualquier otra cosa   -> sigue PENDING, suma un intento y guarda el error

   `@acuses` es JSON: [{"event_uuid":"...","result":"APPLIED","error":null}, ...]
   ================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_sync_outbox_ack
    @acuses NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH a AS (
        SELECT TRY_CAST(j.event_uuid AS UNIQUEIDENTIFIER) AS event_uuid,
               UPPER(ISNULL(j.result, '')) AS result,
               LEFT(j.error, 400) AS error
          FROM OPENJSON(@acuses) WITH (
                event_uuid NVARCHAR(36) '$.event_uuid',
                result     NVARCHAR(20) '$.result',
                error      NVARCHAR(400) '$.error') j
    )
    UPDATE o
       SET status     = CASE WHEN a.result IN ('APPLIED', 'DUPLICATE') THEN 'SENT'
                             WHEN a.result = 'REJECTED' THEN 'REJECTED'
                             ELSE o.status END,
           sent_at    = CASE WHEN a.result IN ('APPLIED', 'DUPLICATE') THEN SYSUTCDATETIME() ELSE o.sent_at END,
           attempts   = o.attempts + 1,
           last_error = CASE WHEN a.result IN ('APPLIED', 'DUPLICATE') THEN NULL ELSE ISNULL(a.error, a.result) END
      FROM dbo.sync_outbox o
      JOIN a ON a.event_uuid = o.event_uuid
     WHERE o.status = 'PENDING';

    SELECT @@ROWCOUNT AS actualizados;
END
GO
