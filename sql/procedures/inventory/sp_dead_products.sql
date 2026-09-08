/* sp_dead_products
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
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
