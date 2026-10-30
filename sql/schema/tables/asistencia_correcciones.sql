/* asistencia_correcciones
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.asistencia_correcciones', 'U') IS NULL
BEGIN
CREATE TABLE dbo.asistencia_correcciones (
    id INT IDENTITY(1, 1) NOT NULL,
    jornada_id INT NOT NULL,
    entrada_antes DATETIME2(0) NULL,
    salida_antes DATETIME2(0) NULL,
    entrada_nueva DATETIME2(0) NOT NULL,
    salida_nueva DATETIME2(0) NULL,
    motivo NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NOT NULL,
    corregida_por INT NOT NULL,
    corregida_en DATETIME2(0) NOT NULL CONSTRAINT DF_asistencia_correcciones_en DEFAULT (sysdatetime()),
    CONSTRAINT PK_asistencia_correcciones PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_asistencia_correcciones_jornada', 'F') IS NULL
ALTER TABLE dbo.asistencia_correcciones WITH CHECK ADD CONSTRAINT FK_asistencia_correcciones_jornada FOREIGN KEY (jornada_id) REFERENCES dbo.asistencia_jornadas (id);

IF OBJECT_ID(N'dbo.FK_asistencia_correcciones_user', 'F') IS NULL
ALTER TABLE dbo.asistencia_correcciones WITH CHECK ADD CONSTRAINT FK_asistencia_correcciones_user FOREIGN KEY (corregida_por) REFERENCES dbo.users (id);
