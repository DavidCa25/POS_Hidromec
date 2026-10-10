/* sp_branch_transfer_send
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_branch_transfer_send ======================
   0055 · MultiSucursal. ESTA sucursal manda mercancia a otra de la empresa.

   Es una SALIDA: baja la existencia aqui, en la misma transaccion, con su
   movimiento (salida / BRANCH_OUT). La entrada la registra la otra sucursal
   al recibir, con lo que realmente llego.

   @to_location_uuid  la sucursal destino en la nube.
   @lines   [{"product_uuid": "...", "qty": 12}]  por uuid: es lo que comparten
            las sucursales gracias al catalogo corporativo.
   @transfer_uuid  reintento = el mismo envio, sin volver a descontar.

   No deja la existencia en negativo: lo que no esta no puede salir.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_branch_transfer_send
    @user_id          INT,
    @to_location_uuid UNIQUEIDENTIFIER,
    @to_name          NVARCHAR(120),
    @lines            NVARCHAR(MAX),
    @note             NVARCHAR(255) = NULL,
    @machine_name     NVARCHAR(120) = NULL,
    @transfer_uuid    UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @errmsg NVARCHAR(400);

    IF @transfer_uuid IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.stock_transfers WHERE uuid = @transfer_uuid)
    BEGIN
        SELECT t.uuid AS transfer_uuid, t.status, t.kind, CAST(1 AS BIT) AS ya_existia FROM dbo.stock_transfers t WHERE t.uuid = @transfer_uuid;
        SELECT LOWER(CONVERT(VARCHAR(36), p.uuid)) AS product_uuid, p.nombre, l.qty_sent AS qty
          FROM dbo.stock_transfer_lines l JOIN dbo.stock_transfers t ON t.id = l.transfer_id JOIN dbo.products p ON p.id = l.product_id
         WHERE t.uuid = @transfer_uuid ORDER BY l.id;
        RETURN;
    END

    IF @to_location_uuid IS NULL
    BEGIN RAISERROR('Elige la sucursal a la que se manda la mercancía.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Falta quién envía la mercancía.', 16, 1); RETURN; END
    IF ISJSON(@lines) = 0 OR (SELECT COUNT(*) FROM OPENJSON(@lines)) = 0
    BEGIN RAISERROR('El traspaso no tiene productos.', 16, 1); RETURN; END

    CREATE TABLE #l (product_id INT NOT NULL PRIMARY KEY, qty DECIMAL(12, 2) NOT NULL);
    INSERT INTO #l (product_id, qty)
    SELECT p.id, SUM(j.qty)
      FROM OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid', qty DECIMAL(12, 2) '$.qty') j
      JOIN dbo.products p ON p.uuid = j.product_uuid
     GROUP BY p.id;

    IF (SELECT COUNT(DISTINCT j.product_uuid) FROM OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid') j) <> (SELECT COUNT(*) FROM #l)
    BEGIN RAISERROR('Un producto del traspaso no existe en esta sucursal.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM #l WHERE qty <= 0)
    BEGIN RAISERROR('Cada cantidad a enviar debe ser mayor a cero.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM #l l JOIN dbo.products p ON p.id = l.product_id WHERE p.inventory_mode <> 'DIRECT')
    BEGIN RAISERROR('Solo se traspasa mercancía con existencia propia (no recetas ni productos de menú).', 16, 1); RETURN; END

    DECLARE @id INT, @uuid UNIQUEIDENTIFIER = ISNULL(@transfer_uuid, NEWID());

    BEGIN TRY
        BEGIN TRAN;

        DECLARE @pid INT = NULL, @stk DECIMAL(12, 2), @rq DECIMAL(12, 2), @pname NVARCHAR(100);
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
        VALUES (@uuid, 'BRANCH_OUT', 'SENT', @to_location_uuid, LEFT(@to_name, 120), @note, @user_id, @machine_name);
        SET @id = SCOPE_IDENTITY();

        INSERT INTO dbo.stock_transfer_lines (transfer_id, product_id, qty_sent) SELECT @id, product_id, qty FROM #l;

        UPDATE p SET p.stock = p.stock - l.qty FROM dbo.products p JOIN #l l ON l.product_id = p.id;

        INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        SELECT l.product_id, 'salida', CONVERT(NVARCHAR(36), @uuid), l.qty, GETDATE(),
               LEFT(CONCAT(N'Traspaso a sucursal: ', @to_name), 255), 'BRANCH_OUT', p.cost
          FROM #l l JOIN dbo.products p ON p.id = l.product_id;

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        SET @errmsg = ERROR_MESSAGE();
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END CATCH

    SELECT t.uuid AS transfer_uuid, t.status, t.kind, CAST(0 AS BIT) AS ya_existia FROM dbo.stock_transfers t WHERE t.id = @id;
    SELECT LOWER(CONVERT(VARCHAR(36), p.uuid)) AS product_uuid, p.nombre, l.qty_sent AS qty
      FROM dbo.stock_transfer_lines l JOIN dbo.products p ON p.id = l.product_id
     WHERE l.transfer_id = @id ORDER BY l.id;
END
GO
