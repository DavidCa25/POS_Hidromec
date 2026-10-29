/* ============================================================
   0070 — menu diseno

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0070_menu-diseno.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0070_menu-diseno.sql ========== */
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

/* ---------- sp_menu_en_linea_config (SQL_STORED_PROCEDURE) ---------- */
/* sp_menu_en_linea_config
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0067 · La configuracion del menu en linea (una fila). Sin parametros la
   lee; con @guardar = 1 la cambia. El slug es la direccion corta del menu
   (wybix.mx/m/<slug>): minusculas, numeros y guiones; la nube decide si esta
   libre al publicar.

   0070 · Con @diseno = 1 se guardan TAMBIEN los datos de la plantilla
   (colores, frase, direccion, horario). Va aparte para que guardar la
   publicacion no borre el diseno, y al reves. */
CREATE OR ALTER PROCEDURE dbo.sp_menu_en_linea_config
    @guardar BIT = 0,
    @activo BIT = NULL,
    @recibe_pedidos BIT = NULL,
    @slug NVARCHAR(40) = NULL,
    @minutos_estimados INT = NULL,
    @mensaje NVARCHAR(200) = NULL,
    @user_id INT = NULL,
    @diseno BIT = 0,
    @color NVARCHAR(7) = NULL,
    @acento NVARCHAR(7) = NULL,
    @frase NVARCHAR(120) = NULL,
    @direccion NVARCHAR(200) = NULL,
    @horario NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.menu_en_linea_config WHERE id = 1)
        INSERT INTO dbo.menu_en_linea_config (id) VALUES (1);

    IF @guardar = 1
    BEGIN
        SET @slug = LOWER(NULLIF(LTRIM(RTRIM(@slug)), ''));
        IF @slug IS NOT NULL AND (LEN(@slug) < 3 OR @slug COLLATE Latin1_General_BIN LIKE '%[^a-z0-9-]%'
                                  OR LEFT(@slug, 1) = '-' OR RIGHT(@slug, 1) = '-')
        BEGIN RAISERROR('La dirección del menú lleva de 3 a 40 letras minúsculas, números o guiones.', 16, 1); RETURN; END
        IF ISNULL(@activo, 0) = 1 AND @slug IS NULL
        BEGIN RAISERROR('Elige la dirección del menú antes de publicarlo.', 16, 1); RETURN; END
        IF @minutos_estimados IS NOT NULL AND (@minutos_estimados < 1 OR @minutos_estimados > 240)
        BEGIN RAISERROR('El tiempo estimado va de 1 a 240 minutos.', 16, 1); RETURN; END

        UPDATE dbo.menu_en_linea_config
           SET activo = ISNULL(@activo, activo),
               recibe_pedidos = ISNULL(@recibe_pedidos, recibe_pedidos),
               slug = @slug,
               minutos_estimados = ISNULL(@minutos_estimados, minutos_estimados),
               mensaje = NULLIF(LTRIM(RTRIM(@mensaje)), ''),
               actualizado_en = SYSDATETIME(),
               actualizado_por = @user_id
         WHERE id = 1;
    END

    IF @diseno = 1
    BEGIN
        SET @color = LOWER(NULLIF(LTRIM(RTRIM(@color)), ''));
        SET @acento = LOWER(NULLIF(LTRIM(RTRIM(@acento)), ''));
        IF (@color IS NOT NULL AND (LEN(@color) <> 7 OR @color COLLATE Latin1_General_BIN NOT LIKE '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'))
        OR (@acento IS NOT NULL AND (LEN(@acento) <> 7 OR @acento COLLATE Latin1_General_BIN NOT LIKE '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'))
        BEGIN RAISERROR('Los colores van como #rrggbb.', 16, 1); RETURN; END

        UPDATE dbo.menu_en_linea_config
           SET color = @color, acento = @acento,
               frase = NULLIF(LTRIM(RTRIM(@frase)), ''),
               direccion = NULLIF(LTRIM(RTRIM(@direccion)), ''),
               horario = NULLIF(LTRIM(RTRIM(@horario)), ''),
               actualizado_en = SYSDATETIME(),
               actualizado_por = @user_id
         WHERE id = 1;
    END

    SELECT c.activo, c.recibe_pedidos, c.slug, c.minutos_estimados, c.mensaje, c.actualizado_en,
           (SELECT COUNT(*) FROM dbo.pedidos_en_linea WHERE estado = 'PENDIENTE') AS pendientes,
           c.color, c.acento, c.frase, c.direccion, c.horario
      FROM dbo.menu_en_linea_config c WHERE c.id = 1;
END
GO

/* ---------- sp_menu_en_linea_diseno (SQL_STORED_PROCEDURE) ---------- */
/* sp_menu_en_linea_diseno
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0070 · Todo lo que pinta la plantilla del menu en linea, sin los bytes
   de las fotos. Lo usan la pantalla Diseno del menu y la publicacion.

     1 imagenes      id, tipo, producto, titulo, version y tamano
     2 productos     vendibles, con lo que el menu sabe de cada uno
     3 mas_vendidos  los 8 productos mas vendidos de los ultimos 30 dias
                     (piezas), solo vendibles y no ocultos: «Lo mas pedido»
                     sale de ventas reales, no de una lista a mano. */
