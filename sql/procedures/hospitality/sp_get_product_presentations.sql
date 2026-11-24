/* sp_get_product_presentations
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Presentaciones de un producto (caja, bolsa, kg...). Sin @product_id
-- devuelve las de todos los productos (para Compras y para la caja, que
-- busca ahi el codigo de barras de un carton). 0089: bar_code y sale_price;
-- con sale_price la presentacion tambien se vende.
CREATE OR ALTER PROCEDURE dbo.sp_get_product_presentations
    @product_id INT = NULL,
    @only_active BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SELECT pp.id, pp.product_id, pp.name, pp.factor_to_base, pp.is_default, pp.active,
           p.base_uom, pp.bar_code, pp.sale_price
    FROM dbo.product_presentations pp
    JOIN dbo.products p ON p.id = pp.product_id
    WHERE (@product_id IS NULL OR pp.product_id = @product_id)
      AND (@only_active = 0 OR pp.active = 1)
    ORDER BY pp.product_id, pp.is_default DESC, pp.name;
END
GO
