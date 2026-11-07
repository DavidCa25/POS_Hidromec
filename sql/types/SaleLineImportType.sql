/* SaleLineImportType
 * Tipo de tabla. SQL Server no conserva el texto original de un tipo, asi
 * que este DDL se reconstruye desde sys.columns. Es equivalente, no literal.
 * Un tipo NO admite CREATE OR ALTER: se comprueba antes de crearlo.
 *
 * Partidas de ventas historicas (Migracion -> Ventas), una por producto
 * vendido. Lo recibe dbo.sp_import_sales.
 */
IF TYPE_ID(N'dbo.SaleLineImportType') IS NULL
BEGIN
  CREATE TYPE dbo.SaleLineImportType AS TABLE (
    ext_folio NVARCHAR(40) NULL,
    sale_date DATETIME NULL,
    part_number NVARCHAR(100) NULL,
    quantity DECIMAL(12, 2) NULL,
    unit_price DECIMAL(10, 2) NULL,
    payment_method NVARCHAR(50) NULL
  );
END;
