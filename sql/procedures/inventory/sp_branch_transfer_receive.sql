/* sp_branch_transfer_receive
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_branch_transfer_receive ======================
   0055 · MultiSucursal. ESTA sucursal recibe lo que otra le mando.

   Entra lo que REALMENTE llego (qty), no lo que decia el envio (qty_sent):
   la diferencia se ve en el traspaso de los dos lados. Es una ENTRADA
   (entrada / BRANCH_IN) y queda como traspaso BRANCH_IN ya recibido.

   @lines  [{"product_uuid","nombre","qty_sent","qty"}]
   El mismo @transfer_uuid dos veces = una sola entrada (reintento seguro).
   Un producto que esta sucursal no tiene detiene todo: primero hay que
   recibir el catalogo de la matriz.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_branch_transfer_receive
    @transfer_uuid      UNIQUEIDENTIFIER,
    @user_id            INT,
    @from_location_uuid UNIQUEIDENTIFIER,
    @from_name          NVARCHAR(120),
    @lines              NVARCHAR(MAX),
    @note               NVARCHAR(255) = NULL,
    @machine_name       NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @errmsg NVARCHAR(1000);

    IF EXISTS (SELECT 1 FROM dbo.stock_transfers WHERE uuid = @transfer_uuid)
    BEGIN
        SELECT t.uuid AS transfer_uuid, t.status, t.kind, CAST(1 AS BIT) AS ya_existia FROM dbo.stock_transfers t WHERE t.uuid = @transfer_uuid;
        RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Falta quién recibe la mercancía.', 16, 1); RETURN; END
    IF ISJSON(@lines) = 0 OR (SELECT COUNT(*) FROM OPENJSON(@lines)) = 0
    BEGIN RAISERROR('El traspaso no tiene productos.', 16, 1); RETURN; END

    /* Tabla declarada y no SELECT INTO: con el LEFT JOIN, SELECT INTO hereda
       products.id como NOT NULL y un producto que no existe aqui revienta
       antes de poder decir cual es. */
    CREATE TABLE #l (product_uuid UNIQUEIDENTIFIER NULL, nombre NVARCHAR(100) NULL, qty_sent DECIMAL(12, 2) NULL,
                     qty DECIMAL(12, 2) NULL, product_id INT NULL);
    INSERT INTO #l (product_uuid, nombre, qty_sent, qty, product_id)
    SELECT j.product_uuid, j.nombre, j.qty_sent, j.qty, p.id
      FROM OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid', nombre NVARCHAR(100) '$.nombre',
             qty_sent DECIMAL(12, 2) '$.qty_sent', qty DECIMAL(12, 2) '$.qty') j
      LEFT JOIN dbo.products p ON p.uuid = j.product_uuid;

    IF EXISTS (SELECT 1 FROM #l WHERE product_id IS NULL)
    BEGIN
        SELECT @errmsg = CONCAT('Esta sucursal todavía no tiene: ', STRING_AGG(ISNULL(nombre, CONVERT(NVARCHAR(36), product_uuid)), ', '),
                                '. Recibe primero el catálogo de la matriz.')
          FROM #l WHERE product_id IS NULL;
        RAISERROR(@errmsg, 16, 1); RETURN;
    END
    IF EXISTS (SELECT 1 FROM #l WHERE ISNULL(qty, -1) < 0 OR ISNULL(qty_sent, 0) < 0)
    BEGIN RAISERROR('Una cantidad recibida no es válida.', 16, 1); RETURN; END

    DECLARE @id INT;
    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO dbo.stock_transfers (uuid, kind, status, event_location_uuid, event_name, note, created_by, created_machine_name, received_by, received_at)
        VALUES (@transfer_uuid, 'BRANCH_IN', 'RECEIVED', @from_location_uuid, LEFT(@from_name, 120), @note, @user_id, @machine_name, @user_id, SYSDATETIME());
        SET @id = SCOPE_IDENTITY();

        INSERT INTO dbo.stock_transfer_lines (transfer_id, product_id, qty_sent, qty_received)
        SELECT @id, product_id, SUM(ISNULL(qty_sent, qty)), SUM(qty) FROM #l GROUP BY product_id;

        UPDATE p SET p.stock = p.stock + l.qty
          FROM dbo.products p JOIN (SELECT product_id, SUM(qty) AS qty FROM #l GROUP BY product_id) l ON l.product_id = p.id;

        INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        SELECT l.product_id, 'entrada', CONVERT(NVARCHAR(36), @transfer_uuid), l.qty, GETDATE(),
               LEFT(CONCAT(N'Traspaso de sucursal: ', @from_name), 255), 'BRANCH_IN', p.cost
          FROM (SELECT product_id, SUM(qty) AS qty FROM #l GROUP BY product_id) l JOIN dbo.products p ON p.id = l.product_id
         WHERE l.qty > 0;

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        SET @errmsg = ERROR_MESSAGE();
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END CATCH

    SELECT t.uuid AS transfer_uuid, t.status, t.kind, CAST(0 AS BIT) AS ya_existia FROM dbo.stock_transfers t WHERE t.id = @id;
END
GO
