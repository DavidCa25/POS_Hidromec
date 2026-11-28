/* mesero_cobros
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.mesero_cobros', 'U') IS NULL
BEGIN
CREATE TABLE dbo.mesero_cobros (
    sale_id INT NOT NULL,
    mesero_id INT NOT NULL,
    cuenta_id INT NULL,
    closure_id INT NOT NULL,
    register_id INT NOT NULL,
    metodo NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL,
    total DECIMAL(12, 2) NOT NULL,
    propina DECIMAL(12, 2) NOT NULL CONSTRAINT DF_mesero_cobros_propina DEFAULT ((0)),
    propina_metodo VARCHAR(12) COLLATE Modern_Spanish_CI_AS NULL,
    efectivo DECIMAL(12, 2) NOT NULL,
    cash_movement_id INT NULL,
    cobrado_en DATETIME2(3) NOT NULL CONSTRAINT DF_mesero_cobros_cobrado_en DEFAULT (sysdatetime()),
    CONSTRAINT PK_mesero_cobros PRIMARY KEY CLUSTERED (sale_id)
);
END;

IF OBJECT_ID(N'dbo.FK_mesero_cobros_sale', 'F') IS NULL
ALTER TABLE dbo.mesero_cobros WITH CHECK ADD CONSTRAINT FK_mesero_cobros_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);

IF OBJECT_ID(N'dbo.FK_mesero_cobros_closure', 'F') IS NULL
ALTER TABLE dbo.mesero_cobros WITH CHECK ADD CONSTRAINT FK_mesero_cobros_closure FOREIGN KEY (closure_id) REFERENCES dbo.cash_closures (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_mesero_cobros_mesero' AND object_id = OBJECT_ID(N'dbo.mesero_cobros'))
CREATE NONCLUSTERED INDEX IX_mesero_cobros_mesero ON dbo.mesero_cobros (mesero_id, closure_id);
