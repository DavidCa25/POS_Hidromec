/* product_impuestos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.product_impuestos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.product_impuestos (
    product_id INT NOT NULL,
    impuesto_id INT NOT NULL,
    cantidad DECIMAL(12, 4) NULL,
    CONSTRAINT PK_product_impuestos PRIMARY KEY CLUSTERED (product_id, impuesto_id)
);
END;

IF OBJECT_ID(N'dbo.CK_product_impuestos_cantidad', 'C') IS NULL
ALTER TABLE dbo.product_impuestos WITH CHECK ADD CONSTRAINT CK_product_impuestos_cantidad CHECK ([cantidad] IS NULL OR [cantidad]>(0));

IF OBJECT_ID(N'dbo.FK_product_impuestos_impuesto', 'F') IS NULL
ALTER TABLE dbo.product_impuestos WITH CHECK ADD CONSTRAINT FK_product_impuestos_impuesto FOREIGN KEY (impuesto_id) REFERENCES dbo.CAT_impuestos (id);

IF OBJECT_ID(N'dbo.FK_product_impuestos_producto', 'F') IS NULL
ALTER TABLE dbo.product_impuestos WITH CHECK ADD CONSTRAINT FK_product_impuestos_producto FOREIGN KEY (product_id) REFERENCES dbo.products (id);
