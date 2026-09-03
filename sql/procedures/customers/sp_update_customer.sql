/* sp_update_customer
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:      <David>
-- Create date: <12-01-2025>
-- Update:      + campos fiscales, tax_id y protección de datos existentes
-- Description: <Store procedure para actualizar cliente>
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[sp_update_customer]
    @id             int,
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
    @credit_limit   decimal(12,2),
    @terms_days     int,
    @active         bit,
    @regimen_fiscal nvarchar(5)       = NULL,
    @uso_cfdi       nvarchar(5)       = NULL,
    @razon_social   nvarchar(255)     = NULL,

    -- Los hacemos opcionales (= NULL)
    @grace_days     int               = NULL,
    @late_fee_pct   decimal(5,2)      = NULL,
    @late_fee_fixed decimal(12,2)     = NULL,
    @risk_level     tinyint           = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.customers
    SET
        code           = @code,
        customerName   = @customerName,
        tax_id         = @tax_id,
        email          = @email,
        phone          = @phone,
        mobile         = @mobile,
        birthdate      = @birthdate,
        street         = @street,
        city           = @city,
        state          = @state,
        zip            = @zip,
        country        = @country,
        credit_limit   = @credit_limit,
        terms_days     = @terms_days,
        active         = @active,
        regimen_fiscal = @regimen_fiscal,
        uso_cfdi       = @uso_cfdi,
        razon_social   = @razon_social,

        -- Si llega NULL, conserva el valor que ya tenía en la tabla
        grace_days     = ISNULL(@grace_days, grace_days),
        late_fee_pct   = ISNULL(@late_fee_pct, late_fee_pct),
        late_fee_fixed = ISNULL(@late_fee_fixed, late_fee_fixed),
        risk_level     = ISNULL(@risk_level, risk_level),

        updated_at     = SYSUTCDATETIME()
    WHERE id = @id;
END;
GO
