/* sp_get_product_presentations
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Presentaciones de compra de un producto (caja, bolsa, kg...). Sin
-- @product_id devuelve las de todos los productos (para Compras).
CREATE OR ALTER PROCEDURE dbo.sp_get_product_presentations
    @product_id INT = NULL,
    @only_active BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SELECT pp.id, pp.product_id, pp.name, pp.factor_to_base, pp.is_default, pp.active,
           p.base_uom
    FROM dbo.product_presentations pp
    JOIN dbo.products p ON p.id = pp.product_id
    WHERE (@product_id IS NULL OR pp.product_id = @product_id)
      AND (@only_active = 0 OR pp.active = 1)
    ORDER BY pp.product_id, pp.is_default DESC, pp.name;
END
GO
