SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_membership_admin (0063) =====================
   Todo lo que enseña Fidelización > Club, en una llamada:

     1  indicadores del mes: socios activos, ingreso, beneficios dados y su
        costo, por vencer en 7 días, canjes dobles sin revisar
     2  planes, con su producto de cobro, precio y productos del beneficio
     3  socios (filtrables por texto y estado), con su estado de hoy
     4  canjes dobles: los que la nube marcó porque el mismo día se dio el
        beneficio de más (una caja sin internet no podía saberlo)
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_membership_admin
    @buscar NVARCHAR(80) = NULL,
    @estado VARCHAR(12)  = NULL     -- ACTIVA | VENCIDA | CANCELADA | POR_VENCER | NULL = todas
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);
    DECLARE @mes DATE = DATEFROMPARTS(YEAR(@hoy), MONTH(@hoy), 1);
    SET @buscar = NULLIF(LTRIM(RTRIM(@buscar)), N'');
    /* El teléfono se busca por sus dígitos: «477 312 4588» y «4773124588» son el mismo. */
    DECLARE @digitos NVARCHAR(80) = NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(@buscar, N''), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), N'');
    IF @digitos IS NOT NULL AND @digitos LIKE N'%[^0-9]%' SET @digitos = NULL;

    SELECT m.id, LOWER(CONVERT(VARCHAR(36), m.uuid)) AS uuid, c.id AS customer_id, c.customerName AS cliente,
           COALESCE(NULLIF(c.mobile, N''), c.phone) AS telefono,
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(COALESCE(NULLIF(c.mobile, N''), c.phone), N''), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N'') AS tel_digitos, p.id AS plan_id, p.name AS plan_name, m.paid_until, m.origin,
           CASE WHEN m.status = N'CANCELLED' THEN 'CANCELADA'
                WHEN m.paid_until IS NULL OR DATEADD(DAY, p.grace_days, m.paid_until) < @hoy THEN 'VENCIDA'
                WHEN m.paid_until <= DATEADD(DAY, 7, @hoy) THEN 'POR_VENCER'
                ELSE 'ACTIVA' END AS estado,
           (SELECT ISNULL(SUM(r.units), 0) FROM dbo.membership_redemptions r
             WHERE r.membership_id = m.id AND r.voided_at IS NULL AND r.redeem_date >= @mes) AS beneficios_mes,
           (SELECT MAX(r.created_at) FROM dbo.membership_redemptions r WHERE r.membership_id = m.id AND r.voided_at IS NULL) AS ultimo_canje
      INTO #socios
      FROM dbo.customer_memberships m
      JOIN dbo.customers c ON c.id = m.customer_id
      JOIN dbo.membership_plans p ON p.id = m.plan_id;

    /* 1 indicadores */
    SELECT
        (SELECT COUNT(*) FROM #socios WHERE estado IN ('ACTIVA', 'POR_VENCER')) AS activos,
        (SELECT COUNT(*) FROM #socios WHERE estado = 'POR_VENCER') AS por_vencer,
        (SELECT COUNT(*) FROM #socios WHERE estado = 'VENCIDA') AS vencidas,
        (SELECT ISNULL(SUM(amount), 0) FROM dbo.membership_payments WHERE voided_at IS NULL AND created_at >= @mes) AS ingreso_mes,
        (SELECT COUNT(*) FROM dbo.membership_payments WHERE voided_at IS NULL AND created_at >= @mes) AS pagos_mes,
        (SELECT ISNULL(SUM(units), 0) FROM dbo.membership_redemptions WHERE voided_at IS NULL AND redeem_date >= @mes) AS beneficios_mes,
        (SELECT ISNULL(SUM(r.units * ISNULL(d.unit_cost, pr.cost)), 0)
           FROM dbo.membership_redemptions r
           LEFT JOIN dbo.sale_detail d ON d.id = r.sale_detail_id
           LEFT JOIN dbo.products pr ON pr.id = r.product_id
          WHERE r.voided_at IS NULL AND r.redeem_date >= @mes AND r.origin = N'LOCAL') AS costo_beneficios_mes,
        (SELECT COUNT(*) FROM dbo.membership_redemptions WHERE doble = 1 AND reviewed_at IS NULL) AS dobles_pendientes;

    /* 2 planes */
    SELECT p.id, LOWER(CONVERT(VARCHAR(36), p.uuid)) AS uuid, p.name, p.sale_product_id, sp.nombre AS sale_product_name, sp.price,
           p.period_days, p.daily_limit, p.grace_days, p.active, p.origin,
           (SELECT COUNT(*) FROM #socios s WHERE s.plan_id = p.id AND s.estado IN ('ACTIVA', 'POR_VENCER')) AS socios_activos,
           (SELECT pp.product_id AS id, pr.nombre AS nombre FROM dbo.membership_plan_products pp JOIN dbo.products pr ON pr.id = pp.product_id
             WHERE pp.plan_id = p.id ORDER BY pr.nombre FOR JSON PATH) AS productos_json
      FROM dbo.membership_plans p
      LEFT JOIN dbo.products sp ON sp.id = p.sale_product_id
     ORDER BY p.active DESC, p.name;

    /* 3 socios */
    SELECT TOP (500) *
      FROM #socios
     WHERE (@buscar IS NULL OR cliente LIKE N'%' + @buscar + N'%' OR (@digitos IS NOT NULL AND tel_digitos LIKE N'%' + @digitos + N'%'))
       AND (@estado IS NULL OR estado = @estado OR (@estado = 'ACTIVA' AND estado = 'POR_VENCER'))
     ORDER BY CASE estado WHEN 'POR_VENCER' THEN 0 WHEN 'VENCIDA' THEN 1 WHEN 'ACTIVA' THEN 2 ELSE 3 END, paid_until, cliente;

    /* 4 canjes dobles */
    SELECT TOP (200) r.id, r.redeem_date, r.created_at, r.units, r.product_name, r.origin,
           ISNULL(r.location_name, N'Esta sucursal') AS sucursal, r.sale_id, c.customerName AS cliente, p.name AS plan_name,
           r.reviewed_at, u.usuario AS revisado_por, r.review_note
      FROM dbo.membership_redemptions r
      JOIN dbo.customer_memberships m ON m.id = r.membership_id
      JOIN dbo.customers c ON c.id = m.customer_id
      JOIN dbo.membership_plans p ON p.id = m.plan_id
      LEFT JOIN dbo.users u ON u.id = r.reviewed_by
     WHERE r.doble = 1
     ORDER BY CASE WHEN r.reviewed_at IS NULL THEN 0 ELSE 1 END, r.redeem_date DESC, r.created_at DESC;
END;
GO
