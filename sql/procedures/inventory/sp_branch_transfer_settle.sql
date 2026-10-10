/* sp_branch_transfer_settle
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_branch_transfer_settle ======================
   0055 · MultiSucursal. El ENVIO de esta sucursal se cierra con lo que dice
   la nube:

     RECEIVED   la otra sucursal lo recibio: se anota cuanto llego de cada
                producto. La existencia de aqui ya habia bajado al enviar.
     CANCELLED  se cancelo antes de recibirse: la mercancia vuelve a esta
                sucursal (entrada / BRANCH_CANCEL).

   Idempotente: un traspaso ya cerrado no se vuelve a tocar.
   @received_lines  [{"product_uuid","qty"}]
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_branch_transfer_settle
    @transfer_uuid  UNIQUEIDENTIFIER,
    @status         VARCHAR(12),
    @received_lines NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @id INT, @actual VARCHAR(12), @nombre NVARCHAR(120);

    SELECT @id = id, @actual = status, @nombre = event_name
      FROM dbo.stock_transfers WHERE uuid = @transfer_uuid AND kind = 'BRANCH_OUT';
    IF @id IS NULL BEGIN RAISERROR('No existe ese traspaso enviado.', 16, 1); RETURN; END
    IF @status NOT IN ('RECEIVED', 'CANCELLED') BEGIN RAISERROR('Estado de traspaso no válido.', 16, 1); RETURN; END
    IF @actual <> 'SENT'
    BEGIN
        SELECT @transfer_uuid AS transfer_uuid, @actual AS status, CAST(1 AS BIT) AS ya_estaba;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;
        IF @status = 'RECEIVED'
        BEGIN
            UPDATE l SET l.qty_received = r.qty
              FROM dbo.stock_transfer_lines l JOIN dbo.products p ON p.id = l.product_id
              JOIN (SELECT product_uuid, SUM(qty) AS qty FROM OPENJSON(ISNULL(@received_lines, '[]'))
                      WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid', qty DECIMAL(12, 2) '$.qty') GROUP BY product_uuid) r
                ON r.product_uuid = p.uuid
             WHERE l.transfer_id = @id;
            /* Lo que no aparece en lo recibido no llego. */
            UPDATE dbo.stock_transfer_lines SET qty_received = 0 WHERE transfer_id = @id AND qty_received IS NULL;
            UPDATE dbo.stock_transfers SET status = 'RECEIVED', received_at = SYSDATETIME() WHERE id = @id;
        END
        ELSE
        BEGIN
            UPDATE p SET p.stock = p.stock + l.qty_sent
              FROM dbo.products p JOIN dbo.stock_transfer_lines l ON l.product_id = p.id WHERE l.transfer_id = @id;
            INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
            SELECT l.product_id, 'entrada', CONVERT(NVARCHAR(36), @transfer_uuid), l.qty_sent, GETDATE(),
                   LEFT(CONCAT(N'Traspaso cancelado: ', @nombre), 255), 'BRANCH_CANCEL', p.cost
              FROM dbo.stock_transfer_lines l JOIN dbo.products p ON p.id = l.product_id WHERE l.transfer_id = @id;
            UPDATE dbo.stock_transfers SET status = 'CANCELLED', cancelled_at = SYSDATETIME() WHERE id = @id;
        END
        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        DECLARE @e NVARCHAR(2048) = ERROR_MESSAGE();
        RAISERROR(@e, 16, 1);
        RETURN;
    END CATCH

    SELECT @transfer_uuid AS transfer_uuid, @status AS status, CAST(0 AS BIT) AS ya_estaba;
END
GO
