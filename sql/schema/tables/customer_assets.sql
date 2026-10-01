/* customer_assets
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.customer_assets', 'U') IS NULL
BEGIN
CREATE TABLE dbo.customer_assets (
    id INT IDENTITY(1, 1) NOT NULL,
    customer_id INT NOT NULL,
    kind NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_cassets_kind DEFAULT ('OTRO'),
    label NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    identifier NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
    secondary_identifier NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
    brand NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
    model NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
    year_or_age NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    color NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL,
    notes NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    active BIT NOT NULL CONSTRAINT DF_cassets_active DEFAULT ((1)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_cassets_created DEFAULT (sysdatetime()),
    updated_at DATETIME2(0) NULL,
    CONSTRAINT PK_customer_assets PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_customer_assets_customer', 'F') IS NULL
ALTER TABLE dbo.customer_assets WITH CHECK ADD CONSTRAINT FK_customer_assets_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_customer_assets_customer' AND object_id = OBJECT_ID(N'dbo.customer_assets'))
CREATE NONCLUSTERED INDEX IX_customer_assets_customer ON dbo.customer_assets (customer_id, active) INCLUDE (identifier, label);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_customer_assets_identifier' AND object_id = OBJECT_ID(N'dbo.customer_assets'))
CREATE NONCLUSTERED INDEX IX_customer_assets_identifier ON dbo.customer_assets (identifier) WHERE ([identifier] IS NOT NULL);
