/* sp_production_formula_get
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · La fórmula de producción de un producto DIRECT.
   Dos resultados: cabecera (el producto con su precio y existencia; si tiene
   fórmula, su rendimiento y costo por pieza al costo actual) y líneas (con
   existencia y costo por línea). */
CREATE OR ALTER PROCEDURE dbo.sp_production_formula_get
    @product_id INT
AS
BEGIN
    SET NOCOUNT ON;

    /* El producto siempre (precio y existencia, para el margen), con o sin
       formula: tiene_formula dice si ya existe. */
    SELECT p.id AS product_id, p.nombre AS product_name, p.base_uom, p.price AS product_price, p.stock AS product_stock,
           CAST(CASE WHEN f.product_id IS NULL THEN 0 ELSE 1 END AS BIT) AS tiene_formula,
           f.yield_qty, f.notes, f.updated_at,
           ( SELECT ISNULL(SUM(l.qty_base * (1 + l.waste_pct / 100.0) * ISNULL(i.cost, 0)), 0)
               FROM dbo.production_formula_lines l JOIN dbo.products i ON i.id = l.ingredient_product_id
              WHERE l.product_id = p.id ) / NULLIF(f.yield_qty, 0) AS unit_cost
    FROM dbo.products p
    LEFT JOIN dbo.production_formulas f ON f.product_id = p.id
    WHERE p.id = @product_id;

    SELECT l.ingredient_product_id, i.nombre AS ingredient_name, i.base_uom, u.dimension,
           l.qty_base, l.input_qty, l.input_uom, l.waste_pct, l.sort_order,
           i.stock AS ingredient_stock, i.cost AS ingredient_cost,
           l.qty_base * (1 + l.waste_pct / 100.0) * ISNULL(i.cost, 0) AS line_cost
    FROM dbo.production_formula_lines l
    JOIN dbo.products i ON i.id = l.ingredient_product_id
    LEFT JOIN dbo.uoms u ON u.code = i.base_uom
    WHERE l.product_id = @product_id
    ORDER BY l.sort_order, i.nombre;
END
GO
