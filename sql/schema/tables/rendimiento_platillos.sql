/* rendimiento_platillos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.rendimiento_platillos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.rendimiento_platillos (
    product_id INT NOT NULL,
    carne_id INT NOT NULL,
    tacos DECIMAL(6, 2) NOT NULL,
    manual BIT NOT NULL CONSTRAINT DF_rendimiento_platillos_manual DEFAULT ((0)),
    CONSTRAINT PK_rendimiento_platillos PRIMARY KEY CLUSTERED (product_id, carne_id)
);
END;

IF OBJECT_ID(N'dbo.FK_rendimiento_platillos_product', 'F') IS NULL
ALTER TABLE dbo.rendimiento_platillos WITH CHECK ADD CONSTRAINT FK_rendimiento_platillos_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.FK_rendimiento_platillos_carne', 'F') IS NULL
ALTER TABLE dbo.rendimiento_platillos WITH CHECK ADD CONSTRAINT FK_rendimiento_platillos_carne FOREIGN KEY (carne_id) REFERENCES dbo.rendimiento_carnes (product_id);

IF OBJECT_ID(N'dbo.CK_rendimiento_platillos_tacos', 'C') IS NULL
ALTER TABLE dbo.rendimiento_platillos WITH CHECK ADD CONSTRAINT CK_rendimiento_platillos_tacos CHECK ([tacos] > 0 AND [tacos] <= 100);
