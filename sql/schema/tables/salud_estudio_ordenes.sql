/* salud_estudio_ordenes
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_estudio_ordenes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_estudio_ordenes (
    id INT IDENTITY(1, 1) NOT NULL,
    folio AS ('EST-'+right('000000'+CONVERT([varchar](7),[id]),(6))) PERSISTED,
    paciente_id INT NOT NULL,
    medico NVARCHAR(160) COLLATE Modern_Spanish_CI_AS NULL,
    indicaciones NVARCHAR(600) COLLATE Modern_Spanish_CI_AS NULL,
    estado NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_salud_eo_estado DEFAULT (N'ABIERTA'),
    orden_id INT NULL,
    created_by INT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_salud_eo_created DEFAULT (sysdatetime()),
    entregado_at DATETIME2(0) NULL,
    entregado_por INT NULL,
    CONSTRAINT PK_salud_estudio_ordenes PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_salud_eo_estado', 'C') IS NULL
ALTER TABLE dbo.salud_estudio_ordenes WITH CHECK ADD CONSTRAINT CK_salud_eo_estado CHECK ([estado]=N'CANCELADA' OR [estado]=N'ENTREGADA' OR [estado]=N'LISTA' OR [estado]=N'ABIERTA');

IF OBJECT_ID(N'dbo.FK_salud_eo_paciente', 'F') IS NULL
ALTER TABLE dbo.salud_estudio_ordenes WITH CHECK ADD CONSTRAINT FK_salud_eo_paciente FOREIGN KEY (paciente_id) REFERENCES dbo.salud_pacientes (customer_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_eo_estado' AND object_id = OBJECT_ID(N'dbo.salud_estudio_ordenes'))
CREATE NONCLUSTERED INDEX IX_salud_eo_estado ON dbo.salud_estudio_ordenes (estado, created_at) WHERE ([estado] IN (N'ABIERTA', N'LISTA'));

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_eo_paciente' AND object_id = OBJECT_ID(N'dbo.salud_estudio_ordenes'))
CREATE NONCLUSTERED INDEX IX_salud_eo_paciente ON dbo.salud_estudio_ordenes (paciente_id, created_at DESC);
