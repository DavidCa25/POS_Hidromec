/* menu_en_linea_imagenes
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.menu_en_linea_imagenes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.menu_en_linea_imagenes (
    id INT IDENTITY(1, 1) NOT NULL,
    tipo NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    product_id INT NULL,
    titulo NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
    subtitulo NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    orden INT NOT NULL CONSTRAINT DF_menu_en_linea_imagenes_orden DEFAULT ((0)),
    mime NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    data VARBINARY(MAX) NOT NULL,
    ancho INT NOT NULL,
    alto INT NOT NULL,
    version INT NOT NULL CONSTRAINT DF_menu_en_linea_imagenes_version DEFAULT ((1)),
    actualizado_en DATETIME2(0) NOT NULL CONSTRAINT DF_menu_en_linea_imagenes_act DEFAULT (sysdatetime()),
    CONSTRAINT PK_menu_en_linea_imagenes PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_menu_en_linea_imagenes_mime', 'C') IS NULL
ALTER TABLE dbo.menu_en_linea_imagenes WITH CHECK ADD CONSTRAINT CK_menu_en_linea_imagenes_mime CHECK ([mime]='image/webp' OR [mime]='image/png' OR [mime]='image/jpeg');

IF OBJECT_ID(N'dbo.CK_menu_en_linea_imagenes_peso', 'C') IS NULL
ALTER TABLE dbo.menu_en_linea_imagenes WITH CHECK ADD CONSTRAINT CK_menu_en_linea_imagenes_peso CHECK (datalength([data])<=(460800));

IF OBJECT_ID(N'dbo.CK_menu_en_linea_imagenes_producto', 'C') IS NULL
ALTER TABLE dbo.menu_en_linea_imagenes WITH CHECK ADD CONSTRAINT CK_menu_en_linea_imagenes_producto CHECK ([tipo]='PRODUCTO' AND [product_id] IS NOT NULL OR ([tipo]='LOGO' OR [tipo]='PORTADA') OR [tipo]='PROMO');

IF OBJECT_ID(N'dbo.CK_menu_en_linea_imagenes_tipo', 'C') IS NULL
ALTER TABLE dbo.menu_en_linea_imagenes WITH CHECK ADD CONSTRAINT CK_menu_en_linea_imagenes_tipo CHECK ([tipo]='PRODUCTO' OR [tipo]='PROMO' OR [tipo]='LOGO' OR [tipo]='PORTADA');

IF OBJECT_ID(N'dbo.FK_menu_en_linea_imagenes_product', 'F') IS NULL
ALTER TABLE dbo.menu_en_linea_imagenes WITH CHECK ADD CONSTRAINT FK_menu_en_linea_imagenes_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_menu_en_linea_imagenes_producto' AND object_id = OBJECT_ID(N'dbo.menu_en_linea_imagenes'))
CREATE UNIQUE NONCLUSTERED INDEX UX_menu_en_linea_imagenes_producto ON dbo.menu_en_linea_imagenes (product_id) WHERE ([tipo]='PRODUCTO');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_menu_en_linea_imagenes_unica' AND object_id = OBJECT_ID(N'dbo.menu_en_linea_imagenes'))
CREATE UNIQUE NONCLUSTERED INDEX UX_menu_en_linea_imagenes_unica ON dbo.menu_en_linea_imagenes (tipo) WHERE ([tipo] IN ('PORTADA', 'LOGO'));
