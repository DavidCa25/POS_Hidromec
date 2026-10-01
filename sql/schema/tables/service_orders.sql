/* service_orders
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.service_orders', 'U') IS NULL
BEGIN
CREATE TABLE dbo.service_orders (
    id INT IDENTITY(1, 1) NOT NULL,
    folio AS ('OS-'+right('000000'+CONVERT([varchar](7),[id]),(6))) PERSISTED,
    customer_id INT NOT NULL,
    customer_asset_id INT NULL,
    status NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_sorders_status DEFAULT ('BORRADOR'),
    reported_issue NVARCHAR(1000) COLLATE Modern_Spanish_CI_AS NULL,
    diagnosis NVARCHAR(1000) COLLATE Modern_Spanish_CI_AS NULL,
    quote_version INT NOT NULL CONSTRAINT DF_sorders_qver DEFAULT ((1)),
    authorized_version INT NULL,
    authorized_at DATETIME2(0) NULL,
    authorized_by_name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    authorized_channel NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    authorized_by_user INT NULL,
    promised_at DATETIME2(0) NULL,
    opened_at DATETIME2(0) NOT NULL CONSTRAINT DF_sorders_opened DEFAULT (sysdatetime()),
    opened_by INT NULL,
    closed_at DATETIME2(0) NULL,
    closed_by INT NULL,
    sale_id INT NULL,
    register_id INT NULL,
    notes NVARCHAR(1000) COLLATE Modern_Spanish_CI_AS NULL,
    rowver TIMESTAMP NOT NULL,
    CONSTRAINT PK_service_orders PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_sorders_asset', 'F') IS NULL
ALTER TABLE dbo.service_orders WITH CHECK ADD CONSTRAINT FK_sorders_asset FOREIGN KEY (customer_asset_id) REFERENCES dbo.customer_assets (id);

IF OBJECT_ID(N'dbo.FK_sorders_auth_user', 'F') IS NULL
ALTER TABLE dbo.service_orders WITH CHECK ADD CONSTRAINT FK_sorders_auth_user FOREIGN KEY (authorized_by_user) REFERENCES dbo.users (id);

IF OBJECT_ID(N'dbo.FK_sorders_closed_by', 'F') IS NULL
ALTER TABLE dbo.service_orders WITH CHECK ADD CONSTRAINT FK_sorders_closed_by FOREIGN KEY (closed_by) REFERENCES dbo.users (id);

IF OBJECT_ID(N'dbo.FK_sorders_customer', 'F') IS NULL
ALTER TABLE dbo.service_orders WITH CHECK ADD CONSTRAINT FK_sorders_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers (id);

IF OBJECT_ID(N'dbo.FK_sorders_opened_by', 'F') IS NULL
ALTER TABLE dbo.service_orders WITH CHECK ADD CONSTRAINT FK_sorders_opened_by FOREIGN KEY (opened_by) REFERENCES dbo.users (id);

IF OBJECT_ID(N'dbo.FK_sorders_sale', 'F') IS NULL
ALTER TABLE dbo.service_orders WITH CHECK ADD CONSTRAINT FK_sorders_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_service_orders_customer' AND object_id = OBJECT_ID(N'dbo.service_orders'))
CREATE NONCLUSTERED INDEX IX_service_orders_customer ON dbo.service_orders (customer_id, opened_at DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_service_orders_status' AND object_id = OBJECT_ID(N'dbo.service_orders'))
CREATE NONCLUSTERED INDEX IX_service_orders_status ON dbo.service_orders (status, opened_at DESC) INCLUDE (customer_id, sale_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_service_orders_sale' AND object_id = OBJECT_ID(N'dbo.service_orders'))
CREATE UNIQUE NONCLUSTERED INDEX UX_service_orders_sale ON dbo.service_orders (sale_id) WHERE ([sale_id] IS NOT NULL);
