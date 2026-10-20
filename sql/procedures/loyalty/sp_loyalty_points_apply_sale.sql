SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_apply_sale (0064) =====================
   El canje de puntos o de una tarjeta de sellos, DENTRO de la transacción de
   sp_register_sale (paso 11, junto al Club). La cotización ya aplicó el
   descuento; aquí se comprueba OTRA VEZ, con el candado del cliente, que el
   saldo alcance -entre cotizar y cobrar pudo canjear en otra caja- y se
   descuenta. Si no alcanza, la venta entera no se registra.

   La cotización trae:
     $.loyaltyCustomerId          el cliente del canje
     $.points  {rewardId, cost, amountApplied}
     $.stamps  {cardId, cost, amountApplied}
   y los renglones con audit.rule = 'points' / 'stamps'. Usa #map (línea de
   la cotización -> sale_detail) que crea sp_register_sale.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_apply_sale
    @sale_id INT,
    @customer_id INT,
    @user_id INT,
    @quote NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    IF @quote IS NULL RETURN;

    DECLARE @reward INT = TRY_CONVERT(INT, JSON_VALUE(@quote, '$.points.rewardId')),
            @costo_q INT = TRY_CONVERT(INT, JSON_VALUE(@quote, '$.points.cost')),
            @monto_p DECIMAL(12,2) = TRY_CONVERT(DECIMAL(12,2), JSON_VALUE(@quote, '$.points.amountApplied')),
            @card INT = TRY_CONVERT(INT, JSON_VALUE(@quote, '$.stamps.cardId')),
            @sellos_q INT = TRY_CONVERT(INT, JSON_VALUE(@quote, '$.stamps.cost')),
            @monto_s DECIMAL(12,2) = TRY_CONVERT(DECIMAL(12,2), JSON_VALUE(@quote, '$.stamps.amountApplied'));
    IF @reward IS NULL AND @card IS NULL RETURN;

    IF @customer_id IS NULL OR @customer_id <> TRY_CONVERT(INT, JSON_VALUE(@quote, '$.loyaltyCustomerId'))
        THROW 51000, 'El canje es de otro cliente: vuelve a elegirlo.', 1;

    DECLARE @recurso NVARCHAR(40) = CONCAT(N'wx-loy-', @customer_id);
    EXEC sp_getapplock @Resource = @recurso, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;

    /* El renglón al que se ata el canje (si es por producto). */
    DECLARE @lineas TABLE (sale_detail_id INT, regla NVARCHAR(40), line_no INT);
    INSERT INTO @lineas
    SELECT m.sale_detail_id, c.regla, m.line_no
      FROM #map m
      JOIN OPENJSON(@quote, '$.lines') WITH (line_no INT, regla NVARCHAR(40) '$.audit.rule') c ON c.line_no = m.line_no
     WHERE c.regla IN (N'points', N'stamps');

    IF @reward IS NOT NULL
    BEGIN
        DECLARE @costo INT, @kind NVARCHAR(20);
        SELECT @costo = points_cost, @kind = kind FROM dbo.reward_definitions
         WHERE id = @reward AND active = 1 AND points_cost IS NOT NULL;
        IF @costo IS NULL OR @costo <> @costo_q
            THROW 51000, 'La recompensa cambió: vuelve a elegir el canje.', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.loyalty_points_config WHERE id = 1 AND enabled = 1)
            THROW 51000, 'Los puntos están apagados.', 1;
        IF ISNULL(@monto_p, 0) <= 0
            THROW 51000, 'El canje de puntos no aplicó a ningún producto.', 1;
        IF (SELECT ISNULL(SUM(delta), 0) FROM dbo.loyalty_ledger WHERE customer_id = @customer_id AND program = N'POINTS') < @costo
            THROW 51000, 'Al cliente ya no le alcanzan los puntos.', 1;
        INSERT INTO dbo.loyalty_ledger (customer_id, program, delta, kind, reason, sale_id, sale_detail_id, reward_definition_id, amount, user_id)
        VALUES (@customer_id, N'POINTS', -@costo, N'REDEEM', N'CANJE', @sale_id,
                CASE WHEN @kind = N'FREE_PRODUCT' THEN (SELECT TOP 1 sale_detail_id FROM @lineas WHERE regla = N'points' ORDER BY line_no) END,
                @reward, @monto_p, @user_id);
    END

    IF @card IS NOT NULL
    BEGIN
        DECLARE @req INT = (SELECT stamps_required FROM dbo.loyalty_stamp_cards WHERE id = @card AND active = 1);
        IF @req IS NULL OR @req <> @sellos_q
            THROW 51000, 'La tarjeta de sellos cambió: vuelve a elegir el canje.', 1;
        IF ISNULL(@monto_s, 0) <= 0
            THROW 51000, 'El canje de sellos no aplicó a ningún producto.', 1;
        IF (SELECT ISNULL(SUM(delta), 0) FROM dbo.loyalty_ledger
             WHERE customer_id = @customer_id AND program = N'STAMPS' AND card_id = @card) < @req
            THROW 51000, 'Al cliente ya no le alcanzan los sellos.', 1;
        INSERT INTO dbo.loyalty_ledger (customer_id, program, card_id, delta, kind, reason, sale_id, sale_detail_id, amount, user_id)
        VALUES (@customer_id, N'STAMPS', @card, -@req, N'REDEEM', N'CANJE', @sale_id,
                (SELECT TOP 1 sale_detail_id FROM @lineas WHERE regla = N'stamps' ORDER BY line_no), @monto_s, @user_id);
    END
END;
GO
