/* socios_liquidaciones
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.socios_liquidaciones', 'U') IS NULL
BEGIN
CREATE TABLE dbo.socios_liquidaciones (
    id INT IDENTITY(1, 1) NOT NULL,
    desde DATE NOT NULL,
    hasta DATE NOT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_socios_liquidaciones_created DEFAULT (sysdatetime()),
    user_id INT NULL,
    CONSTRAINT PK_socios_liquidaciones PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_socios_liquidaciones_rango', 'C') IS NULL
ALTER TABLE dbo.socios_liquidaciones WITH CHECK ADD CONSTRAINT CK_socios_liquidaciones_rango CHECK ([desde]<=[hasta]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_socios_liquidaciones_desde' AND object_id = OBJECT_ID(N'dbo.socios_liquidaciones'))
CREATE UNIQUE NONCLUSTERED INDEX UX_socios_liquidaciones_desde ON dbo.socios_liquidaciones (desde);
