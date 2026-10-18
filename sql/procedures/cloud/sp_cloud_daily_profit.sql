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

    /* 0062: la misma utilidad que Estadísticas y el Estado de resultados.
       Antes restaba `products.last_cost`, columna que no existe, a un precio
       con IVA. Ahora: venta SIN IVA menos el costo congelado del renglón. */
    SELECT
        ISNULL(SUM(x.base - x.costo), 0) AS utilidad,
        -- Venta sin IVA: base del margen %
        ISNULL(SUM(x.base), 0)           AS venta_bruta
    FROM dbo.sales s
    JOIN dbo.sale_detail sd ON sd.sale_id = s.id
    JOIN dbo.products p ON p.id = sd.product_id
    CROSS APPLY (SELECT
        CASE WHEN ISNULL(sd.tax_object, '02') = '02'
             THEN sd.subtotal / (1 + ISNULL(sd.tax_rate, ISNULL(p.tasa_iva, 0)))
             ELSE sd.subtotal END AS base,
        sd.quantity * COALESCE(sd.unit_cost, p.cost, 0) AS costo) x
    WHERE s.datee >= CAST(GETDATE() AS DATE)
      AND s.datee <  DATEADD(DAY, 1, CAST(GETDATE() AS DATE));
END
GO
