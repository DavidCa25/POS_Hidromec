/* sp_socios_ejemplo
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ========================= sp_socios_ejemplo (0079) =======================
   Un producto REAL del negocio para el ejemplo del asistente: su precio y
   el costo de cada insumo de su receta, con la categoria de cada uno. El
   asistente calcula A, B y C con los duenos que se estan eligiendo (aun sin
   guardar), asi que aqui no se resuelve ningun dueno.

   Sin @product_id elige uno: el vendible con receta que mas se ha vendido;
   si no hay, el que mas se ha vendido.

   recordset 1  el producto (id, nombre, precio, categoria)
   recordset 2  lo que gasta UNA unidad: insumo, categoria y costo
   recordset 3  hasta 30 productos para cambiar de ejemplo
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_ejemplo
    @product_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @product_id IS NULL
        SELECT TOP (1) @product_id = p.id
          FROM dbo.products p
          LEFT JOIN (SELECT product_id, SUM(quantity) AS q FROM dbo.sale_detail GROUP BY product_id) v
                 ON v.product_id = p.id
         WHERE p.sellable = 1 AND ISNULL(p.active, 1) = 1 AND p.price > 0
         ORDER BY CASE WHEN p.inventory_mode = 'RECIPE'
                        AND EXISTS (SELECT 1 FROM dbo.recipes r WHERE r.product_id = p.id AND r.active = 1) THEN 0 ELSE 1 END,
                  ISNULL(v.q, 0) DESC, p.id;

    SELECT p.id, p.nombre, p.price AS precio, p.category_id, k.namee AS categoria, p.inventory_mode
      FROM dbo.products p LEFT JOIN dbo.CAT_categories k ON k.id = p.category_id
     WHERE p.id = @product_id;

    DECLARE @receta INT = (SELECT TOP (1) id FROM dbo.recipes
                            WHERE product_id = @product_id AND variant_option_id IS NULL AND active = 1);
    IF @receta IS NOT NULL
        SELECT i.id AS product_id, i.nombre, i.category_id, k.namee AS categoria,
               CAST(rl.qty_base * (1 + rl.waste_pct / 100.0) * ISNULL(i.cost, 0) AS DECIMAL(14, 4)) AS costo
          FROM dbo.recipe_lines rl
          JOIN dbo.products i ON i.id = rl.ingredient_product_id
          LEFT JOIN dbo.CAT_categories k ON k.id = i.category_id
         WHERE rl.recipe_id = @receta
         ORDER BY rl.sort_order, rl.id;
    ELSE
        SELECT p.id AS product_id, p.nombre, p.category_id, k.namee AS categoria,
               CAST(ISNULL(p.cost, 0) AS DECIMAL(14, 4)) AS costo
          FROM dbo.products p LEFT JOIN dbo.CAT_categories k ON k.id = p.category_id
         WHERE p.id = @product_id;

    SELECT TOP (30) p.id, p.nombre, p.price AS precio
      FROM dbo.products p
      LEFT JOIN (SELECT product_id, SUM(quantity) AS q FROM dbo.sale_detail GROUP BY product_id) v
             ON v.product_id = p.id
     WHERE p.sellable = 1 AND ISNULL(p.active, 1) = 1 AND p.price > 0
     ORDER BY ISNULL(v.q, 0) DESC, p.nombre;
END
GO
