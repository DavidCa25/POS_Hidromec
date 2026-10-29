/* sp_get_weekly_profit
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <06-12-2025>
-- Description:	<Obtener una utilidad por semana>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_weekly_profit
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @from DATE = DATEADD(DAY, -6, CAST(GETDATE() AS DATE));
    DECLARE @to   DATE = DATEADD(DAY,  1, CAST(GETDATE() AS DATE));

    ;WITH daily AS (
        SELECT
            CAST(s.datee AS DATE)                           AS sale_date,
            /* 0062: venta sin IVA y costo CONGELADO del renglón (antes: venta con
               IVA contra el costo de hoy del producto). */
            SUM(CASE WHEN ISNULL(d.tax_object, '02') = '02'
                     THEN d.subtotal / (1 + ISNULL(d.tax_rate, ISNULL(p.tasa_iva, 0)))
                     ELSE d.subtotal END)                  AS total_sales,
            SUM(d.quantity * COALESCE(d.unit_cost, p.cost, 0)) AS total_cost
        FROM sales        AS s
        JOIN sale_detail  AS d ON d.sale_id   = s.id
        JOIN products     AS p ON p.id        = d.product_id
        WHERE s.datee >= @from
          AND s.datee <  @to
        GROUP BY CAST(s.datee AS DATE)
    )
    /* 0069: lo que las plataformas descontaron (promociones y reembolsos
       bajan la venta; la comision sin IVA, la utilidad), de las liquidaciones
       confirmadas, en el dia de la venta. */
    , pa AS (
        SELECT a.alloc_date, SUM(a.discount_base + a.refund_base) AS descuento, SUM(a.fee_base) AS comision
          FROM dbo.platform_settlement_allocations a
          JOIN dbo.platform_settlements t ON t.id = a.settlement_id AND t.status = 'CONFIRMADA'
         WHERE a.alloc_date >= @from AND a.alloc_date < @to
         GROUP BY a.alloc_date
    )
    SELECT
        d.sale_date,
        d.total_sales - ISNULL(pa.descuento, 0) AS total_sales,
        d.total_cost,
        (d.total_sales - ISNULL(pa.descuento, 0) - d.total_cost - ISNULL(pa.comision, 0)) AS profit
    FROM daily d
    LEFT JOIN pa ON pa.alloc_date = d.sale_date
    ORDER BY d.sale_date;
END;
GO
