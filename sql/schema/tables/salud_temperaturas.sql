/* salud_temperaturas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_temperaturas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_temperaturas (
    id INT IDENTITY(1, 1) NOT NULL,
    equipo NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL,
    grados DECIMAL(4, 1) NOT NULL,
    user_id INT NULL,
    at DATETIME2(0) NOT NULL CONSTRAINT DF_salud_temp_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_salud_temperaturas PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_salud_temperaturas', 'C') IS NULL
ALTER TABLE dbo.salud_temperaturas WITH CHECK ADD CONSTRAINT CK_salud_temperaturas CHECK ([grados]>=(-40) AND [grados]<=(60));

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_temperaturas_at' AND object_id = OBJECT_ID(N'dbo.salud_temperaturas'))
CREATE NONCLUSTERED INDEX IX_salud_temperaturas_at ON dbo.salud_temperaturas (at DESC);
