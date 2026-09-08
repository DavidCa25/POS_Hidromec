/* sp_update_sale
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* -------------------- sp_update_sale -------------------- */
CREATE OR ALTER PROCEDURE [dbo].[sp_update_sale]
  @sale_id INT,
  @user_id INT,
  @SaleDetails dbo.SaleDetailType READONLY,
  @note NVARCHAR(400) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  IF @sale_id IS NULL OR @sale_id <= 0
  BEGIN
    RAISERROR('sale_id inválido.',16,1);
    RETURN;
  END

  BEGIN TRY
    BEGIN TRAN;

    IF EXISTS (SELECT 1 FROM dbo.sale_refunds WHERE sale_id = @sale_id)
    BEGIN
      RAISERROR('No se puede actualizar: la venta ya tiene reembolsos.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    /* La edicion recalcula stock por PRODUCTO vendido: solo vale para lineas
       DIRECT sin modificadores. Una venta con recetas se corrige con
       Reembolso / Cambio, que repone lo que realmente se consumio. */
    IF EXISTS (SELECT 1 FROM dbo.sale_detail d WHERE d.sale_id = @sale_id AND d.inventory_mode = 'RECIPE')
       OR EXISTS (SELECT 1 FROM dbo.sale_detail d JOIN dbo.sale_detail_modifiers m ON m.sale_detail_id = d.id WHERE d.sale_id = @sale_id)
       OR EXISTS (SELECT 1 FROM @SaleDetails n JOIN dbo.products p ON p.id = n.product_id WHERE p.inventory_mode = 'RECIPE')
    BEGIN
      RAISERROR('Esta venta contiene recetas o modificadores: usa Reembolso / Cambio en lugar de modificarla.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    DECLARE @old_total DECIMAL(12,2);
    DECLARE @payment_method NVARCHAR(50);
    DECLARE @customer_id INT;
    DECLARE @paid_amount DECIMAL(12,2);
    DECLARE @balance DECIMAL(12,2);

    SELECT
      @old_total = s.total,
      @payment_method = s.payment_method,
      @customer_id = s.customer_id,
      @paid_amount = s.paid_amount,
      @balance = s.balance
    FROM dbo.sales s WITH (UPDLOCK, HOLDLOCK)
    WHERE s.id = @sale_id;

    IF @old_total IS NULL
    BEGIN
      RAISERROR('La venta no existe.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    IF (@customer_id IS NOT NULL AND UPPER(@payment_method)='CREDITO')
       AND (ISNULL(@paid_amount,0) > 0 AND ISNULL(@balance,0) < ISNULL(@old_total,0))
    BEGIN
      RAISERROR('No se puede actualizar: venta a crédito con pagos registrados.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    ;WITH n AS (
      SELECT product_id, SUM(quantity) AS qty, MAX(unit_price) AS unit_price
      FROM @SaleDetails
      GROUP BY product_id
    )
    SELECT * INTO #new FROM n;

    SELECT
      d.product_id,
      SUM(d.quantity) AS qty,
      MAX(d.unitary_price) AS unit_price,
      MAX(d.unit_cost) AS unit_cost
    INTO #old
    FROM dbo.sale_detail d
    WHERE d.sale_id = @sale_id
    GROUP BY d.product_id;

    /* Solo los productos con inventario directo mueven stock; NONE no. */
    ;WITH delta AS (
      SELECT
        COALESCE(o.product_id, n.product_id) AS product_id,
        ISNULL(o.qty,0) AS old_qty,
        ISNULL(n.qty,0) AS new_qty,
        CASE WHEN p.inventory_mode = 'DIRECT' THEN (ISNULL(o.qty,0) - ISNULL(n.qty,0)) ELSE 0 END AS stock_change
      FROM #old o
      FULL JOIN #new n ON n.product_id = o.product_id
      JOIN dbo.products p ON p.id = COALESCE(o.product_id, n.product_id)
    )
    SELECT * INTO #delta FROM delta;

    IF EXISTS (
      SELECT 1
      FROM #delta d
      JOIN dbo.products p WITH (UPDLOCK, HOLDLOCK) ON p.id = d.product_id
      WHERE d.stock_change < 0
        AND p.stock < ABS(d.stock_change)
    )
    BEGIN
      RAISERROR('No hay stock suficiente para aumentar cantidades en la venta.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    UPDATE p
    SET p.stock = p.stock + d.stock_change
    FROM dbo.products p
    JOIN #delta d ON d.product_id = p.id;

    DECLARE @new_total DECIMAL(12,2);
    SELECT @new_total = ISNULL(SUM(qty * unit_price),0) FROM #new;

    DELETE FROM dbo.sale_detail WHERE sale_id = @sale_id;

    /* Se conserva el costo congelado de la linea original; una linea nueva
       toma el costo actual del producto. */
    INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, inventory_mode)
    SELECT @sale_id, n.product_id, n.qty, n.unit_price, ISNULL(o.unit_cost, p.cost), p.inventory_mode
    FROM #new n
    JOIN dbo.products p ON p.id = n.product_id
    LEFT JOIN #old o ON o.product_id = n.product_id;

    INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, sold_product_id, units, unit_cost)
    SELECT
      d.product_id,
      CASE WHEN d.stock_change < 0 THEN 'salida' ELSE 'entrada' END,
      CAST(@sale_id AS NVARCHAR(50)),
      ABS(d.stock_change),
      GETDATE(),
      CONCAT('Ajuste venta ', @sale_id, COALESCE(CONCAT(' - ', @note), '')),
      'EDIT',
      d.product_id,
      ABS(d.stock_change),
      p.cost
    FROM #delta d
    JOIN dbo.products p ON p.id = d.product_id
    WHERE d.stock_change <> 0;

    UPDATE dbo.sales
    SET total = @new_total,
        paid_amount = CASE
            WHEN @customer_id IS NOT NULL AND UPPER(@payment_method)='CREDITO' THEN ISNULL(paid_amount,0)
            ELSE @new_total
        END,
        balance = CASE
            WHEN @customer_id IS NOT NULL AND UPPER(@payment_method)='CREDITO' THEN @new_total
            ELSE 0
        END
    WHERE id = @sale_id;

    IF (@customer_id IS NULL OR UPPER(@payment_method) <> 'CREDITO')
       AND UPPER(@payment_method)='EFECTIVO'
    BEGIN
      DECLARE @closure_id_open INT;
      SELECT TOP(1) @closure_id_open = id
      FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
      WHERE userId = @user_id AND closed_at IS NULL
      ORDER BY opened_at DESC, id DESC;

      IF @closure_id_open IS NULL
      BEGIN
        RAISERROR('No hay turno abierto para registrar el ajuste en caja.',16,1);
        ROLLBACK TRAN;
        RETURN;
      END

      DECLARE @delta_total DECIMAL(12,2) = (@new_total - ISNULL(@old_total,0));

      IF @delta_total <> 0
      BEGIN
        INSERT INTO dbo.cash_movements
          (datee, userId, typee, reference_id, reference, amount, note, closure_id)
        VALUES
          (GETDATE(), @user_id, 'SALE_ADJ', @sale_id,
           CONCAT('Ajuste Venta ', @sale_id),
           @delta_total,
           @note,
           @closure_id_open);
      END
    END

    COMMIT TRAN;

    SELECT
      @sale_id AS sale_id,
      @old_total AS old_total,
      @new_total AS new_total,
      (@new_total - @old_total) AS delta_total;

  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRAN;
    DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@msg,16,1);
  END CATCH
END
GO
