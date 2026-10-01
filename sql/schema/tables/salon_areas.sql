/* salon_areas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salon_areas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salon_areas (
    id INT IDENTITY(1, 1) NOT NULL,
    nombre NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NOT NULL,
    orden INT NOT NULL CONSTRAINT DF_salon_areas_orden DEFAULT ((0)),
    activa BIT NOT NULL CONSTRAINT DF_salon_areas_activa DEFAULT ((1)),
    creada_en DATETIME2(7) NOT NULL CONSTRAINT DF_salon_areas_creada DEFAULT (sysdatetime()),
    CONSTRAINT PK_salon_areas PRIMARY KEY CLUSTERED (id)
);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_salon_areas_nombre' AND object_id = OBJECT_ID(N'dbo.salon_areas'))
CREATE UNIQUE NONCLUSTERED INDEX UX_salon_areas_nombre ON dbo.salon_areas (nombre) WHERE ([activa]=(1));
