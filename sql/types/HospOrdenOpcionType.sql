/* HospOrdenOpcionType
 * Tipo de tabla. SQL Server no conserva el texto original de un tipo, asi
 * que este DDL se reconstruye desde sys.columns. Es equivalente, no literal.
 * Un tipo NO admite CREATE OR ALTER: se comprueba antes de crearlo.
 */
IF TYPE_ID(N'dbo.HospOrdenOpcionType') IS NULL
BEGIN
  CREATE TYPE dbo.HospOrdenOpcionType AS TABLE (
    linea INT NOT NULL,
    modifier_option_id INT NOT NULL,
    quantity INT NOT NULL
  );
END;
