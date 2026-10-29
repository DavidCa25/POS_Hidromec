/* loyalty_stamp_card_products
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.loyalty_stamp_card_products', 'U') IS NULL
BEGIN
CREATE TABLE dbo.loyalty_stamp_card_products (
    card_id INT NOT NULL,
    product_id INT NOT NULL,
    CONSTRAINT PK_loyalty_stamp_card_products PRIMARY KEY CLUSTERED (card_id, product_id)
);
END;

IF OBJECT_ID(N'dbo.FK_loyalty_stamp_card_products_card', 'F') IS NULL
ALTER TABLE dbo.loyalty_stamp_card_products WITH CHECK ADD CONSTRAINT FK_loyalty_stamp_card_products_card FOREIGN KEY (card_id) REFERENCES dbo.loyalty_stamp_cards (id);

IF OBJECT_ID(N'dbo.FK_loyalty_stamp_card_products_product', 'F') IS NULL
ALTER TABLE dbo.loyalty_stamp_card_products WITH CHECK ADD CONSTRAINT FK_loyalty_stamp_card_products_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);