CREATE OR ALTER PROCEDURE dbo.sp_menu_en_linea_diseno
AS
BEGIN
    SET NOCOUNT ON;

    SELECT i.id, i.tipo, i.product_id, i.titulo, i.subtitulo, i.orden, i.version, i.ancho, i.alto, i.mime
      FROM dbo.menu_en_linea_imagenes i
     ORDER BY CASE i.tipo WHEN 'PORTADA' THEN 0 WHEN 'LOGO' THEN 1 WHEN 'PROMO' THEN 2 ELSE 3 END, i.orden, i.id;

    SELECT p.id AS product_id, p.nombre, p.price, p.category_id, c.namee AS categoria, p.image_version,
           m.descripcion, m.etiquetas, ISNULL(m.destacado, 0) AS destacado, ISNULL(m.oculto, 0) AS oculto,
           f.id AS foto_id, f.version AS foto_version
      FROM dbo.products p
      LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
      LEFT JOIN dbo.menu_en_linea_productos m ON m.product_id = p.id
      LEFT JOIN dbo.menu_en_linea_imagenes f ON f.tipo = 'PRODUCTO' AND f.product_id = p.id
     WHERE p.active = 1 AND p.sellable = 1
     ORDER BY c.namee, p.nombre;

    SELECT TOP 8 d.product_id, SUM(d.quantity) AS piezas
      FROM dbo.sale_detail d
      JOIN dbo.sales s ON s.id = d.sale_id
      JOIN dbo.products p ON p.id = d.product_id AND p.active = 1 AND p.sellable = 1
      LEFT JOIN dbo.menu_en_linea_productos m ON m.product_id = d.product_id
     WHERE s.datee >= DATEADD(DAY, -30, SYSDATETIME()) AND ISNULL(m.oculto, 0) = 0
     GROUP BY d.product_id
     ORDER BY SUM(d.quantity) DESC, d.product_id;
END
GO

/* ---------- sp_menu_en_linea_imagen_borrar (SQL_STORED_PROCEDURE) ---------- */
/* sp_menu_en_linea_imagen_borrar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0070 · Quitar una foto del menu (portada, logo, promo o la de un
   producto). La nube deja de ofrecerla en la siguiente publicacion. */
CREATE OR ALTER PROCEDURE dbo.sp_menu_en_linea_imagen_borrar
    @id INT
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.menu_en_linea_imagenes WHERE id = @id;
    SELECT @@ROWCOUNT AS borradas;
END
GO

/* ---------- sp_menu_en_linea_imagen_get (SQL_STORED_PROCEDURE) ---------- */
/* sp_menu_en_linea_imagen_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0070 · Los bytes de una foto del menu: para subirla a la nube y para la
   vista previa de la pantalla Diseno del menu. */
CREATE OR ALTER PROCEDURE dbo.sp_menu_en_linea_imagen_get
    @id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT id, tipo, product_id, version, mime, data FROM dbo.menu_en_linea_imagenes WHERE id = @id;
END
GO

/* ---------- sp_menu_en_linea_imagen_guardar (SQL_STORED_PROCEDURE) ---------- */
/* sp_menu_en_linea_imagen_guardar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0070 · Guardar una foto grande del menu (ya reducida por la caja).

   PORTADA y LOGO son una cada una; PRODUCTO, una por producto: guardar otra
   la reemplaza y sube la version (asi la nube sabe que debe pedirla). PROMO
   son hasta 5: con @id se edita esa (con @data NULL solo cambian titulo,
   producto u orden); sin @id se agrega. */
