/* recipes
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.recipes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.recipes (
    id INT IDENTITY(1, 1) NOT NULL,
    product_id INT NOT NULL,
    variant_option_id INT NULL,
    active BIT NOT NULL CONSTRAINT DF_recipes_active DEFAULT ((1)),
    notes NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL,
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_recipes_updated_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_recipes PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_recipes_product', 'F') IS NULL
ALTER TABLE dbo.recipes WITH CHECK ADD CONSTRAINT FK_recipes_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.FK_recipes_variant_option', 'F') IS NULL
ALTER TABLE dbo.recipes WITH CHECK ADD CONSTRAINT FK_recipes_variant_option FOREIGN KEY (variant_option_id) REFERENCES dbo.modifier_options (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_recipes_product_variant' AND object_id = OBJECT_ID(N'dbo.recipes'))
CREATE UNIQUE NONCLUSTERED INDEX UX_recipes_product_variant ON dbo.recipes (product_id, variant_option_id);
