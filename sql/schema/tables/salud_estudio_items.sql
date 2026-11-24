/* salud_estudio_items
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.salud_estudio_items', 'U') IS NULL
BEGIN
CREATE TABLE dbo.salud_estudio_items (
    id INT IDENTITY(1, 1) NOT NULL,
    orden_id INT NOT NULL,
    product_id INT NOT NULL,
    nombre NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NOT NULL,
    tipo NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    modalidad NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    parametros NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    precio DECIMAL(12, 2) NOT NULL,
    estado NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_salud_ei_estado DEFAULT (N'SOLICITADO'),
    tomado_at DATETIME2(0) NULL,
    tomado_por INT NULL,
    resultados NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    hallazgos NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    conclusion NVARCHAR(1000) COLLATE Modern_Spanish_CI_AS NULL,
    birads TINYINT NULL,
    capturado_at DATETIME2(0) NULL,
    capturado_por INT NULL,
    validado_at DATETIME2(0) NULL,
    validado_por INT NULL,
    firmante NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    huella VARBINARY(32) NULL,
    CONSTRAINT PK_salud_estudio_items PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_salud_ei_birads', 'C') IS NULL
ALTER TABLE dbo.salud_estudio_items WITH CHECK ADD CONSTRAINT CK_salud_ei_birads CHECK ([birads] IS NULL OR [birads]>=(0) AND [birads]<=(6) AND [modalidad]=N'MASTOGRAFIA');

IF OBJECT_ID(N'dbo.CK_salud_ei_estado', 'C') IS NULL
ALTER TABLE dbo.salud_estudio_items WITH CHECK ADD CONSTRAINT CK_salud_ei_estado CHECK ([estado]=N'CANCELADO' OR [estado]=N'VALIDADO' OR [estado]=N'CAPTURADO' OR [estado]=N'TOMADO' OR [estado]=N'SOLICITADO');

IF OBJECT_ID(N'dbo.CK_salud_ei_json', 'C') IS NULL
ALTER TABLE dbo.salud_estudio_items WITH CHECK ADD CONSTRAINT CK_salud_ei_json CHECK (([resultados] IS NULL OR isjson([resultados])=(1)) AND ([parametros] IS NULL OR isjson([parametros])=(1)) AND ([firmante] IS NULL OR isjson([firmante])=(1)));

IF OBJECT_ID(N'dbo.CK_salud_ei_tipo', 'C') IS NULL
ALTER TABLE dbo.salud_estudio_items WITH CHECK ADD CONSTRAINT CK_salud_ei_tipo CHECK ([tipo]=N'IMAGEN' OR [tipo]=N'LAB');

IF OBJECT_ID(N'dbo.CK_salud_ei_validado', 'C') IS NULL
ALTER TABLE dbo.salud_estudio_items WITH CHECK ADD CONSTRAINT CK_salud_ei_validado CHECK ([estado]<>N'VALIDADO' OR [validado_at] IS NOT NULL AND [validado_por] IS NOT NULL AND [huella] IS NOT NULL AND [firmante] IS NOT NULL);

IF OBJECT_ID(N'dbo.FK_salud_ei_estudio', 'F') IS NULL
ALTER TABLE dbo.salud_estudio_items WITH CHECK ADD CONSTRAINT FK_salud_ei_estudio FOREIGN KEY (product_id) REFERENCES dbo.salud_estudios (product_id);

IF OBJECT_ID(N'dbo.FK_salud_ei_orden', 'F') IS NULL
ALTER TABLE dbo.salud_estudio_items WITH CHECK ADD CONSTRAINT FK_salud_ei_orden FOREIGN KEY (orden_id) REFERENCES dbo.salud_estudio_ordenes (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_salud_ei_orden' AND object_id = OBJECT_ID(N'dbo.salud_estudio_items'))
CREATE NONCLUSTERED INDEX IX_salud_ei_orden ON dbo.salud_estudio_items (orden_id);
