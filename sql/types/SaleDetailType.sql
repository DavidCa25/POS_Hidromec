/* SaleDetailType
 * Tipo de tabla. SQL Server no conserva el texto original de un tipo, asi
 * que este DDL se reconstruye desde sys.columns. Es equivalente, no literal.
 * Un tipo NO admite CREATE OR ALTER: se comprueba antes de crearlo.
 */
IF TYPE_ID(N'dbo.SaleDetailType') IS NULL
BEGIN
  CREATE TYPE dbo.SaleDetailType AS TABLE (
    product_id INT NULL,
    quantity DECIMAL(12, 2) NULL,
    unit_price DECIMAL(10, 2) NULL
  );
END;
