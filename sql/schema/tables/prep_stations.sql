/* prep_stations
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.prep_stations', 'U') IS NULL
BEGIN
CREATE TABLE dbo.prep_stations (
    id INT IDENTITY(1, 1) NOT NULL,
    nombre NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL,
    salida NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_prep_stations_salida DEFAULT ('PANTALLA'),
    impresora NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    ancho_mm INT NULL,
    orden INT NOT NULL CONSTRAINT DF_prep_stations_orden DEFAULT ((0)),
    activa BIT NOT NULL CONSTRAINT DF_prep_stations_activa DEFAULT ((1)),
    CONSTRAINT PK_prep_stations PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_prep_stations_salida', 'C') IS NULL
ALTER TABLE dbo.prep_stations WITH CHECK ADD CONSTRAINT CK_prep_stations_salida CHECK ([salida]='AMBOS' OR [salida]='IMPRESORA' OR [salida]='PANTALLA');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_prep_stations_nombre' AND object_id = OBJECT_ID(N'dbo.prep_stations'))
CREATE UNIQUE NONCLUSTERED INDEX UX_prep_stations_nombre ON dbo.prep_stations (nombre) WHERE ([activa]=(1));
