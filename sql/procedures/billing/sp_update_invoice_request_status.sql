/* sp_update_invoice_request_status
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
CREATE OR ALTER PROCEDURE dbo.sp_update_invoice_request_status
  @invoice_request_id int,
  @status nvarchar(20),              -- PENDING | STAMPED | CANCELED | ERROR
  @cfdi_uuid nvarchar(50) = NULL,
  @xml_path nvarchar(400) = NULL,
  @pdf_path nvarchar(400) = NULL,
  @error_message nvarchar(1000) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  IF NOT EXISTS (SELECT 1 FROM dbo.invoice_requests WHERE id = @invoice_request_id)
  BEGIN
    RAISERROR('Invoice request not found', 16, 1);
    RETURN;
  END

  DECLARE @sale_id int;
  SELECT @sale_id = sale_id FROM dbo.invoice_requests WHERE id = @invoice_request_id;

  UPDATE dbo.invoice_requests
  SET status = @status,
      cfdi_uuid = COALESCE(@cfdi_uuid, cfdi_uuid),
      xml_path = COALESCE(@xml_path, xml_path),
      pdf_path = COALESCE(@pdf_path, pdf_path),
      error_message = CASE WHEN @status = 'ERROR' THEN @error_message ELSE NULL END,
      updated_at = SYSUTCDATETIME()
  WHERE id = @invoice_request_id;

  UPDATE dbo.sales
  SET invoice_status = @status
  WHERE id = @sale_id;

  SELECT * FROM dbo.invoice_requests WHERE id = @invoice_request_id;
END
GO
