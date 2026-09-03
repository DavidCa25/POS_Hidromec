/* cash_movements
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.cash_movements', 'U') IS NULL
BEGIN
CREATE TABLE dbo.cash_movements (
    id INT IDENTITY(1, 1) NOT NULL,
    datee DATETIME2(7) NOT NULL DEFAULT (getdate()),
    userId INT NULL,
    typee VARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL,
    reference_id INT NULL,
    reference NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NULL,
    amount DECIMAL(12, 2) NOT NULL,
    note NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    closure_id INT NULL,
    register_id INT NULL CONSTRAINT DF_cash_movements_register_id DEFAULT ((1)),
    PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_cash_movements_register', 'F') IS NULL
ALTER TABLE dbo.cash_movements WITH CHECK ADD CONSTRAINT FK_cash_movements_register FOREIGN KEY (register_id) REFERENCES dbo.registers (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_cash_movements_closure' AND object_id = OBJECT_ID(N'dbo.cash_movements'))
CREATE NONCLUSTERED INDEX IX_cash_movements_closure ON dbo.cash_movements (closure_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_cash_movements_closure_date' AND object_id = OBJECT_ID(N'dbo.cash_movements'))
CREATE NONCLUSTERED INDEX IX_cash_movements_closure_date ON dbo.cash_movements (closure_id, datee) INCLUDE (amount, typee, userId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_cash_movements_datee' AND object_id = OBJECT_ID(N'dbo.cash_movements'))
CREATE NONCLUSTERED INDEX IX_cash_movements_datee ON dbo.cash_movements (datee);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_cash_movements_register_id' AND object_id = OBJECT_ID(N'dbo.cash_movements'))
CREATE NONCLUSTERED INDEX IX_cash_movements_register_id ON dbo.cash_movements (register_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_cash_movements_user_type_dt' AND object_id = OBJECT_ID(N'dbo.cash_movements'))
CREATE NONCLUSTERED INDEX IX_cash_movements_user_type_dt ON dbo.cash_movements (userId, typee, datee);
