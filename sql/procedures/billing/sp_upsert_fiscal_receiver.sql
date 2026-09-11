/* sp_upsert_fiscal_receiver
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
CREATE OR ALTER PROCEDURE dbo.sp_upsert_fiscal_receiver
  @rfc           nvarchar(20),
  @name          nvarchar(250),
  @fiscal_zip    nvarchar(10),
  @fiscal_regime nvarchar(10),
  @cfdi_use      nvarchar(5),
  @email         nvarchar(120) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @id int;

  SELECT @id = id
  FROM dbo.fiscal_receivers
  WHERE rfc = @rfc;

  IF @id IS NULL
  BEGIN
    INSERT INTO dbo.fiscal_receivers (rfc, name, fiscal_zip, fiscal_regime, cfdi_use, email, created_at)
    VALUES (@rfc, @name, @fiscal_zip, @fiscal_regime, @cfdi_use, @email, SYSUTCDATETIME());

    SET @id = SCOPE_IDENTITY();
  END
  ELSE
  BEGIN
    UPDATE dbo.fiscal_receivers
    SET name = @name,
        fiscal_zip = @fiscal_zip,
        fiscal_regime = @fiscal_regime,
        cfdi_use = @cfdi_use,
        email = @email,
        updated_at = SYSUTCDATETIME()
    WHERE id = @id;
  END

  SELECT @id AS receiver_id;
END
GO
