/* sale_refund_detail
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.sale_refund_detail', 'U') IS NULL
BEGIN
CREATE TABLE dbo.sale_refund_detail (
    id INT IDENTITY(1, 1) NOT NULL,
    refund_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity DECIMAL(12, 2) NOT NULL,
    unitary_price DECIMAL(12, 2) NOT NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sale_refund_detail_refund_id' AND object_id = OBJECT_ID(N'dbo.sale_refund_detail'))
CREATE NONCLUSTERED INDEX IX_sale_refund_detail_refund_id ON dbo.sale_refund_detail (refund_id);
