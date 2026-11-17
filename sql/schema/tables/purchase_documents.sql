/* purchase_documents
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.purchase_documents', 'U') IS NULL
BEGIN
CREATE TABLE dbo.purchase_documents (
    id INT IDENTITY(1, 1) NOT NULL,
    purchase_id INT NULL,
    supplier_id INT NULL,
    tipo VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    archivo_nombre NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    archivo_ruta NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    sha256 CHAR(64) COLLATE Modern_Spanish_CI_AS NOT NULL,
    cfdi_uuid VARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL,
    rfc_emisor VARCHAR(13) COLLATE Modern_Spanish_CI_AS NULL,
    folio NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
    fecha_documento DATE NULL,
    total DECIMAL(12, 2) NULL,
    cuadra BIT NOT NULL CONSTRAINT DF_purchase_documents_cuadra DEFAULT ((0)),
    datos_json NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    created_by INT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_purchase_documents_created_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_purchase_documents PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_purchase_documents_tipo', 'C') IS NULL
ALTER TABLE dbo.purchase_documents WITH CHECK ADD CONSTRAINT CK_purchase_documents_tipo CHECK ([tipo]='OTRO' OR [tipo]='PDF' OR [tipo]='NOTA' OR [tipo]='CFDI' OR [tipo]='TICKET');

IF OBJECT_ID(N'dbo.FK_purchase_documents_purchase', 'F') IS NULL
ALTER TABLE dbo.purchase_documents WITH CHECK ADD CONSTRAINT FK_purchase_documents_purchase FOREIGN KEY (purchase_id) REFERENCES dbo.purchase (id);

IF OBJECT_ID(N'dbo.FK_purchase_documents_supplier', 'F') IS NULL
ALTER TABLE dbo.purchase_documents WITH CHECK ADD CONSTRAINT FK_purchase_documents_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.CAT_suppliers (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_purchase_documents_purchase' AND object_id = OBJECT_ID(N'dbo.purchase_documents'))
CREATE NONCLUSTERED INDEX IX_purchase_documents_purchase ON dbo.purchase_documents (purchase_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_purchase_documents_uuid' AND object_id = OBJECT_ID(N'dbo.purchase_documents'))
CREATE UNIQUE NONCLUSTERED INDEX UX_purchase_documents_uuid ON dbo.purchase_documents (cfdi_uuid) WHERE ([cfdi_uuid] IS NOT NULL);
