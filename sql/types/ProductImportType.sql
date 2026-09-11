/* ProductImportType
 * Tipo de tabla. SQL Server no conserva el texto original de un tipo, asi
 * que este DDL se reconstruye desde sys.columns. Es equivalente, no literal.
 * Un tipo NO admite CREATE OR ALTER: se comprueba antes de crearlo.
 */
IF TYPE_ID(N'dbo.ProductImportType') IS NULL
BEGIN
  CREATE TYPE dbo.ProductImportType AS TABLE (
    part_number NVARCHAR(100) NULL,
    name NVARCHAR(100) NULL,
    brand_name NVARCHAR(150) NULL,
    category_name NVARCHAR(150) NULL,
    price DECIMAL(10, 2) NULL,
    stock DECIMAL(12, 2) NULL,
    bar_code NVARCHAR(100) NULL,
    clave_prod_serv NVARCHAR(8) NULL,
    clave_unidad NVARCHAR(5) NULL,
    objeto_impuesto NVARCHAR(2) NULL,
    tasa_iva DECIMAL(5, 4) NULL
  );
END;
