/* stock_transfer_lines
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.stock_transfer_lines', 'U') IS NULL
BEGIN
CREATE TABLE dbo.stock_transfer_lines (
    id INT IDENTITY(1, 1) NOT NULL,
    transfer_id INT NOT NULL,
    product_id INT NOT NULL,
    qty_sent DECIMAL(12, 2) NOT NULL,
    qty_received DECIMAL(12, 2) NULL,
    CONSTRAINT PK_stock_transfer_lines PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_stock_transfer_lines_qty', 'C') IS NULL
ALTER TABLE dbo.stock_transfer_lines WITH CHECK ADD CONSTRAINT CK_stock_transfer_lines_qty CHECK ([qty_sent]>=(0) AND ([qty_received] IS NULL OR [qty_received]>=(0)));

IF OBJECT_ID(N'dbo.FK_stock_transfer_lines_product', 'F') IS NULL
ALTER TABLE dbo.stock_transfer_lines WITH CHECK ADD CONSTRAINT FK_stock_transfer_lines_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.FK_stock_transfer_lines_transfer', 'F') IS NULL
ALTER TABLE dbo.stock_transfer_lines WITH CHECK ADD CONSTRAINT FK_stock_transfer_lines_transfer FOREIGN KEY (transfer_id) REFERENCES dbo.stock_transfers (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_stock_transfer_lines_transfer' AND object_id = OBJECT_ID(N'dbo.stock_transfer_lines'))
CREATE NONCLUSTERED INDEX IX_stock_transfer_lines_transfer ON dbo.stock_transfer_lines (transfer_id);
