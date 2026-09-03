/* invoicing_provider_config
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.invoicing_provider_config', 'U') IS NULL
BEGIN
CREATE TABLE dbo.invoicing_provider_config (
    id INT IDENTITY(1, 1) NOT NULL,
    provider NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL,
    api_user NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    api_key_encrypted VARBINARY(MAX) NULL,
    api_secret_encrypted VARBINARY(MAX) NULL,
    csd_cer_encrypted VARBINARY(MAX) NULL,
    csd_key_encrypted VARBINARY(MAX) NULL,
    csd_password_encrypted VARBINARY(MAX) NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_invoicing_provider_config_created_at DEFAULT (sysutcdatetime()),
    updated_at DATETIME2(0) NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_invoicing_provider_config_provider' AND object_id = OBJECT_ID(N'dbo.invoicing_provider_config'))
CREATE UNIQUE NONCLUSTERED INDEX UX_invoicing_provider_config_provider ON dbo.invoicing_provider_config (provider);
