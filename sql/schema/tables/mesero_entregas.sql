/* mesero_entregas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.mesero_entregas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.mesero_entregas (
    id INT IDENTITY(1, 1) NOT NULL,
    mesero_id INT NOT NULL,
    closure_id INT NOT NULL,
    register_id INT NOT NULL,
    esperado DECIMAL(12, 2) NOT NULL,
    entregado DECIMAL(12, 2) NOT NULL,
    diferencia DECIMAL(12, 2) NOT NULL,
    recibio_user_id INT NULL,
    nota NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    cash_movement_id INT NULL,
    entregado_en DATETIME2(3) NOT NULL CONSTRAINT DF_mesero_entregas_en DEFAULT (sysdatetime()),
    CONSTRAINT PK_mesero_entregas PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_mesero_entregas_closure', 'F') IS NULL
ALTER TABLE dbo.mesero_entregas WITH CHECK ADD CONSTRAINT FK_mesero_entregas_closure FOREIGN KEY (closure_id) REFERENCES dbo.cash_closures (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_mesero_entregas_mesero' AND object_id = OBJECT_ID(N'dbo.mesero_entregas'))
CREATE NONCLUSTERED INDEX IX_mesero_entregas_mesero ON dbo.mesero_entregas (mesero_id, closure_id);
