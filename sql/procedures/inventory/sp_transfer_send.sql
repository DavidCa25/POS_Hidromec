/* sp_transfer_send
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_transfer_send ======================
   0052. La sucursal MANDA mercancia a un evento (feria).

   Es una SALIDA de esta sucursal: baja el stock aqui, en la misma
   transaccion, y deja su movimiento (salida / TRANSFER_OUT). La entrada en
   el evento la registra la tablet cuando la recibe, con lo que realmente
   llego: la diferencia, si la hay, se ve en la transferencia.

   @lines  JSON: [{"product_uuid":"...","qty":40}, ...]  (UUID: lo mismo que
           ve la tablet; un id local no significa nada fuera de esta base).
   @transfer_uuid  si se manda y ya existe, devuelve la existente sin tocar
           nada (reintento de la pantalla = un solo envio).

   No se permite dejar la sucursal en negativo: lo que no esta en el almacen
   no puede salir hacia la feria.
   ============================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_transfer_send
    @user_id             INT,
    @event_location_uuid UNIQUEIDENTIFIER,
    @event_name          NVARCHAR(120),
    @lines               NVARCHAR(MAX),
    @note                NVARCHAR(255) = NULL,
    @machine_name        NVARCHAR(120) = NULL,
    @transfer_uuid       UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @errmsg NVARCHAR(400);

    IF @transfer_uuid IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.stock_transfers WHERE uuid = @transfer_uuid)
    BEGIN
        SELECT t.uuid AS transfer_uuid, t.status, t.kind, CAST(1 AS BIT) AS ya_existia
          FROM dbo.stock_transfers t WHERE t.uuid = @transfer_uuid;
        RETURN;
    END

    IF @event_location_uuid IS NULL
    BEGIN RAISERROR('Indica el evento al que se manda la mercancia.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Falta quien envia la mercancia.', 16, 1); RETURN; END

    CREATE TABLE #l (product_id INT NOT NULL PRIMARY KEY, qty DECIMAL(12,2) NOT NULL);
    INSERT INTO #l (product_id, qty)
    SELECT p.id, SUM(CAST(j.qty AS DECIMAL(12,2)))
      FROM OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid', qty DECIMAL(12,2) '$.qty') j
      JOIN dbo.products p ON p.uuid = j.product_uuid
     GROUP BY p.id;

    IF (SELECT COUNT(*) FROM OPENJSON(@lines)) = 0
    BEGIN RAISERROR('La transferencia no tiene productos.', 16, 1); RETURN; END
    IF (SELECT COUNT(DISTINCT j.product_uuid) FROM OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid') j) <> (SELECT COUNT(*) FROM #l)
    BEGIN RAISERROR('Un producto de la transferencia no existe en esta sucursal.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM #l WHERE qty <= 0)
    BEGIN RAISERROR('Cada cantidad a enviar debe ser mayor a cero.', 16, 1); RETURN; END

    DECLARE @id INT, @uuid UNIQUEIDENTIFIER = ISNULL(@transfer_uuid, NEWID());

    BEGIN TRY
        BEGIN TRAN;

        /* Bloqueo en orden de id y validacion de existencias. */
        DECLARE @pid INT = NULL, @stk DECIMAL(12,2), @rq DECIMAL(12,2), @pname NVARCHAR(100);
        SELECT TOP 1 @pid = p.id, @stk = p.stock, @rq = l.qty, @pname = p.nombre
          FROM #l l INNER LOOP JOIN dbo.products p WITH (UPDLOCK, HOLDLOCK) ON p.id = l.product_id
         WHERE p.stock < l.qty
         ORDER BY p.id
         OPTION (FORCE ORDER);
        IF @pid IS NOT NULL
        BEGIN
            SET @errmsg = CONCAT('No hay existencia suficiente de "', @pname, '": hay ', CONVERT(NVARCHAR(30), @stk),
                                 ' y se quieren enviar ', CONVERT(NVARCHAR(30), @rq), '.');
            RAISERROR(@errmsg, 16, 1);
        END

        INSERT INTO dbo.stock_transfers (uuid, kind, status, event_location_uuid, event_name, note, created_by, created_machine_name)
        VALUES (@uuid, 'OUT', 'SENT', @event_location_uuid, LEFT(@event_name, 120), @note, @user_id, @machine_name);
        SET @id = SCOPE_IDENTITY();

        INSERT INTO dbo.stock_transfer_lines (transfer_id, product_id, qty_sent)
        SELECT @id, product_id, qty FROM #l;

        UPDATE p SET p.stock = p.stock - l.qty
          FROM dbo.products p JOIN #l l ON l.product_id = p.id;

        INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        SELECT l.product_id, 'salida', CONVERT(NVARCHAR(36), @uuid), l.qty, GETDATE(),
               LEFT(CONCAT(N'Envio a evento: ', @event_name), 255), 'TRANSFER_OUT', p.cost
          FROM #l l JOIN dbo.products p ON p.id = l.product_id;

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        SET @errmsg = ERROR_MESSAGE();
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END CATCH

    SELECT t.uuid AS transfer_uuid, t.status, t.kind, CAST(0 AS BIT) AS ya_existia
      FROM dbo.stock_transfers t WHERE t.id = @id;
    SELECT p.uuid AS product_uuid, p.nombre AS product_name, l.qty_sent
      FROM dbo.stock_transfer_lines l JOIN dbo.products p ON p.id = l.product_id
     WHERE l.transfer_id = @id ORDER BY l.id;
END
GO
