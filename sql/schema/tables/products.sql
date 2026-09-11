/* products
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.products', 'U') IS NULL
BEGIN
CREATE TABLE dbo.products (
    id INT IDENTITY(1, 1) NOT NULL,
    part_number NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NOT NULL,
    nombre NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    stock DECIMAL(12, 2) NOT NULL,
    active BIT NULL DEFAULT ((1)),
    registrated_date DATETIME NULL DEFAULT (getdate()),
    category_id INT NULL,
    brand_id INT NULL,
    cost DECIMAL(14, 4) NULL,
    bar_code NVARCHAR(50) COLLATE Modern_Spanish_CI_AS NULL DEFAULT ('7855745585855'),
    clave_prod_serv NVARCHAR(8) COLLATE Modern_Spanish_CI_AS NULL,
    clave_unidad NVARCHAR(5) COLLATE Modern_Spanish_CI_AS NULL,
    objeto_impuesto NVARCHAR(2) COLLATE Modern_Spanish_CI_AS NOT NULL DEFAULT ('02'),
    tasa_iva DECIMAL(5, 4) NOT NULL DEFAULT ((0.16)),
    inventory_mode NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_products_inventory_mode DEFAULT ('DIRECT'),
    sellable BIT NOT NULL CONSTRAINT DF_products_sellable DEFAULT ((1)),
    base_uom NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_products_base_uom DEFAULT ('pza'),
    allow_decimal_qty BIT NOT NULL CONSTRAINT DF_products_allow_decimal_qty DEFAULT ((0)),
    image_version INT NOT NULL CONSTRAINT DF_products_image_version DEFAULT ((0)),
    PRIMARY KEY CLUSTERED (id),
    UNIQUE NONCLUSTERED (part_number)
);
END;

IF OBJECT_ID(N'dbo.CK_products_inventory_mode', 'C') IS NULL
ALTER TABLE dbo.products WITH CHECK ADD CONSTRAINT CK_products_inventory_mode CHECK ([inventory_mode]='NONE' OR [inventory_mode]='RECIPE' OR [inventory_mode]='DIRECT');

IF OBJECT_ID(N'dbo.FK_products_base_uom', 'F') IS NULL
ALTER TABLE dbo.products WITH CHECK ADD CONSTRAINT FK_products_base_uom FOREIGN KEY (base_uom) REFERENCES dbo.uoms (code);

IF OBJECT_ID(N'dbo.fk_products_brand', 'F') IS NULL
ALTER TABLE dbo.products WITH CHECK ADD CONSTRAINT fk_products_brand FOREIGN KEY (brand_id) REFERENCES dbo.CAT_brands (id);

IF OBJECT_ID(N'dbo.fk_products_category', 'F') IS NULL
ALTER TABLE dbo.products WITH CHECK ADD CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES dbo.CAT_categories (id);
