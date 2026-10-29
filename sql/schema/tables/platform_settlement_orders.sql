/* platform_settlement_orders
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.platform_settlement_orders', 'U') IS NULL
BEGIN
CREATE TABLE dbo.platform_settlement_orders (
    id INT IDENTITY(1, 1) NOT NULL,
    settlement_id INT NOT NULL,
    line_no INT NOT NULL,
    platform_order_id NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NULL,
    order_at DATETIME2(0) NULL,
    customer NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    fulfillment NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL,
    platform_status NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL,
    sales_base DECIMAL(14, 2) NULL,
    tax DECIMAL(14, 2) NULL,
    sales_total DECIMAL(14, 2) NOT NULL,
    net_amount DECIMAL(14, 2) NULL,
    cancelled BIT NOT NULL CONSTRAINT DF_platform_settlement_orders_cancelled DEFAULT ((0)),
    sale_id INT NULL,
    match_kind VARCHAR(10) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_platform_settlement_orders PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_platform_settlement_orders_match', 'C') IS NULL
ALTER TABLE dbo.platform_settlement_orders WITH CHECK ADD CONSTRAINT CK_platform_settlement_orders_match CHECK ([sale_id] IS NULL AND [match_kind] IS NULL OR [sale_id] IS NOT NULL AND ([match_kind]='MANUAL' OR [match_kind]='IMPORTE' OR [match_kind]='REFERENCIA'));

IF OBJECT_ID(N'dbo.FK_platform_settlement_orders_sale', 'F') IS NULL
ALTER TABLE dbo.platform_settlement_orders WITH CHECK ADD CONSTRAINT FK_platform_settlement_orders_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);

IF OBJECT_ID(N'dbo.FK_platform_settlement_orders_settlement', 'F') IS NULL
ALTER TABLE dbo.platform_settlement_orders WITH CHECK ADD CONSTRAINT FK_platform_settlement_orders_settlement FOREIGN KEY (settlement_id) REFERENCES dbo.platform_settlements (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_platform_settlement_orders_settlement' AND object_id = OBJECT_ID(N'dbo.platform_settlement_orders'))
CREATE NONCLUSTERED INDEX IX_platform_settlement_orders_settlement ON dbo.platform_settlement_orders (settlement_id, line_no);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_platform_settlement_orders_sale' AND object_id = OBJECT_ID(N'dbo.platform_settlement_orders'))
CREATE UNIQUE NONCLUSTERED INDEX UX_platform_settlement_orders_sale ON dbo.platform_settlement_orders (settlement_id, sale_id) WHERE ([sale_id] IS NOT NULL);
