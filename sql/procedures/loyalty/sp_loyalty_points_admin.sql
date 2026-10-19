SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_admin (0064) =====================
   Fidelización > Puntos.

     1  configuración
     2  indicadores del mes: puntos dados, canjeados, vigentes (lo que el
        negocio le debe a sus clientes), clientes con saldo, sellos y
        tarjetas canjeadas
     3  tarjetas de sellos (con sus productos en JSON)
     4  recompensas que se pueden poner en el catálogo de canje
     5  clientes con movimiento (búsqueda por nombre o teléfono)
   ======================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_admin
    @buscar NVARCHAR(80) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @mes DATETIME2(0) = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1);
    SET @buscar = NULLIF(LTRIM(RTRIM(@buscar)), N'');
    DECLARE @digitos NVARCHAR(80) = NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(@buscar, N''), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), N'');
    IF @digitos LIKE N'%[^0-9]%' SET @digitos = NULL;

    /* 1 */
    SELECT enabled, per_amount, points_per, visit_points, expiry_months, updated_at FROM dbo.loyalty_points_config WHERE id = 1;

    /* 2 */
    SELECT
        ISNULL((SELECT SUM(delta) FROM dbo.loyalty_ledger WHERE program = N'POINTS' AND kind = N'EARN' AND created_at >= @mes), 0) AS dados_mes,
        ISNULL((SELECT -SUM(delta) FROM dbo.loyalty_ledger WHERE program = N'POINTS' AND kind = N'REDEEM' AND created_at >= @mes), 0) AS canjeados_mes,
        ISNULL((SELECT SUM(delta) FROM dbo.loyalty_ledger WHERE program = N'POINTS'), 0) AS vigentes,
        (SELECT COUNT(*) FROM (SELECT customer_id FROM dbo.loyalty_ledger WHERE program = N'POINTS'
                                GROUP BY customer_id HAVING SUM(delta) > 0) x) AS clientes_con_saldo,
        ISNULL((SELECT SUM(delta) FROM dbo.loyalty_ledger WHERE program = N'STAMPS' AND kind = N'EARN' AND created_at >= @mes), 0) AS sellos_mes,
        (SELECT COUNT(*) FROM dbo.loyalty_ledger WHERE program = N'STAMPS' AND kind = N'REDEEM' AND created_at >= @mes) AS tarjetas_mes,
        ISNULL((SELECT SUM(amount) FROM dbo.loyalty_ledger WHERE kind = N'REDEEM' AND created_at >= @mes), 0) AS descuento_mes;

    /* 3 */
    SELECT c.id, LOWER(CONVERT(VARCHAR(36), c.uuid)) AS uuid, c.name, c.stamps_required, c.reward_product_id,
           rp.nombre AS reward_product_name, c.active, c.origin,
           (SELECT COUNT(*) FROM (SELECT customer_id FROM dbo.loyalty_ledger l WHERE l.card_id = c.id
                                   GROUP BY customer_id HAVING SUM(delta) > 0) x) AS clientes,
           (SELECT cp.product_id AS id, pr.nombre AS nombre FROM dbo.loyalty_stamp_card_products cp
              JOIN dbo.products pr ON pr.id = cp.product_id WHERE cp.card_id = c.id ORDER BY pr.nombre FOR JSON PATH) AS productos_json
      FROM dbo.loyalty_stamp_cards c
      LEFT JOIN dbo.products rp ON rp.id = c.reward_product_id
     ORDER BY c.active DESC, c.name;

    /* 4 */
    SELECT rd.id, rd.name, rd.kind, rd.product_id, pr.nombre AS product_name, rd.amount, rd.discount_pct, rd.points_cost, rd.active,
           (SELECT COUNT(*) FROM dbo.loyalty_ledger l WHERE l.reward_definition_id = rd.id AND l.kind = N'REDEEM') AS canjes
      FROM dbo.reward_definitions rd
      LEFT JOIN dbo.products pr ON pr.id = rd.product_id
     WHERE rd.kind IN (N'FREE_PRODUCT', N'AMOUNT', N'PERCENT') AND (rd.active = 1 OR rd.points_cost IS NOT NULL)
     ORDER BY CASE WHEN rd.points_cost IS NULL THEN 1 ELSE 0 END, rd.points_cost, rd.name;

    /* 5 */
    SELECT TOP (200) c.id, c.customerName AS cliente, COALESCE(NULLIF(c.mobile, N''), c.phone) AS telefono,
           ISNULL(SUM(CASE WHEN l.program = N'POINTS' THEN l.delta END), 0) AS puntos,
           (SELECT k.name AS tarjeta, k.stamps_required AS requeridos, SUM(s.delta) AS sellos
              FROM dbo.loyalty_ledger s JOIN dbo.loyalty_stamp_cards k ON k.id = s.card_id
             WHERE s.customer_id = c.id AND s.program = N'STAMPS'
             GROUP BY k.name, k.stamps_required FOR JSON PATH) AS sellos_json,
           MAX(l.created_at) AS ultimo
      FROM dbo.customers c
      JOIN dbo.loyalty_ledger l ON l.customer_id = c.id
     WHERE @buscar IS NULL OR c.customerName LIKE N'%' + @buscar + N'%'
        OR (@digitos IS NOT NULL AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(COALESCE(NULLIF(c.mobile, N''), c.phone), N''),
              N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N'') LIKE N'%' + @digitos + N'%')
     GROUP BY c.id, c.customerName, c.mobile, c.phone
     ORDER BY MAX(l.created_at) DESC;
END;
GO
