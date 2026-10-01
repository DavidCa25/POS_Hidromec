/* superficie_auditoria
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.superficie_auditoria', 'U') IS NULL
BEGIN
CREATE TABLE dbo.superficie_auditoria (
    id BIGINT IDENTITY(1, 1) NOT NULL,
    momento DATETIME2(0) NOT NULL CONSTRAINT DF_sup_aud_momento DEFAULT (sysutcdatetime()),
    local_creado_en DATETIME2(0) NULL,
    dispositivo_id UNIQUEIDENTIFIER NULL,
    sesion_id UNIQUEIDENTIFIER NULL,
    user_id INT NULL,
    professional_id INT NULL,
    superficie NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL,
    accion NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL,
    entidad NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NULL,
    entidad_id NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL,
    detalle NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    idem_key NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,
    resultado NVARCHAR(2000) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_superficie_auditoria PRIMARY KEY CLUSTERED (id)
);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sup_aud_momento' AND object_id = OBJECT_ID(N'dbo.superficie_auditoria'))
CREATE NONCLUSTERED INDEX IX_sup_aud_momento ON dbo.superficie_auditoria (momento DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_sup_aud_idem' AND object_id = OBJECT_ID(N'dbo.superficie_auditoria'))
CREATE UNIQUE NONCLUSTERED INDEX UX_sup_aud_idem ON dbo.superficie_auditoria (idem_key) WHERE ([idem_key] IS NOT NULL);
