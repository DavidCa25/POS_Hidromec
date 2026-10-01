/* HospOrdenLineaV2Type
 * Tipo de tabla. SQL Server no conserva el texto original de un tipo, asi
 * que este DDL se reconstruye desde sys.columns. Es equivalente, no literal.
 * Un tipo NO admite CREATE OR ALTER: se comprueba antes de crearlo.
 */
IF TYPE_ID(N'dbo.HospOrdenLineaV2Type') IS NULL
BEGIN
  CREATE TYPE dbo.HospOrdenLineaV2Type AS TABLE (
    linea INT NOT NULL,
    product_id INT NOT NULL,
    cantidad DECIMAL(12, 3) NOT NULL,
    nota NVARCHAR(200) NULL,
    origen UNIQUEIDENTIFIER NULL
  );
END;
