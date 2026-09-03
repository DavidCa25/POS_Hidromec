/* sp_update_business_config
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_update_business_config
  @business_name      nvarchar(200),
  @address            nvarchar(300) = NULL,
  @phone              nvarchar(50)  = NULL,
  @rfc                nvarchar(50)  = NULL,

  @fiscal_name        nvarchar(250) = NULL,
  @fiscal_zip         nvarchar(10)  = NULL,
  @fiscal_regime      nvarchar(10)  = NULL,

  @invoicing_enabled  bit = 0,
  @invoicing_provider nvarchar(30) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  IF @business_name IS NULL OR LTRIM(RTRIM(@business_name)) = ''
  BEGIN
    RAISERROR('business_name requerido.', 16, 1);
    RETURN;
  END

  DECLARE @id int;

  -- Si ya existe un registro, usamos el primero (o el id=1 si existe)
  SELECT TOP 1 @id = id
  FROM dbo.business_config
  ORDER BY id ASC;

  IF @id IS NULL
  BEGIN
    INSERT INTO dbo.business_config (
      business_name, address, phone, rfc,
      fiscal_name, fiscal_zip, fiscal_regime,
      invoicing_enabled, invoicing_provider,
      updated_at
    )
    VALUES (
      @business_name, @address, @phone, @rfc,
      @fiscal_name, @fiscal_zip, @fiscal_regime,
      @invoicing_enabled, @invoicing_provider,
      GETDATE()
    );

    SET @id = SCOPE_IDENTITY();
  END
  ELSE
  BEGIN
    UPDATE dbo.business_config
    SET business_name = @business_name,
        address = @address,
        phone = @phone,
        rfc = @rfc,
        fiscal_name = @fiscal_name,
        fiscal_zip = @fiscal_zip,
        fiscal_regime = @fiscal_regime,
        invoicing_enabled = @invoicing_enabled,
        invoicing_provider = @invoicing_provider,
        updated_at = GETDATE()
    WHERE id = @id;
  END

  SELECT TOP 1 *
  FROM dbo.business_config
  WHERE id = @id;
END
GO
