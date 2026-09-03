/* sp_create_invoice_request
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
CREATE OR ALTER PROCEDURE dbo.sp_create_invoice_request
  @sale_id int,
  @receiver_id int = NULL,
  @receiver_snapshot_json nvarchar(max) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  -- Validar venta existe
  IF NOT EXISTS (SELECT 1 FROM dbo.sales WHERE id = @sale_id)
  BEGIN
    RAISERROR('Sale not found', 16, 1);
    RETURN;
  END

  -- Si ya existe request para esta venta, regresarla
  IF EXISTS (SELECT 1 FROM dbo.invoice_requests WHERE sale_id = @sale_id)
  BEGIN
    SELECT TOP 1 *
    FROM dbo.invoice_requests
    WHERE sale_id = @sale_id;
    RETURN;
  END

  INSERT INTO dbo.invoice_requests
    (sale_id, receiver_id, receiver_snapshot, status, created_at)
  VALUES
    (@sale_id, @receiver_id, @receiver_snapshot_json, 'PENDING', SYSUTCDATETIME());

  DECLARE @request_id int = SCOPE_IDENTITY();

  UPDATE dbo.sales
  SET invoice_status = 'PENDING'
  WHERE id = @sale_id;

  SELECT *
  FROM dbo.invoice_requests
  WHERE id = @request_id;
END
GO
