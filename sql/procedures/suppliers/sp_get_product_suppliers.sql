/* sp_get_product_suppliers
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <30-12-2025>
-- Description:	<Obtener Proveedores por producto>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_product_suppliers
  @product_id INT,
  @only_active BIT = 1
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    ps.product_id,
    ps.supplier_id,
    s.nombre AS supplier_name,
    ps.is_default,
    ps.last_cost,
    ps.active,
    ps.created_at,
    ps.updated_at
  FROM dbo.product_suppliers ps
  JOIN dbo.CAT_suppliers s ON s.id = ps.supplier_id
  WHERE ps.product_id = @product_id
    AND (@only_active = 0 OR ps.active = 1)
  ORDER BY ps.is_default DESC, s.nombre ASC;
END
GO
