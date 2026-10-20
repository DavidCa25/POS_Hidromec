/* sp_production_board
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · El tablero de produccion de un dia.

   1) Las tandas del dia (y las que siguen en preparacion de dias anteriores:
      algo que se metio al horno ayer no desaparece del tablero). Las
      planeadas traen cuantos ingredientes no alcanzan para ELLAS SOLAS.
   2) Lo que piden TODAS las tandas planeadas juntas contra la existencia:
      el aviso «no alcanza» de la parte de arriba.
   3) Los productos que tienen formula, para «Agregar».

   Es informacion para la pantalla: empezar una tanda vuelve a validar
   existencias dentro de su transaccion. */
CREATE OR ALTER PROCEDURE dbo.sp_production_board
    @production_date DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @production_date = ISNULL(@production_date, CAST(GETDATE() AS DATE));

    SELECT b.id INTO #b
      FROM dbo.production_batches b
     WHERE b.production_date = @production_date OR b.status = 'IN_PROGRESS';

    /* Requerimiento de cada tanda planeada, por ingrediente. */
    SELECT b.id AS batch_id, r.ingredient_product_id, r.qty
      INTO #req
      FROM dbo.production_batches b
      JOIN #b x ON x.id = b.id
     CROSS APPLY (SELECT l.ingredient_product_id,
                   CAST(ROUND(l.qty_base * (1 + l.waste_pct / 100.0) * b.planned_qty / f.yield_qty, 2) AS DECIMAL(14, 2)) AS qty
              FROM dbo.production_formula_lines l
              JOIN dbo.production_formulas f ON f.product_id = l.product_id
                   WHERE l.product_id = b.product_id) r
     WHERE b.status = 'PLANNED';

    SELECT b.id, LOWER(CONVERT(VARCHAR(36), b.uuid)) AS uuid, b.product_id, p.nombre AS product_name, p.base_uom,
           b.status, b.production_date, b.planned_qty, b.good_qty, b.waste_qty, b.waste_reason,
           b.total_cost, b.unit_cost, b.note,
           b.created_at, uc.usuario AS created_by_name,
           b.started_at, us.usuario AS started_by_name,
           b.finished_at, uf.usuario AS finished_by_name,
           ( SELECT COUNT(*) FROM #req r JOIN dbo.products i ON i.id = r.ingredient_product_id
              WHERE r.batch_id = b.id AND i.stock < r.qty ) AS faltantes
      FROM dbo.production_batches b
      JOIN #b x ON x.id = b.id
      JOIN dbo.products p ON p.id = b.product_id
      LEFT JOIN dbo.users uc ON uc.id = b.created_by
      LEFT JOIN dbo.users us ON us.id = b.started_by
      LEFT JOIN dbo.users uf ON uf.id = b.finished_by
     WHERE b.status <> 'CANCELLED'
     ORDER BY CASE b.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END, b.created_at;

    SELECT r.ingredient_product_id, i.nombre AS ingredient_name, i.base_uom,
           SUM(r.qty) AS needed, i.stock,
           CASE WHEN SUM(r.qty) > i.stock THEN SUM(r.qty) - i.stock ELSE 0 END AS missing
      FROM #req r
      JOIN dbo.products i ON i.id = r.ingredient_product_id
     GROUP BY r.ingredient_product_id, i.nombre, i.base_uom, i.stock
     ORDER BY CASE WHEN SUM(r.qty) > i.stock THEN 0 ELSE 1 END, i.nombre;

    SELECT f.product_id, p.nombre AS product_name, p.base_uom, f.yield_qty, p.stock,
           ( SELECT ISNULL(SUM(l.qty_base * (1 + l.waste_pct / 100.0) * ISNULL(i.cost, 0)), 0)
               FROM dbo.production_formula_lines l JOIN dbo.products i ON i.id = l.ingredient_product_id
              WHERE l.product_id = f.product_id ) / f.yield_qty AS unit_cost
      FROM dbo.production_formulas f
      JOIN dbo.products p ON p.id = f.product_id
     WHERE p.active = 1 AND p.inventory_mode = 'DIRECT'
     ORDER BY p.nombre;
END
GO
