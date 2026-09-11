/* product_images
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.product_images', 'U') IS NULL
BEGIN
CREATE TABLE dbo.product_images (
    product_id INT NOT NULL,
    thumb VARBINARY(MAX) NOT NULL,
    mime NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_product_images_mime DEFAULT ('image/jpeg'),
    width INT NOT NULL,
    height INT NOT NULL,
    version INT NOT NULL CONSTRAINT DF_product_images_version DEFAULT ((1)),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_product_images_updated_at DEFAULT (sysdatetime()),
    CONSTRAINT PK_product_images PRIMARY KEY CLUSTERED (product_id)
);
END;

IF OBJECT_ID(N'dbo.CK_product_images_size', 'C') IS NULL
ALTER TABLE dbo.product_images WITH CHECK ADD CONSTRAINT CK_product_images_size CHECK (datalength([thumb])<=(65536));

IF OBJECT_ID(N'dbo.FK_product_images_product', 'F') IS NULL
ALTER TABLE dbo.product_images WITH CHECK ADD CONSTRAINT FK_product_images_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);
