SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_customer_status (0064) =====================
   Lo que la caja enseña de los puntos y sellos del cliente elegido.

     1  configuración de puntos y el saldo del cliente (con su caducidad)
     2  tarjetas de sellos activas, con los sellos que lleva el cliente
     3  productos que sellan cada tarjeta (y con los que se canjea si la
        tarjeta no fija uno)
     4  catálogo de canje: recompensas con costo en puntos

   CADUCIDAD: si la configuración tiene `expiry_months` y el cliente no ha
   ganado ni canjeado en ese tiempo, su saldo caduca AQUÍ (un movimiento
   EXPIRE). Se hace al preguntar, que es cuando importa: nadie necesita un
   proceso nocturno para un saldo que no se consulta.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_customer_status
    @customer_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @enabled BIT, @per_amount DECIMAL(12,2), @points_per INT, @visit INT, @meses INT;
    SELECT @enabled = enabled, @per_amount = per_amount, @points_per = points_per, @visit = visit_points, @meses = expiry_months
      FROM dbo.loyalty_points_config WHERE id = 1;

    IF @customer_id IS NOT NULL AND @meses IS NOT NULL
    BEGIN
        BEGIN TRAN;
        DECLARE @recurso NVARCHAR(40) = CONCAT(N'wx-loy-', @customer_id);
        EXEC sp_getapplock @Resource = @recurso, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
        DECLARE @saldo INT = (SELECT ISNULL(SUM(delta), 0) FROM dbo.loyalty_ledger WHERE customer_id = @customer_id AND program = N'POINTS');
        DECLARE @ult DATETIME2(0) = (SELECT MAX(created_at) FROM dbo.loyalty_ledger
                                      WHERE customer_id = @customer_id AND program = N'POINTS' AND kind IN (N'EARN', N'REDEEM'));
        IF @saldo > 0 AND @ult IS NOT NULL AND DATEADD(MONTH, @meses, @ult) < SYSDATETIME()
            INSERT INTO dbo.loyalty_ledger (customer_id, program, delta, kind, note)
            VALUES (@customer_id, N'POINTS', -@saldo, N'EXPIRE', CONCAT(N'Sin movimiento desde ', CONVERT(VARCHAR(10), @ult, 23)));
        COMMIT;
    END

    /* 1 configuración y saldo */
    SELECT ISNULL(@enabled, 0) AS enabled, @per_amount AS per_amount, ISNULL(@points_per, 1) AS points_per,
           ISNULL(@visit, 0) AS visit_points, @meses AS expiry_months,
           ISNULL(s.saldo, 0) AS puntos, s.ultimo,
           CASE WHEN @meses IS NULL OR s.ultimo IS NULL OR ISNULL(s.saldo, 0) <= 0 THEN NULL
                ELSE CAST(DATEADD(MONTH, @meses, s.ultimo) AS DATE) END AS vencen
      FROM (SELECT SUM(delta) AS saldo,
                   MAX(CASE WHEN kind IN (N'EARN', N'REDEEM') THEN created_at END) AS ultimo
              FROM dbo.loyalty_ledger WHERE customer_id = @customer_id AND program = N'POINTS') s;

    /* 2 tarjetas de sellos */
    SELECT c.id, LOWER(CONVERT(VARCHAR(36), c.uuid)) AS uuid, c.name, c.stamps_required, c.reward_product_id,
           rp.nombre AS reward_product_name,
           ISNULL((SELECT SUM(l.delta) FROM dbo.loyalty_ledger l
                    WHERE l.customer_id = @customer_id AND l.program = N'STAMPS' AND l.card_id = c.id), 0) AS sellos
      FROM dbo.loyalty_stamp_cards c
      LEFT JOIN dbo.products rp ON rp.id = c.reward_product_id
     WHERE c.active = 1
     ORDER BY c.name;

    /* 3 productos de cada tarjeta (+ el de canje si es otro) */
    SELECT x.card_id, pr.id AS product_id, pr.nombre, pr.price, pr.inventory_mode, pr.tasa_iva, pr.objeto_impuesto,
           pr.clave_prod_serv, pr.clave_unidad, x.es_premio
      FROM (SELECT cp.card_id, cp.product_id, CAST(CASE WHEN c.reward_product_id IS NULL OR c.reward_product_id = cp.product_id THEN 1 ELSE 0 END AS BIT) AS es_premio
              FROM dbo.loyalty_stamp_card_products cp JOIN dbo.loyalty_stamp_cards c ON c.id = cp.card_id WHERE c.active = 1
            UNION
            SELECT c.id, c.reward_product_id, CAST(1 AS BIT) FROM dbo.loyalty_stamp_cards c
             WHERE c.active = 1 AND c.reward_product_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM dbo.loyalty_stamp_card_products cp WHERE cp.card_id = c.id AND cp.product_id = c.reward_product_id)) x
      JOIN dbo.products pr ON pr.id = x.product_id
     ORDER BY x.card_id, pr.nombre;

    /* 4 catálogo de canje */
    SELECT rd.id, rd.name, rd.kind, rd.product_id, rd.amount, rd.discount_pct, rd.points_cost,
           pr.nombre AS product_name, pr.price AS product_price, pr.inventory_mode AS product_inventory_mode,
           pr.tasa_iva AS product_tasa_iva, pr.objeto_impuesto AS product_objeto_impuesto,
           pr.clave_prod_serv AS product_clave_prod_serv, pr.clave_unidad AS product_clave_unidad
      FROM dbo.reward_definitions rd
      LEFT JOIN dbo.products pr ON pr.id = rd.product_id
     WHERE rd.active = 1 AND rd.points_cost IS NOT NULL AND rd.kind IN (N'FREE_PRODUCT', N'AMOUNT', N'PERCENT')
       AND ISNULL(@enabled, 0) = 1
     ORDER BY rd.points_cost, rd.name;
END;
GO
