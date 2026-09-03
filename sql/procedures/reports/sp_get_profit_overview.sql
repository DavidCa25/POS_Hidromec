/* sp_get_profit_overview
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Utilidad por día (pestaña "Caja y utilidad" de Estadísticas).
-- Utilidad = (precio de venta SIN IVA) - (costo del producto).
-- El costo (last_cost) vive en product_suppliers (por proveedor); se toma el del proveedor default.
-- Si un producto no tiene costo registrado, se asume 0 (la utilidad sale como venta completa).

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
            sd.quantity *
            ( sd.unitary_price / (1 + ISNULL(p.tasa_iva, 0.16)) - ISNULL(ps.last_cost, 0) )
        ) AS profit
    FROM dbo.sales s
    INNER JOIN dbo.sale_detail sd ON sd.sale_id = s.id
    INNER JOIN dbo.products p     ON p.id = sd.product_id
    OUTER APPLY (
        SELECT TOP 1 x.last_cost
        FROM dbo.product_suppliers x
        WHERE x.product_id = p.id AND x.active = 1
        ORDER BY x.is_default DESC
    ) ps
    WHERE s.datee >= @from_date
      AND s.datee <  DATEADD(DAY, 1, @to_date)
    GROUP BY CAST(s.datee AS DATE)
    ORDER BY CAST(s.datee AS DATE);
END;
GO
