/* ModifierOptionType
 * Tipo de tabla. SQL Server no conserva el texto original de un tipo, asi
 * que este DDL se reconstruye desde sys.columns. Es equivalente, no literal.
 * Un tipo NO admite CREATE OR ALTER: se comprueba antes de crearlo.
 */
IF TYPE_ID(N'dbo.ModifierOptionType') IS NULL
BEGIN
  CREATE TYPE dbo.ModifierOptionType AS TABLE (
    id INT NULL,
    name NVARCHAR(80) NOT NULL,
    price_delta DECIMAL(10, 2) NULL,
    effect NVARCHAR(12) NOT NULL,
    ingredient_product_id INT NULL,
    replaces_product_id INT NULL,
    qty_base DECIMAL(14, 4) NULL,
    qty_factor DECIMAL(8, 4) NULL,
    active BIT NULL,
    sort_order INT NULL
  );
END;
