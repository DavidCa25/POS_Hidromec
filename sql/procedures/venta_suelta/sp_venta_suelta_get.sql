/* sp_venta_suelta_get
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ==================== sp_venta_suelta_get (0073) ====================
   Como se vende suelto un producto.

   Primer resultado: de que paquete sale (si es un suelto). Cero filas: no
   cuelga de ningun paquete.
   Segundo resultado: los sueltos que salen de el (si es un paquete). Para
   que el formulario no deje convertir en suelto a algo que ya es paquete.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_venta_suelta_get
    @product_id INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT v.product_id, v.parent_product_id, p.nombre AS parent_name,
           p.stock AS parent_stock, v.piezas
    FROM dbo.venta_suelta v
    JOIN dbo.products p ON p.id = v.parent_product_id
    WHERE v.product_id = @product_id;

    SELECT v.product_id, h.nombre AS product_name, v.piezas
    FROM dbo.venta_suelta v
    JOIN dbo.products h ON h.id = v.product_id
    WHERE v.parent_product_id = @product_id
    ORDER BY h.nombre;
END
GO
