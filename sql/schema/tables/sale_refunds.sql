/* sale_refunds
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.sale_refunds', 'U') IS NULL
BEGIN
CREATE TABLE dbo.sale_refunds (
    id INT IDENTITY(1, 1) NOT NULL,
    sale_id INT NOT NULL,
    user_id INT NOT NULL,
    datee DATETIME2(0) NOT NULL DEFAULT (sysdatetime()),
    payment_method NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NOT NULL,
    refund_total DECIMAL(12, 2) NOT NULL,
    note NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    closure_id INT NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sale_refunds_sale_id' AND object_id = OBJECT_ID(N'dbo.sale_refunds'))
CREATE NONCLUSTERED INDEX IX_sale_refunds_sale_id ON dbo.sale_refunds (sale_id);
