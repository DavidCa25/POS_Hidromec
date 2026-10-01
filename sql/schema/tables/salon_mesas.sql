/* salon_mesas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salon_mesas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salon_mesas (
    id INT IDENTITY(1, 1) NOT NULL,
    area_id INT NOT NULL,
    nombre NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL,
    capacidad INT NULL,
    orden INT NOT NULL CONSTRAINT DF_salon_mesas_orden DEFAULT ((0)),
    activa BIT NOT NULL CONSTRAINT DF_salon_mesas_activa DEFAULT ((1)),
    CONSTRAINT PK_salon_mesas PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_salon_mesas_area', 'F') IS NULL
ALTER TABLE dbo.salon_mesas WITH CHECK ADD CONSTRAINT FK_salon_mesas_area FOREIGN KEY (area_id) REFERENCES dbo.salon_areas (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_salon_mesas_nombre' AND object_id = OBJECT_ID(N'dbo.salon_mesas'))
CREATE UNIQUE NONCLUSTERED INDEX UX_salon_mesas_nombre ON dbo.salon_mesas (area_id, nombre) WHERE ([activa]=(1));
