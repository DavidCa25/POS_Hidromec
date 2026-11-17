/* sp_producto_impuestos_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* =================== sp_producto_impuestos_get (0083) ===================
   Los impuestos además del IVA que lleva un producto, con su valor de hoy.
   Incluye los apagados (marcados en el producto pero sin cobrarse) para que
   la pantalla lo diga en vez de esconderlo.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_producto_impuestos_get
    @product_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT i.id, i.nombre, i.clase, i.factor, i.tasa, i.cuota, i.unidad, i.en_base_iva, i.activo, pi.cantidad
      FROM dbo.product_impuestos pi
      JOIN dbo.CAT_impuestos i ON i.id = pi.impuesto_id
     WHERE pi.product_id = @product_id
     ORDER BY i.clase, i.nombre;
END
GO
