/* cash_closures
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.cash_closures', 'U') IS NULL
BEGIN
CREATE TABLE dbo.cash_closures (
    id INT IDENTITY(1, 1) NOT NULL,
    userId INT NOT NULL,
    create_date DATE NULL,
    cash_expected DECIMAL(10, 2) NOT NULL,
    cash_delivered DECIMAL(10, 2) NOT NULL,
    difference DECIMAL(10, 2) NOT NULL,
    opened_at DATETIME2(0) NOT NULL,
    closed_at DATETIME2(0) NULL,
    opening_cash DECIMAL(10, 2) NOT NULL,
    opening_note NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    opening_user_id INT NULL,
    register_id INT NULL CONSTRAINT DF_cash_closures_register_id DEFAULT ((1)),
    PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_cash_closures_register', 'F') IS NULL
ALTER TABLE dbo.cash_closures WITH CHECK ADD CONSTRAINT FK_cash_closures_register FOREIGN KEY (register_id) REFERENCES dbo.registers (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_cash_closures_register_id' AND object_id = OBJECT_ID(N'dbo.cash_closures'))
CREATE NONCLUSTERED INDEX IX_cash_closures_register_id ON dbo.cash_closures (register_id);
