/* menu_en_linea_productos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.menu_en_linea_productos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.menu_en_linea_productos (
    product_id INT NOT NULL,
    descripcion NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL,
    etiquetas NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NULL,
    destacado BIT NOT NULL CONSTRAINT DF_menu_en_linea_productos_dest DEFAULT ((0)),
    oculto BIT NOT NULL CONSTRAINT DF_menu_en_linea_productos_oculto DEFAULT ((0)),
    actualizado_en DATETIME2(0) NOT NULL CONSTRAINT DF_menu_en_linea_productos_act DEFAULT (sysdatetime()),
    CONSTRAINT PK_menu_en_linea_productos PRIMARY KEY CLUSTERED (product_id)
);
END;

IF OBJECT_ID(N'dbo.FK_menu_en_linea_productos_product', 'F') IS NULL
ALTER TABLE dbo.menu_en_linea_productos WITH CHECK ADD CONSTRAINT FK_menu_en_linea_productos_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);
