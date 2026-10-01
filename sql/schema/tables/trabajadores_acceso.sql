/* trabajadores_acceso
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.trabajadores_acceso', 'U') IS NULL
BEGIN
CREATE TABLE dbo.trabajadores_acceso (
    id INT IDENTITY(1, 1) NOT NULL,
    user_id INT NULL,
    professional_id INT NULL,
    qr_hash CHAR(64) COLLATE Modern_Spanish_CI_AS NULL,
    qr_creado_en DATETIME2(0) NULL,
    pin_hash VARCHAR(128) COLLATE Modern_Spanish_CI_AS NULL,
    pin_sal VARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,
    pin_creado_en DATETIME2(0) NULL,
    pin_fallos INT NOT NULL CONSTRAINT DF_trab_acceso_fallos DEFAULT ((0)),
    bloqueado_hasta DATETIME2(0) NULL,
    creado_en DATETIME2(0) NOT NULL CONSTRAINT DF_trab_acceso_creado DEFAULT (sysutcdatetime()),
    creado_por INT NULL,
    revocado_en DATETIME2(0) NULL,
    revocado_por INT NULL,
    CONSTRAINT PK_trabajadores_acceso PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_trab_acceso_persona', 'C') IS NULL
ALTER TABLE dbo.trabajadores_acceso WITH CHECK ADD CONSTRAINT CK_trab_acceso_persona CHECK ([user_id] IS NOT NULL AND [professional_id] IS NULL OR [user_id] IS NULL AND [professional_id] IS NOT NULL);

IF OBJECT_ID(N'dbo.FK_trab_acceso_prof', 'F') IS NULL
ALTER TABLE dbo.trabajadores_acceso WITH CHECK ADD CONSTRAINT FK_trab_acceso_prof FOREIGN KEY (professional_id) REFERENCES dbo.professionals (id);

IF OBJECT_ID(N'dbo.FK_trab_acceso_user', 'F') IS NULL
ALTER TABLE dbo.trabajadores_acceso WITH CHECK ADD CONSTRAINT FK_trab_acceso_user FOREIGN KEY (user_id) REFERENCES dbo.users (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_trab_acceso_prof' AND object_id = OBJECT_ID(N'dbo.trabajadores_acceso'))
CREATE UNIQUE NONCLUSTERED INDEX UX_trab_acceso_prof ON dbo.trabajadores_acceso (professional_id) WHERE ([professional_id] IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_trab_acceso_qr' AND object_id = OBJECT_ID(N'dbo.trabajadores_acceso'))
CREATE UNIQUE NONCLUSTERED INDEX UX_trab_acceso_qr ON dbo.trabajadores_acceso (qr_hash) WHERE ([qr_hash] IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_trab_acceso_user' AND object_id = OBJECT_ID(N'dbo.trabajadores_acceso'))
CREATE UNIQUE NONCLUSTERED INDEX UX_trab_acceso_user ON dbo.trabajadores_acceso (user_id) WHERE ([user_id] IS NOT NULL);
