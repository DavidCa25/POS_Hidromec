/* sp_reorder_suggestions
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Que hay que reponer, y en cuantos dias se acaba.
--
-- QUE ESTABA MAL
-- --------------
-- Media TODO contra `products.stock` y contra `sale_detail`:
--
--   1. Un producto RECIPE tiene stock 0 POR DISENO -su disponibilidad sale de
--      los ingredientes-. La division daba 0 y el filtro `0 <= @dias_alerta`
--      lo dejaba pasar: cada bebida vendida aparecia con "0 dias restantes",
--      que en pantalla se leia como "se acabara en menos de 0 dias".
--   2. Un producto NONE (servicio) tampoco tiene existencias: mismo caso.
--   3. Un INGREDIENTE nunca aparece en `sale_detail` -se vende el latte, no la
--      leche-, asi que justo lo que hay que reponer no generaba alerta nunca.
--
-- COMO SE MIDE AHORA
-- ------------------
--   existencia   DIRECT  ->  products.stock
--                RECIPE  ->  unidades que alcanzan segun sus ingredientes,
--                            con conversion y merma (mismo calculo que
--                            sp_get_menu_catalog)
--                NONE    ->  fuera: no hay nada que reponer
--
--   ritmo        DIRECT  ->  salidas de inventario de venta o receta. Cubre lo
--                            que se vende en caja Y lo que se consume como
--                            ingrediente. Los ajustes de conteo fisico NO
--                            cuentan: entran sin `source` y una merma contada
--                            una vez no es ritmo de consumo.
--                RECIPE  ->  unidades vendidas del producto
--
-- Los dias nunca salen negativos ni indefinidos: si no hay existencia son 0,
-- y el ritmo es siempre > 0 porque sin consumo no hay alerta.
CREATE OR ALTER PROCEDURE sp_reorder_suggestions
  @dias_ventana   INT = 30,   -- ventana para medir la velocidad de consumo
  @dias_alerta    INT = 7,    -- alerta si se acaba en <= estos dias
  @dias_objetivo  INT = 30    -- pedir lo necesario para cubrir estos dias
AS
BEGIN
  SET NOCOUNT ON;

  IF @dias_ventana  IS NULL OR @dias_ventana  <= 0 SET @dias_ventana  = 30;
  IF @dias_alerta   IS NULL OR @dias_alerta   <  0 SET @dias_alerta   = 7;
  IF @dias_objetivo IS NULL OR @dias_objetivo <= 0 SET @dias_objetivo = 30;

  DECLARE @desde DATE = DATEADD(DAY, -@dias_ventana, CAST(GETDATE() AS DATE));

  ;WITH
  /* Lo que de verdad salio del inventario. Un ingrediente no esta en
     sale_detail, pero deja salida cada vez que se prepara la bebida. */
  consumo_directo AS (
      SELECT m.product_id, SUM(m.quantity) AS consumido
      FROM dbo.inventory_movements m
      WHERE m.typee = 'salida'
        AND m.source IN ('SALE', 'RECIPE')
        AND m.datee >= @desde
      GROUP BY m.product_id
  ),
  /* Una receta no mueve stock propio: su ritmo son las unidades vendidas. */
  consumo_receta AS (
      SELECT sd.product_id, SUM(sd.quantity) AS consumido
      FROM dbo.sale_detail sd
      JOIN dbo.sales s ON s.id = sd.sale_id
      WHERE s.datee >= @desde
      GROUP BY sd.product_id
  ),
  receta_base AS (
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
  /* El ingrediente que primero se acaba: manda el minimo y se dice cual es. */
  limita AS (
      SELECT product_id, units, ing_nombre, ing_stock, ing_uom, ing_necesita
      FROM (
          SELECT l.*, ROW_NUMBER() OVER (PARTITION BY l.product_id
                                         ORDER BY l.units, l.ing_nombre) AS r
          FROM lineas l
      ) t
      WHERE t.r = 1
  ),
  base AS (
      SELECT
          p.id, p.nombre, p.part_number, p.inventory_mode, p.base_uom,
          CASE p.inventory_mode
               WHEN 'DIRECT' THEN CAST(p.stock AS DECIMAL(18,4))
               ELSE CAST(ISNULL(li.units, 0) AS DECIMAL(18,4))
          END AS existencia,
          CASE p.inventory_mode
               WHEN 'DIRECT' THEN CAST(ISNULL(cd.consumido, 0) AS DECIMAL(18,4))
               ELSE CAST(ISNULL(cr.consumido, 0) AS DECIMAL(18,4))
          END AS consumido,
          li.ing_nombre, li.ing_stock, li.ing_uom, li.ing_necesita
      FROM dbo.products p
      LEFT JOIN consumo_directo cd ON cd.product_id = p.id
      LEFT JOIN consumo_receta  cr ON cr.product_id = p.id
      LEFT JOIN limita li          ON li.product_id = p.id
      /* NONE no tiene existencias que reponer; un producto de baja tampoco. */
      WHERE p.active = 1
        AND p.inventory_mode IN ('DIRECT', 'RECIPE')
  ),
  ritmo AS (
      SELECT b.*,
             CAST(b.consumido / @dias_ventana AS DECIMAL(18,6)) AS prom_diario
      FROM base b
      WHERE b.consumido > 0
  )
  SELECT
      r.id,
      r.nombre,
      r.part_number,
      r.inventory_mode,
      r.base_uom,
      CAST(r.existencia AS DECIMAL(18,2)) AS stock,
      CAST(r.consumido  AS DECIMAL(18,2)) AS vendido_ventana,
      CAST(r.prom_diario AS DECIMAL(12,2)) AS prom_diario,
      /* Nunca negativo ni indefinido: sin existencia son 0 dias. */
      CAST(FLOOR(CASE WHEN r.existencia <= 0 THEN 0
                      ELSE r.existencia / r.prom_diario END) AS INT) AS dias_restantes,
      /* Reponer una receta no se hace comprando la receta: se compra el
         ingrediente que limita. Por eso solo DIRECT lleva sugerido. */
      CASE WHEN r.inventory_mode = 'DIRECT' THEN
           CASE WHEN CEILING(r.prom_diario * @dias_objetivo) - r.existencia > 0
                THEN CEILING(r.prom_diario * @dias_objetivo) - r.existencia
                ELSE 0 END
      END AS sugerido,
      /* Solo tiene sentido en una receta: quien limita y por cuanto. */
      CASE WHEN r.inventory_mode = 'RECIPE' THEN r.ing_nombre   END AS limita_nombre,
      CASE WHEN r.inventory_mode = 'RECIPE' THEN r.ing_stock    END AS limita_stock,
      CASE WHEN r.inventory_mode = 'RECIPE' THEN r.ing_uom      END AS limita_uom,
      CASE WHEN r.inventory_mode = 'RECIPE' THEN r.ing_necesita END AS limita_necesita
  FROM ritmo r
  WHERE (CASE WHEN r.existencia <= 0 THEN 0 ELSE r.existencia / r.prom_diario END) <= @dias_alerta
  ORDER BY dias_restantes ASC, r.nombre ASC;
END
GO
