/* trabajador_sesiones
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.trabajador_sesiones', 'U') IS NULL
BEGIN
CREATE TABLE dbo.trabajador_sesiones (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_trabajador_sesiones_id DEFAULT (newid()),
    token_hash CHAR(64) COLLATE Modern_Spanish_CI_AS NOT NULL,
    dispositivo_id UNIQUEIDENTIFIER NOT NULL,
    acceso_id INT NOT NULL,
    user_id INT NULL,
    professional_id INT NULL,
    superficie NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL,
    via NVARCHAR(8) COLLATE Modern_Spanish_CI_AS NOT NULL,
    inicio DATETIME2(0) NOT NULL CONSTRAINT DF_trab_ses_inicio DEFAULT (sysutcdatetime()),
    ultima_actividad DATETIME2(0) NOT NULL CONSTRAINT DF_trab_ses_act DEFAULT (sysutcdatetime()),
    expira_en DATETIME2(0) NOT NULL,
    cerrada_en DATETIME2(0) NULL,
    motivo_cierre NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_trabajador_sesiones PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_trab_ses_acceso', 'F') IS NULL
ALTER TABLE dbo.trabajador_sesiones WITH CHECK ADD CONSTRAINT FK_trab_ses_acceso FOREIGN KEY (acceso_id) REFERENCES dbo.trabajadores_acceso (id);

IF OBJECT_ID(N'dbo.FK_trab_ses_disp', 'F') IS NULL
ALTER TABLE dbo.trabajador_sesiones WITH CHECK ADD CONSTRAINT FK_trab_ses_disp FOREIGN KEY (dispositivo_id) REFERENCES dbo.dispositivos_locales (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_trab_ses_disp' AND object_id = OBJECT_ID(N'dbo.trabajador_sesiones'))
CREATE NONCLUSTERED INDEX IX_trab_ses_disp ON dbo.trabajador_sesiones (dispositivo_id) WHERE ([cerrada_en] IS NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_trab_ses_token' AND object_id = OBJECT_ID(N'dbo.trabajador_sesiones'))
CREATE UNIQUE NONCLUSTERED INDEX UX_trab_ses_token ON dbo.trabajador_sesiones (token_hash);
