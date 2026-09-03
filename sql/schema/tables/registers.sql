/* registers
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.registers', 'U') IS NULL
BEGIN
CREATE TABLE dbo.registers (
    id INT IDENTITY(1, 1) NOT NULL,
    code NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    name NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NOT NULL,
    is_active BIT NOT NULL CONSTRAINT DF_registers_is_active DEFAULT ((1)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_registers_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_registers PRIMARY KEY CLUSTERED (id)
);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_registers_code' AND object_id = OBJECT_ID(N'dbo.registers'))
CREATE UNIQUE NONCLUSTERED INDEX UX_registers_code ON dbo.registers (code);
