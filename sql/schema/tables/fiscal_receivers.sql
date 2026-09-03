/* fiscal_receivers
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.fiscal_receivers', 'U') IS NULL
BEGIN
CREATE TABLE dbo.fiscal_receivers (
    id INT IDENTITY(1, 1) NOT NULL,
    rfc NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    name NVARCHAR(250) COLLATE Modern_Spanish_CI_AS NOT NULL,
    fiscal_zip NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    fiscal_regime NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    cfdi_use NVARCHAR(5) COLLATE Modern_Spanish_CI_AS NOT NULL,
    email NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_fiscal_receivers_created_at DEFAULT (sysutcdatetime()),
    updated_at DATETIME2(0) NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_fiscal_receivers_rfc' AND object_id = OBJECT_ID(N'dbo.fiscal_receivers'))
CREATE UNIQUE NONCLUSTERED INDEX UX_fiscal_receivers_rfc ON dbo.fiscal_receivers (rfc);
