/* sale_detail
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.sale_detail', 'U') IS NULL
BEGIN
CREATE TABLE dbo.sale_detail (
    id INT IDENTITY(1, 1) NOT NULL,
    sale_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity DECIMAL(12, 2) NOT NULL,
    unitary_price DECIMAL(10, 2) NOT NULL,
    subtotal AS ([quantity]*[unitary_price]),
    unit_cost DECIMAL(14, 4) NULL,
    line_cost AS ([quantity]*[unit_cost]),
    inventory_mode NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NULL,
    note NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

ALTER TABLE dbo.sale_detail WITH CHECK ADD FOREIGN KEY (product_id) REFERENCES dbo.products (id);

ALTER TABLE dbo.sale_detail WITH CHECK ADD FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);
