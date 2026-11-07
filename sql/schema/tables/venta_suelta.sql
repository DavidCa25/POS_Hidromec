/* venta_suelta
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.venta_suelta', 'U') IS NULL
BEGIN
CREATE TABLE dbo.venta_suelta (
    product_id INT NOT NULL,
    parent_product_id INT NOT NULL,
    piezas INT NOT NULL,
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_venta_suelta_upd DEFAULT (sysdatetime()),
    updated_by INT NULL,
    CONSTRAINT PK_venta_suelta PRIMARY KEY CLUSTERED (product_id)
);
END;

IF OBJECT_ID(N'dbo.CK_venta_suelta_distinto', 'C') IS NULL
ALTER TABLE dbo.venta_suelta WITH CHECK ADD CONSTRAINT CK_venta_suelta_distinto CHECK ([product_id]<>[parent_product_id]);

IF OBJECT_ID(N'dbo.CK_venta_suelta_piezas', 'C') IS NULL
ALTER TABLE dbo.venta_suelta WITH CHECK ADD CONSTRAINT CK_venta_suelta_piezas CHECK ([piezas]>=(2) AND [piezas]<=(10000));

IF OBJECT_ID(N'dbo.FK_venta_suelta_parent', 'F') IS NULL
ALTER TABLE dbo.venta_suelta WITH CHECK ADD CONSTRAINT FK_venta_suelta_parent FOREIGN KEY (parent_product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.FK_venta_suelta_product', 'F') IS NULL
ALTER TABLE dbo.venta_suelta WITH CHECK ADD CONSTRAINT FK_venta_suelta_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_venta_suelta_parent' AND object_id = OBJECT_ID(N'dbo.venta_suelta'))
CREATE NONCLUSTERED INDEX IX_venta_suelta_parent ON dbo.venta_suelta (parent_product_id);
