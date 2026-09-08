/* sp_get_modifier_groups
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Grupos de modificadores con sus opciones. Sin @product_id: todos los
-- grupos (catalogo del Backoffice). Con @product_id: solo los ligados al
-- producto, en el orden del producto. Dos resultados: grupos y opciones.
CREATE OR ALTER PROCEDURE dbo.sp_get_modifier_groups
    @product_id INT = NULL,
    @only_active BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        g.id, g.name, g.role, g.min_select, g.max_select, g.required, g.active,
        ISNULL(pmg.sort_order, g.sort_order) AS sort_order,
        ( SELECT COUNT(*) FROM dbo.product_modifier_groups x WHERE x.group_id = g.id ) AS products_count
    FROM dbo.modifier_groups g
    LEFT JOIN dbo.product_modifier_groups pmg ON pmg.group_id = g.id AND pmg.product_id = @product_id
    WHERE (@product_id IS NULL OR pmg.product_id IS NOT NULL)
      AND (@only_active = 0 OR g.active = 1)
    ORDER BY ISNULL(pmg.sort_order, g.sort_order), g.name;

    SELECT
        o.id, o.group_id, o.name, o.price_delta, o.effect,
        o.ingredient_product_id, i.nombre AS ingredient_name, i.base_uom AS ingredient_uom,
        o.replaces_product_id,   r.nombre AS replaces_name,
        o.qty_base, o.qty_factor, o.active, o.sort_order
    FROM dbo.modifier_options o
    JOIN dbo.modifier_groups g ON g.id = o.group_id
    LEFT JOIN dbo.product_modifier_groups pmg ON pmg.group_id = g.id AND pmg.product_id = @product_id
    LEFT JOIN dbo.products i ON i.id = o.ingredient_product_id
    LEFT JOIN dbo.products r ON r.id = o.replaces_product_id
    WHERE (@product_id IS NULL OR pmg.product_id IS NOT NULL)
      AND (@only_active = 0 OR (g.active = 1 AND o.active = 1))
    ORDER BY o.group_id, o.sort_order, o.id;
END
GO
