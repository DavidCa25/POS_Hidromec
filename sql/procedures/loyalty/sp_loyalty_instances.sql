/* sp_loyalty_instances
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_loyalty_instances — lo que Fidelizacion ha REPARTIDO de verdad.

   El catalogo (`sp_loyalty_catalog`) responde "que promociones tengo
   definidas". Esto responde la otra pregunta, que es la que aparece cuando un
   cliente llega con un codigo en la mano: "¿que se ha entregado, a quien, y
   sigue valiendo?".

   Hasta ahora esa respuesta solo existia en SQL. Un negocio no puede depender
   de que alguien abra SSMS para saber si una recompensa ya se uso.

   VIGENCIA CALCULADA AQUI
   -----------------------
   `vigente` no se guarda: se deriva del estado, los usos y la fecha, con el
   reloj del SERVIDOR. Si lo decidiera la pantalla, dos cajas con la hora
   desajustada mostrarian cosas distintas del mismo cupon.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_loyalty_instances]
    @kind_of NVARCHAR(10),              -- REWARD | COUPON
    @estado NVARCHAR(12) = NULL,        -- ISSUED | REDEEMED | VOID | EXPIRED (derivado) | NULL = todas
    @search NVARCHAR(120) = NULL,       -- codigo, cliente o nombre de la promocion
    @top INT = 300
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ahora DATETIME2(0) = SYSDATETIME();   /* hora local: misma politica que sp_loyalty_evaluate_sale */
    IF ISNULL(@top, 0) < 1 SET @top = 300;
    SET @search = NULLIF(LTRIM(RTRIM(ISNULL(@search, N''))), N'');
    SET @kind_of = UPPER(LTRIM(RTRIM(ISNULL(@kind_of, N'REWARD'))));

    IF @kind_of = 'REWARD'
    BEGIN
        SELECT TOP (@top)
            ri.id,
            ri.code,
            rd.id AS definition_id,
            rd.name AS promocion,
            rd.kind,
            rd.amount,
            rd.discount_pct,
            p.nombre AS product_name,
            ri.customer_id,
            c.customerName AS cliente,
            ri.campaign_id,
            cp.name AS campana,
            ri.sale_id,
            ri.register_id,
            rg.name AS caja,
            ri.machine_id,
            ri.issued_at,
            ri.expires_at,
            ri.status,
            ri.uses_count,
            ri.uses_allowed,
            /* Caducado es un estado REAL aunque la fila siga diciendo ISSUED:
               nadie recorre la tabla a medianoche para marcarlas. */
            CAST(CASE WHEN ri.status = 'ISSUED'
                       AND ri.uses_count < ri.uses_allowed
                       AND (ri.expires_at IS NULL OR ri.expires_at >= @ahora)
                      THEN 1 ELSE 0 END AS BIT) AS vigente,
            CASE WHEN ri.status = 'VOID' THEN 'ANULADO'
                 WHEN ri.status = 'REDEEMED' OR ri.uses_count >= ri.uses_allowed THEN 'USADO'
                 WHEN ri.expires_at IS NOT NULL AND ri.expires_at < @ahora THEN 'VENCIDO'
                 ELSE 'VIGENTE' END AS situacion,
            (SELECT MAX(lr.created_at) FROM dbo.loyalty_redemptions lr
              WHERE lr.reward_instance_id = ri.id) AS ultima_redencion,
            (SELECT MAX(lr.sale_id) FROM dbo.loyalty_redemptions lr
              WHERE lr.reward_instance_id = ri.id) AS venta_redencion
        FROM dbo.reward_instances ri
        JOIN dbo.reward_definitions rd ON rd.id = ri.definition_id
        LEFT JOIN dbo.products p ON p.id = rd.product_id
        LEFT JOIN dbo.customers c ON c.id = ri.customer_id
        LEFT JOIN dbo.campaigns cp ON cp.id = ri.campaign_id
        LEFT JOIN dbo.registers rg ON rg.id = ri.register_id
        WHERE (@search IS NULL
               OR ri.code LIKE '%' + @search + '%'
               OR rd.name LIKE '%' + @search + '%'
               OR c.customerName LIKE '%' + @search + '%')
          AND (@estado IS NULL
               OR (@estado = 'EXPIRED' AND ri.expires_at IS NOT NULL AND ri.expires_at < @ahora
                   AND ri.status = 'ISSUED')
               OR (@estado <> 'EXPIRED' AND ri.status = @estado))
        ORDER BY ri.id DESC;
        RETURN;
    END

    IF @kind_of = 'COUPON'
    BEGIN
        SELECT TOP (@top)
            ci.id,
            ci.code,
            cd.id AS definition_id,
            cd.name AS promocion,
            cd.kind,
            cd.amount,
            cd.discount_pct,
            p.nombre AS product_name,
            ci.customer_id,
            c.customerName AS cliente,
            ci.campaign_id,
            cp.name AS campana,
            ci.sale_id,
            ci.register_id,
            rg.name AS caja,
            ci.machine_id,
            ci.issued_at,
            ci.expires_at,
            ci.status,
            ci.uses_count,
            ci.uses_allowed,
            CAST(CASE WHEN ci.status = 'ISSUED'
                       AND ci.uses_count < ci.uses_allowed
                       AND (ci.expires_at IS NULL OR ci.expires_at >= @ahora)
                      THEN 1 ELSE 0 END AS BIT) AS vigente,
            CASE WHEN ci.status = 'VOID' THEN 'ANULADO'
                 WHEN ci.status = 'REDEEMED' OR ci.uses_count >= ci.uses_allowed THEN 'USADO'
                 WHEN ci.expires_at IS NOT NULL AND ci.expires_at < @ahora THEN 'VENCIDO'
                 ELSE 'VIGENTE' END AS situacion,
            (SELECT MAX(lr.created_at) FROM dbo.loyalty_redemptions lr
              WHERE lr.coupon_instance_id = ci.id) AS ultima_redencion,
            (SELECT MAX(lr.sale_id) FROM dbo.loyalty_redemptions lr
              WHERE lr.coupon_instance_id = ci.id) AS venta_redencion
        FROM dbo.coupon_instances ci
        JOIN dbo.coupon_definitions cd ON cd.id = ci.definition_id
        LEFT JOIN dbo.products p ON p.id = cd.product_id
        LEFT JOIN dbo.customers c ON c.id = ci.customer_id
        LEFT JOIN dbo.campaigns cp ON cp.id = ci.campaign_id
        LEFT JOIN dbo.registers rg ON rg.id = ci.register_id
        WHERE (@search IS NULL
               OR ci.code LIKE '%' + @search + '%'
               OR cd.name LIKE '%' + @search + '%'
               OR c.customerName LIKE '%' + @search + '%')
          AND (@estado IS NULL
               OR (@estado = 'EXPIRED' AND ci.expires_at IS NOT NULL AND ci.expires_at < @ahora
                   AND ci.status = 'ISSUED')
               OR (@estado <> 'EXPIRED' AND ci.status = @estado))
        ORDER BY ci.id DESC;
        RETURN;
    END

    RAISERROR('kind_of desconocido: use REWARD o COUPON.', 16, 1);
END
GO
