/* ============================================================
   0070 — Diseño del menú en línea (esquema)

   Una sola plantilla para todos; el negocio solo pone su contenido.

   menu_en_linea_config      + color y acento (#rrggbb; sin ellos manda el
                             addon o el de Wybix), una frase del negocio,
                             dirección y horario que ve el cliente.

   menu_en_linea_productos   lo que el menú en línea sabe de un producto y
                             la caja no: descripción, etiquetas (NUEVO,
                             RECOMENDADO, PICANTE, VEGETARIANO), destacado y
                             oculto (no se ofrece en línea).

   menu_en_linea_imagenes    las fotos GRANDES del menú (las miniaturas de
                             Touch son de 192 px y no alcanzan): una PORTADA,
                             un LOGO, hasta 5 PROMO con título y producto, y
                             una por PRODUCTO. Viven aquí, en la base del
                             negocio (respaldo y multicaja), y la caja
                             principal las sube a la nube por versión.

   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF COL_LENGTH(N'dbo.menu_en_linea_config', N'color') IS NULL
    ALTER TABLE dbo.menu_en_linea_config ADD color NVARCHAR(7) COLLATE Modern_Spanish_CI_AS NULL;
GO
IF COL_LENGTH(N'dbo.menu_en_linea_config', N'acento') IS NULL
    ALTER TABLE dbo.menu_en_linea_config ADD acento NVARCHAR(7) COLLATE Modern_Spanish_CI_AS NULL;
GO
IF COL_LENGTH(N'dbo.menu_en_linea_config', N'frase') IS NULL
    ALTER TABLE dbo.menu_en_linea_config ADD frase NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL;
GO
IF COL_LENGTH(N'dbo.menu_en_linea_config', N'direccion') IS NULL
    ALTER TABLE dbo.menu_en_linea_config ADD direccion NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL;
GO
IF COL_LENGTH(N'dbo.menu_en_linea_config', N'horario') IS NULL
    ALTER TABLE dbo.menu_en_linea_config ADD horario NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL;
GO
IF OBJECT_ID(N'dbo.menu_en_linea_productos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.menu_en_linea_productos (
    product_id INT NOT NULL,
    descripcion NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL,
    etiquetas NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NULL,
    destacado BIT NOT NULL CONSTRAINT DF_menu_en_linea_productos_dest DEFAULT (0),
    oculto BIT NOT NULL CONSTRAINT DF_menu_en_linea_productos_oculto DEFAULT (0),
    actualizado_en DATETIME2(0) NOT NULL CONSTRAINT DF_menu_en_linea_productos_act DEFAULT (sysdatetime()),
    CONSTRAINT PK_menu_en_linea_productos PRIMARY KEY CLUSTERED (product_id),
    CONSTRAINT FK_menu_en_linea_productos_product FOREIGN KEY (product_id) REFERENCES dbo.products (id)
);
END;
GO
IF OBJECT_ID(N'dbo.menu_en_linea_imagenes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.menu_en_linea_imagenes (
    id INT IDENTITY(1, 1) NOT NULL,
    tipo NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    product_id INT NULL,
    titulo NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NULL,
    subtitulo NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    orden INT NOT NULL CONSTRAINT DF_menu_en_linea_imagenes_orden DEFAULT (0),
    mime NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    data VARBINARY(MAX) NOT NULL,
    ancho INT NOT NULL,
    alto INT NOT NULL,
    version INT NOT NULL CONSTRAINT DF_menu_en_linea_imagenes_version DEFAULT (1),
    actualizado_en DATETIME2(0) NOT NULL CONSTRAINT DF_menu_en_linea_imagenes_act DEFAULT (sysdatetime()),
    CONSTRAINT PK_menu_en_linea_imagenes PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_menu_en_linea_imagenes_tipo CHECK (tipo IN ('PORTADA', 'LOGO', 'PROMO', 'PRODUCTO')),
    CONSTRAINT CK_menu_en_linea_imagenes_producto CHECK ((tipo = 'PRODUCTO' AND product_id IS NOT NULL) OR (tipo IN ('PORTADA', 'LOGO')) OR tipo = 'PROMO'),
    CONSTRAINT CK_menu_en_linea_imagenes_mime CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT CK_menu_en_linea_imagenes_peso CHECK (DATALENGTH(data) <= 460800),
    CONSTRAINT FK_menu_en_linea_imagenes_product FOREIGN KEY (product_id) REFERENCES dbo.products (id)
);
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_menu_en_linea_imagenes_unica' AND object_id = OBJECT_ID(N'dbo.menu_en_linea_imagenes'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_menu_en_linea_imagenes_unica ON dbo.menu_en_linea_imagenes (tipo) WHERE (tipo IN ('PORTADA', 'LOGO'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_menu_en_linea_imagenes_producto' AND object_id = OBJECT_ID(N'dbo.menu_en_linea_imagenes'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_menu_en_linea_imagenes_producto ON dbo.menu_en_linea_imagenes (product_id) WHERE (tipo = 'PRODUCTO');
GO
