/* production_batch_consumption
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.production_batch_consumption', 'U') IS NULL
BEGIN
CREATE TABLE dbo.production_batch_consumption (
    batch_id INT NOT NULL,
    ingredient_product_id INT NOT NULL,
    qty DECIMAL(14, 4) NOT NULL,
    unit_cost DECIMAL(14, 4) NOT NULL,
    CONSTRAINT PK_production_batch_consumption PRIMARY KEY CLUSTERED (batch_id, ingredient_product_id)
);
END;

IF OBJECT_ID(N'dbo.FK_production_batch_consumption_batch', 'F') IS NULL
ALTER TABLE dbo.production_batch_consumption WITH CHECK ADD CONSTRAINT FK_production_batch_consumption_batch FOREIGN KEY (batch_id) REFERENCES dbo.production_batches (id);

IF OBJECT_ID(N'dbo.FK_production_batch_consumption_ingredient', 'F') IS NULL
ALTER TABLE dbo.production_batch_consumption WITH CHECK ADD CONSTRAINT FK_production_batch_consumption_ingredient FOREIGN KEY (ingredient_product_id) REFERENCES dbo.products (id);
