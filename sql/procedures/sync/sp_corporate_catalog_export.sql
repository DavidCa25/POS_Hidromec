/* sp_corporate_catalog_export
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_corporate_catalog_export ======================
   0055 · MultiSucursal. El catalogo CORPORATIVO de la matriz, en un JSON:

     categories               uuid y nombre
     products                 TODOS (activos e inactivos: una baja en la matriz
                              es una baja en las sucursales). Sin existencia ni
                              costo de inventario: eso es de cada sucursal.
     modifier_groups          con sus opciones (ingredientes por uuid)
     product_modifier_groups  que grupos lleva cada producto
     recipes                  con sus lineas
     commercial               la politica comercial (canales, precios, ofertas)
     users                    los usuarios de empresa (corporate_scope no nulo),
                              con el hash de su contrasena y de su PIN

   Los numeros viajan como TEXTO (sin flotantes) y los UUID en minusculas,
   igual que sp_catalog_publication. La nube versiona por huella: si nada
   cambio, la version tampoco.
   ======================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_corporate_catalog_export
AS
BEGIN
    SET NOCOUNT ON;
    SELECT (
        SELECT
            1 AS [schema],
            JSON_QUERY((SELECT payload FROM dbo.commercial_policy WHERE id = 1)) AS commercial,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), c.uuid)) AS uuid, c.namee AS nombre
                  FROM dbo.CAT_categories c ORDER BY c.id
                   FOR JSON PATH), '[]')) AS categories,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), p.uuid)) AS uuid,
                       p.part_number, p.nombre,
                       CONVERT(VARCHAR(20), p.price) AS price,
                       p.bar_code,
                       LOWER(CONVERT(VARCHAR(36), c.uuid)) AS category_uuid,
                       b.namee AS brand,
                       p.clave_prod_serv, p.clave_unidad, p.objeto_impuesto,
                       CONVERT(VARCHAR(10), p.tasa_iva) AS tasa_iva,
                       p.inventory_mode,
                       CAST(p.sellable AS BIT) AS sellable,
                       p.base_uom,
                       CAST(p.allow_decimal_qty AS BIT) AS allow_decimal_qty,
                       CAST(ISNULL(p.active, 1) AS BIT) AS active
                  FROM dbo.products p
                  LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
                  LEFT JOIN dbo.CAT_brands b ON b.id = p.brand_id
                 ORDER BY p.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS products,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), g.uuid)) AS uuid, g.name, g.role, g.min_select, g.max_select,
                       CAST(g.required AS BIT) AS required, CAST(g.active AS BIT) AS active, g.sort_order,
                       JSON_QUERY(ISNULL((
                           SELECT LOWER(CONVERT(VARCHAR(36), o.uuid)) AS uuid, o.name,
                                  CONVERT(VARCHAR(20), o.price_delta) AS price_delta, o.effect,
                                  LOWER(CONVERT(VARCHAR(36), ing.uuid)) AS ingredient_uuid,
                                  LOWER(CONVERT(VARCHAR(36), rep.uuid)) AS replaces_uuid,
                                  CONVERT(VARCHAR(30), o.qty_base) AS qty_base,
                                  CONVERT(VARCHAR(20), o.qty_factor) AS qty_factor,
                                  CAST(o.active AS BIT) AS active, o.sort_order
                             FROM dbo.modifier_options o
                             LEFT JOIN dbo.products ing ON ing.id = o.ingredient_product_id
                             LEFT JOIN dbo.products rep ON rep.id = o.replaces_product_id
                            WHERE o.group_id = g.id
                            ORDER BY o.sort_order, o.id
                              FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS options
                  FROM dbo.modifier_groups g
                 ORDER BY g.sort_order, g.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS modifier_groups,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), p.uuid)) AS product_uuid,
                       LOWER(CONVERT(VARCHAR(36), g.uuid)) AS group_uuid, pmg.sort_order
                  FROM dbo.product_modifier_groups pmg
                  JOIN dbo.products p ON p.id = pmg.product_id
                  JOIN dbo.modifier_groups g ON g.id = pmg.group_id
                 ORDER BY p.id, pmg.sort_order, g.id
                   FOR JSON PATH), '[]')) AS product_modifier_groups,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), r.uuid)) AS uuid,
                       LOWER(CONVERT(VARCHAR(36), pr.uuid)) AS product_uuid,
                       LOWER(CONVERT(VARCHAR(36), vo.uuid)) AS variant_option_uuid,
                       CAST(r.active AS BIT) AS active, r.notes,
                       JSON_QUERY(ISNULL((
                           SELECT LOWER(CONVERT(VARCHAR(36), ip.uuid)) AS ingredient_uuid,
                                  CONVERT(VARCHAR(30), rl.qty_base) AS qty_base,
                                  CONVERT(VARCHAR(30), rl.input_qty) AS input_qty,
                                  rl.input_uom,
                                  CONVERT(VARCHAR(10), rl.waste_pct) AS waste_pct,
                                  rl.sort_order
                             FROM dbo.recipe_lines rl JOIN dbo.products ip ON ip.id = rl.ingredient_product_id
                            WHERE rl.recipe_id = r.id
                            ORDER BY rl.sort_order, rl.id
                              FOR JSON PATH), '[]')) AS lines
                  FROM dbo.recipes r
                  JOIN dbo.products pr ON pr.id = r.product_id
                  LEFT JOIN dbo.modifier_options vo ON vo.id = r.variant_option_id
                 ORDER BY r.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS recipes,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), u.uuid)) AS uuid, u.usuario, u.rol, u.password_hash,
                       CAST(ISNULL(u.active, 1) AS BIT) AS active,
                       JSON_QUERY(u.corporate_scope) AS scope,
                       a.pin_hash, a.pin_sal, CONVERT(VARCHAR(19), a.pin_creado_en, 126) AS pin_set_at
                  FROM dbo.users u
                  LEFT JOIN dbo.trabajadores_acceso a ON a.user_id = u.id AND a.revocado_en IS NULL
                 WHERE u.corporate_scope IS NOT NULL
                 ORDER BY u.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS users
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS catalog_json;
END
GO
