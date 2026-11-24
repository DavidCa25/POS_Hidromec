/* salud_diagnosticos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_diagnosticos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_diagnosticos (
    id INT IDENTITY(1, 1) NOT NULL,
    documento_id INT NOT NULL,
    cie10 NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NULL,
    descripcion NVARCHAR(250) COLLATE Modern_Spanish_CI_AS NOT NULL,
    principal BIT NOT NULL CONSTRAINT DF_salud_dx_principal DEFAULT ((0)),
    CONSTRAINT PK_salud_diagnosticos PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_salud_diagnosticos_doc', 'F') IS NULL
ALTER TABLE dbo.salud_diagnosticos WITH CHECK ADD CONSTRAINT FK_salud_diagnosticos_doc FOREIGN KEY (documento_id) REFERENCES dbo.salud_documentos (id) ON DELETE CASCADE;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_diagnosticos_cie' AND object_id = OBJECT_ID(N'dbo.salud_diagnosticos'))
CREATE NONCLUSTERED INDEX IX_salud_diagnosticos_cie ON dbo.salud_diagnosticos (cie10) WHERE ([cie10] IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_diagnosticos_doc' AND object_id = OBJECT_ID(N'dbo.salud_diagnosticos'))
CREATE NONCLUSTERED INDEX IX_salud_diagnosticos_doc ON dbo.salud_diagnosticos (documento_id);
