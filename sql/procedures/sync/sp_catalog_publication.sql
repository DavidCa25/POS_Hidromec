/* sp_catalog_publication
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_catalog_publication ======================
   0052. El catalogo de ESTA sucursal tal como lo necesita una tablet de un
   evento que la tiene como sucursal base: un solo JSON.

   QUE INCLUYE (y nada mas)
     products         lo vendible (activo y sellable) + todo lo activo con
                      inventario propio (DIRECT: vasos, servilletas... se pueden
                      mandar a la feria aunque no se vendan) + los insumos que
                      usan las recetas y las opciones activas (sus costos y su
                      existencia en el evento dependen de ellos)
     recipes          activas, con sus lineas (cantidad base y merma)
     modifier_groups  activos, con sus opciones activas
     categories

   Los numeros viajan como TEXTO: JSON los convertiria en flotantes y la
   tablet tiene que calcular exactamente lo mismo que sp_register_sale.
   Los UUID van en minusculas para que comparar sea comparar texto.

   La nube asigna `catalog_version`: si el JSON no cambio, la version tampoco.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_catalog_publication
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH ref AS (
        SELECT rl.ingredient_product_id AS id
          FROM dbo.recipe_lines rl JOIN dbo.recipes r ON r.id = rl.recipe_id AND r.active = 1
        UNION
        SELECT ingredient_product_id FROM dbo.modifier_options WHERE active = 1 AND ingredient_product_id IS NOT NULL
        UNION
        SELECT replaces_product_id FROM dbo.modifier_options WHERE active = 1 AND replaces_product_id IS NOT NULL
    ), prods AS (
        SELECT p.* FROM dbo.products p
         WHERE (ISNULL(p.active, 1) = 1 AND (p.sellable = 1 OR p.inventory_mode = 'DIRECT')) OR p.id IN (SELECT id FROM ref)
    )
    SELECT (
        SELECT
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), p.uuid)) AS uuid,
                       p.nombre,
                       CONVERT(VARCHAR(20), p.price) AS price,
                       CONVERT(VARCHAR(30), p.cost) AS cost,
                       p.inventory_mode,
                       CAST(p.sellable AS BIT) AS sellable,
                       CAST(ISNULL(p.active, 1) AS BIT) AS active,
                       CAST(p.allow_decimal_qty AS BIT) AS allow_decimal_qty,
                       LOWER(CONVERT(VARCHAR(36), c.uuid)) AS category_uuid,
                       CONVERT(VARCHAR(10), p.tasa_iva) AS tasa_iva,
                       p.base_uom,
                       JSON_QUERY(ISNULL((
                           SELECT '[' + STRING_AGG('"' + LOWER(CONVERT(VARCHAR(36), g.uuid)) + '"', ',')
                                        WITHIN GROUP (ORDER BY pmg.sort_order, g.id) + ']'
                             FROM dbo.product_modifier_groups pmg JOIN dbo.modifier_groups g ON g.id = pmg.group_id
                            WHERE pmg.product_id = p.id), '[]')) AS modifier_groups
                  FROM prods p LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
                 ORDER BY p.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS products,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), r.uuid)) AS uuid,
                       LOWER(CONVERT(VARCHAR(36), pr.uuid)) AS product_uuid,
                       LOWER(CONVERT(VARCHAR(36), vo.uuid)) AS variant_option_uuid,
                       CAST(r.active AS BIT) AS active,
                       JSON_QUERY(ISNULL((
                           SELECT LOWER(CONVERT(VARCHAR(36), ip.uuid)) AS ingredient_uuid,
                                  CONVERT(VARCHAR(30), rl.qty_base) AS qty_base,
                                  CONVERT(VARCHAR(10), rl.waste_pct) AS waste_pct
                             FROM dbo.recipe_lines rl JOIN dbo.products ip ON ip.id = rl.ingredient_product_id
                            WHERE rl.recipe_id = r.id
                            ORDER BY rl.sort_order, rl.id
                              FOR JSON PATH), '[]')) AS lines
                  FROM dbo.recipes r
                  JOIN dbo.products pr ON pr.id = r.product_id
                  LEFT JOIN dbo.modifier_options vo ON vo.id = r.variant_option_id
                 WHERE r.active = 1 AND r.product_id IN (SELECT id FROM prods)
                 ORDER BY r.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS recipes,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), g.uuid)) AS uuid, g.name, g.role, g.min_select, g.max_select,
                       CAST(g.required AS BIT) AS required, CAST(g.active AS BIT) AS active,
                       JSON_QUERY(ISNULL((
                           SELECT LOWER(CONVERT(VARCHAR(36), o.uuid)) AS uuid, o.name,
                                  CONVERT(VARCHAR(20), o.price_delta) AS price_delta, o.effect,
                                  LOWER(CONVERT(VARCHAR(36), ing.uuid)) AS ingredient_uuid,
                                  LOWER(CONVERT(VARCHAR(36), rep.uuid)) AS replaces_uuid,
                                  CONVERT(VARCHAR(30), o.qty_base) AS qty_base,
                                  CONVERT(VARCHAR(20), o.qty_factor) AS qty_factor,
                                  CAST(o.active AS BIT) AS active
                             FROM dbo.modifier_options o
                             LEFT JOIN dbo.products ing ON ing.id = o.ingredient_product_id
                             LEFT JOIN dbo.products rep ON rep.id = o.replaces_product_id
                            WHERE o.group_id = g.id AND o.active = 1
                            ORDER BY o.sort_order, o.id
                              FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS options
                  FROM dbo.modifier_groups g
                 WHERE g.active = 1
                 ORDER BY g.sort_order, g.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS modifier_groups,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), c.uuid)) AS uuid, c.namee AS nombre
                  FROM dbo.CAT_categories c ORDER BY c.id
                   FOR JSON PATH), '[]')) AS categories
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS catalog_json;
END
GO
