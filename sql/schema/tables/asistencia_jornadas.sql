/* asistencia_jornadas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.asistencia_jornadas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.asistencia_jornadas (
    id INT IDENTITY(1, 1) NOT NULL,
    user_id INT NOT NULL,
    dia DATE NOT NULL,
    entrada_en DATETIME2(0) NOT NULL,
    salida_en DATETIME2(0) NULL,
    estado VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_asistencia_jornadas_estado DEFAULT ('ABIERTA'),
    register_id INT NULL,
    corregida BIT NOT NULL CONSTRAINT DF_asistencia_jornadas_corr DEFAULT ((0)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_asistencia_jornadas_created DEFAULT (sysdatetime()),
    CONSTRAINT PK_asistencia_jornadas PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_asistencia_jornadas_estado', 'C') IS NULL
ALTER TABLE dbo.asistencia_jornadas WITH CHECK ADD CONSTRAINT CK_asistencia_jornadas_estado CHECK ([estado]='SIN_SALIDA' OR [estado]='CERRADA' OR [estado]='ABIERTA');

IF OBJECT_ID(N'dbo.CK_asistencia_jornadas_rango', 'C') IS NULL
ALTER TABLE dbo.asistencia_jornadas WITH CHECK ADD CONSTRAINT CK_asistencia_jornadas_rango CHECK ([salida_en] IS NULL OR [salida_en]>=[entrada_en]);

IF OBJECT_ID(N'dbo.FK_asistencia_jornadas_user', 'F') IS NULL
ALTER TABLE dbo.asistencia_jornadas WITH CHECK ADD CONSTRAINT FK_asistencia_jornadas_user FOREIGN KEY (user_id) REFERENCES dbo.users (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_asistencia_jornadas_user_dia' AND object_id = OBJECT_ID(N'dbo.asistencia_jornadas'))
CREATE NONCLUSTERED INDEX IX_asistencia_jornadas_user_dia ON dbo.asistencia_jornadas (user_id, dia);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_asistencia_jornadas_abierta' AND object_id = OBJECT_ID(N'dbo.asistencia_jornadas'))
CREATE UNIQUE NONCLUSTERED INDEX UX_asistencia_jornadas_abierta ON dbo.asistencia_jornadas (user_id) WHERE ([estado]='ABIERTA');
