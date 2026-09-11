/* cash_shifts
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.cash_shifts', 'U') IS NULL
BEGIN
CREATE TABLE dbo.cash_shifts (
    id INT IDENTITY(1, 1) NOT NULL,
    userId INT NOT NULL,
    opened_at DATETIME2(0) NOT NULL CONSTRAINT DF_cash_shifts_opened_at DEFAULT (sysutcdatetime()),
    opening_cash DECIMAL(12, 2) NOT NULL CONSTRAINT DF_cash_shifts_opening_cash DEFAULT ((0)),
    note NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    status NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_cash_shifts_status DEFAULT ('OPEN'),
    closed_at DATETIME2(0) NULL,
    register_id INT NULL CONSTRAINT DF_cash_shifts_register_id DEFAULT ((1)),
    PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_cash_shifts_register', 'F') IS NULL
ALTER TABLE dbo.cash_shifts WITH CHECK ADD CONSTRAINT FK_cash_shifts_register FOREIGN KEY (register_id) REFERENCES dbo.registers (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_cash_shifts_register_id' AND object_id = OBJECT_ID(N'dbo.cash_shifts'))
CREATE NONCLUSTERED INDEX IX_cash_shifts_register_id ON dbo.cash_shifts (register_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_cash_shifts_user_date' AND object_id = OBJECT_ID(N'dbo.cash_shifts'))
CREATE NONCLUSTERED INDEX IX_cash_shifts_user_date ON dbo.cash_shifts (userId, opened_at) INCLUDE (opening_cash, status);
