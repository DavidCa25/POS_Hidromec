/* Contrato aditivo. Ventas históricas mantienen su método y total. */
IF OBJECT_ID('dbo.sale_payments','U') IS NULL
CREATE TABLE dbo.sale_payments (
 id INT IDENTITY PRIMARY KEY, sale_id INT NOT NULL REFERENCES dbo.sales(id),
 payment_method NVARCHAR(50) NOT NULL, amount DECIMAL(12,2) NOT NULL CHECK(amount>0),
 received DECIMAL(12,2) NULL, reference NVARCHAR(100) NULL,
 CONSTRAINT UQ_sale_payments_method UNIQUE(sale_id,payment_method),
 CONSTRAINT CK_sale_payments_cash CHECK(received IS NULL OR (payment_method='EFECTIVO' AND received>=amount))
);
IF COL_LENGTH('dbo.sales','client_sale_key') IS NULL ALTER TABLE dbo.sales ADD client_sale_key UNIQUEIDENTIFIER NULL;
IF COL_LENGTH('dbo.sales','client_sale_hash') IS NULL ALTER TABLE dbo.sales ADD client_sale_hash VARCHAR(64) NULL;
GO
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.sales') AND name='UX_sales_client_key')
CREATE UNIQUE INDEX UX_sales_client_key ON dbo.sales(client_sale_key) WHERE client_sale_key IS NOT NULL;
GO

IF COL_LENGTH('dbo.cash_closures','receipt_snapshot') IS NULL ALTER TABLE dbo.cash_closures ADD receipt_snapshot NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.sale_detail','tax_rate') IS NULL ALTER TABLE dbo.sale_detail ADD tax_rate DECIMAL(9,6) NULL, tax_object NVARCHAR(2) NULL;
GO

IF OBJECT_ID('dbo.refund_payments','U') IS NULL CREATE TABLE dbo.refund_payments(
 refund_id INT NOT NULL REFERENCES dbo.sale_refunds(id),payment_method NVARCHAR(50) NOT NULL,amount DECIMAL(12,2) NOT NULL CHECK(amount>0),PRIMARY KEY(refund_id,payment_method));
GO

IF OBJECT_ID('dbo.ticket_email_jobs','U') IS NULL CREATE TABLE dbo.ticket_email_jobs(
 id UNIQUEIDENTIFIER PRIMARY KEY,sale_id INT NOT NULL REFERENCES dbo.sales(id),recipient NVARCHAR(254) NOT NULL,
 pdf VARBINARY(MAX) NOT NULL,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),sent_at DATETIME2 NULL,
 CONSTRAINT UQ_ticket_email_destination UNIQUE(sale_id,recipient));
GO

IF COL_LENGTH('dbo.sales','closure_id') IS NULL ALTER TABLE dbo.sales ADD closure_id INT NULL REFERENCES dbo.cash_closures(id);
GO
