/* sp_dead_products
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Productos sin rotacion (activos, sin ninguna venta) */
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
      AND NOT EXISTS (SELECT 1 FROM sale_detail sd WHERE sd.product_id = p.id)
    ORDER BY p.nombre;
END
GO
