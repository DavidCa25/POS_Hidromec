/* production_waste
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.production_waste', 'U') IS NULL
BEGIN
CREATE TABLE dbo.production_waste (
    id INT IDENTITY(1, 1) NOT NULL,
    uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_production_waste_uuid DEFAULT (newid()),
    product_id INT NOT NULL,
    waste_date DATE NOT NULL,
    qty DECIMAL(12, 2) NOT NULL,
    reason NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL,
    unit_cost DECIMAL(14, 4) NULL,
    machine_name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    created_by INT NOT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_production_waste_created_at DEFAULT (sysdatetime()),
    row_version TIMESTAMP NOT NULL,
    CONSTRAINT PK_production_waste PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UQ_production_waste_uuid UNIQUE NONCLUSTERED (uuid)
);
END;

IF OBJECT_ID(N'dbo.CK_production_waste_qty', 'C') IS NULL
ALTER TABLE dbo.production_waste WITH CHECK ADD CONSTRAINT CK_production_waste_qty CHECK ([qty]>(0));

IF OBJECT_ID(N'dbo.FK_production_waste_created_by', 'F') IS NULL
ALTER TABLE dbo.production_waste WITH CHECK ADD CONSTRAINT FK_production_waste_created_by FOREIGN KEY (created_by) REFERENCES dbo.users (id);

IF OBJECT_ID(N'dbo.FK_production_waste_product', 'F') IS NULL
ALTER TABLE dbo.production_waste WITH CHECK ADD CONSTRAINT FK_production_waste_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_production_waste_date' AND object_id = OBJECT_ID(N'dbo.production_waste'))
CREATE NONCLUSTERED INDEX IX_production_waste_date ON dbo.production_waste (waste_date);
