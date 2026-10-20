/* sp_production_start
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · Empieza una tanda: AQUI salen los ingredientes.

   Una transaccion, como la venta: bloquea la tanda y los ingredientes en
   orden de id, valida que alcancen (no deja existencias negativas), los
   descuenta con su movimiento (salida / PRODUCTION, referencia = uuid de la
   tanda) y congela lo consumido y su costo. Reintentar una tanda que ya
   empezo no vuelve a descontar. */
CREATE OR ALTER PROCEDURE dbo.sp_production_start
    @user_id      INT,
    @batch_id     INT,
    @machine_name NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @status VARCHAR(12), @product_id INT, @planned DECIMAL(12, 2), @uuid UNIQUEIDENTIFIER,
            @nombre NVARCHAR(100), @errmsg NVARCHAR(400), @faltan INT;

    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Usuario invalido.', 16, 1); RETURN; END

    CREATE TABLE #req (ingredient_product_id INT NOT NULL PRIMARY KEY, qty DECIMAL(14, 2) NOT NULL);
    CREATE TABLE #stk (id INT NOT NULL PRIMARY KEY, stock DECIMAL(12, 2) NOT NULL, nombre NVARCHAR(100) NULL,
                       base_uom NVARCHAR(10) NULL, cost DECIMAL(14, 4) NOT NULL, qty DECIMAL(14, 2) NOT NULL);

    BEGIN TRY
        BEGIN TRAN;
        SELECT @status = b.status, @product_id = b.product_id, @planned = b.planned_qty, @uuid = b.uuid, @nombre = p.nombre
          FROM dbo.production_batches b WITH (UPDLOCK, HOLDLOCK)
          JOIN dbo.products p ON p.id = b.product_id
         WHERE b.id = @batch_id;

        IF @status IS NULL RAISERROR('La tanda no existe.', 16, 1);
        IF @status = 'IN_PROGRESS'
        BEGIN
            COMMIT TRAN;
            SELECT @batch_id AS id, 'IN_PROGRESS' AS status;
            RETURN;
        END
        IF @status <> 'PLANNED' RAISERROR('Esta tanda ya no se puede empezar.', 16, 1);

        INSERT INTO #req (ingredient_product_id, qty)
        SELECT l.ingredient_product_id,
                   CAST(ROUND(l.qty_base * (1 + l.waste_pct / 100.0) * @planned / f.yield_qty, 2) AS DECIMAL(14, 2)) AS qty
              FROM dbo.production_formula_lines l
              JOIN dbo.production_formulas f ON f.product_id = l.product_id
             WHERE l.product_id = @product_id;
        IF NOT EXISTS (SELECT 1 FROM #req) RAISERROR('Este producto no tiene formula de produccion.', 16, 1);
        DELETE FROM #req WHERE qty <= 0;

        /* Bloqueo en orden de id, igual que sp_register_sale. */
        INSERT INTO #stk (id, stock, nombre, base_uom, cost, qty)
        SELECT p.id, p.stock, p.nombre, p.base_uom, ISNULL(p.cost, 0), r.qty
          FROM dbo.products p WITH (UPDLOCK, HOLDLOCK)
          JOIN #req r ON r.ingredient_product_id = p.id
         ORDER BY p.id;

        SET @faltan = (SELECT COUNT(*) FROM #stk WHERE stock < qty);
        IF @faltan > 0
        BEGIN
            SELECT TOP 1 @errmsg = CONCAT('No alcanza ', nombre, ': necesitas ', CONVERT(NVARCHAR(30), CAST(qty AS FLOAT)), ' ', base_uom,
                                          ' y hay ', CONVERT(NVARCHAR(30), CAST(stock AS FLOAT)), ' ', base_uom,
                                          CASE WHEN @faltan > 1 THEN CONCAT(' (y ', @faltan - 1, ' ingrediente(s) mas)') ELSE '' END,
                                          '. Registra la compra o ajusta lo planeado.')
              FROM #stk WHERE stock < qty ORDER BY nombre;
            RAISERROR(@errmsg, 16, 1);
        END

        UPDATE p SET p.stock = p.stock - s.qty
          FROM dbo.products p JOIN #stk s ON s.id = p.id;

        INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        SELECT s.id, 'salida', CONVERT(NVARCHAR(36), @uuid), s.qty, GETDATE(),
               LEFT(CONCAT(N'Produccion: ', @nombre, N' x', CONVERT(NVARCHAR(30), @planned)), 255), 'PRODUCTION', s.cost
          FROM #stk s;

        INSERT INTO dbo.production_batch_consumption (batch_id, ingredient_product_id, qty, unit_cost)
        SELECT @batch_id, s.id, s.qty, s.cost FROM #stk s;

        UPDATE dbo.production_batches
           SET status = 'IN_PROGRESS', started_by = @user_id, started_at = SYSDATETIME(),
               total_cost = (SELECT ISNULL(SUM(qty * cost), 0) FROM #stk),
               machine_name = ISNULL(@machine_name, machine_name)
         WHERE id = @batch_id;

        COMMIT TRAN;
        SELECT @batch_id AS id, 'IN_PROGRESS' AS status;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
