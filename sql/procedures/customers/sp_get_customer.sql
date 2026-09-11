/* sp_get_customer
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:      <David>
-- Create date: <12-01-2025>
-- Update:      + campos fiscales
-- Description: <Store procedure para obtener cliente>
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[sp_get_customer]
    @id   int          = NULL,
    @code nvarchar(30) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        id, code, customerName, tax_id, email, phone, mobile, birthdate,
        street, city, state, zip, country,
        credit_limit, terms_days, grace_days, late_fee_pct, late_fee_fixed,
        risk_level, active,
        regimen_fiscal, uso_cfdi, razon_social,
        created_at, updated_at
    FROM dbo.customers
    WHERE
        (@id IS NULL   OR id = @id)
        AND (@code IS NULL OR code = @code);
END;
GO
