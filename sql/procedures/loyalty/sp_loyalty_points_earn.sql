SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_earn (0064) =====================
   Lo que una venta suma al cliente: puntos por lo pagado, puntos por la
   visita del día y un sello por cada unidad de los productos de una tarjeta.

   Se llama desde sp_loyalty_evaluate_sale, DESPUÉS del cobro y fuera de su
   transacción, por la misma razón que las campañas: un error aquí nunca
   puede tumbar un cobro.

   IDEMPOTENTE: UX_loyalty_ledger_earn impide ganar dos veces por la misma
   venta, y el candado por cliente hace que dos ventas simultáneas del mismo
   cliente no cuenten dos visitas el mismo día.

   No suma:
     · ventas sin cliente;
     · unidades en $0 (el café del Club, el producto canjeado): un regalo no
       sella la tarjeta que lo regala;
     · nada si la venta ya tiene devoluciones (se evaluó tarde).
   ======================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_earn
    @sale_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @c INT, @total DECIMAL(12,2), @fecha DATETIME;
    SELECT @c = customer_id, @total = total, @fecha = datee FROM dbo.sales WHERE id = @sale_id;
    IF @c IS NULL RETURN;
    IF EXISTS (SELECT 1 FROM dbo.sale_refunds WHERE sale_id = @sale_id) RETURN;

    DECLARE @enabled BIT, @per_amount DECIMAL(12,2), @points_per INT, @visit INT;
    SELECT @enabled = enabled, @per_amount = per_amount, @points_per = points_per, @visit = visit_points
      FROM dbo.loyalty_points_config WHERE id = 1;

    BEGIN TRAN;
    DECLARE @recurso NVARCHAR(40) = CONCAT(N'wx-loy-', @c);
    EXEC sp_getapplock @Resource = @recurso, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;

    IF @enabled = 1
    BEGIN
        DECLARE @pts INT = CASE WHEN @per_amount IS NULL OR @total <= 0 THEN 0
                                ELSE CAST(FLOOR(@total / @per_amount) AS INT) * @points_per END;
        IF @pts > 0 AND NOT EXISTS (SELECT 1 FROM dbo.loyalty_ledger
                                     WHERE sale_id = @sale_id AND program = N'POINTS' AND kind = N'EARN' AND reason = N'PURCHASE')
            INSERT INTO dbo.loyalty_ledger (customer_id, program, delta, kind, reason, sale_id, amount)
            VALUES (@c, N'POINTS', @pts, N'EARN', N'PURCHASE', @sale_id, @total);

        IF @visit > 0
           AND NOT EXISTS (SELECT 1 FROM dbo.loyalty_ledger l
                            LEFT JOIN dbo.sales s ON s.id = l.sale_id
                            WHERE l.customer_id = @c AND l.program = N'POINTS' AND l.kind = N'EARN' AND l.reason = N'VISIT'
                              AND CAST(ISNULL(s.datee, l.created_at) AS DATE) = CAST(@fecha AS DATE))
            INSERT INTO dbo.loyalty_ledger (customer_id, program, delta, kind, reason, sale_id)
            VALUES (@c, N'POINTS', @visit, N'EARN', N'VISIT', @sale_id);
    END

    /* Sellos: unidades enteras cobradas (> $0) de los productos de cada tarjeta. */
    INSERT INTO dbo.loyalty_ledger (customer_id, program, card_id, delta, kind, reason, sale_id)
    SELECT @c, N'STAMPS', c.id, u.unidades, N'EARN', N'PURCHASE', @sale_id
      FROM dbo.loyalty_stamp_cards c
     CROSS APPLY (SELECT CAST(FLOOR(SUM(d.quantity)) AS INT) AS unidades
                    FROM dbo.sale_detail d
                    JOIN dbo.loyalty_stamp_card_products cp ON cp.card_id = c.id AND cp.product_id = d.product_id
                   WHERE d.sale_id = @sale_id AND d.unitary_price > 0) u
     WHERE c.active = 1 AND u.unidades > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.loyalty_ledger l
                        WHERE l.sale_id = @sale_id AND l.program = N'STAMPS' AND l.card_id = c.id AND l.kind = N'EARN');

    COMMIT;
END;
GO
