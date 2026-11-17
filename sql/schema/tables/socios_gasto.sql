/* socios_gasto
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.socios_gasto', 'U') IS NULL
BEGIN
CREATE TABLE dbo.socios_gasto (
    expense_id INT NOT NULL,
    modo VARCHAR(8) COLLATE Modern_Spanish_CI_AS NOT NULL,
    pagado_por_socio_id INT NULL,
    CONSTRAINT PK_socios_gasto PRIMARY KEY CLUSTERED (expense_id)
);
END;

IF OBJECT_ID(N'dbo.CK_socios_gasto_modo', 'C') IS NULL
ALTER TABLE dbo.socios_gasto WITH CHECK ADD CONSTRAINT CK_socios_gasto_modo CHECK ([modo]='COMUN' OR [modo]='SOCIOS');

IF OBJECT_ID(N'dbo.FK_socios_gasto_expense', 'F') IS NULL
ALTER TABLE dbo.socios_gasto WITH CHECK ADD CONSTRAINT FK_socios_gasto_expense FOREIGN KEY (expense_id) REFERENCES dbo.expenses (id);

IF OBJECT_ID(N'dbo.FK_socios_gasto_pagado', 'F') IS NULL
ALTER TABLE dbo.socios_gasto WITH CHECK ADD CONSTRAINT FK_socios_gasto_pagado FOREIGN KEY (pagado_por_socio_id) REFERENCES dbo.socios (id);
