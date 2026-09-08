/* recipe_lines
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.recipe_lines', 'U') IS NULL
BEGIN
CREATE TABLE dbo.recipe_lines (
    id INT IDENTITY(1, 1) NOT NULL,
    recipe_id INT NOT NULL,
    ingredient_product_id INT NOT NULL,
    qty_base DECIMAL(14, 4) NOT NULL,
    input_qty DECIMAL(12, 3) NOT NULL,
    input_uom NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    waste_pct DECIMAL(5, 2) NOT NULL CONSTRAINT DF_recipe_lines_waste_pct DEFAULT ((0)),
    sort_order INT NOT NULL CONSTRAINT DF_recipe_lines_sort_order DEFAULT ((0)),
    CONSTRAINT PK_recipe_lines PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_recipe_lines_qty', 'C') IS NULL
ALTER TABLE dbo.recipe_lines WITH CHECK ADD CONSTRAINT CK_recipe_lines_qty CHECK ([qty_base]>(0) AND [input_qty]>(0));

IF OBJECT_ID(N'dbo.CK_recipe_lines_waste', 'C') IS NULL
ALTER TABLE dbo.recipe_lines WITH CHECK ADD CONSTRAINT CK_recipe_lines_waste CHECK ([waste_pct]>=(0) AND [waste_pct]<=(100));

IF OBJECT_ID(N'dbo.FK_recipe_lines_ingredient', 'F') IS NULL
ALTER TABLE dbo.recipe_lines WITH CHECK ADD CONSTRAINT FK_recipe_lines_ingredient FOREIGN KEY (ingredient_product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.FK_recipe_lines_recipe', 'F') IS NULL
ALTER TABLE dbo.recipe_lines WITH CHECK ADD CONSTRAINT FK_recipe_lines_recipe FOREIGN KEY (recipe_id) REFERENCES dbo.recipes (id) ON DELETE CASCADE;

IF OBJECT_ID(N'dbo.FK_recipe_lines_uom', 'F') IS NULL
ALTER TABLE dbo.recipe_lines WITH CHECK ADD CONSTRAINT FK_recipe_lines_uom FOREIGN KEY (input_uom) REFERENCES dbo.uoms (code);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_recipe_lines_recipe_ingredient' AND object_id = OBJECT_ID(N'dbo.recipe_lines'))
CREATE UNIQUE NONCLUSTERED INDEX UX_recipe_lines_recipe_ingredient ON dbo.recipe_lines (recipe_id, ingredient_product_id);