CREATE OR ALTER PROCEDURE dbo.sp_menu_en_linea_imagen_guardar
    @tipo NVARCHAR(10),
    @id INT = NULL,
    @product_id INT = NULL,
    @titulo NVARCHAR(60) = NULL,
    @subtitulo NVARCHAR(120) = NULL,
    @orden INT = NULL,
    @mime NVARCHAR(20) = NULL,
    @data VARBINARY(MAX) = NULL,
    @ancho INT = NULL,
    @alto INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @tipo = UPPER(LTRIM(RTRIM(ISNULL(@tipo, ''))));
    IF @tipo NOT IN ('PORTADA', 'LOGO', 'PROMO', 'PRODUCTO')
    BEGIN RAISERROR('Tipo de imagen no válido.', 16, 1); RETURN; END
    IF @tipo = 'PRODUCTO' AND NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
    BEGIN RAISERROR('El producto no existe.', 16, 1); RETURN; END
    IF @tipo = 'PROMO' AND @product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id AND active = 1)
    BEGIN RAISERROR('El producto de la promoción no existe.', 16, 1); RETURN; END
    IF @data IS NOT NULL AND DATALENGTH(@data) > 460800
    BEGIN RAISERROR('La imagen pesa demasiado.', 16, 1); RETURN; END
    IF @data IS NULL AND NOT (@tipo = 'PROMO' AND @id IS NOT NULL)
    BEGIN RAISERROR('Falta la imagen.', 16, 1); RETURN; END

    DECLARE @actual INT;
    BEGIN TRAN;
    IF @tipo = 'PROMO'
    BEGIN
        IF @id IS NOT NULL
        BEGIN
            SELECT @actual = id FROM dbo.menu_en_linea_imagenes WITH (UPDLOCK, HOLDLOCK) WHERE id = @id AND tipo = 'PROMO';
            IF @actual IS NULL BEGIN ROLLBACK TRAN; RAISERROR('La promoción no existe.', 16, 1); RETURN; END
        END
        ELSE IF (SELECT COUNT(*) FROM dbo.menu_en_linea_imagenes WITH (UPDLOCK, HOLDLOCK) WHERE tipo = 'PROMO') >= 5
        BEGIN ROLLBACK TRAN; RAISERROR('Ya tienes 5 promociones. Quita una para agregar otra.', 16, 1); RETURN; END
    END
    ELSE
        SELECT @actual = id FROM dbo.menu_en_linea_imagenes WITH (UPDLOCK, HOLDLOCK)
         WHERE tipo = @tipo AND (@tipo <> 'PRODUCTO' OR product_id = @product_id);

    IF @actual IS NULL
    BEGIN
        INSERT INTO dbo.menu_en_linea_imagenes (tipo, product_id, titulo, subtitulo, orden, mime, data, ancho, alto)
        VALUES (@tipo, CASE WHEN @tipo IN ('PRODUCTO', 'PROMO') THEN @product_id END,
                NULLIF(LTRIM(RTRIM(@titulo)), ''), NULLIF(LTRIM(RTRIM(@subtitulo)), ''), ISNULL(@orden, 0),
                @mime, @data, @ancho, @alto);
        SET @actual = SCOPE_IDENTITY();
    END
    ELSE
        UPDATE dbo.menu_en_linea_imagenes
           SET titulo = CASE WHEN @tipo = 'PROMO' THEN NULLIF(LTRIM(RTRIM(@titulo)), '') ELSE titulo END,
               subtitulo = CASE WHEN @tipo = 'PROMO' THEN NULLIF(LTRIM(RTRIM(@subtitulo)), '') ELSE subtitulo END,
               product_id = CASE WHEN @tipo = 'PROMO' THEN @product_id ELSE product_id END,
               orden = ISNULL(@orden, orden),
               mime = ISNULL(@mime, mime), data = ISNULL(@data, data),
               ancho = ISNULL(@ancho, ancho), alto = ISNULL(@alto, alto),
               version = version + CASE WHEN @data IS NOT NULL THEN 1 ELSE 0 END,
               actualizado_en = SYSDATETIME()
         WHERE id = @actual;
    COMMIT TRAN;

    SELECT id, tipo, product_id, titulo, subtitulo, orden, version, ancho, alto
      FROM dbo.menu_en_linea_imagenes WHERE id = @actual;
END
GO

/* ---------- sp_menu_en_linea_producto_guardar (SQL_STORED_PROCEDURE) ---------- */
/* sp_menu_en_linea_producto_guardar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0070 · Lo que el menu en linea dice de un producto: descripcion,
   etiquetas (lista separada por comas de NUEVO, RECOMENDADO, PICANTE,
   VEGETARIANO), destacado y oculto. No toca el producto de la caja. */
CREATE OR ALTER PROCEDURE dbo.sp_menu_en_linea_producto_guardar
    @product_id INT,
    @descripcion NVARCHAR(300) = NULL,
    @etiquetas NVARCHAR(100) = NULL,
    @destacado BIT = 0,
    @oculto BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
    BEGIN RAISERROR('El producto no existe.', 16, 1); RETURN; END

    SET @etiquetas = NULLIF(UPPER(REPLACE(LTRIM(RTRIM(ISNULL(@etiquetas, ''))), ' ', '')), '');
    IF EXISTS (SELECT 1 FROM STRING_SPLIT(ISNULL(@etiquetas, ''), ',')
                WHERE value <> '' AND value NOT IN ('NUEVO', 'RECOMENDADO', 'PICANTE', 'VEGETARIANO'))
    BEGIN RAISERROR('Etiqueta no válida.', 16, 1); RETURN; END

    MERGE dbo.menu_en_linea_productos AS d
    USING (SELECT @product_id AS product_id) AS s ON d.product_id = s.product_id
    WHEN MATCHED THEN UPDATE SET descripcion = NULLIF(LTRIM(RTRIM(@descripcion)), ''), etiquetas = @etiquetas,
                                 destacado = ISNULL(@destacado, 0), oculto = ISNULL(@oculto, 0), actualizado_en = SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT (product_id, descripcion, etiquetas, destacado, oculto)
                          VALUES (@product_id, NULLIF(LTRIM(RTRIM(@descripcion)), ''), @etiquetas, ISNULL(@destacado, 0), ISNULL(@oculto, 0));

    SELECT product_id, descripcion, etiquetas, destacado, oculto FROM dbo.menu_en_linea_productos WHERE product_id = @product_id;
END
GO
