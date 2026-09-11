/* inventory_movements
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.inventory_movements', 'U') IS NULL
BEGIN
CREATE TABLE dbo.inventory_movements (
    id INT IDENTITY(1, 1) NOT NULL,
    product_id INT NOT NULL,
    typee NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    reference NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NULL,
    quantity DECIMAL(12, 2) NOT NULL,
    datee DATETIME NULL DEFAULT (getdate()),
    descriptionn NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    source NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    sale_detail_id INT NULL,
    unit_cost DECIMAL(14, 4) NULL,
    sold_product_id INT NULL,
    units DECIMAL(12, 2) NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

ALTER TABLE dbo.inventory_movements WITH CHECK ADD CHECK ([typee]='salida' OR [typee]='entrada');

ALTER TABLE dbo.inventory_movements WITH CHECK ADD FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.FK_inventory_movements_sale_detail', 'F') IS NULL
ALTER TABLE dbo.inventory_movements WITH CHECK ADD CONSTRAINT FK_inventory_movements_sale_detail FOREIGN KEY (sale_detail_id) REFERENCES dbo.sale_detail (id) ON DELETE SET NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_inventory_movements_product_date' AND object_id = OBJECT_ID(N'dbo.inventory_movements'))
CREATE NONCLUSTERED INDEX IX_inventory_movements_product_date ON dbo.inventory_movements (product_id, datee);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_inventory_movements_sale_detail' AND object_id = OBJECT_ID(N'dbo.inventory_movements'))
CREATE NONCLUSTERED INDEX IX_inventory_movements_sale_detail ON dbo.inventory_movements (sale_detail_id) WHERE ([sale_detail_id] IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_inventory_movements_sale_ref' AND object_id = OBJECT_ID(N'dbo.inventory_movements'))
CREATE NONCLUSTERED INDEX IX_inventory_movements_sale_ref ON dbo.inventory_movements (reference, sold_product_id) INCLUDE (product_id, quantity, source, units);
