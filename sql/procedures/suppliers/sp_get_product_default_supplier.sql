/* sp_get_product_default_supplier
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <30-12-2025>
-- Description:	<Obtener Proveedor por default>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_product_default_supplier
  @product_id INT
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 1
    ps.product_id,
    ps.supplier_id,
    s.nombre AS supplier_name,
    ps.last_cost
  FROM dbo.product_suppliers ps
  JOIN dbo.CAT_suppliers s ON s.id = ps.supplier_id
  WHERE ps.product_id = @product_id
    AND ps.active = 1
    AND ps.is_default = 1;
END
GO
