/* sale_payments
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.sale_payments', 'U') IS NULL
BEGIN
CREATE TABLE dbo.sale_payments (
    id INT IDENTITY(1, 1) NOT NULL,
    sale_id INT NOT NULL,
    payment_method NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    received DECIMAL(12, 2) NULL,
    reference NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NULL,
    PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UQ_sale_payments_method UNIQUE NONCLUSTERED (sale_id, payment_method)
);
END;

ALTER TABLE dbo.sale_payments WITH CHECK ADD CHECK ([amount]>(0));

IF OBJECT_ID(N'dbo.CK_sale_payments_cash', 'C') IS NULL
ALTER TABLE dbo.sale_payments WITH CHECK ADD CONSTRAINT CK_sale_payments_cash CHECK ([received] IS NULL OR [payment_method]='EFECTIVO' AND [received]>=[amount]);

ALTER TABLE dbo.sale_payments WITH CHECK ADD FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);
