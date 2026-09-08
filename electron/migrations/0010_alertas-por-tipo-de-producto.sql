/* 0010_alertas-por-tipo-de-producto.sql
 * ---------------------------------------------------------------------------
 * "Sin rotacion" mira el consumo, no solo la venta directa.
 *
 * QUE PASABA
 * ----------
 * `sp_dead_products` marcaba como sin rotacion todo producto activo sin filas
 * en `sale_detail`. Un ingrediente NUNCA aparece ahi: no se vende, se consume
 * dentro de una receta y eso queda en `inventory_movements`. Resultado: cada
 * ingrediente salia en la alerta aunque se gastara a diario.
 *
 * QUE CAMBIA
 * ----------
 * Se exige que tampoco tenga movimientos de inventario, y se limita a los
 * productos que de verdad ocupan existencias (`inventory_mode = 'DIRECT'`):
 * uno de receta no tiene stock propio y uno de servicio no tiene ninguno.
 *
 * Las otras alertas de stock -agotados, stock bajo y sus contadores- viven en
 * consultas de electron/main.js y se corrigieron ahi con el mismo criterio.
 * ---------------------------------------------------------------------------
 */

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Productos sin rotacion: ocupan inventario y no se mueven.
 *
 * Update: + se mira el CONSUMO, no solo la venta directa.
 *
 * Un ingrediente no aparece nunca en `sale_detail`: no se vende, se consume
 * dentro de una receta y eso queda en `inventory_movements`. Con la regla
 * anterior TODO ingrediente salia como "sin rotacion" aunque se estuviera
 * gastando cada dia, y la alerta perdia su sentido.
 *
 * Quedan fuera ademas los productos que no tienen existencias que ocupar:
 * los de receta -su stock lo tienen sus ingredientes- y los de servicio.
 */
CREATE OR ALTER PROCEDURE dbo.sp_dead_products
    @limit INT = 20
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@limit)
        p.id,
        p.nombre,
        p.stock,
        p.price
    FROM products p
    WHERE p.active = 1
      AND p.inventory_mode = 'DIRECT'
      AND NOT EXISTS (SELECT 1 FROM sale_detail sd WHERE sd.product_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM dbo.inventory_movements im WHERE im.product_id = p.id)
    ORDER BY p.nombre;
END
GO
