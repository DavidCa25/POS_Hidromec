/* sp_get_active_products
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<Daniela Luna>
-- Create date: <04/08/2025>
-- Description:	<Productos activos para venta, inventario y compras>
-- Update:      + inventory_mode, sellable, base_uom, allow_decimal_qty,
--                image_version, has_modifiers, cost, category_id (Core).
--              Devuelve TODOS los activos, ingredientes incluidos; las
--              pantallas de venta filtran sellable = 1.
-- Update:      + available_units y limita_* .
--
--              Un producto RECIPE tiene `stock` 0 por diseno: su existencia
--              son sus ingredientes. Las pantallas que leen de aqui -el
--              buscador de Retail, Inventario, Compras- pintaban ese 0 como
--              si fuera disponibilidad y mostraban "0 pz" en un producto que
--              si se podia preparar. El calculo es el mismo que usa
--              sp_get_menu_catalog para Touch, para que las dos experiencias
--              no puedan discrepar.
--
--              + default_presentation_*: en que se compra normalmente el
--              producto, para poder mostrarlo como columna sin una consulta
--              por fila.
-- =============================================

CREATE OR ALTER PROCEDURE [dbo].[sp_get_active_products]
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH receta_base AS (
        SELECT r.product_id, r.id AS recipe_id,
               ROW_NUMBER() OVER (PARTITION BY r.product_id
                                  ORDER BY CASE WHEN r.variant_option_id IS NULL THEN 0 ELSE 1 END, r.id) AS k
        FROM dbo.recipes r
        WHERE r.active = 1
    ),
    lineas AS (
        SELECT rb.product_id,
               i.nombre   AS ing_nombre,
               i.stock    AS ing_stock,
               i.base_uom AS ing_uom,
               rl.qty_base * (1 + rl.waste_pct / 100.0) AS ing_necesita,
               CASE WHEN rl.qty_base * (1 + rl.waste_pct / 100.0) <= 0 THEN 999999
                    ELSE FLOOR(i.stock / (rl.qty_base * (1 + rl.waste_pct / 100.0))) END AS units
        FROM receta_base rb
        JOIN dbo.recipe_lines rl ON rl.recipe_id = rb.recipe_id
        JOIN dbo.products i ON i.id = rl.ingredient_product_id
        WHERE rb.k = 1
    ),
    posibles AS (
        SELECT product_id, units, ing_nombre, ing_stock, ing_uom, ing_necesita
        FROM (
            SELECT l.*, ROW_NUMBER() OVER (PARTITION BY l.product_id
                                           ORDER BY l.units, l.ing_nombre) AS r
            FROM lineas l
        ) t
        WHERE t.r = 1
    )
    SELECT
        p.id,
        p.part_number,
        p.nombre AS product_name,
        p.price,
        p.stock,
        c.namee AS category_name,
        m.namee AS brand_name,
        p.bar_code AS bar_code,
        ds.supplier_name AS default_supplier_name,
        p.category_id,
        p.brand_id,
        p.cost,
        p.clave_prod_serv,
        p.clave_unidad,
        p.objeto_impuesto,
        p.tasa_iva,
        p.inventory_mode,
        p.sellable,
        p.base_uom,
        p.allow_decimal_qty,
        p.image_version,
        CASE WHEN EXISTS (
            SELECT 1 FROM dbo.product_modifier_groups pmg
            JOIN dbo.modifier_groups g ON g.id = pmg.group_id AND g.active = 1
            WHERE pmg.product_id = p.id) THEN 1 ELSE 0 END AS has_modifiers,

        /* Cuantas unidades hay DE VERDAD, segun lo que el producto es. */
        CASE p.inventory_mode
            WHEN 'NONE'   THEN 999999
            WHEN 'DIRECT' THEN FLOOR(p.stock)
            ELSE ISNULL(po.units, 0)
        END AS available_units,

        /* Solo tiene sentido en una receta: quien limita y por cuanto. */
        CASE WHEN p.inventory_mode = 'RECIPE' THEN po.ing_nombre   END AS limita_nombre,
        CASE WHEN p.inventory_mode = 'RECIPE' THEN po.ing_stock    END AS limita_stock,
        CASE WHEN p.inventory_mode = 'RECIPE' THEN po.ing_uom      END AS limita_uom,
        CASE WHEN p.inventory_mode = 'RECIPE' THEN po.ing_necesita END AS limita_necesita,

        /* En que se compra normalmente: para la columna de Inventario. */
        dp.name           AS default_presentation_name,
        dp.factor_to_base AS default_presentation_factor
    FROM products p
    INNER JOIN CAT_categories c ON p.category_id = c.id
    INNER JOIN CAT_brands m ON p.brand_id = m.id
    LEFT JOIN posibles po ON po.product_id = p.id
    OUTER APPLY (
      SELECT TOP 1 s.nombre AS supplier_name
      FROM dbo.product_suppliers ps
      INNER JOIN dbo.CAT_suppliers s ON s.id = ps.supplier_id
      WHERE ps.product_id = p.id AND ps.active = 1 AND ps.is_default = 1
    ) ds
    OUTER APPLY (
      SELECT TOP 1 pp.name, pp.factor_to_base
      FROM dbo.product_presentations pp
      WHERE pp.product_id = p.id AND pp.active = 1
      ORDER BY pp.is_default DESC, pp.id ASC
    ) dp
    WHERE p.active = 1
    ORDER BY p.id ASC
END;
GO
