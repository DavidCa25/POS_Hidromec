/* PurchaseDetailType2
 * Tipo de tabla. SQL Server no conserva el texto original de un tipo, asi
 * que este DDL se reconstruye desde sys.columns. Es equivalente, no literal.
 * Un tipo NO admite CREATE OR ALTER: se comprueba antes de crearlo.
 */
IF TYPE_ID(N'dbo.PurchaseDetailType2') IS NULL
BEGIN
  CREATE TYPE dbo.PurchaseDetailType2 AS TABLE (
    product_id INT NOT NULL,
    quantity DECIMAL(12, 2) NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    profit_percent DECIMAL(5, 2) NULL,
    presentation_id INT NULL
  );
END;
