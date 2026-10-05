/* sp_transfer_receive_return
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_transfer_receive_return ======================
   0052. La sucursal RECIBE el sobrante que regresa de un evento.

   La tablet registro RETURN_TRANSFER_OUT (lo que mando). Aqui se cuenta lo
   que llego: entra al almacen (entrada / RETURN_TRANSFER_IN) y se guardan
   las dos cantidades. Si la feria mando 8 y llegaron 7, la diferencia queda
   en la transferencia; no se ajusta nada en silencio.

   @transfer_uuid  el UUID que genero la tablet. Recibir dos veces la misma
                   transferencia no suma dos veces: devuelve la existente.
   @lines  JSON: [{"product_uuid":"...","qty_sent":8,"qty_received":8}, ...]
   ======================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_transfer_receive_return
    @user_id             INT,
    @transfer_uuid       UNIQUEIDENTIFIER,
    @event_location_uuid UNIQUEIDENTIFIER,
    @event_name          NVARCHAR(120),
    @lines               NVARCHAR(MAX),
    @machine_name        NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @errmsg NVARCHAR(400);

    IF @transfer_uuid IS NULL
    BEGIN RAISERROR('Falta la transferencia que se recibe.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.stock_transfers WHERE uuid = @transfer_uuid)
    BEGIN
        SELECT uuid AS transfer_uuid, status, kind, CAST(1 AS BIT) AS ya_existia
          FROM dbo.stock_transfers WHERE uuid = @transfer_uuid;
        RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Falta quien recibe la mercancia.', 16, 1); RETURN; END

    CREATE TABLE #l (product_id INT NOT NULL PRIMARY KEY, qty_sent DECIMAL(12,2) NOT NULL, qty_received DECIMAL(12,2) NOT NULL);
    INSERT INTO #l (product_id, qty_sent, qty_received)
    SELECT p.id, SUM(j.qty_sent), SUM(j.qty_received)
      FROM OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid',
                                  qty_sent DECIMAL(12,2) '$.qty_sent', qty_received DECIMAL(12,2) '$.qty_received') j
      JOIN dbo.products p ON p.uuid = j.product_uuid
     GROUP BY p.id;

    IF (SELECT COUNT(DISTINCT j.product_uuid) FROM OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid') j) <> (SELECT COUNT(*) FROM #l)
       OR NOT EXISTS (SELECT 1 FROM #l)
    BEGIN RAISERROR('Un producto del retorno no existe en esta sucursal.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM #l WHERE qty_sent < 0 OR qty_received < 0)
    BEGIN RAISERROR('Las cantidades del retorno no pueden ser negativas.', 16, 1); RETURN; END

    DECLARE @id INT;
    BEGIN TRY
        BEGIN TRAN;
        INSERT INTO dbo.stock_transfers (uuid, kind, status, event_location_uuid, event_name, created_by, created_machine_name,
                                         received_by, received_at)
        VALUES (@transfer_uuid, 'RETURN_IN', 'RECEIVED', @event_location_uuid, LEFT(@event_name, 120), @user_id, @machine_name,
                @user_id, SYSDATETIME());
        SET @id = SCOPE_IDENTITY();

        INSERT INTO dbo.stock_transfer_lines (transfer_id, product_id, qty_sent, qty_received)
        SELECT @id, product_id, qty_sent, qty_received FROM #l;

        UPDATE p SET p.stock = p.stock + l.qty_received
          FROM dbo.products p WITH (UPDLOCK, HOLDLOCK) JOIN #l l ON l.product_id = p.id
         WHERE l.qty_received > 0;

        INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        SELECT l.product_id, 'entrada', CONVERT(NVARCHAR(36), @transfer_uuid), l.qty_received, GETDATE(),
               LEFT(CONCAT(N'Regreso de evento: ', @event_name), 255), 'RETURN_TRANSFER_IN', p.cost
          FROM #l l JOIN dbo.products p ON p.id = l.product_id
         WHERE l.qty_received > 0;
        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        SET @errmsg = ERROR_MESSAGE();
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END CATCH

    SELECT uuid AS transfer_uuid, status, kind, CAST(0 AS BIT) AS ya_existia FROM dbo.stock_transfers WHERE id = @id;
END
GO
