/* sp_impuestos_listar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_impuestos_listar (0083) ======================
   El catálogo de impuestos además del IVA. @todos = 0: solo los encendidos
   (lo que se puede poner en un producto); 1: todos, para Configuración.
   `productos` dice en cuántos productos está: uno usado no se borra.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_impuestos_listar
    @todos BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT i.id, i.clave, i.nombre, i.clase, i.factor, i.tasa, i.cuota, i.unidad, i.en_base_iva, i.nota,
           i.activo, i.sistema, i.actualizado_en,
           (SELECT COUNT(*) FROM dbo.product_impuestos pi WHERE pi.impuesto_id = i.id) AS productos
      FROM dbo.CAT_impuestos i
     WHERE @todos = 1 OR i.activo = 1
     ORDER BY i.clase, i.activo DESC, i.nombre;
END
GO
