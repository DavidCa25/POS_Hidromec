/* sp_cloud_daily_profit
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_cloud_daily_profit
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);

    /* 0062: la misma utilidad que Estadísticas y el Estado de resultados.
       Antes restaba `products.last_cost`, columna que no existe, a un precio
       con IVA. Ahora: venta SIN IVA menos el costo congelado del renglón. */
    DECLARE @base DECIMAL(18, 4), @costo DECIMAL(18, 4);
    SELECT @base = ISNULL(SUM(x.base), 0), @costo = ISNULL(SUM(x.costo), 0)
    FROM dbo.sales s
    JOIN dbo.sale_detail sd ON sd.sale_id = s.id
    JOIN dbo.products p ON p.id = sd.product_id
    CROSS APPLY (SELECT
        CASE WHEN ISNULL(sd.tax_object, '02') = '02'
             THEN sd.subtotal / (1 + ISNULL(sd.tax_rate, ISNULL(p.tasa_iva, 0)))
             ELSE sd.subtotal END AS base,
        sd.quantity * COALESCE(sd.unit_cost, p.cost, 0) AS costo) x
    WHERE s.datee >= @hoy
      AND s.datee <  DATEADD(DAY, 1, @hoy);

    /* 0069: lo que las plataformas descuentan (promociones, reembolsos y
       comisión, sin IVA).
         · confirmado: de liquidaciones ya confirmadas, repartido en hoy;
         · estimado: las ventas de hoy pagadas en plataforma que ninguna
           liquidación tiene aún, al porcentaje de la ÚLTIMA liquidación
           confirmada de esa plataforma. Sin liquidación previa no se estima.
       Las retenciones no son gasto: no se restan. */
    DECLARE @confirmado DECIMAL(18, 4) = ISNULL((
        SELECT SUM(a.discount_base + a.refund_base + a.fee_base)
          FROM dbo.platform_settlement_allocations a
          JOIN dbo.platform_settlements t ON t.id = a.settlement_id AND t.status = 'CONFIRMADA'
         WHERE a.alloc_date = @hoy), 0);

    DECLARE @estimado DECIMAL(18, 4) = ISNULL((
        SELECT SUM(CAST(ISNULL(sp.amount, s.total) AS DECIMAL(18, 4)) * r.tasa)
          FROM dbo.sales s
          JOIN dbo.platform_channels pc ON pc.channel_id = JSON_VALUE(s.commercial_snapshot, '$.channel')
          LEFT JOIN dbo.sale_payments sp ON sp.sale_id = s.id AND sp.payment_method = 'PLATAFORMA'
          CROSS APPLY (SELECT TOP (1)
                    (t.marketing / (1 + t.iva_rate) + t.refunds / (1 + t.iva_rate) + t.other_adjustments
                     + t.service_fees / (1 + t.iva_rate)) / t.gross_sales AS tasa
                 FROM dbo.platform_settlements t
                WHERE t.platform = pc.platform AND t.status = 'CONFIRMADA' AND t.gross_sales > 0
                ORDER BY t.period_to DESC, t.id DESC) r
         WHERE s.datee >= @hoy AND s.datee < DATEADD(DAY, 1, @hoy)
           AND (sp.id IS NOT NULL OR (s.payment_method = 'PLATAFORMA' AND NOT EXISTS (SELECT 1 FROM dbo.sale_payments x WHERE x.sale_id = s.id)))
           AND NOT EXISTS (SELECT 1 FROM dbo.platform_settlement_allocations a
                             JOIN dbo.platform_settlements t ON t.id = a.settlement_id AND t.status = 'CONFIRMADA'
                            WHERE a.sale_id = s.id)), 0);

    SELECT
        CAST(@base - @costo - @confirmado - @estimado AS DECIMAL(18, 4)) AS utilidad,
        -- Venta sin IVA: base del margen %
        @base AS venta_bruta,
        CAST(@confirmado AS DECIMAL(18, 2)) AS plataformas_confirmado,
        CAST(@estimado AS DECIMAL(18, 2)) AS plataformas_estimado;
END
GO
