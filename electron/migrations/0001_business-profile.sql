/* ============================================================
   0001 — business profile

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0001_business-profile.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0001_business-profile.sql ========== */
/* 0001 — business profile
 *
 * Primera migracion productiva sobre WYBIX DATABASE BASELINE V1.
 *
 *   business_config.business_profile  RETAIL | HOSPITALITY  (default RETAIL)
 *     Perfil del NEGOCIO. Unica fuente de la capacidad Hospitality; el perfil
 *     del DISPOSITIVO vive en device-config.json de cada caja, no aqui.
 *   business_config.ticket_footer
 *     La aplicacion lo enviaba y el procedure lo rechazaba: se completa.
 *
 * Todas las instalaciones existentes quedan en RETAIL: exactamente como
 * operan hoy. Cada paso comprueba su existencia (idempotente).
 */

IF COL_LENGTH('dbo.business_config', 'ticket_footer') IS NULL
    ALTER TABLE dbo.business_config ADD ticket_footer NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL;
GO

IF COL_LENGTH('dbo.business_config', 'business_profile') IS NULL
    ALTER TABLE dbo.business_config ADD business_profile NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL
        CONSTRAINT DF_business_config_business_profile DEFAULT ('RETAIL');
GO

IF OBJECT_ID(N'dbo.CK_business_config_business_profile', 'C') IS NULL
    ALTER TABLE dbo.business_config WITH CHECK ADD CONSTRAINT CK_business_config_business_profile
        CHECK ([business_profile]='HOSPITALITY' OR [business_profile]='RETAIL');
GO

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
  @business_profile   nvarchar(20)  = NULL
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
      ticket_footer, business_profile,
      updated_at
    )
    VALUES (
      @business_name, @address, @phone, @rfc,
      @fiscal_name, @fiscal_zip, @fiscal_regime,
      @invoicing_enabled, @invoicing_provider,
      @ticket_footer, ISNULL(@business_profile, 'RETAIL'),
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
        updated_at = GETDATE()
    WHERE id = @id;
  END

  SELECT TOP 1 *
  FROM dbo.business_config
  WHERE id = @id;
END
GO
