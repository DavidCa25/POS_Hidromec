/* propinas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.propinas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.propinas (
    id INT IDENTITY(1, 1) NOT NULL,
    sale_id INT NOT NULL,
    monto DECIMAL(10, 2) NOT NULL,
    metodo VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    user_id INT NOT NULL,
    register_id INT NOT NULL,
    closure_id INT NULL,
    fecha DATETIME2(0) NOT NULL CONSTRAINT DF_propinas_fecha DEFAULT (sysdatetime()),
    cash_movement_id INT NULL,
    reparto_id INT NULL,
    CONSTRAINT PK_propinas PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_propinas_cash', 'C') IS NULL
ALTER TABLE dbo.propinas WITH CHECK ADD CONSTRAINT CK_propinas_cash CHECK ([metodo]<>'EFECTIVO' OR [cash_movement_id] IS NOT NULL);

IF OBJECT_ID(N'dbo.CK_propinas_metodo', 'C') IS NULL
ALTER TABLE dbo.propinas WITH CHECK ADD CONSTRAINT CK_propinas_metodo CHECK ([metodo]='TARJETA' OR [metodo]='EFECTIVO');

IF OBJECT_ID(N'dbo.CK_propinas_monto', 'C') IS NULL
ALTER TABLE dbo.propinas WITH CHECK ADD CONSTRAINT CK_propinas_monto CHECK ([monto]>(0));

IF OBJECT_ID(N'dbo.FK_propinas_cash', 'F') IS NULL
ALTER TABLE dbo.propinas WITH CHECK ADD CONSTRAINT FK_propinas_cash FOREIGN KEY (cash_movement_id) REFERENCES dbo.cash_movements (id);

IF OBJECT_ID(N'dbo.FK_propinas_register', 'F') IS NULL
ALTER TABLE dbo.propinas WITH CHECK ADD CONSTRAINT FK_propinas_register FOREIGN KEY (register_id) REFERENCES dbo.registers (id);

IF OBJECT_ID(N'dbo.FK_propinas_reparto', 'F') IS NULL
ALTER TABLE dbo.propinas WITH CHECK ADD CONSTRAINT FK_propinas_reparto FOREIGN KEY (reparto_id) REFERENCES dbo.propinas_repartos (id);

IF OBJECT_ID(N'dbo.FK_propinas_sale', 'F') IS NULL
ALTER TABLE dbo.propinas WITH CHECK ADD CONSTRAINT FK_propinas_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);

IF OBJECT_ID(N'dbo.FK_propinas_user', 'F') IS NULL
ALTER TABLE dbo.propinas WITH CHECK ADD CONSTRAINT FK_propinas_user FOREIGN KEY (user_id) REFERENCES dbo.users (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_propinas_pendientes' AND object_id = OBJECT_ID(N'dbo.propinas'))
CREATE NONCLUSTERED INDEX IX_propinas_pendientes ON dbo.propinas (register_id, fecha) WHERE ([reparto_id] IS NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_propinas_sale' AND object_id = OBJECT_ID(N'dbo.propinas'))
CREATE UNIQUE NONCLUSTERED INDEX UX_propinas_sale ON dbo.propinas (sale_id);
