/* purchase_order_sent
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.purchase_order_sent', 'U') IS NULL
BEGIN
CREATE TABLE dbo.purchase_order_sent (
    id INT IDENTITY(1, 1) NOT NULL,
    supplier_id INT NOT NULL,
    sent_at DATETIME2(0) NOT NULL CONSTRAINT DF_purchase_order_sent_sent_at DEFAULT (sysdatetime()),
    via VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    lineas INT NOT NULL CONSTRAINT DF_purchase_order_sent_lineas DEFAULT ((0)),
    user_id INT NULL,
    CONSTRAINT PK_purchase_order_sent PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_purchase_order_sent_supplier', 'F') IS NULL
ALTER TABLE dbo.purchase_order_sent WITH CHECK ADD CONSTRAINT FK_purchase_order_sent_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.CAT_suppliers (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_purchase_order_sent_supplier' AND object_id = OBJECT_ID(N'dbo.purchase_order_sent'))
CREATE NONCLUSTERED INDEX IX_purchase_order_sent_supplier ON dbo.purchase_order_sent (supplier_id, sent_at);
