/* asistente_hallazgos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.asistente_hallazgos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.asistente_hallazgos (
    id INT IDENTITY(1, 1) NOT NULL,
    clave NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NOT NULL,
    regla VARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    version INT NOT NULL,
    dominio VARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    severidad VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    prioridad INT NOT NULL,
    titulo NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NOT NULL,
    detalle NVARCHAR(600) COLLATE Modern_Spanish_CI_AS NOT NULL,
    evidencia NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    acciones NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    entidad_tipo VARCHAR(30) COLLATE Modern_Spanish_CI_AS NULL,
    entidad_id NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NULL,
    entidad_nombre NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    ruta NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    ver_permiso VARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL,
    estado VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_asistente_hallazgos_estado DEFAULT ('abierto'),
    pospuesto_hasta DATETIME2(0) NULL,
    detectado_en DATETIME2(0) NOT NULL CONSTRAINT DF_asistente_hallazgos_detectado DEFAULT (sysdatetime()),
    actualizado_en DATETIME2(0) NOT NULL CONSTRAINT DF_asistente_hallazgos_actualizado DEFAULT (sysdatetime()),
    resuelto_en DATETIME2(0) NULL,
    visto_por INT NULL,
    visto_en DATETIME2(0) NULL,
    CONSTRAINT PK_asistente_hallazgos PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UX_asistente_hallazgos_clave UNIQUE NONCLUSTERED (clave)
);
END;

IF OBJECT_ID(N'dbo.CK_asistente_hallazgos_estado', 'C') IS NULL
ALTER TABLE dbo.asistente_hallazgos WITH CHECK ADD CONSTRAINT CK_asistente_hallazgos_estado CHECK ([estado]='resuelto' OR [estado]='descartado' OR [estado]='pospuesto' OR [estado]='visto' OR [estado]='abierto');

IF OBJECT_ID(N'dbo.CK_asistente_hallazgos_severidad', 'C') IS NULL
ALTER TABLE dbo.asistente_hallazgos WITH CHECK ADD CONSTRAINT CK_asistente_hallazgos_severidad CHECK ([severidad]='critico' OR [severidad]='importante' OR [severidad]='aviso' OR [severidad]='info');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_asistente_hallazgos_estado' AND object_id = OBJECT_ID(N'dbo.asistente_hallazgos'))
CREATE NONCLUSTERED INDEX IX_asistente_hallazgos_estado ON dbo.asistente_hallazgos (estado, prioridad DESC) INCLUDE (dominio, regla);
