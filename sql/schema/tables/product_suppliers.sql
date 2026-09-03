/* product_suppliers
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.product_suppliers', 'U') IS NULL
BEGIN
CREATE TABLE dbo.product_suppliers (
    product_id INT NOT NULL,
    supplier_id INT NOT NULL,
    is_default BIT NOT NULL CONSTRAINT DF_product_suppliers_is_default DEFAULT ((0)),
    last_cost DECIMAL(10, 2) NULL,
    active BIT NOT NULL CONSTRAINT DF_product_suppliers_active DEFAULT ((1)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_product_suppliers_created_at DEFAULT (sysdatetime()),
    updated_at DATETIME2(0) NULL,
    CONSTRAINT PK_product_suppliers PRIMARY KEY CLUSTERED (product_id, supplier_id)
);
END;

IF OBJECT_ID(N'dbo.FK_product_suppliers_product', 'F') IS NULL
ALTER TABLE dbo.product_suppliers WITH CHECK ADD CONSTRAINT FK_product_suppliers_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.FK_product_suppliers_supplier', 'F') IS NULL
ALTER TABLE dbo.product_suppliers WITH CHECK ADD CONSTRAINT FK_product_suppliers_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.CAT_suppliers (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_product_suppliers_default' AND object_id = OBJECT_ID(N'dbo.product_suppliers'))
CREATE UNIQUE NONCLUSTERED INDEX UX_product_suppliers_default ON dbo.product_suppliers (product_id) WHERE ([is_default]=(1));
