/* sp_create_customer
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:      <David>
-- Update:      + campos fiscales (regimen, uso CFDI, razon social)
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[sp_create_customer]
    @code           nvarchar(30)      = NULL,
    @customerName   nvarchar(120),
    @tax_id         nvarchar(20)      = NULL,
    @email          nvarchar(120)     = NULL,
    @phone          nvarchar(30)      = NULL,
    @mobile         nvarchar(30)      = NULL,
    @birthdate      date              = NULL,
    @street         nvarchar(120)     = NULL,
    @city           nvarchar(80)      = NULL,
    @state          nvarchar(80)      = NULL,
    @zip            nvarchar(12)      = NULL,
    @country        nvarchar(80)      = NULL,
    @credit_limit   decimal(12,2)     = 0,
    @terms_days     int               = 0,
    @grace_days     int               = 0,
    @late_fee_pct   decimal(5,2)      = 0,
    @late_fee_fixed decimal(12,2)     = 0,
    @risk_level     tinyint           = 0,
    @active         bit               = 1,
    @regimen_fiscal nvarchar(5)       = NULL,
    @uso_cfdi       nvarchar(5)       = NULL,
    @razon_social   nvarchar(255)     = NULL,
    @NewId          int OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.customers
    (
        code, customerName, tax_id, email, phone, mobile, birthdate,
        street, city, state, zip, country,
        credit_limit, terms_days, grace_days, late_fee_pct, late_fee_fixed,
        risk_level, active,
        regimen_fiscal, uso_cfdi, razon_social,
        created_at, updated_at
    )
    VALUES
    (
        @code, @customerName, @tax_id, @email, @phone, @mobile, @birthdate,
        @street, @city, @state, @zip, @country,
        @credit_limit, @terms_days, @grace_days, @late_fee_pct, @late_fee_fixed,
        @risk_level, @active,
        @regimen_fiscal, @uso_cfdi, @razon_social,
        SYSUTCDATETIME(), NULL
    );
    SET @NewId = SCOPE_IDENTITY();
END;
GO
