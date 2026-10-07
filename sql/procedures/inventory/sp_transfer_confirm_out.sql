/* sp_transfer_confirm_out
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_transfer_confirm_out ======================
   0052. El evento confirmo lo que RECIBIO de un envio de esta sucursal.

   No cambia el stock de aqui (ya salio al enviar): solo registra cuanto
   llego, para que la diferencia en transito quede a la vista en la
   transferencia. Idempotente: confirmar otra vez no cambia nada.

   @lines JSON: [{"product_uuid":"...","qty_received":39}, ...]
   ===================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_transfer_confirm_out
    @transfer_uuid UNIQUEIDENTIFIER,
    @lines         NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @id INT, @status VARCHAR(12);
    SELECT @id = id, @status = status FROM dbo.stock_transfers WHERE uuid = @transfer_uuid AND kind = 'OUT';
    IF @id IS NULL
    BEGIN RAISERROR('La transferencia no existe en esta sucursal.', 16, 1); RETURN; END

    IF @status = 'SENT'
    BEGIN
        BEGIN TRAN;
        UPDATE l SET qty_received = j.qty_received
          FROM dbo.stock_transfer_lines l
          JOIN dbo.products p ON p.id = l.product_id
          JOIN OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid', qty_received DECIMAL(12,2) '$.qty_received') j
            ON j.product_uuid = p.uuid
         WHERE l.transfer_id = @id;
        UPDATE dbo.stock_transfers SET status = 'RECEIVED', received_at = SYSDATETIME() WHERE id = @id;
        COMMIT TRAN;
    END

    SELECT t.uuid AS transfer_uuid, t.status,
           (SELECT SUM(l.qty_sent - ISNULL(l.qty_received, l.qty_sent)) FROM dbo.stock_transfer_lines l WHERE l.transfer_id = t.id) AS diferencia
      FROM dbo.stock_transfers t WHERE t.id = @id;
END
GO
