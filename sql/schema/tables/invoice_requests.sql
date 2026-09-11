/* invoice_requests
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.invoice_requests', 'U') IS NULL
BEGIN
CREATE TABLE dbo.invoice_requests (
    id INT IDENTITY(1, 1) NOT NULL,
    sale_id INT NOT NULL,
    receiver_id INT NULL,
    receiver_snapshot NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    status NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_invoice_requests_status DEFAULT ('PENDING'),
    error_message NVARCHAR(1000) COLLATE Modern_Spanish_CI_AS NULL,
    cfdi_uuid NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NULL,
    xml_path NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    pdf_path NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_invoice_requests_created_at DEFAULT (sysutcdatetime()),
    updated_at DATETIME2(0) NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_invoice_requests_receivers', 'F') IS NULL
ALTER TABLE dbo.invoice_requests WITH CHECK ADD CONSTRAINT FK_invoice_requests_receivers FOREIGN KEY (receiver_id) REFERENCES dbo.fiscal_receivers (id);

IF OBJECT_ID(N'dbo.FK_invoice_requests_sales', 'F') IS NULL
ALTER TABLE dbo.invoice_requests WITH CHECK ADD CONSTRAINT FK_invoice_requests_sales FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_invoice_requests_sale_id' AND object_id = OBJECT_ID(N'dbo.invoice_requests'))
CREATE NONCLUSTERED INDEX IX_invoice_requests_sale_id ON dbo.invoice_requests (sale_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_invoice_requests_status' AND object_id = OBJECT_ID(N'dbo.invoice_requests'))
CREATE NONCLUSTERED INDEX IX_invoice_requests_status ON dbo.invoice_requests (status);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_invoice_requests_sale_id' AND object_id = OBJECT_ID(N'dbo.invoice_requests'))
CREATE UNIQUE NONCLUSTERED INDEX UX_invoice_requests_sale_id ON dbo.invoice_requests (sale_id);
