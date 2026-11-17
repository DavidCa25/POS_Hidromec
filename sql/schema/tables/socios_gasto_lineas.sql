/* socios_gasto_lineas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.socios_gasto_lineas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.socios_gasto_lineas (
    expense_id INT NOT NULL,
    socio_id INT NOT NULL,
    pct DECIMAL(7, 4) NOT NULL,
    CONSTRAINT PK_socios_gasto_lineas PRIMARY KEY CLUSTERED (expense_id, socio_id)
);
END;

IF OBJECT_ID(N'dbo.CK_socios_gasto_lineas_pct', 'C') IS NULL
ALTER TABLE dbo.socios_gasto_lineas WITH CHECK ADD CONSTRAINT CK_socios_gasto_lineas_pct CHECK ([pct]>(0) AND [pct]<=(100));

IF OBJECT_ID(N'dbo.FK_socios_gasto_lineas_gasto', 'F') IS NULL
ALTER TABLE dbo.socios_gasto_lineas WITH CHECK ADD CONSTRAINT FK_socios_gasto_lineas_gasto FOREIGN KEY (expense_id) REFERENCES dbo.socios_gasto (expense_id) ON DELETE CASCADE;

IF OBJECT_ID(N'dbo.FK_socios_gasto_lineas_socio', 'F') IS NULL
ALTER TABLE dbo.socios_gasto_lineas WITH CHECK ADD CONSTRAINT FK_socios_gasto_lineas_socio FOREIGN KEY (socio_id) REFERENCES dbo.socios (id);
