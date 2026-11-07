/* ============================================================
   0077 — compras documentos

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0077_compras-documentos.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0077_compras-documentos.sql ========== */
/* 0077 · Documentos de compra
 *
 * Tickets, notas de remisión y facturas que se suben en Compras para llenar la
 * compra solos (OCR local o el XML del SAT).
 *
 *   purchase_documents      el documento: archivo, lo que se leyó y la compra
 *                           a la que quedó ligado. Una factura (UUID) no se
 *                           sube dos veces.
 *   supplier_item_aliases   la memoria por proveedor: «REF COLA 600ML NR CJ24»
 *                           de ESTE proveedor es tal producto en tal
 *                           presentación. Se aprende al registrar la compra.
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
    CONSTRAINT PK_purchase_documents PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_purchase_documents_tipo CHECK (tipo IN ('TICKET', 'CFDI', 'NOTA', 'PDF', 'OTRO'))
);
END;
GO

IF OBJECT_ID(N'dbo.FK_purchase_documents_purchase', 'F') IS NULL
ALTER TABLE dbo.purchase_documents WITH CHECK ADD CONSTRAINT FK_purchase_documents_purchase FOREIGN KEY (purchase_id) REFERENCES dbo.purchase (id);
GO
IF OBJECT_ID(N'dbo.FK_purchase_documents_supplier', 'F') IS NULL
ALTER TABLE dbo.purchase_documents WITH CHECK ADD CONSTRAINT FK_purchase_documents_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.CAT_suppliers (id);
GO
/* Una factura del SAT es única: su UUID no entra dos veces. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_purchase_documents_uuid' AND object_id = OBJECT_ID(N'dbo.purchase_documents'))
CREATE UNIQUE INDEX UX_purchase_documents_uuid ON dbo.purchase_documents (cfdi_uuid) WHERE cfdi_uuid IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_purchase_documents_purchase' AND object_id = OBJECT_ID(N'dbo.purchase_documents'))
CREATE INDEX IX_purchase_documents_purchase ON dbo.purchase_documents (purchase_id);
GO

IF OBJECT_ID(N'dbo.supplier_item_aliases', 'U') IS NULL
BEGIN
CREATE TABLE dbo.supplier_item_aliases (
    supplier_id INT NOT NULL,
    texto NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NOT NULL,
    codigo NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
    product_id INT NOT NULL,
    presentation_id INT NULL,
    factor DECIMAL(14, 4) NOT NULL CONSTRAINT DF_supplier_item_aliases_factor DEFAULT ((1)),
    veces INT NOT NULL CONSTRAINT DF_supplier_item_aliases_veces DEFAULT ((1)),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_supplier_item_aliases_updated_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_supplier_item_aliases PRIMARY KEY CLUSTERED (supplier_id, texto)
);
END;
GO
IF OBJECT_ID(N'dbo.FK_supplier_item_aliases_supplier', 'F') IS NULL
ALTER TABLE dbo.supplier_item_aliases WITH CHECK ADD CONSTRAINT FK_supplier_item_aliases_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.CAT_suppliers (id);
GO
IF OBJECT_ID(N'dbo.FK_supplier_item_aliases_product', 'F') IS NULL
ALTER TABLE dbo.supplier_item_aliases WITH CHECK ADD CONSTRAINT FK_supplier_item_aliases_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_supplier_item_aliases_codigo' AND object_id = OBJECT_ID(N'dbo.supplier_item_aliases'))
CREATE INDEX IX_supplier_item_aliases_codigo ON dbo.supplier_item_aliases (supplier_id, codigo) WHERE codigo IS NOT NULL;
GO
