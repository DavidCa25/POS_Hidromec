/* refund_payments
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.refund_payments', 'U') IS NULL
BEGIN
CREATE TABLE dbo.refund_payments (
    refund_id INT NOT NULL,
    payment_method NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    PRIMARY KEY CLUSTERED (refund_id, payment_method)
);
END;

ALTER TABLE dbo.refund_payments WITH CHECK ADD CHECK ([amount]>(0));

ALTER TABLE dbo.refund_payments WITH CHECK ADD FOREIGN KEY (refund_id) REFERENCES dbo.sale_refunds (id);
