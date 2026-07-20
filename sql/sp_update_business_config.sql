-- Guarda los datos del negocio (Configuracion > Datos del negocio).
-- Tabla real: dbo.business_config (la misma que lee sp_get_business_config).

CREATE OR ALTER PROCEDURE sp_update_business_config
  @business_name NVARCHAR(200),
  @address       NVARCHAR(300),
  @phone         NVARCHAR(50),
  @rfc           NVARCHAR(50),
  @ticket_footer NVARCHAR(300)
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.business_config
     SET business_name = @business_name,
         address       = @address,
         phone         = @phone,
         rfc           = @rfc,
         ticket_footer = @ticket_footer,
         updated_at    = GETDATE();

  -- Si aun no existe la fila de configuracion, la crea.
  IF @@ROWCOUNT = 0
    INSERT INTO dbo.business_config
      (business_name, address, phone, rfc, ticket_footer, invoicing_enabled, updated_at)
    VALUES
      (@business_name, @address, @phone, @rfc, @ticket_footer, 0, GETDATE());
END
