/* comandas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.comandas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.comandas (
    id INT IDENTITY(1, 1) NOT NULL,
    orden_id INT NOT NULL,
    cuenta_id INT NOT NULL,
    station_id INT NOT NULL,
    estado NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_comandas_estado DEFAULT ('NUEVA'),
    creada_en DATETIME2(7) NOT NULL CONSTRAINT DF_comandas_creada DEFAULT (sysdatetime()),
    empezada_en DATETIME2(7) NULL,
    lista_en DATETIME2(7) NULL,
    entregada_en DATETIME2(7) NULL,
    cancelada_en DATETIME2(7) NULL,
    cancelada_por INT NULL,
    motivo NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    version TIMESTAMP NOT NULL,
    CONSTRAINT PK_comandas PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_comandas_estado', 'C') IS NULL
ALTER TABLE dbo.comandas WITH CHECK ADD CONSTRAINT CK_comandas_estado CHECK ([estado]='CANCELADA' OR [estado]='ENTREGADA' OR [estado]='LISTA' OR [estado]='PREPARANDO' OR [estado]='NUEVA');

IF OBJECT_ID(N'dbo.FK_comandas_cuenta', 'F') IS NULL
ALTER TABLE dbo.comandas WITH CHECK ADD CONSTRAINT FK_comandas_cuenta FOREIGN KEY (cuenta_id) REFERENCES dbo.hosp_cuentas (id);

IF OBJECT_ID(N'dbo.FK_comandas_orden', 'F') IS NULL
ALTER TABLE dbo.comandas WITH CHECK ADD CONSTRAINT FK_comandas_orden FOREIGN KEY (orden_id) REFERENCES dbo.hosp_ordenes (id);

IF OBJECT_ID(N'dbo.FK_comandas_station', 'F') IS NULL
ALTER TABLE dbo.comandas WITH CHECK ADD CONSTRAINT FK_comandas_station FOREIGN KEY (station_id) REFERENCES dbo.prep_stations (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_comandas_cuenta' AND object_id = OBJECT_ID(N'dbo.comandas'))
CREATE NONCLUSTERED INDEX IX_comandas_cuenta ON dbo.comandas (cuenta_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_comandas_estacion_estado' AND object_id = OBJECT_ID(N'dbo.comandas'))
CREATE NONCLUSTERED INDEX IX_comandas_estacion_estado ON dbo.comandas (station_id, estado);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_comandas_version' AND object_id = OBJECT_ID(N'dbo.comandas'))
CREATE NONCLUSTERED INDEX IX_comandas_version ON dbo.comandas (version) INCLUDE (estado, station_id);
