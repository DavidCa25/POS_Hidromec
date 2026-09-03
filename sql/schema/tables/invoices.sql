/* invoices
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.invoices', 'U') IS NULL
BEGIN
CREATE TABLE dbo.invoices (
    id INT IDENTITY(1, 1) NOT NULL,
    sale_id INT NULL,
    tipo NVARCHAR(2) COLLATE Modern_Spanish_CI_AS NOT NULL DEFAULT ('I'),
    serie NVARCHAR(25) COLLATE Modern_Spanish_CI_AS NULL,
    folio NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL,
    uuid NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NULL,
    receptor_rfc NVARCHAR(13) COLLATE Modern_Spanish_CI_AS NOT NULL,
    receptor_razon_social NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NOT NULL,
    receptor_regimen NVARCHAR(5) COLLATE Modern_Spanish_CI_AS NOT NULL,
    receptor_uso_cfdi NVARCHAR(5) COLLATE Modern_Spanish_CI_AS NOT NULL,
    receptor_codigo_postal NVARCHAR(5) COLLATE Modern_Spanish_CI_AS NOT NULL,
    receptor_email NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    metodo_pago NVARCHAR(3) COLLATE Modern_Spanish_CI_AS NOT NULL DEFAULT ('PUE'),
    forma_pago NVARCHAR(3) COLLATE Modern_Spanish_CI_AS NOT NULL DEFAULT ('01'),
    subtotal DECIMAL(12, 2) NOT NULL DEFAULT ((0)),
    descuento DECIMAL(12, 2) NOT NULL DEFAULT ((0)),
    iva DECIMAL(12, 2) NOT NULL DEFAULT ((0)),
    total DECIMAL(12, 2) NOT NULL DEFAULT ((0)),
    estado NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL DEFAULT ('borrador'),
    fiscalapi_invoice_id NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NULL,
    xml_content NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    error_mensaje NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    fecha_timbrado DATETIME2(0) NULL,
    created_at DATETIME2(0) NOT NULL DEFAULT (sysdatetime()),
    motivo_cancelacion NVARCHAR(2) COLLATE Modern_Spanish_CI_AS NULL,
    folio_sustitucion NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NULL,
    fecha_cancelacion DATETIME2(7) NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_invoices_estado' AND object_id = OBJECT_ID(N'dbo.invoices'))
CREATE NONCLUSTERED INDEX ix_invoices_estado ON dbo.invoices (estado);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_invoices_sale' AND object_id = OBJECT_ID(N'dbo.invoices'))
CREATE NONCLUSTERED INDEX ix_invoices_sale ON dbo.invoices (sale_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_invoices_uuid' AND object_id = OBJECT_ID(N'dbo.invoices'))
CREATE NONCLUSTERED INDEX ix_invoices_uuid ON dbo.invoices (uuid);
