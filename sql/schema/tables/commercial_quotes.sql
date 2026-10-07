/* commercial_quotes
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.commercial_quotes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.commercial_quotes (
    id UNIQUEIDENTIFIER NOT NULL,
    actor_id INT NOT NULL,
    register_id INT NULL,
    policy_version INT NOT NULL,
    payload NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NOT NULL,
    expires_at DATETIME2(7) NOT NULL,
    sale_id INT NULL,
    created_at DATETIME2(7) NOT NULL DEFAULT (sysutcdatetime()),
    payment_reference NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

ALTER TABLE dbo.commercial_quotes WITH CHECK ADD CHECK (isjson([payload])=(1));

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_commercial_quote_payment' AND object_id = OBJECT_ID(N'dbo.commercial_quotes'))
CREATE UNIQUE NONCLUSTERED INDEX UX_commercial_quote_payment ON dbo.commercial_quotes (payment_reference) WHERE ([payment_reference] IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_commercial_quote_sale' AND object_id = OBJECT_ID(N'dbo.commercial_quotes'))
CREATE UNIQUE NONCLUSTERED INDEX UX_commercial_quote_sale ON dbo.commercial_quotes (sale_id) WHERE ([sale_id] IS NOT NULL);
