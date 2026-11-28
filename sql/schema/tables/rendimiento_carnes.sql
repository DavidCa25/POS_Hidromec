/* rendimiento_carnes
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.rendimiento_carnes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.rendimiento_carnes (
    product_id INT NOT NULL,
    rinde DECIMAL(6, 2) NOT NULL,
    activo BIT NOT NULL CONSTRAINT DF_rendimiento_carnes_activo DEFAULT ((1)),
    desde DATETIME2(3) NOT NULL CONSTRAINT DF_rendimiento_carnes_desde DEFAULT (sysdatetime()),
    actualizado DATETIME2(0) NOT NULL CONSTRAINT DF_rendimiento_carnes_actualizado DEFAULT (sysdatetime()),
    CONSTRAINT PK_rendimiento_carnes PRIMARY KEY CLUSTERED (product_id)
);
END;

IF OBJECT_ID(N'dbo.FK_rendimiento_carnes_product', 'F') IS NULL
ALTER TABLE dbo.rendimiento_carnes WITH CHECK ADD CONSTRAINT FK_rendimiento_carnes_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.CK_rendimiento_carnes_rinde', 'C') IS NULL
ALTER TABLE dbo.rendimiento_carnes WITH CHECK ADD CONSTRAINT CK_rendimiento_carnes_rinde CHECK ([rinde] >= 1 AND [rinde] <= 60);
