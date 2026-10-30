/* sp_platform_settlement_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ==================== sp_platform_settlement_get (0069) ====================
   Una liquidacion y su conciliacion contra la caja.

     1  encabezado   desglose, deposito esperado y real, y los conteos
     2  pedidos      cada pedido de la plataforma con su venta, si la hay:
                       OK            emparejado y mismo importe
                       DIFERENCIA    emparejado, importe distinto
                       FALTA_EN_CAJA la plataforma lo cobro, la caja no lo tiene
                       CANCELADO     la plataforma lo cancelo
     3  sobrantes    ventas pagadas en plataforma, del periodo, que ningun
                     pedido reclamo (de esta plataforma o sin plataforma)
   En una liquidacion CONFIRMADA o CANCELADA no hay sobrantes: ya se cerro.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_get
    @settlement_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @estado VARCHAR(10) = (SELECT status FROM dbo.platform_settlements WHERE id = @settlement_id);
    IF @estado IS NULL THROW 51000, 'La liquidacion no existe.', 1;

    CREATE TABLE #candidatas (sale_id INT PRIMARY KEY, datee DATETIME2(0), dia DATE, amount DECIMAL(14, 2),
        reference NVARCHAR(100) COLLATE DATABASE_DEFAULT, nref NVARCHAR(100) COLLATE DATABASE_DEFAULT, channel_id NVARCHAR(64) COLLATE DATABASE_DEFAULT, channel_name NVARCHAR(120) COLLATE DATABASE_DEFAULT,
        mapped BIT, in_period BIT);
    IF @estado = 'BORRADOR'
        EXEC dbo.sp_platform_settlement_candidates @settlement_id = @settlement_id;

    /* Lo que la caja cobro en plataforma por cada venta emparejada. */
    SELECT o.id, o.line_no, o.platform_order_id, o.order_at, o.customer, o.fulfillment, o.platform_status,
           o.sales_base, o.tax, o.sales_total, o.net_amount, o.cancelled, o.sale_id, o.match_kind,
           s.datee AS sale_datee,
           CAST(ISNULL(p.amount, s.total) AS DECIMAL(14, 2)) AS caja_amount,
           p.reference AS caja_reference,
           JSON_VALUE(s.commercial_snapshot, '$.channelName') AS caja_channel,
           CASE WHEN o.cancelled = 1 THEN 'CANCELADO'
                WHEN o.sale_id IS NULL THEN 'FALTA_EN_CAJA'
                WHEN ISNULL(p.amount, s.total) = o.sales_total THEN 'OK'
                ELSE 'DIFERENCIA' END AS estado
      INTO #p
      FROM dbo.platform_settlement_orders o
      LEFT JOIN dbo.sales s ON s.id = o.sale_id
      LEFT JOIN dbo.sale_payments p ON p.sale_id = s.id AND p.payment_method = 'PLATAFORMA'
     WHERE o.settlement_id = @settlement_id;

    SELECT c.sale_id, c.datee, c.amount, c.reference, c.channel_name, c.mapped
      INTO #s
      FROM #candidatas c
     WHERE c.in_period = 1
       AND NOT EXISTS (SELECT 1 FROM #p p WHERE p.sale_id = c.sale_id);

    /* ================================ 1 encabezado */
    SELECT t.id, t.platform, t.period_from, t.period_to, t.status, t.source_file,
           t.gross_sales, t.marketing, t.service_fees, t.refunds, t.isr_withheld, t.iva_withheld,
           t.other_adjustments, t.iva_rate, t.deposit_expected, t.deposit_real, t.deposit_date,
           CAST(t.deposit_real - t.deposit_expected AS DECIMAL(14, 2)) AS deposit_difference,
           t.note, t.expense_id, t.created_at, uc.usuario AS created_by_name,
           t.confirmed_at, uf.usuario AS confirmed_by_name, t.voided_at, uv.usuario AS voided_by_name, t.void_reason,
           /* Lo que toca resultados, sin IVA, como se repartira al confirmar. */
           CAST(t.service_fees / (1 + t.iva_rate) AS DECIMAL(14, 2)) AS fee_base,
           CAST(t.service_fees - t.service_fees / (1 + t.iva_rate) AS DECIMAL(14, 2)) AS fee_iva,
           CAST(t.marketing / (1 + t.iva_rate) AS DECIMAL(14, 2)) AS marketing_base,
           CAST(t.refunds / (1 + t.iva_rate) + t.other_adjustments AS DECIMAL(14, 2)) AS refunds_base,
           (SELECT COUNT(*) FROM #p) AS pedidos,
           (SELECT COUNT(*) FROM #p WHERE estado = 'OK') AS pedidos_ok,
           (SELECT COUNT(*) FROM #p WHERE estado = 'DIFERENCIA') AS pedidos_diferencia,
           (SELECT COUNT(*) FROM #p WHERE estado = 'FALTA_EN_CAJA') AS pedidos_faltan,
           (SELECT COUNT(*) FROM #p WHERE estado = 'CANCELADO') AS pedidos_cancelados,
           (SELECT COUNT(*) FROM #s) AS caja_sobrantes,
           CAST((SELECT ISNULL(SUM(sales_total), 0) FROM #p WHERE cancelled = 0) AS DECIMAL(14, 2)) AS total_plataforma,
           CAST((SELECT ISNULL(SUM(caja_amount), 0) FROM #p WHERE sale_id IS NOT NULL) AS DECIMAL(14, 2)) AS total_caja_emparejado,
           CAST((SELECT ISNULL(SUM(sales_total), 0) FROM #p WHERE estado = 'FALTA_EN_CAJA') AS DECIMAL(14, 2)) AS total_faltan,
           CAST((SELECT ISNULL(SUM(amount), 0) FROM #s) AS DECIMAL(14, 2)) AS total_sobrantes
      FROM dbo.platform_settlements t
      LEFT JOIN dbo.users uc ON uc.id = t.created_by
      LEFT JOIN dbo.users uf ON uf.id = t.confirmed_by
      LEFT JOIN dbo.users uv ON uv.id = t.voided_by
     WHERE t.id = @settlement_id;

    /* ================================ 2 pedidos */
    SELECT id, line_no, platform_order_id, order_at, customer, fulfillment, platform_status,
           sales_base, tax, sales_total, net_amount, cancelled, sale_id, match_kind, sale_datee,
           caja_amount, caja_reference, caja_channel,
           CAST(CASE WHEN sale_id IS NULL THEN NULL ELSE caja_amount - sales_total END AS DECIMAL(14, 2)) AS diferencia,
           estado
      FROM #p
     ORDER BY CASE estado WHEN 'FALTA_EN_CAJA' THEN 0 WHEN 'DIFERENCIA' THEN 1 WHEN 'OK' THEN 2 ELSE 3 END, order_at, line_no;

    /* ================================ 3 sobrantes */
    SELECT sale_id, datee, amount, reference, channel_name, mapped FROM #s ORDER BY datee;
END
GO
