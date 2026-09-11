/* sp_get_invoice_requests
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <22-12-2025>
-- Description:	<Store procedure para guardar para después la inserción>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_invoice_requests
  @status nvarchar(20) = NULL -- NULL = todos
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    ir.id,
    ir.sale_id,
    ir.status,
    ir.error_message,
    ir.cfdi_uuid,
    ir.created_at,
    ir.updated_at,
    s.datee AS sale_date,
    s.total AS sale_total,
    s.payment_method,
    s.customer_id
  FROM dbo.invoice_requests ir
  INNER JOIN dbo.sales s ON s.id = ir.sale_id
  WHERE (@status IS NULL OR ir.status = @status)
  ORDER BY ir.created_at DESC;
END
GO
