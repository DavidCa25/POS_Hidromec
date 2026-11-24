/* sp_venta_suelta_lista
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================= sp_venta_suelta_lista (0091) =================
   Todos los ligues de venta suelta de una vez, para que la caja diga en el
   buscador qué es pieza («Suelto · de la cajetilla de 20») y qué es paquete
   («Paquete de 20 · también por pieza»), sin preguntar producto por producto.

   Sin la aplicación encendida no devuelve nada: la caja se ve como siempre.
   Solo lee. */
CREATE OR ALTER PROCEDURE dbo.sp_venta_suelta_lista
AS
BEGIN
    SET NOCOUNT ON;
    SELECT v.product_id, s.nombre AS product_name,
           v.parent_product_id, pk.nombre AS parent_name, v.piezas
      FROM dbo.venta_suelta v
      JOIN dbo.products s  ON s.id  = v.product_id
      JOIN dbo.products pk ON pk.id = v.parent_product_id
     WHERE s.active = 1 AND pk.active = 1
       AND EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'venta-suelta' AND enabled = 1)
     ORDER BY pk.nombre, s.nombre;
END
GO
