/* asistencia_horarios
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.asistencia_horarios', 'U') IS NULL
BEGIN
CREATE TABLE dbo.asistencia_horarios (
    user_id INT NOT NULL,
    weekday TINYINT NOT NULL,
    entrada TIME(0) NOT NULL,
    salida TIME(0) NOT NULL,
    descanso_min SMALLINT NOT NULL CONSTRAINT DF_asistencia_horarios_desc DEFAULT ((0)),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_asistencia_horarios_upd DEFAULT (sysdatetime()),
    updated_by INT NULL,
    CONSTRAINT PK_asistencia_horarios PRIMARY KEY CLUSTERED (user_id, weekday)
);
END;

IF OBJECT_ID(N'dbo.CK_asistencia_horarios_desc', 'C') IS NULL
ALTER TABLE dbo.asistencia_horarios WITH CHECK ADD CONSTRAINT CK_asistencia_horarios_desc CHECK ([descanso_min]>=(0) AND [descanso_min]<=(240));

IF OBJECT_ID(N'dbo.CK_asistencia_horarios_rango', 'C') IS NULL
ALTER TABLE dbo.asistencia_horarios WITH CHECK ADD CONSTRAINT CK_asistencia_horarios_rango CHECK ([entrada]<>[salida]);

IF OBJECT_ID(N'dbo.CK_asistencia_horarios_weekday', 'C') IS NULL
ALTER TABLE dbo.asistencia_horarios WITH CHECK ADD CONSTRAINT CK_asistencia_horarios_weekday CHECK ([weekday]>=(1) AND [weekday]<=(7));

IF OBJECT_ID(N'dbo.FK_asistencia_horarios_user', 'F') IS NULL
ALTER TABLE dbo.asistencia_horarios WITH CHECK ADD CONSTRAINT FK_asistencia_horarios_user FOREIGN KEY (user_id) REFERENCES dbo.users (id);
