/* salud_documentos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_documentos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_documentos (
    id INT IDENTITY(1, 1) NOT NULL,
    paciente_id INT NOT NULL,
    tipo NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    titulo NVARCHAR(160) COLLATE Modern_Spanish_CI_AS NULL,
    contenido NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NOT NULL,
    autor_id INT NOT NULL,
    cita_id INT NULL,
    orden_id INT NULL,
    estado NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_salud_doc_estado DEFAULT (N'BORRADOR'),
    firmado_at DATETIME2(0) NULL,
    firmado_por INT NULL,
    huella VARBINARY(32) NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_salud_doc_created DEFAULT (sysdatetime()),
    updated_at DATETIME2(0) NULL,
    firmante NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_salud_documentos PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_salud_documentos_estado', 'C') IS NULL
ALTER TABLE dbo.salud_documentos WITH CHECK ADD CONSTRAINT CK_salud_documentos_estado CHECK ([estado]=N'FIRMADO' OR [estado]=N'BORRADOR');

IF OBJECT_ID(N'dbo.CK_salud_documentos_firma', 'C') IS NULL
ALTER TABLE dbo.salud_documentos WITH CHECK ADD CONSTRAINT CK_salud_documentos_firma CHECK ([estado]=N'BORRADOR' OR [firmado_at] IS NOT NULL AND [firmado_por] IS NOT NULL AND [huella] IS NOT NULL);

IF OBJECT_ID(N'dbo.CK_salud_documentos_firmante', 'C') IS NULL
ALTER TABLE dbo.salud_documentos WITH CHECK ADD CONSTRAINT CK_salud_documentos_firmante CHECK ([firmante] IS NULL OR isjson([firmante])=(1));

IF OBJECT_ID(N'dbo.CK_salud_documentos_json', 'C') IS NULL
ALTER TABLE dbo.salud_documentos WITH CHECK ADD CONSTRAINT CK_salud_documentos_json CHECK (isjson([contenido])=(1));

IF OBJECT_ID(N'dbo.CK_salud_documentos_tipo', 'C') IS NULL
ALTER TABLE dbo.salud_documentos WITH CHECK ADD CONSTRAINT CK_salud_documentos_tipo CHECK ([tipo]=N'REFERENCIA' OR [tipo]=N'SOLICITUD' OR [tipo]=N'CONSENTIMIENTO' OR [tipo]=N'RECETA' OR [tipo]=N'NOTA' OR [tipo]=N'HISTORIA');

IF OBJECT_ID(N'dbo.FK_salud_documentos_paciente', 'F') IS NULL
ALTER TABLE dbo.salud_documentos WITH CHECK ADD CONSTRAINT FK_salud_documentos_paciente FOREIGN KEY (paciente_id) REFERENCES dbo.salud_pacientes (customer_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_documentos_paciente' AND object_id = OBJECT_ID(N'dbo.salud_documentos'))
CREATE NONCLUSTERED INDEX IX_salud_documentos_paciente ON dbo.salud_documentos (paciente_id, created_at DESC) INCLUDE (autor_id, estado, tipo, titulo);
