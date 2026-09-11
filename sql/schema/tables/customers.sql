/* customers
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.customers', 'U') IS NULL
BEGIN
CREATE TABLE dbo.customers (
    id INT IDENTITY(1, 1) NOT NULL,
    code NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NULL,
    customerName NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    tax_id NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    email NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    phone NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NULL,
    mobile NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NULL,
    birthdate DATE NULL,
    street NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    city NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NULL,
    state NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NULL,
    zip NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NULL,
    country NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NULL,
    credit_limit DECIMAL(12, 2) NOT NULL CONSTRAINT DF_customers_credit_limit DEFAULT ((0)),
    terms_days INT NOT NULL CONSTRAINT DF_customers_terms_days DEFAULT ((0)),
    grace_days INT NOT NULL CONSTRAINT DF_customers_grace_days DEFAULT ((0)),
    late_fee_pct DECIMAL(5, 2) NOT NULL CONSTRAINT DF_customers_late_pct DEFAULT ((0)),
    late_fee_fixed DECIMAL(12, 2) NOT NULL CONSTRAINT DF_customers_late_fix DEFAULT ((0)),
    risk_level TINYINT NOT NULL CONSTRAINT DF_customers_risk DEFAULT ((0)),
    active BIT NOT NULL CONSTRAINT DF_customers_active DEFAULT ((1)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_customers_created DEFAULT (sysutcdatetime()),
    updated_at DATETIME2(0) NULL,
    regimen_fiscal NVARCHAR(5) COLLATE Modern_Spanish_CI_AS NULL,
    uso_cfdi NVARCHAR(5) COLLATE Modern_Spanish_CI_AS NULL,
    razon_social NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_customers_name' AND object_id = OBJECT_ID(N'dbo.customers'))
CREATE NONCLUSTERED INDEX IX_customers_name ON dbo.customers (customerName);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_customers_code' AND object_id = OBJECT_ID(N'dbo.customers'))
CREATE UNIQUE NONCLUSTERED INDEX UX_customers_code ON dbo.customers (code) WHERE ([code] IS NOT NULL);
