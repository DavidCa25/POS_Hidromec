/* ============================================================
   0004 — menu catalog

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   NO toca tablas ni datos. Solo objetos programables.
   ============================================================ */

/* ---------- sp_get_menu_catalog (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_menu_catalog
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Catalogo completo del punto de venta Touch en UNA llamada.
--
-- Existe para que tocar un producto no dispare consultas: sin esto, cada
-- toque pediria modificadores, receta y disponibilidad por separado (N+1 por
-- toque, justo lo que no se quiere en una caja i5 con 8 GB).
--
-- Devuelve cinco resultados:
--   1 categorias con cuantos productos vendibles tienen
--   2 productos vendibles (con inventory_mode, image_version, has_modifiers
--     y `available_units`: cuantas unidades alcanzan HOY segun ingredientes)
--   3 grupos de modificadores ligados a productos
--   4 opciones de esos grupos
--   5 relacion producto -> grupo, en orden
--
-- `available_units` es una ESTIMACION para pintar la rejilla (agotado,
-- quedan pocos). La validacion real es siempre sp_register_sale: entre esta
-- consulta y el cobro puede vender otra caja.
CREATE OR ALTER PROCEDURE dbo.sp_get_menu_catalog
AS
BEGIN
    SET NOCOUNT ON;

    /* Unidades posibles de cada receta: el ingrediente que primero se acaba. */
    ;WITH receta_base AS (
        SELECT r.product_id, r.id AS recipe_id,
               ROW_NUMBER() OVER (PARTITION BY r.product_id
                                  ORDER BY CASE WHEN r.variant_option_id IS NULL THEN 0 ELSE 1 END, r.id) AS k
        FROM dbo.recipes r
        WHERE r.active = 1
    ),
    posibles AS (
        SELECT rb.product_id,
               MIN(CASE WHEN rl.qty_base * (1 + rl.waste_pct / 100.0) <= 0 THEN 999999
                        ELSE FLOOR(i.stock / (rl.qty_base * (1 + rl.waste_pct / 100.0))) END) AS units
        FROM receta_base rb
        JOIN dbo.recipe_lines rl ON rl.recipe_id = rb.recipe_id
        JOIN dbo.products i ON i.id = rl.ingredient_product_id
        WHERE rb.k = 1
        GROUP BY rb.product_id
    )
    SELECT
        p.id,
        p.part_number,
        p.bar_code,
        p.nombre            AS product_name,
        p.price,
        p.stock,
        p.cost,
        p.category_id,
        c.namee             AS category_name,
        p.inventory_mode,
        p.base_uom,
        p.allow_decimal_qty,
        p.image_version,
        p.tasa_iva,
        p.objeto_impuesto,
        p.clave_prod_serv,
        p.clave_unidad,
        CASE WHEN EXISTS (
            SELECT 1 FROM dbo.product_modifier_groups pmg
            JOIN dbo.modifier_groups g ON g.id = pmg.group_id AND g.active = 1
            WHERE pmg.product_id = p.id) THEN 1 ELSE 0 END AS has_modifiers,
        CASE p.inventory_mode
            WHEN 'NONE'   THEN 999999
            WHEN 'DIRECT' THEN FLOOR(p.stock)
            ELSE ISNULL(po.units, 0)
        END AS available_units
    INTO #cat
    FROM dbo.products p
    LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
    LEFT JOIN posibles po ON po.product_id = p.id
    WHERE p.active = 1 AND p.sellable = 1;

    /* 1) Categorias con producto vendible */
    SELECT category_id, ISNULL(category_name, N'Sin categoria') AS category_name, COUNT(*) AS products_count
    FROM #cat
    GROUP BY category_id, category_name
    ORDER BY category_name;

    /* 2) Productos */
    SELECT * FROM #cat ORDER BY category_name, product_name;

    /* 3) Grupos usados por algun producto vendible */
    SELECT DISTINCT g.id, g.name, g.role, g.min_select, g.max_select, g.required, g.sort_order
    FROM dbo.modifier_groups g
    JOIN dbo.product_modifier_groups pmg ON pmg.group_id = g.id
    JOIN #cat p ON p.id = pmg.product_id
    WHERE g.active = 1
    ORDER BY g.sort_order, g.name;

    /* 4) Opciones de esos grupos. price_delta es lo que suma al precio. */
    SELECT o.id, o.group_id, o.name, o.price_delta, o.effect, o.sort_order,
           CASE WHEN o.ingredient_product_id IS NULL THEN 999999
                ELSE FLOOR(ISNULL(i.stock, 0) / NULLIF(o.qty_base, 0)) END AS available_units
    FROM dbo.modifier_options o
    JOIN dbo.modifier_groups g ON g.id = o.group_id AND g.active = 1
    LEFT JOIN dbo.products i ON i.id = o.ingredient_product_id
    WHERE o.active = 1
      AND EXISTS (SELECT 1 FROM dbo.product_modifier_groups pmg JOIN #cat p ON p.id = pmg.product_id WHERE pmg.group_id = g.id)
    ORDER BY o.group_id, o.sort_order, o.id;

    /* 5) Producto -> grupo */
    SELECT pmg.product_id, pmg.group_id, pmg.sort_order
    FROM dbo.product_modifier_groups pmg
    JOIN #cat p ON p.id = pmg.product_id
    JOIN dbo.modifier_groups g ON g.id = pmg.group_id AND g.active = 1
    ORDER BY pmg.product_id, pmg.sort_order;
END
GO
