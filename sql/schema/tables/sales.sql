/* sales
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.sales', 'U') IS NULL
BEGIN
CREATE TABLE dbo.sales (
    id INT IDENTITY(1, 1) NOT NULL,
    datee DATETIME NULL DEFAULT (getdate()),
    useer_id INT NOT NULL,
    total DECIMAL(10, 2) NULL,
    payment_method NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NULL,
    customer_id INT NULL,
    paid_amount DECIMAL(10, 2) NOT NULL DEFAULT ((0)),
    balance DECIMAL(10, 2) NOT NULL DEFAULT ((0)),
    due_date DATE NULL,
    invoice_status NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_sales_invoice_status DEFAULT ('NONE'),
    register_id INT NULL CONSTRAINT DF_sales_register_id DEFAULT ((1)),
    service_mode NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_sales_service_mode', 'C') IS NULL
ALTER TABLE dbo.sales WITH CHECK ADD CONSTRAINT CK_sales_service_mode CHECK ([service_mode] IS NULL OR [service_mode]='TAKEAWAY' OR [service_mode]='DINE_IN');

ALTER TABLE dbo.sales WITH CHECK ADD FOREIGN KEY (useer_id) REFERENCES dbo.users (id);

IF OBJECT_ID(N'dbo.FK_sales_customer', 'F') IS NULL
ALTER TABLE dbo.sales WITH CHECK ADD CONSTRAINT FK_sales_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers (id);

IF OBJECT_ID(N'dbo.FK_sales_register', 'F') IS NULL
ALTER TABLE dbo.sales WITH CHECK ADD CONSTRAINT FK_sales_register FOREIGN KEY (register_id) REFERENCES dbo.registers (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sales_register_id' AND object_id = OBJECT_ID(N'dbo.sales'))
CREATE NONCLUSTERED INDEX IX_sales_register_id ON dbo.sales (register_id);
