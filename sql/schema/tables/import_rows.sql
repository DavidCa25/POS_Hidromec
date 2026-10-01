/* import_rows
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.import_rows', 'U') IS NULL
BEGIN
CREATE TABLE dbo.import_rows (
    id INT IDENTITY(1, 1) NOT NULL,
    batch_id INT NOT NULL,
    fila INT NOT NULL,
    crudo_json NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    tipo NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_import_rows_tipo DEFAULT ('PRODUCTO'),
    part_number NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NULL,
    nombre NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    price DECIMAL(10, 2) NULL,
    cost DECIMAL(14, 4) NULL,
    stock DECIMAL(12, 2) NULL,
    bar_code NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
    category_name NVARCHAR(150) COLLATE Modern_Spanish_CI_AS NULL,
    brand_name NVARCHAR(150) COLLATE Modern_Spanish_CI_AS NULL,
    base_uom NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NULL,
    clave_prod_serv NVARCHAR(8) COLLATE Modern_Spanish_CI_AS NULL,
    clave_unidad NVARCHAR(5) COLLATE Modern_Spanish_CI_AS NULL,
    tasa_iva DECIMAL(5, 4) NULL,
    duration_minutes INT NULL,
    schedulable BIT NULL,
    default_commission_pct DECIMAL(5, 2) NULL,
    accion NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_import_rows_accion DEFAULT ('PENDIENTE'),
    match_product_id INT NULL,
    match_motivo NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    problemas_json NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    resolucion NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    aplicada BIT NOT NULL CONSTRAINT DF_import_rows_aplicada DEFAULT ((0)),
    applied_product_id INT NULL,
    applied_at DATETIME2(0) NULL,
    previo_json NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL,
    inventory_mode NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NULL,
    sellable BIT NULL,
    CONSTRAINT PK_import_rows PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_import_rows_accion', 'C') IS NULL
ALTER TABLE dbo.import_rows WITH CHECK ADD CONSTRAINT CK_import_rows_accion CHECK ([accion]='PENDIENTE' OR [accion]='OMITIR' OR [accion]='CONFLICT' OR [accion]='UNCHANGED' OR [accion]='UPDATE' OR [accion]='CREATE');

IF OBJECT_ID(N'dbo.CK_import_rows_invmode', 'C') IS NULL
ALTER TABLE dbo.import_rows WITH CHECK ADD CONSTRAINT CK_import_rows_invmode CHECK ([inventory_mode] IS NULL OR ([inventory_mode]='NONE' OR [inventory_mode]='RECIPE' OR [inventory_mode]='DIRECT'));

IF OBJECT_ID(N'dbo.CK_import_rows_tipo', 'C') IS NULL
ALTER TABLE dbo.import_rows WITH CHECK ADD CONSTRAINT CK_import_rows_tipo CHECK ([tipo]='MATERIAL' OR [tipo]='SERVICIO' OR [tipo]='MENU' OR [tipo]='INGREDIENTE' OR [tipo]='PRODUCTO');

IF OBJECT_ID(N'dbo.FK_import_rows_batch', 'F') IS NULL
ALTER TABLE dbo.import_rows WITH CHECK ADD CONSTRAINT FK_import_rows_batch FOREIGN KEY (batch_id) REFERENCES dbo.import_batches (id) ON DELETE CASCADE;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_import_rows_batch' AND object_id = OBJECT_ID(N'dbo.import_rows'))
CREATE NONCLUSTERED INDEX IX_import_rows_batch ON dbo.import_rows (batch_id, accion) INCLUDE (aplicada);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_import_rows_pn' AND object_id = OBJECT_ID(N'dbo.import_rows'))
CREATE NONCLUSTERED INDEX IX_import_rows_pn ON dbo.import_rows (batch_id, part_number);
