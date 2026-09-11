/* business_config
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.business_config', 'U') IS NULL
BEGIN
CREATE TABLE dbo.business_config (
    id INT IDENTITY(1, 1) NOT NULL,
    business_name NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NOT NULL,
    address NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL,
    phone NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NULL,
    rfc NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NULL,
    updated_at DATETIME NULL DEFAULT (getdate()),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_business_config_created_at DEFAULT (sysutcdatetime()),
    fiscal_name NVARCHAR(250) COLLATE Modern_Spanish_CI_AS NULL,
    fiscal_zip NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NULL,
    fiscal_regime NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NULL,
    invoicing_enabled BIT NOT NULL CONSTRAINT DF_business_config_invoicing_enabled DEFAULT ((0)),
    invoicing_provider NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NULL,
    ticket_footer NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL,
    business_profile NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_business_config_business_profile DEFAULT ('RETAIL'),
    loyalty_enabled BIT NOT NULL CONSTRAINT DF_business_config_loyalty_enabled DEFAULT ((0)),
    PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_business_config_business_profile', 'C') IS NULL
ALTER TABLE dbo.business_config WITH CHECK ADD CONSTRAINT CK_business_config_business_profile CHECK ([business_profile]='HOSPITALITY' OR [business_profile]='RETAIL');
