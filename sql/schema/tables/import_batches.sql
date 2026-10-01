/* import_batches
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.import_batches', 'U') IS NULL
BEGIN
CREATE TABLE dbo.import_batches (
    id INT IDENTITY(1, 1) NOT NULL,
    origen NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    etiqueta NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NOT NULL,
    preset NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL,
    business_profile NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    estado NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_import_batches_estado DEFAULT ('ANALIZANDO'),
    user_id INT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_import_batches_created DEFAULT (sysdatetime()),
    updated_at DATETIME2(0) NULL,
    completed_at DATETIME2(0) NULL,
    total_filas INT NOT NULL CONSTRAINT DF_import_batches_total DEFAULT ((0)),
    creadas INT NOT NULL CONSTRAINT DF_import_batches_creadas DEFAULT ((0)),
    actualizadas INT NOT NULL CONSTRAINT DF_import_batches_actualizadas DEFAULT ((0)),
    sin_cambios INT NOT NULL CONSTRAINT DF_import_batches_sincambios DEFAULT ((0)),
    omitidas INT NOT NULL CONSTRAINT DF_import_batches_omitidas DEFAULT ((0)),
    mapping_json NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    profile_id INT NULL,
    metadata_json NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_import_batches PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_import_batches_estado', 'C') IS NULL
ALTER TABLE dbo.import_batches WITH CHECK ADD CONSTRAINT CK_import_batches_estado CHECK ([estado]='DESCARTADA' OR [estado]='IMPORTADA' OR [estado]='LISTA' OR [estado]='REVISION' OR [estado]='ANALIZANDO' OR [estado]='CAPTURANDO');

IF OBJECT_ID(N'dbo.CK_import_batches_origen', 'C') IS NULL
ALTER TABLE dbo.import_batches WITH CHECK ADD CONSTRAINT CK_import_batches_origen CHECK ([origen]='PLANTILLA' OR [origen]='LECTOR' OR [origen]='MANUAL' OR [origen]='PEGADO' OR [origen]='ARCHIVO');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_import_batches_estado' AND object_id = OBJECT_ID(N'dbo.import_batches'))
CREATE NONCLUSTERED INDEX IX_import_batches_estado ON dbo.import_batches (estado, created_at DESC);
