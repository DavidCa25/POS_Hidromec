SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_exchange_sale (0065) =====================
   Un CAMBIO: el cliente devuelve unas piezas y se lleva otras, en una sola
   operación y en una sola transacción.

     1. Devuelve (sp_refund_sale) apartando para el cambio el valor de lo que
        se lleva (@exchange_amount). Esa parte no regresa como dinero.
     2. Registra la venta nueva (sp_register_sale) a precio de lista, pagada
        con ese apartado (pago CAMBIO, referencia = la devolución).
     3. Lo que falte lo paga con @diff_method (efectivo con @received,
        tarjeta o transferencia). Si lo que se lleva vale MENOS, la diferencia
        le regresa con las reglas de una devolución normal (paso 1).

   Si algo falla, nada queda: ni la devolución ni la venta.
   @new_lines_json = [{ "productId": 12, "qty": 1 }, ...]
   ================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_exchange_sale
    @sale_id INT,
    @user_id INT,
    @RefundDetails dbo.SaleDetailType READONLY,
    @new_lines_json NVARCHAR(MAX),
    @reason NVARCHAR(40),
    @note NVARCHAR(400) = NULL,
    @diff_method NVARCHAR(20) = NULL,
    @received DECIMAL(12,2) = NULL,
    @register_id INT = NULL,
    @machine_id NVARCHAR(64) = NULL,
    @machine_name NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF ISJSON(@new_lines_json) <> 1 THROW 51000, 'Elige qué se lleva a cambio.', 1;
    DECLARE @lleva dbo.SaleDetailType2;
    INSERT INTO @lleva (line_no, product_id, quantity, unit_price, note)
    SELECT ROW_NUMBER() OVER (ORDER BY (SELECT 1)), p.id, j.qty, p.price, NULL
      FROM OPENJSON(@new_lines_json) WITH (productId INT, qty DECIMAL(12,2)) j
      JOIN dbo.products p ON p.id = j.productId AND p.active = 1
     WHERE j.qty > 0;
    IF NOT EXISTS (SELECT 1 FROM @lleva) THROW 51000, 'Elige qué se lleva a cambio.', 1;
    DECLARE @nuevo DECIMAL(12,2) = (SELECT SUM(ROUND(quantity * unit_price, 2)) FROM @lleva);
    DECLARE @customer_id INT = (SELECT customer_id FROM dbo.sales WHERE id = @sale_id);

    BEGIN TRAN;

    /* 1. La devolución, con su apartado para el cambio. */
    EXEC dbo.sp_refund_sale @sale_id = @sale_id, @user_id = @user_id, @payment_method = N'EFECTIVO',
         @RefundDetails = @RefundDetails, @note = @note, @apply_net_update = 0, @register_id = @register_id,
         @machine_id = @machine_id, @machine_name = @machine_name, @reason = @reason, @exchange_amount = @nuevo;
    DECLARE @refund_id INT, @keep DECIMAL(12,2), @devuelto DECIMAL(12,2);
    SELECT TOP 1 @refund_id = id, @keep = ISNULL(exchange_amount, 0), @devuelto = refund_total
      FROM dbo.sale_refunds WHERE sale_id = @sale_id ORDER BY id DESC;
    IF ISNULL(@keep, 0) <= 0 THROW 51000, 'Lo que devuelve no tiene valor para un cambio.', 1;

    /* 2 y 3. La venta nueva, pagada con el cambio y, si falta, la diferencia. */
    DECLARE @diff DECIMAL(12,2) = @nuevo - @keep;
    IF @diff > 0 AND ISNULL(@diff_method, N'') NOT IN (N'EFECTIVO', N'TARJETA', N'TRANSFERENCIA')
        THROW 51000, 'Elige cómo paga la diferencia.', 1;
    IF @diff > 0 AND @diff_method = N'EFECTIVO' AND ISNULL(@received, 0) < @diff
        THROW 51000, 'El dinero recibido no alcanza para la diferencia.', 1;
    DECLARE @pagos NVARCHAR(MAX) = (
        SELECT method, amount, received, reference FROM (
            SELECT N'CAMBIO' AS method, @keep AS amount, CAST(NULL AS DECIMAL(12,2)) AS received, CAST(@refund_id AS NVARCHAR(20)) AS reference
            UNION ALL
            SELECT @diff_method, @diff, CASE WHEN @diff_method = N'EFECTIVO' THEN @received END, NULL WHERE @diff > 0) x
        FOR JSON PATH, INCLUDE_NULL_VALUES);
    DECLARE @vacio dbo.SaleDetailType, @mods dbo.SaleModifierType, @clave UNIQUEIDENTIFIER = NEWID();
    EXEC dbo.sp_register_sale @user_id = @user_id, @payment_method = N'MIXTO', @SaleDetails = @vacio,
         @customer_id = @customer_id, @register_id = @register_id, @SaleDetails2 = @lleva, @SaleModifiers = @mods,
         @machine_id = @machine_id, @machine_name = @machine_name, @payments_json = @pagos, @client_sale_key = @clave;
    DECLARE @venta_nueva INT = (SELECT id FROM dbo.sales WHERE client_sale_key = @clave);

    COMMIT;

    SELECT @refund_id AS refund_id, @venta_nueva AS sale_id, @devuelto AS devuelto, @nuevo AS lleva,
           CASE WHEN @diff > 0 THEN @diff ELSE 0 END AS paga, @devuelto - @keep AS regresa;
END;
GO
