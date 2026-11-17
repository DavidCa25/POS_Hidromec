/* supplier_item_aliases
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.supplier_item_aliases', 'U') IS NULL
BEGIN
CREATE TABLE dbo.supplier_item_aliases (
    supplier_id INT NOT NULL,
    texto NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NOT NULL,
    codigo NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
    product_id INT NOT NULL,
    presentation_id INT NULL,
    factor DECIMAL(14, 4) NOT NULL CONSTRAINT DF_supplier_item_aliases_factor DEFAULT ((1)),
    veces INT NOT NULL CONSTRAINT DF_supplier_item_aliases_veces DEFAULT ((1)),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_supplier_item_aliases_updated_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_supplier_item_aliases PRIMARY KEY CLUSTERED (supplier_id, texto)
);
END;

IF OBJECT_ID(N'dbo.FK_supplier_item_aliases_product', 'F') IS NULL
ALTER TABLE dbo.supplier_item_aliases WITH CHECK ADD CONSTRAINT FK_supplier_item_aliases_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.FK_supplier_item_aliases_supplier', 'F') IS NULL
ALTER TABLE dbo.supplier_item_aliases WITH CHECK ADD CONSTRAINT FK_supplier_item_aliases_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.CAT_suppliers (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_supplier_item_aliases_codigo' AND object_id = OBJECT_ID(N'dbo.supplier_item_aliases'))
CREATE NONCLUSTERED INDEX IX_supplier_item_aliases_codigo ON dbo.supplier_item_aliases (supplier_id, codigo) WHERE ([codigo] IS NOT NULL);
