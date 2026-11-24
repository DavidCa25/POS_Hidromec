/* salud_bitacora
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_bitacora', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_bitacora (
    id BIGINT IDENTITY(1, 1) NOT NULL,
    user_id INT NULL,
    paciente_id INT NULL,
    documento_id INT NULL,
    accion NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    at DATETIME2(0) NOT NULL CONSTRAINT DF_salud_bitacora_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_salud_bitacora PRIMARY KEY CLUSTERED (id)
);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_bitacora_paciente' AND object_id = OBJECT_ID(N'dbo.salud_bitacora'))
CREATE NONCLUSTERED INDEX IX_salud_bitacora_paciente ON dbo.salud_bitacora (paciente_id, at DESC);
