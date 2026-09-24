/* ============================================================
   0030 — core espejo modulos

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   NO toca tablas ni datos. Solo objetos programables.
   ============================================================ */

/* ---------- sp_update_business_config (SQL_STORED_PROCEDURE) ---------- */
/* sp_update_business_config
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Description: Guarda los datos del negocio (Configuracion > Negocio).
--   + ticket_footer: pie del ticket. La app lo enviaba desde hace tiempo y
--     el procedure lo rechazaba ("no es un parametro").
--   + business_profile: RETAIL | HOSPITALITY. NULL conserva el valor actual.
--   + loyalty_enabled: enciende Fidelizacion. NULL conserva el valor actual,
--     y eso NO es un detalle: el panel de datos del negocio guarda sin
--     enviarlo, asi que con un default de 0 cambiar el telefono apagaria
--     las campanas.
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
  @invoicing_provider nvarchar(30) = NULL,

  @ticket_footer      nvarchar(300) = NULL,
  @business_profile   nvarchar(20)  = NULL,
  @loyalty_enabled    bit = NULL
AS
BEGIN
  SET NOCOUNT ON;

  IF @business_name IS NULL OR LTRIM(RTRIM(@business_name)) = ''
  BEGIN
    RAISERROR('business_name requerido.', 16, 1);
    RETURN;
  END

  IF @business_profile IS NOT NULL
  BEGIN
    SET @business_profile = UPPER(LTRIM(RTRIM(@business_profile)));
    IF @business_profile NOT IN ('RETAIL', 'HOSPITALITY')
    BEGIN
      RAISERROR('business_profile invalido: use RETAIL o HOSPITALITY.', 16, 1);
      RETURN;
    END
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
      ticket_footer, business_profile, loyalty_enabled,
      updated_at
    )
    VALUES (
      @business_name, @address, @phone, @rfc,
      @fiscal_name, @fiscal_zip, @fiscal_regime,
      @invoicing_enabled, @invoicing_provider,
      @ticket_footer, ISNULL(@business_profile, 'RETAIL'),
      ISNULL(@loyalty_enabled, 0),
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
        ticket_footer = @ticket_footer,
        business_profile = ISNULL(@business_profile, business_profile),
        loyalty_enabled = ISNULL(@loyalty_enabled, loyalty_enabled),
        updated_at = GETDATE()
    WHERE id = @id;
  END

  /* ------------------------------------------------ espejo hacia el registro

     Una caja con una version anterior de Wybix no conoce `business_modules`:
     enciende Hospitality como siempre se hizo, escribiendo `business_profile`.
     Si el registro no se enterara, la caja nueva de al lado veria el modulo
     apagado y las dos mostrarian pantallas distintas del mismo negocio.

     Por eso este procedimiento -que es el que usa la caja vieja- mantiene el
     registro al dia. Es la mitad que falta del espejo: `sp_set_business_module`
     escribe hacia `business_config`, y esto escribe de vuelta.

     Solo cuando el parametro VINO. El panel de datos del negocio guarda el
     telefono sin mencionar el perfil ni la fidelizacion, y con NULL no se toca
     nada: cambiar el telefono no puede apagar un modulo.

     No hay sincronizacion bidireccional infinita porque ninguno de los dos
     procedimientos llama al otro: cada uno escribe la copia del otro y para. */
  IF OBJECT_ID(N'dbo.business_modules', 'U') IS NOT NULL
  BEGIN
    IF @business_profile IS NOT NULL
    BEGIN
      DECLARE @hosp BIT = CASE WHEN @business_profile = 'HOSPITALITY' THEN 1 ELSE 0 END;
      MERGE dbo.business_modules AS d
      USING (SELECT 'hospitality' AS module_key) AS s ON d.module_key = s.module_key
      WHEN MATCHED AND d.enabled <> @hosp
        THEN UPDATE SET enabled = @hosp,
                        enabled_at = CASE WHEN @hosp = 1 THEN SYSDATETIME() ELSE enabled_at END,
                        updated_at = SYSDATETIME()
      WHEN NOT MATCHED
        THEN INSERT (module_key, enabled, enabled_at, updated_at)
             VALUES ('hospitality', @hosp,
                     CASE WHEN @hosp = 1 THEN SYSDATETIME() END, SYSDATETIME());
    END

    IF @loyalty_enabled IS NOT NULL
    BEGIN
      MERGE dbo.business_modules AS d
      USING (SELECT 'loyalty' AS module_key) AS s ON d.module_key = s.module_key
      WHEN MATCHED AND d.enabled <> @loyalty_enabled
        THEN UPDATE SET enabled = @loyalty_enabled,
                        enabled_at = CASE WHEN @loyalty_enabled = 1 THEN SYSDATETIME() ELSE enabled_at END,
                        updated_at = SYSDATETIME()
      WHEN NOT MATCHED
        THEN INSERT (module_key, enabled, enabled_at, updated_at)
             VALUES ('loyalty', @loyalty_enabled,
                     CASE WHEN @loyalty_enabled = 1 THEN SYSDATETIME() END, SYSDATETIME());
    END
  END

  SELECT TOP 1 *
  FROM dbo.business_config
  WHERE id = @id;
END
GO
