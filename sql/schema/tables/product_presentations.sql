/* product_presentations
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.product_presentations', 'U') IS NULL
BEGIN
CREATE TABLE dbo.product_presentations (
    id INT IDENTITY(1, 1) NOT NULL,
    product_id INT NOT NULL,
    name NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NOT NULL,
    factor_to_base DECIMAL(14, 4) NOT NULL,
    is_default BIT NOT NULL CONSTRAINT DF_product_presentations_is_default DEFAULT ((0)),
    active BIT NOT NULL CONSTRAINT DF_product_presentations_active DEFAULT ((1)),
    CONSTRAINT PK_product_presentations PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_product_presentations_factor', 'C') IS NULL
ALTER TABLE dbo.product_presentations WITH CHECK ADD CONSTRAINT CK_product_presentations_factor CHECK ([factor_to_base]>(0));

IF OBJECT_ID(N'dbo.FK_product_presentations_product', 'F') IS NULL
ALTER TABLE dbo.product_presentations WITH CHECK ADD CONSTRAINT FK_product_presentations_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_product_presentations_product' AND object_id = OBJECT_ID(N'dbo.product_presentations'))
CREATE NONCLUSTERED INDEX IX_product_presentations_product ON dbo.product_presentations (product_id);
