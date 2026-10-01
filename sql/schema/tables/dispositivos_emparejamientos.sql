/* dispositivos_emparejamientos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.dispositivos_emparejamientos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.dispositivos_emparejamientos (
    id INT IDENTITY(1, 1) NOT NULL,
    token_hash CHAR(64) COLLATE Modern_Spanish_CI_AS NOT NULL,
    alcance NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    station_id INT NULL,
    todas BIT NOT NULL CONSTRAINT DF_dispositivos_emp_todas DEFAULT ((0)),
    nombre NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    creado_en DATETIME2(0) NOT NULL CONSTRAINT DF_dispositivos_emp_creado DEFAULT (sysutcdatetime()),
    creado_por INT NULL,
    expira_en DATETIME2(0) NOT NULL,
    usado_en DATETIME2(0) NULL,
    dispositivo_id UNIQUEIDENTIFIER NULL,
    superficie NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_dispositivos_emp_superficie DEFAULT ('PREPARATION'),
    config NVARCHAR(2000) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_dispositivos_emparejamientos PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_dispositivos_emp_station', 'F') IS NULL
ALTER TABLE dbo.dispositivos_emparejamientos WITH CHECK ADD CONSTRAINT FK_dispositivos_emp_station FOREIGN KEY (station_id) REFERENCES dbo.prep_stations (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_dispositivos_emp_token' AND object_id = OBJECT_ID(N'dbo.dispositivos_emparejamientos'))
CREATE UNIQUE NONCLUSTERED INDEX UX_dispositivos_emp_token ON dbo.dispositivos_emparejamientos (token_hash);
