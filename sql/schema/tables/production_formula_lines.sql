/* production_formula_lines
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.production_formula_lines', 'U') IS NULL
BEGIN
CREATE TABLE dbo.production_formula_lines (
    product_id INT NOT NULL,
    ingredient_product_id INT NOT NULL,
    qty_base DECIMAL(14, 4) NOT NULL,
    input_qty DECIMAL(12, 3) NOT NULL,
    input_uom NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    waste_pct DECIMAL(5, 2) NOT NULL CONSTRAINT DF_production_formula_lines_waste DEFAULT ((0)),
    sort_order INT NOT NULL CONSTRAINT DF_production_formula_lines_sort DEFAULT ((0)),
    CONSTRAINT PK_production_formula_lines PRIMARY KEY CLUSTERED (product_id, ingredient_product_id)
);
END;

IF OBJECT_ID(N'dbo.CK_production_formula_lines_qty', 'C') IS NULL
ALTER TABLE dbo.production_formula_lines WITH CHECK ADD CONSTRAINT CK_production_formula_lines_qty CHECK ([qty_base]>(0) AND [input_qty]>(0));

IF OBJECT_ID(N'dbo.CK_production_formula_lines_self', 'C') IS NULL
ALTER TABLE dbo.production_formula_lines WITH CHECK ADD CONSTRAINT CK_production_formula_lines_self CHECK ([ingredient_product_id]<>[product_id]);

IF OBJECT_ID(N'dbo.CK_production_formula_lines_waste', 'C') IS NULL
ALTER TABLE dbo.production_formula_lines WITH CHECK ADD CONSTRAINT CK_production_formula_lines_waste CHECK ([waste_pct]>=(0) AND [waste_pct]<=(100));

IF OBJECT_ID(N'dbo.FK_production_formula_lines_formula', 'F') IS NULL
ALTER TABLE dbo.production_formula_lines WITH CHECK ADD CONSTRAINT FK_production_formula_lines_formula FOREIGN KEY (product_id) REFERENCES dbo.production_formulas (product_id) ON DELETE CASCADE;

IF OBJECT_ID(N'dbo.FK_production_formula_lines_ingredient', 'F') IS NULL
ALTER TABLE dbo.production_formula_lines WITH CHECK ADD CONSTRAINT FK_production_formula_lines_ingredient FOREIGN KEY (ingredient_product_id) REFERENCES dbo.products (id);
