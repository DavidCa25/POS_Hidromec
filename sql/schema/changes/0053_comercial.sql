/* Política publicada y cotizaciones inmutables. Vacía por defecto: no cambia ventas existentes. */
IF OBJECT_ID('dbo.commercial_policy','U') IS NULL
CREATE TABLE dbo.commercial_policy (
 id INT NOT NULL PRIMARY KEY CHECK(id=1), version INT NOT NULL,
 payload NVARCHAR(MAX) NOT NULL CHECK(ISJSON(payload)=1), updated_by INT NULL,
 updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS(SELECT 1 FROM dbo.commercial_policy WHERE id=1)
INSERT dbo.commercial_policy(id,version,payload) VALUES(1,0,N'{"version":0,"channels":[{"id":"LOCAL","name":"Mostrador","active":true,"inheritBase":true}],"prices":[],"promotions":[],"combos":[]}');
IF OBJECT_ID('dbo.commercial_quotes','U') IS NULL
CREATE TABLE dbo.commercial_quotes (
 id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY, actor_id INT NOT NULL, register_id INT NULL,
 policy_version INT NOT NULL, payload NVARCHAR(MAX) NOT NULL CHECK(ISJSON(payload)=1),
 expires_at DATETIME2 NOT NULL, sale_id INT NULL,
 created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.commercial_quotes') AND name='UX_commercial_quote_sale')
CREATE UNIQUE INDEX UX_commercial_quote_sale ON dbo.commercial_quotes(sale_id) WHERE sale_id IS NOT NULL;
IF COL_LENGTH('dbo.sales','commercial_snapshot') IS NULL ALTER TABLE dbo.sales ADD commercial_snapshot NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.sale_detail','commercial_snapshot') IS NULL ALTER TABLE dbo.sale_detail ADD commercial_snapshot NVARCHAR(MAX) NULL;
GO

IF COL_LENGTH('dbo.sale_refund_detail','commercial_amount') IS NULL ALTER TABLE dbo.sale_refund_detail ADD commercial_amount DECIMAL(12,2) NULL;
GO
IF COL_LENGTH('dbo.hosp_cuentas','commercial_context') IS NULL ALTER TABLE dbo.hosp_cuentas ADD commercial_context NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.hosp_orden_lineas','commercial_component') IS NULL ALTER TABLE dbo.hosp_orden_lineas ADD commercial_component NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH('dbo.commercial_quotes','payment_reference') IS NULL ALTER TABLE dbo.commercial_quotes ADD payment_reference NVARCHAR(100) NULL;
GO
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.commercial_quotes') AND name='UX_commercial_quote_payment')
CREATE UNIQUE INDEX UX_commercial_quote_payment ON dbo.commercial_quotes(payment_reference) WHERE payment_reference IS NOT NULL;
GO
