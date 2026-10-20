/* sp_get_profit_overview
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Utilidad por día (pestaña "Caja y utilidad" de Estadísticas).
-- Utilidad = (precio cobrado SIN IVA) - (costo del renglón).
-- 0062: el costo es el CONGELADO al vender (sale_detail.unit_cost), no el
-- costo de hoy: cambiar un costo ya no reescribe la utilidad de días pasados.
-- La tasa de IVA también es la congelada del renglón. Los renglones viejos
-- sin costo o sin tasa usan los del producto (misma regla que
-- sp_income_statement).
CREATE OR ALTER PROCEDURE dbo.sp_get_profit_overview
    @from_date DATE = NULL,
    @to_date   DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @from_date IS NULL SET @from_date = DATEADD(DAY, -6, CAST(GETDATE() AS DATE));
    IF @to_date   IS NULL SET @to_date   = CAST(GETDATE() AS DATE);

    SELECT
        CAST(s.datee AS DATE) AS datee,
        SUM(
            CASE WHEN ISNULL(sd.tax_object, '02') = '02'
                 THEN sd.subtotal / (1 + ISNULL(sd.tax_rate, ISNULL(p.tasa_iva, 0)))
                 ELSE sd.subtotal END
          - sd.quantity * COALESCE(sd.unit_cost, p.cost, 0)
        ) AS profit
    FROM dbo.sales s
    INNER JOIN dbo.sale_detail sd ON sd.sale_id = s.id
    INNER JOIN dbo.products p     ON p.id = sd.product_id
    WHERE s.datee >= @from_date
      AND s.datee <  DATEADD(DAY, 1, @to_date)
    GROUP BY CAST(s.datee AS DATE)
    ORDER BY CAST(s.datee AS DATE);
END;
GO
