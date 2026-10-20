SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_on_refund (0064) =====================
   Una devolución deshace lo que la venta dio en Fidelización. Se llama desde
   sp_refund_sale, dentro de su transacción. Es ACUMULATIVA: cada vez mira
   todas las devoluciones de la venta y escribe solo la diferencia, así dos
   devoluciones parciales no revierten de más.

     · Puntos por compra: en proporción a lo devuelto (todo, si se devolvió
       la venta completa).
     · Puntos por visita: solo si se devolvió la venta completa.
     · Sellos: uno por unidad devuelta de los productos de la tarjeta.
     · Canjes: si se devuelve el producto canjeado -o la venta completa, en
       un canje de $ o %- el cliente recupera sus puntos o sellos.
     · Recompensas y cupones de campaña que la venta generó y no se han
       usado: se anulan si se devolvió la venta completa.

   El saldo puede quedar negativo (ganó, gastó y devolvió): es la deuda real
   del cliente y se ve tal cual en su historial.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_on_refund
    @refund_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @sale INT = (SELECT sale_id FROM dbo.sale_refunds WHERE id = @refund_id);
    IF @sale IS NULL RETURN;
    DECLARE @c INT, @total DECIMAL(12,2);
    SELECT @c = customer_id, @total = total FROM dbo.sales WHERE id = @sale;

    DECLARE @devuelto DECIMAL(12,2) = (SELECT ISNULL(SUM(refund_total), 0) FROM dbo.sale_refunds WHERE sale_id = @sale);
    DECLARE @dev TABLE (product_id INT PRIMARY KEY, q DECIMAL(12,2), q_cobrada DECIMAL(12,2));
    INSERT INTO @dev
    SELECT rd.product_id, SUM(rd.quantity), SUM(CASE WHEN rd.unitary_price > 0 THEN rd.quantity ELSE 0 END)
      FROM dbo.sale_refund_detail rd JOIN dbo.sale_refunds r ON r.id = rd.refund_id
     WHERE r.sale_id = @sale GROUP BY rd.product_id;
    DECLARE @completa BIT = CASE WHEN NOT EXISTS (
            SELECT 1 FROM (SELECT product_id, SUM(quantity) AS q FROM dbo.sale_detail WHERE sale_id = @sale GROUP BY product_id) s
              LEFT JOIN @dev d ON d.product_id = s.product_id
             WHERE ISNULL(d.q, 0) < s.q) THEN 1 ELSE 0 END;

    IF @completa = 1
    BEGIN
        UPDATE dbo.reward_instances SET status = 'VOID' WHERE sale_id = @sale AND status = 'ISSUED' AND uses_count = 0;
        UPDATE dbo.coupon_instances SET status = 'VOID' WHERE sale_id = @sale AND status = 'ISSUED' AND uses_count = 0;
    END

    IF @c IS NULL RETURN;

    /* Puntos por compra y por visita. */
    DECLARE @g_compra INT, @g_visita INT, @r_compra INT, @r_visita INT;
    SELECT @g_compra = ISNULL(SUM(CASE WHEN kind = N'EARN' AND reason = N'PURCHASE' THEN delta END), 0),
           @g_visita = ISNULL(SUM(CASE WHEN kind = N'EARN' AND reason = N'VISIT' THEN delta END), 0),
           @r_compra = ISNULL(-SUM(CASE WHEN kind = N'REVERSE' AND reason = N'PURCHASE' THEN delta END), 0),
           @r_visita = ISNULL(-SUM(CASE WHEN kind = N'REVERSE' AND reason = N'VISIT' THEN delta END), 0)
      FROM dbo.loyalty_ledger WHERE sale_id = @sale AND program = N'POINTS';

    DECLARE @obj_compra INT = CASE WHEN @completa = 1 THEN @g_compra
                                   WHEN @total > 0 THEN CAST(FLOOR(@g_compra * (@devuelto / @total)) AS INT) ELSE 0 END;
    IF @obj_compra > @g_compra SET @obj_compra = @g_compra;
    IF @obj_compra - @r_compra > 0
        INSERT INTO dbo.loyalty_ledger (customer_id, program, delta, kind, reason, sale_id, refund_id)
        VALUES (@c, N'POINTS', -(@obj_compra - @r_compra), N'REVERSE', N'PURCHASE', @sale, @refund_id);
    IF @completa = 1 AND @g_visita - @r_visita > 0
        INSERT INTO dbo.loyalty_ledger (customer_id, program, delta, kind, reason, sale_id, refund_id)
        VALUES (@c, N'POINTS', -(@g_visita - @r_visita), N'REVERSE', N'VISIT', @sale, @refund_id);

    /* Sellos por tarjeta. */
    INSERT INTO dbo.loyalty_ledger (customer_id, program, card_id, delta, kind, reason, sale_id, refund_id)
    SELECT @c, N'STAMPS', g.card_id, -(x.objetivo - g.revertido), N'REVERSE', N'PURCHASE', @sale, @refund_id
      FROM (SELECT card_id,
                   SUM(CASE WHEN kind = N'EARN' THEN delta ELSE 0 END) AS ganado,
                   ISNULL(-SUM(CASE WHEN kind = N'REVERSE' AND reason = N'PURCHASE' THEN delta ELSE 0 END), 0) AS revertido
              FROM dbo.loyalty_ledger WHERE sale_id = @sale AND program = N'STAMPS' GROUP BY card_id) g
     CROSS APPLY (SELECT CASE WHEN u.unidades > g.ganado THEN g.ganado ELSE u.unidades END AS objetivo
                    FROM (SELECT CAST(FLOOR(ISNULL(SUM(d.q_cobrada), 0)) AS INT) AS unidades
                            FROM @dev d JOIN dbo.loyalty_stamp_card_products cp ON cp.card_id = g.card_id AND cp.product_id = d.product_id) u) x
     WHERE g.ganado > 0 AND x.objetivo - g.revertido > 0;

    /* Canjes devueltos: se regresa lo gastado, una vez. */
    INSERT INTO dbo.loyalty_ledger (customer_id, program, card_id, delta, kind, reason, sale_id, sale_detail_id, reward_definition_id, refund_id)
    SELECT l.customer_id, l.program, l.card_id, -l.delta, N'REVERSE', N'CANJE', @sale, l.sale_detail_id, l.reward_definition_id, @refund_id
      FROM dbo.loyalty_ledger l
      LEFT JOIN dbo.sale_detail sd ON sd.id = l.sale_detail_id
     WHERE l.sale_id = @sale AND l.kind = N'REDEEM'
       AND ((l.sale_detail_id IS NOT NULL AND EXISTS (SELECT 1 FROM @dev d WHERE d.product_id = sd.product_id))
            OR (l.sale_detail_id IS NULL AND @completa = 1))
       AND NOT EXISTS (SELECT 1 FROM dbo.loyalty_ledger v
                        WHERE v.sale_id = @sale AND v.kind = N'REVERSE' AND v.reason = N'CANJE'
                          AND v.program = l.program AND ISNULL(v.card_id, 0) = ISNULL(l.card_id, 0));
END;
GO
