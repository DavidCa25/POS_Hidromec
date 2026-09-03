/* purchase_detail
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.purchase_detail', 'U') IS NULL
BEGIN
CREATE TABLE dbo.purchase_detail (
    id INT IDENTITY(1, 1) NOT NULL,
    puchase_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity DECIMAL(12, 2) NOT NULL,
    unitary_price DECIMAL(10, 2) NOT NULL,
    supplier_id INT NULL,
    profit_percent DECIMAL(5, 2) NULL,
    subtotal AS ([quantity]*[unitary_price]),
    PRIMARY KEY CLUSTERED (id)
);
END;

ALTER TABLE dbo.purchase_detail WITH CHECK ADD FOREIGN KEY (product_id) REFERENCES dbo.products (id);

ALTER TABLE dbo.purchase_detail WITH CHECK ADD FOREIGN KEY (puchase_id) REFERENCES dbo.purchase (id);
