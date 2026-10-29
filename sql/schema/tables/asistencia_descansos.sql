/* asistencia_descansos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.asistencia_descansos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.asistencia_descansos (
    id INT IDENTITY(1, 1) NOT NULL,
    jornada_id INT NOT NULL,
    inicio_en DATETIME2(0) NOT NULL,
    fin_en DATETIME2(0) NULL,
    CONSTRAINT PK_asistencia_descansos PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_asistencia_descansos_rango', 'C') IS NULL
ALTER TABLE dbo.asistencia_descansos WITH CHECK ADD CONSTRAINT CK_asistencia_descansos_rango CHECK ([fin_en] IS NULL OR [fin_en]>=[inicio_en]);

IF OBJECT_ID(N'dbo.FK_asistencia_descansos_jornada', 'F') IS NULL
ALTER TABLE dbo.asistencia_descansos WITH CHECK ADD CONSTRAINT FK_asistencia_descansos_jornada FOREIGN KEY (jornada_id) REFERENCES dbo.asistencia_jornadas (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_asistencia_descansos_jornada' AND object_id = OBJECT_ID(N'dbo.asistencia_descansos'))
CREATE NONCLUSTERED INDEX IX_asistencia_descansos_jornada ON dbo.asistencia_descansos (jornada_id);
