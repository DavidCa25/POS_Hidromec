/* sp_get_invoice_request_detail
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
CREATE OR ALTER PROCEDURE dbo.sp_get_invoice_request_detail
  @invoice_request_id int
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    ir.*,
    s.datee AS sale_date,
    s.total AS sale_total,
    s.payment_method,
    s.paid_amount,
    s.balance,
    s.customer_id
  FROM dbo.invoice_requests ir
  INNER JOIN dbo.sales s ON s.id = ir.sale_id
  WHERE ir.id = @invoice_request_id;

  SELECT r.*
  FROM dbo.invoice_requests ir
  INNER JOIN dbo.fiscal_receivers r ON r.id = ir.receiver_id
  WHERE ir.id = @invoice_request_id
    AND ir.receiver_id IS NOT NULL;

  -- Items
  SELECT
    d.product_id,
    p.nombre,
    d.quantity,
    d.unitary_price,
    d.subtotal
  FROM dbo.invoice_requests ir
  INNER JOIN dbo.sale_detail d ON d.sale_id = ir.sale_id
  INNER JOIN dbo.products p ON p.id = d.product_id
  WHERE ir.id = @invoice_request_id
  ORDER BY d.id;
END
GO
