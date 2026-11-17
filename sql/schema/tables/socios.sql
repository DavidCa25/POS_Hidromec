/* socios
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.socios', 'U') IS NULL
BEGIN
CREATE TABLE dbo.socios (
    id INT IDENTITY(1, 1) NOT NULL,
    nombre NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    user_id INT NULL,
    pct_fijo DECIMAL(7, 4) NULL,
    activo BIT NOT NULL CONSTRAINT DF_socios_activo DEFAULT ((1)),
    orden INT NOT NULL CONSTRAINT DF_socios_orden DEFAULT ((0)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_socios_created DEFAULT (sysdatetime()),
    CONSTRAINT PK_socios PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_socios_nombre', 'C') IS NULL
ALTER TABLE dbo.socios WITH CHECK ADD CONSTRAINT CK_socios_nombre CHECK (len(ltrim(rtrim([nombre])))>(0));

IF OBJECT_ID(N'dbo.CK_socios_pct', 'C') IS NULL
ALTER TABLE dbo.socios WITH CHECK ADD CONSTRAINT CK_socios_pct CHECK ([pct_fijo] IS NULL OR [pct_fijo]>=(0) AND [pct_fijo]<=(100));

IF OBJECT_ID(N'dbo.FK_socios_user', 'F') IS NULL
ALTER TABLE dbo.socios WITH CHECK ADD CONSTRAINT FK_socios_user FOREIGN KEY (user_id) REFERENCES dbo.users (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_socios_nombre' AND object_id = OBJECT_ID(N'dbo.socios'))
CREATE UNIQUE NONCLUSTERED INDEX UX_socios_nombre ON dbo.socios (nombre);
