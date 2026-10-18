/* production_formulas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.production_formulas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.production_formulas (
    product_id INT NOT NULL,
    yield_qty DECIMAL(12, 2) NOT NULL CONSTRAINT DF_production_formulas_yield DEFAULT ((1)),
    notes NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL,
    updated_by INT NULL,
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_production_formulas_updated_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_production_formulas PRIMARY KEY CLUSTERED (product_id)
);
END;

IF OBJECT_ID(N'dbo.CK_production_formulas_yield', 'C') IS NULL
ALTER TABLE dbo.production_formulas WITH CHECK ADD CONSTRAINT CK_production_formulas_yield CHECK ([yield_qty]>(0));

IF OBJECT_ID(N'dbo.FK_production_formulas_product', 'F') IS NULL
ALTER TABLE dbo.production_formulas WITH CHECK ADD CONSTRAINT FK_production_formulas_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);
