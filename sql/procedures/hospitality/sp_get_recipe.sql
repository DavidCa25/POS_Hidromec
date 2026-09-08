/* sp_get_recipe
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Receta de un producto. Con @variant_option_id se busca la receta de esa
-- variante (tamano); si no existe se devuelve la base con is_fallback = 1.
-- Dos resultados: cabecera y lineas (con costo por linea al costo actual).
CREATE OR ALTER PROCEDURE dbo.sp_get_recipe
    @product_id        INT,
    @variant_option_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @recipe_id INT = NULL, @is_fallback BIT = 0;

    IF @variant_option_id IS NOT NULL
        SELECT @recipe_id = id FROM dbo.recipes
        WHERE product_id = @product_id AND variant_option_id = @variant_option_id;

    IF @recipe_id IS NULL
    BEGIN
        SELECT @recipe_id = id FROM dbo.recipes
        WHERE product_id = @product_id AND variant_option_id IS NULL;
        IF @variant_option_id IS NOT NULL AND @recipe_id IS NOT NULL SET @is_fallback = 1;
    END

    SELECT
        r.id            AS recipe_id,
        r.product_id,
        r.variant_option_id,
        @variant_option_id AS requested_variant_option_id,
        @is_fallback    AS is_fallback,
        r.active,
        r.notes,
        r.updated_at,
        p.nombre        AS product_name,
        p.inventory_mode,
        ( SELECT ISNULL(SUM(l.qty_base * ISNULL(i.cost, 0) * (1 + l.waste_pct / 100.0)), 0)
            FROM dbo.recipe_lines l JOIN dbo.products i ON i.id = l.ingredient_product_id
           WHERE l.recipe_id = r.id ) AS unit_cost
    FROM dbo.recipes r
    JOIN dbo.products p ON p.id = r.product_id
    WHERE r.id = @recipe_id;

    SELECT
        l.id            AS recipe_line_id,
        l.recipe_id,
        l.ingredient_product_id,
        i.nombre        AS ingredient_name,
        i.base_uom,
        u.dimension,
        l.qty_base,
        l.input_qty,
        l.input_uom,
        l.waste_pct,
        l.sort_order,
        i.stock         AS ingredient_stock,
        i.cost          AS ingredient_cost,
        l.qty_base * ISNULL(i.cost, 0) * (1 + l.waste_pct / 100.0) AS line_cost
    FROM dbo.recipe_lines l
    JOIN dbo.products i ON i.id = l.ingredient_product_id
    JOIN dbo.uoms u ON u.code = i.base_uom
    WHERE l.recipe_id = @recipe_id
    ORDER BY l.sort_order, l.id;
END
GO
