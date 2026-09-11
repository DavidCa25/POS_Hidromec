/* RecipeLineType
 * Tipo de tabla. SQL Server no conserva el texto original de un tipo, asi
 * que este DDL se reconstruye desde sys.columns. Es equivalente, no literal.
 * Un tipo NO admite CREATE OR ALTER: se comprueba antes de crearlo.
 */
IF TYPE_ID(N'dbo.RecipeLineType') IS NULL
BEGIN
  CREATE TYPE dbo.RecipeLineType AS TABLE (
    ingredient_product_id INT NOT NULL,
    input_qty DECIMAL(12, 3) NOT NULL,
    input_uom NVARCHAR(10) NOT NULL,
    waste_pct DECIMAL(5, 2) NULL,
    sort_order INT NULL
  );
END;
