/* dispositivos_locales
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.dispositivos_locales', 'U') IS NULL
BEGIN
CREATE TABLE dbo.dispositivos_locales (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_dispositivos_locales_id DEFAULT (newid()),
    nombre NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    alcance NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    station_id INT NULL,
    todas BIT NOT NULL CONSTRAINT DF_dispositivos_locales_todas DEFAULT ((0)),
    credencial_hash CHAR(64) COLLATE Modern_Spanish_CI_AS NOT NULL,
    emparejado_en DATETIME2(0) NOT NULL CONSTRAINT DF_dispositivos_locales_emp DEFAULT (sysutcdatetime()),
    emparejado_por INT NULL,
    ultimo_contacto DATETIME2(0) NULL,
    ultima_ip NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,
    agente NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    revocado_en DATETIME2(0) NULL,
    revocado_por INT NULL,
    superficie NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_dispositivos_locales_superficie DEFAULT ('PREPARATION'),
    config NVARCHAR(2000) COLLATE Modern_Spanish_CI_AS NULL,
    funcion_cambiada_en DATETIME2(0) NULL,
    funcion_cambiada_por INT NULL,
    CONSTRAINT PK_dispositivos_locales PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_dispositivos_locales_estacion', 'C') IS NULL
ALTER TABLE dbo.dispositivos_locales WITH CHECK ADD CONSTRAINT CK_dispositivos_locales_estacion CHECK ([superficie]<>'PREPARATION' OR [todas]=(1) OR [station_id] IS NOT NULL);

IF OBJECT_ID(N'dbo.FK_dispositivos_locales_station', 'F') IS NULL
ALTER TABLE dbo.dispositivos_locales WITH CHECK ADD CONSTRAINT FK_dispositivos_locales_station FOREIGN KEY (station_id) REFERENCES dbo.prep_stations (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_dispositivos_locales_credencial' AND object_id = OBJECT_ID(N'dbo.dispositivos_locales'))
CREATE UNIQUE NONCLUSTERED INDEX UX_dispositivos_locales_credencial ON dbo.dispositivos_locales (credencial_hash);
