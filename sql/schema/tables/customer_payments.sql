/* customer_payments
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.customer_payments', 'U') IS NULL
BEGIN
CREATE TABLE dbo.customer_payments (
    id INT IDENTITY(1, 1) NOT NULL,
    customer_id INT NOT NULL,
    sale_id INT NOT NULL,
    datee DATETIME2(0) NOT NULL DEFAULT (sysdatetime()),
    amount DECIMAL(10, 2) NOT NULL,
    user_id INT NOT NULL,
    payment_method NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NOT NULL,
    note NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_customer_payments_customers', 'F') IS NULL
ALTER TABLE dbo.customer_payments WITH CHECK ADD CONSTRAINT FK_customer_payments_customers FOREIGN KEY (customer_id) REFERENCES dbo.customers (id);

IF OBJECT_ID(N'dbo.FK_customer_payments_sales', 'F') IS NULL
ALTER TABLE dbo.customer_payments WITH CHECK ADD CONSTRAINT FK_customer_payments_sales FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);
