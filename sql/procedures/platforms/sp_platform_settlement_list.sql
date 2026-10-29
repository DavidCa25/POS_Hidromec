/* sp_platform_settlement_list
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* =================== sp_platform_settlement_list (0069) ===================
   Las liquidaciones cuyo periodo toca [@desde, @hasta] y lo que las
   plataformas le deben al negocio HOY.

     1  liquidaciones   encabezado de cada una (sin las canceladas, salvo
                        @include_voided = 1)
     2  por cobrar      por plataforma:
                          sin_liquidar   ventas pagadas en plataforma de un
                                         canal de esa plataforma que ninguna
                                         liquidacion viva tiene (al ticket)
                          sin_deposito   confirmadas cuyo deposito no llega
                                         (al deposito esperado)
                          retenciones e IVA de comision del rango, de las
                          confirmadas: acreditables, no gasto
     3  sin plataforma  ventas pagadas en plataforma cuyo canal no esta
                        ligado a ninguna plataforma (del rango)
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_list
    @platform       VARCHAR(12) = NULL,
    @desde          DATE = NULL,
    @hasta          DATE = NULL,
    @include_voided BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF @hasta IS NULL SET @hasta = CAST(GETDATE() AS DATE);
    IF @desde IS NULL SET @desde = DATEADD(DAY, -90, @hasta);
    SET @platform = NULLIF(UPPER(LTRIM(RTRIM(@platform))), '');

    /* ================================ 1 liquidaciones */
    SELECT t.id, t.platform, t.period_from, t.period_to, t.status, t.source_file,
           t.gross_sales, t.marketing, t.service_fees, t.refunds, t.isr_withheld, t.iva_withheld, t.other_adjustments,
           t.deposit_expected, t.deposit_real, t.deposit_date,
           CAST(t.deposit_real - t.deposit_expected AS DECIMAL(14, 2)) AS deposit_difference,
           t.created_at, t.confirmed_at, t.voided_at, t.void_reason,
           (SELECT COUNT(*) FROM dbo.platform_settlement_orders o WHERE o.settlement_id = t.id) AS pedidos,
           (SELECT COUNT(*) FROM dbo.platform_settlement_orders o WHERE o.settlement_id = t.id AND o.sale_id IS NULL AND o.cancelled = 0) AS pedidos_faltan
      FROM dbo.platform_settlements t
     WHERE (@platform IS NULL OR t.platform = @platform)
       AND t.period_from <= @hasta AND t.period_to >= @desde
       AND (@include_voided = 1 OR t.status <> 'CANCELADA')
     ORDER BY t.period_to DESC, t.id DESC;

    /* ================================ 2 por cobrar */
    ;WITH plataformas AS (
        SELECT v.platform FROM (VALUES ('UBER_EATS'), ('DIDI_FOOD'), ('RAPPI')) v(platform)
         WHERE @platform IS NULL OR v.platform = @platform),
    pendientes AS (
        SELECT pc.platform, s.id, s.datee, CAST(ISNULL(p.amount, s.total) AS DECIMAL(14, 2)) AS amount
          FROM dbo.sales s
          JOIN dbo.platform_channels pc ON pc.channel_id = JSON_VALUE(s.commercial_snapshot, '$.channel')
          LEFT JOIN dbo.sale_payments p ON p.sale_id = s.id AND p.payment_method = 'PLATAFORMA'
         WHERE (p.id IS NOT NULL OR (s.payment_method = 'PLATAFORMA' AND NOT EXISTS (SELECT 1 FROM dbo.sale_payments x WHERE x.sale_id = s.id)))
           AND NOT EXISTS (SELECT 1 FROM dbo.platform_settlement_orders o JOIN dbo.platform_settlements t ON t.id = o.settlement_id
                            WHERE o.sale_id = s.id AND t.status <> 'CANCELADA')
           AND NOT EXISTS (SELECT 1 FROM dbo.platform_settlement_allocations a JOIN dbo.platform_settlements t ON t.id = a.settlement_id
                            WHERE a.sale_id = s.id AND t.status = 'CONFIRMADA'))
    SELECT pl.platform,
           (SELECT COUNT(*) FROM pendientes x WHERE x.platform = pl.platform) AS ventas_sin_liquidar,
           CAST((SELECT ISNULL(SUM(amount), 0) FROM pendientes x WHERE x.platform = pl.platform) AS DECIMAL(14, 2)) AS importe_sin_liquidar,
           (SELECT MIN(CAST(datee AS DATE)) FROM pendientes x WHERE x.platform = pl.platform) AS desde_sin_liquidar,
           (SELECT COUNT(*) FROM dbo.platform_settlements t WHERE t.platform = pl.platform AND t.status = 'CONFIRMADA' AND t.deposit_real IS NULL) AS liquidaciones_sin_deposito,
           CAST((SELECT ISNULL(SUM(deposit_expected), 0) FROM dbo.platform_settlements t
                  WHERE t.platform = pl.platform AND t.status = 'CONFIRMADA' AND t.deposit_real IS NULL) AS DECIMAL(14, 2)) AS importe_sin_deposito,
           CAST((SELECT ISNULL(SUM(isr_withheld), 0) FROM dbo.platform_settlements t
                  WHERE t.platform = pl.platform AND t.status = 'CONFIRMADA' AND t.period_to BETWEEN @desde AND @hasta) AS DECIMAL(14, 2)) AS isr_retenido,
           CAST((SELECT ISNULL(SUM(iva_withheld), 0) FROM dbo.platform_settlements t
                  WHERE t.platform = pl.platform AND t.status = 'CONFIRMADA' AND t.period_to BETWEEN @desde AND @hasta) AS DECIMAL(14, 2)) AS iva_retenido,
           CAST((SELECT ISNULL(SUM(service_fees - service_fees / (1 + iva_rate)), 0) FROM dbo.platform_settlements t
                  WHERE t.platform = pl.platform AND t.status = 'CONFIRMADA' AND t.period_to BETWEEN @desde AND @hasta) AS DECIMAL(14, 2)) AS iva_comision,
           (SELECT COUNT(*) FROM dbo.platform_channels c WHERE c.platform = pl.platform) AS canales
      FROM plataformas pl
     ORDER BY pl.platform DESC;

    /* ================================ 3 sin plataforma */
    SELECT COUNT(*) AS ventas, CAST(ISNULL(SUM(ISNULL(p.amount, s.total)), 0) AS DECIMAL(14, 2)) AS importe
      FROM dbo.sales s
      LEFT JOIN dbo.sale_payments p ON p.sale_id = s.id AND p.payment_method = 'PLATAFORMA'
      LEFT JOIN dbo.platform_channels pc ON pc.channel_id = JSON_VALUE(s.commercial_snapshot, '$.channel')
     WHERE s.datee >= @desde AND s.datee < DATEADD(DAY, 1, @hasta) AND pc.channel_id IS NULL
       AND (p.id IS NOT NULL OR (s.payment_method = 'PLATAFORMA' AND NOT EXISTS (SELECT 1 FROM dbo.sale_payments x WHERE x.sale_id = s.id)))
       AND NOT EXISTS (SELECT 1 FROM dbo.platform_settlement_orders o JOIN dbo.platform_settlements t ON t.id = o.settlement_id
                        WHERE o.sale_id = s.id AND t.status <> 'CANCELADA');
END
GO
