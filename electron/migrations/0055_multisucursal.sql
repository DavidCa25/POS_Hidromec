/* ============================================================
   0055 — multisucursal

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0055_multisucursal.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0055_multisucursal.sql ========== */
/* ============================================================
   0055 — MultiSucursal (esquema)

   products.corporate      1 = lo administra la matriz (llegó en el catálogo
                           corporativo). En la sucursal, nombre, código,
                           categoría e impuestos no se editan; el precio solo
                           si la empresa lo permite. Inventario y costo siguen
                           siendo de la sucursal.
   products.corporate_price / corporate_sellable
                           lo que dijo la matriz (precio y si se vende).
   products.corporate_override / corporate_available
                           la excepción de ESTA sucursal (precio especial,
                           «no se vende aquí»). Con las cuatro se recalcula el
                           precio efectivo sin perder nada cuando cambia solo
                           el catálogo o solo las excepciones.
   users.corporate         1 = usuario de empresa recibido de la matriz.
   users.corporate_scope   EN LA MATRIZ: a qué sucursales viaja este usuario.
                           NULL = solo aquí; ["*"] = todas; o los ids de
                           sucursal de la nube.
   stock_transfers.kind    + BRANCH_OUT / BRANCH_IN: traspasos entre sucursales
                           (event_location_uuid guarda la otra sucursal).

   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF COL_LENGTH('dbo.products', 'corporate') IS NULL
    ALTER TABLE dbo.products ADD corporate BIT NOT NULL CONSTRAINT DF_products_corporate DEFAULT ((0));
IF COL_LENGTH('dbo.products', 'corporate_price') IS NULL
    ALTER TABLE dbo.products ADD corporate_price DECIMAL(10, 2) NULL, corporate_sellable BIT NULL,
                                 corporate_override DECIMAL(10, 2) NULL, corporate_available BIT NULL;
IF COL_LENGTH('dbo.users', 'corporate') IS NULL
    ALTER TABLE dbo.users ADD corporate BIT NOT NULL CONSTRAINT DF_users_corporate DEFAULT ((0));
IF COL_LENGTH('dbo.users', 'corporate_scope') IS NULL
    ALTER TABLE dbo.users ADD corporate_scope NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NULL;
GO

IF OBJECT_ID(N'dbo.CK_users_corporate_scope', 'C') IS NULL
    ALTER TABLE dbo.users WITH CHECK ADD CONSTRAINT CK_users_corporate_scope CHECK (corporate_scope IS NULL OR ISJSON(corporate_scope) = 1);

IF OBJECT_ID(N'dbo.CK_stock_transfers_kind', 'C') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_stock_transfers_kind' AND definition LIKE N'%BRANCH_OUT%')
    ALTER TABLE dbo.stock_transfers DROP CONSTRAINT CK_stock_transfers_kind;
IF OBJECT_ID(N'dbo.CK_stock_transfers_kind', 'C') IS NULL
    ALTER TABLE dbo.stock_transfers WITH CHECK ADD CONSTRAINT CK_stock_transfers_kind
        CHECK ([kind] = 'RETURN_IN' OR [kind] = 'OUT' OR [kind] = 'BRANCH_OUT' OR [kind] = 'BRANCH_IN');
GO

/* ---------- sp_branch_transfer_receive (SQL_STORED_PROCEDURE) ---------- */
/* sp_branch_transfer_receive
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_branch_transfer_receive ======================
   0055 · MultiSucursal. ESTA sucursal recibe lo que otra le mando.

   Entra lo que REALMENTE llego (qty), no lo que decia el envio (qty_sent):
   la diferencia se ve en el traspaso de los dos lados. Es una ENTRADA
   (entrada / BRANCH_IN) y queda como traspaso BRANCH_IN ya recibido.

   @lines  [{"product_uuid","nombre","qty_sent","qty"}]
   El mismo @transfer_uuid dos veces = una sola entrada (reintento seguro).
   Un producto que esta sucursal no tiene detiene todo: primero hay que
   recibir el catalogo de la matriz.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_branch_transfer_receive
    @transfer_uuid      UNIQUEIDENTIFIER,
    @user_id            INT,
    @from_location_uuid UNIQUEIDENTIFIER,
    @from_name          NVARCHAR(120),
    @lines              NVARCHAR(MAX),
    @note               NVARCHAR(255) = NULL,
    @machine_name       NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @errmsg NVARCHAR(1000);

    IF EXISTS (SELECT 1 FROM dbo.stock_transfers WHERE uuid = @transfer_uuid)
    BEGIN
        SELECT t.uuid AS transfer_uuid, t.status, t.kind, CAST(1 AS BIT) AS ya_existia FROM dbo.stock_transfers t WHERE t.uuid = @transfer_uuid;
        RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Falta quién recibe la mercancía.', 16, 1); RETURN; END
    IF ISJSON(@lines) = 0 OR (SELECT COUNT(*) FROM OPENJSON(@lines)) = 0
    BEGIN RAISERROR('El traspaso no tiene productos.', 16, 1); RETURN; END

    /* Tabla declarada y no SELECT INTO: con el LEFT JOIN, SELECT INTO hereda
       products.id como NOT NULL y un producto que no existe aqui revienta
       antes de poder decir cual es. */
    CREATE TABLE #l (product_uuid UNIQUEIDENTIFIER NULL, nombre NVARCHAR(100) NULL, qty_sent DECIMAL(12, 2) NULL,
                     qty DECIMAL(12, 2) NULL, product_id INT NULL);
    INSERT INTO #l (product_uuid, nombre, qty_sent, qty, product_id)
    SELECT j.product_uuid, j.nombre, j.qty_sent, j.qty, p.id
      FROM OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid', nombre NVARCHAR(100) '$.nombre',
             qty_sent DECIMAL(12, 2) '$.qty_sent', qty DECIMAL(12, 2) '$.qty') j
      LEFT JOIN dbo.products p ON p.uuid = j.product_uuid;

    IF EXISTS (SELECT 1 FROM #l WHERE product_id IS NULL)
    BEGIN
        SELECT @errmsg = CONCAT('Esta sucursal todavía no tiene: ', STRING_AGG(ISNULL(nombre, CONVERT(NVARCHAR(36), product_uuid)), ', '),
                                '. Recibe primero el catálogo de la matriz.')
          FROM #l WHERE product_id IS NULL;
        RAISERROR(@errmsg, 16, 1); RETURN;
    END
    IF EXISTS (SELECT 1 FROM #l WHERE ISNULL(qty, -1) < 0 OR ISNULL(qty_sent, 0) < 0)
    BEGIN RAISERROR('Una cantidad recibida no es válida.', 16, 1); RETURN; END

    DECLARE @id INT;
    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO dbo.stock_transfers (uuid, kind, status, event_location_uuid, event_name, note, created_by, created_machine_name, received_by, received_at)
        VALUES (@transfer_uuid, 'BRANCH_IN', 'RECEIVED', @from_location_uuid, LEFT(@from_name, 120), @note, @user_id, @machine_name, @user_id, SYSDATETIME());
        SET @id = SCOPE_IDENTITY();

        INSERT INTO dbo.stock_transfer_lines (transfer_id, product_id, qty_sent, qty_received)
        SELECT @id, product_id, SUM(ISNULL(qty_sent, qty)), SUM(qty) FROM #l GROUP BY product_id;

        UPDATE p SET p.stock = p.stock + l.qty
          FROM dbo.products p JOIN (SELECT product_id, SUM(qty) AS qty FROM #l GROUP BY product_id) l ON l.product_id = p.id;

        INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        SELECT l.product_id, 'entrada', CONVERT(NVARCHAR(36), @transfer_uuid), l.qty, GETDATE(),
               LEFT(CONCAT(N'Traspaso de sucursal: ', @from_name), 255), 'BRANCH_IN', p.cost
          FROM (SELECT product_id, SUM(qty) AS qty FROM #l GROUP BY product_id) l JOIN dbo.products p ON p.id = l.product_id
         WHERE l.qty > 0;

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        SET @errmsg = ERROR_MESSAGE();
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END CATCH

    SELECT t.uuid AS transfer_uuid, t.status, t.kind, CAST(0 AS BIT) AS ya_existia FROM dbo.stock_transfers t WHERE t.id = @id;
END
GO

/* ---------- sp_branch_transfer_send (SQL_STORED_PROCEDURE) ---------- */
/* sp_branch_transfer_send
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_branch_transfer_send ======================
   0055 · MultiSucursal. ESTA sucursal manda mercancia a otra de la empresa.

   Es una SALIDA: baja la existencia aqui, en la misma transaccion, con su
   movimiento (salida / BRANCH_OUT). La entrada la registra la otra sucursal
   al recibir, con lo que realmente llego.

   @to_location_uuid  la sucursal destino en la nube.
   @lines   [{"product_uuid": "...", "qty": 12}]  por uuid: es lo que comparten
            las sucursales gracias al catalogo corporativo.
   @transfer_uuid  reintento = el mismo envio, sin volver a descontar.

   No deja la existencia en negativo: lo que no esta no puede salir.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_branch_transfer_send
    @user_id          INT,
    @to_location_uuid UNIQUEIDENTIFIER,
    @to_name          NVARCHAR(120),
    @lines            NVARCHAR(MAX),
    @note             NVARCHAR(255) = NULL,
    @machine_name     NVARCHAR(120) = NULL,
    @transfer_uuid    UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @errmsg NVARCHAR(400);

    IF @transfer_uuid IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.stock_transfers WHERE uuid = @transfer_uuid)
    BEGIN
        SELECT t.uuid AS transfer_uuid, t.status, t.kind, CAST(1 AS BIT) AS ya_existia FROM dbo.stock_transfers t WHERE t.uuid = @transfer_uuid;
        SELECT LOWER(CONVERT(VARCHAR(36), p.uuid)) AS product_uuid, p.nombre, l.qty_sent AS qty
          FROM dbo.stock_transfer_lines l JOIN dbo.stock_transfers t ON t.id = l.transfer_id JOIN dbo.products p ON p.id = l.product_id
         WHERE t.uuid = @transfer_uuid ORDER BY l.id;
        RETURN;
    END

    IF @to_location_uuid IS NULL
    BEGIN RAISERROR('Elige la sucursal a la que se manda la mercancía.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Falta quién envía la mercancía.', 16, 1); RETURN; END
    IF ISJSON(@lines) = 0 OR (SELECT COUNT(*) FROM OPENJSON(@lines)) = 0
    BEGIN RAISERROR('El traspaso no tiene productos.', 16, 1); RETURN; END

    CREATE TABLE #l (product_id INT NOT NULL PRIMARY KEY, qty DECIMAL(12, 2) NOT NULL);
    INSERT INTO #l (product_id, qty)
    SELECT p.id, SUM(j.qty)
      FROM OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid', qty DECIMAL(12, 2) '$.qty') j
      JOIN dbo.products p ON p.uuid = j.product_uuid
     GROUP BY p.id;

    IF (SELECT COUNT(DISTINCT j.product_uuid) FROM OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid') j) <> (SELECT COUNT(*) FROM #l)
    BEGIN RAISERROR('Un producto del traspaso no existe en esta sucursal.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM #l WHERE qty <= 0)
    BEGIN RAISERROR('Cada cantidad a enviar debe ser mayor a cero.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM #l l JOIN dbo.products p ON p.id = l.product_id WHERE p.inventory_mode <> 'DIRECT')
    BEGIN RAISERROR('Solo se traspasa mercancía con existencia propia (no recetas ni productos de menú).', 16, 1); RETURN; END

    DECLARE @id INT, @uuid UNIQUEIDENTIFIER = ISNULL(@transfer_uuid, NEWID());

    BEGIN TRY
        BEGIN TRAN;

        DECLARE @pid INT = NULL, @stk DECIMAL(12, 2), @rq DECIMAL(12, 2), @pname NVARCHAR(100);
        SELECT TOP 1 @pid = p.id, @stk = p.stock, @rq = l.qty, @pname = p.nombre
          FROM #l l INNER LOOP JOIN dbo.products p WITH (UPDLOCK, HOLDLOCK) ON p.id = l.product_id
         WHERE p.stock < l.qty
         ORDER BY p.id
         OPTION (FORCE ORDER);
        IF @pid IS NOT NULL
        BEGIN
            SET @errmsg = CONCAT('No hay existencia suficiente de "', @pname, '": hay ', CONVERT(NVARCHAR(30), @stk),
                                 ' y se quieren enviar ', CONVERT(NVARCHAR(30), @rq), '.');
            RAISERROR(@errmsg, 16, 1);
        END

        INSERT INTO dbo.stock_transfers (uuid, kind, status, event_location_uuid, event_name, note, created_by, created_machine_name)
        VALUES (@uuid, 'BRANCH_OUT', 'SENT', @to_location_uuid, LEFT(@to_name, 120), @note, @user_id, @machine_name);
        SET @id = SCOPE_IDENTITY();

        INSERT INTO dbo.stock_transfer_lines (transfer_id, product_id, qty_sent) SELECT @id, product_id, qty FROM #l;

        UPDATE p SET p.stock = p.stock - l.qty FROM dbo.products p JOIN #l l ON l.product_id = p.id;

        INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        SELECT l.product_id, 'salida', CONVERT(NVARCHAR(36), @uuid), l.qty, GETDATE(),
               LEFT(CONCAT(N'Traspaso a sucursal: ', @to_name), 255), 'BRANCH_OUT', p.cost
          FROM #l l JOIN dbo.products p ON p.id = l.product_id;

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        SET @errmsg = ERROR_MESSAGE();
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END CATCH

    SELECT t.uuid AS transfer_uuid, t.status, t.kind, CAST(0 AS BIT) AS ya_existia FROM dbo.stock_transfers t WHERE t.id = @id;
    SELECT LOWER(CONVERT(VARCHAR(36), p.uuid)) AS product_uuid, p.nombre, l.qty_sent AS qty
      FROM dbo.stock_transfer_lines l JOIN dbo.products p ON p.id = l.product_id
     WHERE l.transfer_id = @id ORDER BY l.id;
END
GO

/* ---------- sp_branch_transfer_settle (SQL_STORED_PROCEDURE) ---------- */
/* sp_branch_transfer_settle
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_branch_transfer_settle ======================
   0055 · MultiSucursal. El ENVIO de esta sucursal se cierra con lo que dice
   la nube:

     RECEIVED   la otra sucursal lo recibio: se anota cuanto llego de cada
                producto. La existencia de aqui ya habia bajado al enviar.
     CANCELLED  se cancelo antes de recibirse: la mercancia vuelve a esta
                sucursal (entrada / BRANCH_CANCEL).

   Idempotente: un traspaso ya cerrado no se vuelve a tocar.
   @received_lines  [{"product_uuid","qty"}]
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_branch_transfer_settle
    @transfer_uuid  UNIQUEIDENTIFIER,
    @status         VARCHAR(12),
    @received_lines NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @id INT, @actual VARCHAR(12), @nombre NVARCHAR(120);

    SELECT @id = id, @actual = status, @nombre = event_name
      FROM dbo.stock_transfers WHERE uuid = @transfer_uuid AND kind = 'BRANCH_OUT';
    IF @id IS NULL BEGIN RAISERROR('No existe ese traspaso enviado.', 16, 1); RETURN; END
    IF @status NOT IN ('RECEIVED', 'CANCELLED') BEGIN RAISERROR('Estado de traspaso no válido.', 16, 1); RETURN; END
    IF @actual <> 'SENT'
    BEGIN
        SELECT @transfer_uuid AS transfer_uuid, @actual AS status, CAST(1 AS BIT) AS ya_estaba;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;
        IF @status = 'RECEIVED'
        BEGIN
            UPDATE l SET l.qty_received = r.qty
              FROM dbo.stock_transfer_lines l JOIN dbo.products p ON p.id = l.product_id
              JOIN (SELECT product_uuid, SUM(qty) AS qty FROM OPENJSON(ISNULL(@received_lines, '[]'))
                      WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid', qty DECIMAL(12, 2) '$.qty') GROUP BY product_uuid) r
                ON r.product_uuid = p.uuid
             WHERE l.transfer_id = @id;
            /* Lo que no aparece en lo recibido no llego. */
            UPDATE dbo.stock_transfer_lines SET qty_received = 0 WHERE transfer_id = @id AND qty_received IS NULL;
            UPDATE dbo.stock_transfers SET status = 'RECEIVED', received_at = SYSDATETIME() WHERE id = @id;
        END
        ELSE
        BEGIN
            UPDATE p SET p.stock = p.stock + l.qty_sent
              FROM dbo.products p JOIN dbo.stock_transfer_lines l ON l.product_id = p.id WHERE l.transfer_id = @id;
            INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
            SELECT l.product_id, 'entrada', CONVERT(NVARCHAR(36), @transfer_uuid), l.qty_sent, GETDATE(),
                   LEFT(CONCAT(N'Traspaso cancelado: ', @nombre), 255), 'BRANCH_CANCEL', p.cost
              FROM dbo.stock_transfer_lines l JOIN dbo.products p ON p.id = l.product_id WHERE l.transfer_id = @id;
            UPDATE dbo.stock_transfers SET status = 'CANCELLED', cancelled_at = SYSDATETIME() WHERE id = @id;
        END
        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        DECLARE @e NVARCHAR(2048) = ERROR_MESSAGE();
        RAISERROR(@e, 16, 1);
        RETURN;
    END CATCH

    SELECT @transfer_uuid AS transfer_uuid, @status AS status, CAST(0 AS BIT) AS ya_estaba;
END
GO

/* ---------- sp_corporate_catalog_apply (SQL_STORED_PROCEDURE) ---------- */
/* sp_corporate_catalog_apply
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_corporate_catalog_apply ======================
   0055 · MultiSucursal. La SUCURSAL aplica lo que publico la matriz.

   @catalog    el JSON de sp_corporate_catalog_export (NULL = no hay version
               nueva, solo cambiaron las excepciones o las reglas).
   @overrides  [{product_uuid, price, available}] de ESTA sucursal (NULL = no
               cambiaron; [] = ya no hay ninguna).
   @reglas     {"precios_sucursal": bool, "productos_locales": bool}
   @location_id  esta sucursal en la nube: decide que usuarios de empresa
               le tocan.

   QUE ES DE QUIEN
     De la matriz: nombre, codigo, categoria, marca, impuestos, tipo de
     inventario, si se vende, recetas, modificadores, politica comercial y
     usuarios de empresa.
     De la sucursal: existencia, costo, ventas, cortes y sus productos propios
     (corporate = 0), que no se tocan.

   EMPAREJAR
     Por uuid; si no, por codigo (se adopta el uuid de la matriz: una base que
     empezo como copia de la matriz, o un catalogo capturado igual, no
     duplica productos). Lo que la matriz ya no publica se DESACTIVA, no se
     borra: tiene ventas e inventario.

   PRECIO EFECTIVO = excepcion de la sucursal, o el de la matriz. Si la
   empresa permite precios por sucursal y el precio local ya era distinto del
   que se esperaba, se respeta.

   Todo en UNA transaccion: o se aplica la version entera o nada.
   ======================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_corporate_catalog_apply
    @catalog            NVARCHAR(MAX) = NULL,
    @overrides          NVARCHAR(MAX) = NULL,
    @reglas             NVARCHAR(MAX) = NULL,
    @location_id        NVARCHAR(36)  = NULL,
    @version            INT           = NULL,
    @overrides_revision INT           = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @catalog IS NOT NULL AND (ISJSON(@catalog) = 0 OR JSON_QUERY(@catalog, '$.products') IS NULL)
    BEGIN RAISERROR('El catálogo corporativo llegó incompleto.', 16, 1); RETURN; END
    IF @overrides IS NOT NULL AND ISJSON(@overrides) = 0
    BEGIN RAISERROR('Las excepciones de la sucursal llegaron incompletas.', 16, 1); RETURN; END

    DECLARE @precios_sucursal BIT = ISNULL(TRY_CONVERT(BIT, JSON_VALUE(@reglas, '$.precios_sucursal')), 0);
    DECLARE @nuevos INT = 0, @actualizados INT = 0, @desactivados INT = 0, @usuarios INT = 0, @conflictos NVARCHAR(MAX) = N'';

    /* El precio que se ESPERABA antes de este cambio: con el se sabe si la
       sucursal lo cambio a mano. */
    SELECT id, ISNULL(corporate_override, corporate_price) AS esperado, price
      INTO #antes FROM dbo.products WHERE corporate = 1;

    BEGIN TRY
        BEGIN TRAN;

        IF @catalog IS NOT NULL
        BEGIN
            /* ------------------------------------------------ categorias */
            SELECT uuid, LEFT(nombre, 100) AS nombre INTO #cat
              FROM OPENJSON(@catalog, '$.categories') WITH (uuid UNIQUEIDENTIFIER '$.uuid', nombre NVARCHAR(200) '$.nombre')
             WHERE uuid IS NOT NULL AND NULLIF(LTRIM(nombre), N'') IS NOT NULL;

            UPDATE c SET c.uuid = j.uuid
              FROM dbo.CAT_categories c JOIN #cat j ON j.nombre = c.namee
             WHERE c.uuid <> j.uuid AND NOT EXISTS (SELECT 1 FROM dbo.CAT_categories x WHERE x.uuid = j.uuid);
            UPDATE c SET c.namee = j.nombre
              FROM dbo.CAT_categories c JOIN #cat j ON j.uuid = c.uuid
             WHERE c.namee <> j.nombre AND NOT EXISTS (SELECT 1 FROM dbo.CAT_categories x WHERE x.namee = j.nombre AND x.id <> c.id);
            INSERT INTO dbo.CAT_categories (namee, uuid)
            SELECT j.nombre, j.uuid FROM #cat j
             WHERE NOT EXISTS (SELECT 1 FROM dbo.CAT_categories c WHERE c.uuid = j.uuid OR c.namee = j.nombre);

            /* ---------------------------------------------------- marcas */
            INSERT INTO dbo.CAT_brands (namee)
            SELECT DISTINCT LEFT(j.brand, 100)
              FROM OPENJSON(@catalog, '$.products') WITH (brand NVARCHAR(200) '$.brand') j
             WHERE NULLIF(LTRIM(j.brand), N'') IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM dbo.CAT_brands b WHERE b.namee = LEFT(j.brand, 100));

            /* ------------------------------------------------- productos */
            SELECT j.*, c.id AS category_id, b.id AS brand_id
              INTO #p
              FROM OPENJSON(@catalog, '$.products') WITH (
                     uuid UNIQUEIDENTIFIER '$.uuid', part_number NVARCHAR(100) '$.part_number', nombre NVARCHAR(100) '$.nombre',
                     price DECIMAL(10, 2) '$.price', bar_code NVARCHAR(50) '$.bar_code', category_uuid UNIQUEIDENTIFIER '$.category_uuid',
                     brand NVARCHAR(100) '$.brand', clave_prod_serv NVARCHAR(8) '$.clave_prod_serv', clave_unidad NVARCHAR(5) '$.clave_unidad',
                     objeto_impuesto NVARCHAR(2) '$.objeto_impuesto', tasa_iva DECIMAL(5, 4) '$.tasa_iva', inventory_mode NVARCHAR(10) '$.inventory_mode',
                     sellable BIT '$.sellable', base_uom NVARCHAR(10) '$.base_uom', allow_decimal_qty BIT '$.allow_decimal_qty', active BIT '$.active') j
              LEFT JOIN dbo.CAT_categories c ON c.uuid = j.category_uuid
              LEFT JOIN dbo.CAT_brands b ON b.namee = j.brand
             WHERE j.uuid IS NOT NULL AND NULLIF(LTRIM(j.part_number), N'') IS NOT NULL AND NULLIF(LTRIM(j.nombre), N'') IS NOT NULL;

            /* Las unidades son las del sistema y todas las bases traen las
               mismas. Una que esta base no conozca (una version vieja) cae en
               pieza en vez de romper la llave foranea y toda la version. */
            UPDATE #p SET base_uom = 'pza' WHERE base_uom IS NOT NULL AND base_uom NOT IN (SELECT code FROM dbo.uoms);

            /* Mismo codigo, otro uuid: es el mismo producto. Se adopta el de la matriz. */
            UPDATE x SET x.uuid = j.uuid
              FROM dbo.products x JOIN #p j ON j.part_number = x.part_number
             WHERE x.uuid <> j.uuid AND NOT EXISTS (SELECT 1 FROM dbo.products y WHERE y.uuid = j.uuid);

            /* Un producto PROPIO de la sucursal ocupa el codigo que la matriz
               le da a otro: el propio se renombra, el corporativo manda. */
            UPDATE x SET x.part_number = LEFT(CONCAT(x.part_number, N'-LOCAL-', x.id), 100)
              FROM dbo.products x JOIN #p j ON j.part_number = x.part_number
             WHERE x.uuid <> j.uuid AND x.corporate = 0;
            DECLARE @renombrados INT = @@ROWCOUNT;
            IF @renombrados > 0
                SET @conflictos = CONCAT(@conflictos, @renombrados, N' producto(s) propio(s) renombrado(s) por usar un código de la matriz. ');

            UPDATE x SET x.part_number = j.part_number, x.nombre = j.nombre, x.bar_code = j.bar_code,
                         x.category_id = j.category_id, x.brand_id = j.brand_id,
                         x.clave_prod_serv = j.clave_prod_serv, x.clave_unidad = j.clave_unidad,
                         x.objeto_impuesto = ISNULL(j.objeto_impuesto, x.objeto_impuesto), x.tasa_iva = ISNULL(j.tasa_iva, x.tasa_iva),
                         x.inventory_mode = ISNULL(j.inventory_mode, x.inventory_mode), x.base_uom = ISNULL(j.base_uom, x.base_uom),
                         x.allow_decimal_qty = ISNULL(j.allow_decimal_qty, x.allow_decimal_qty), x.active = ISNULL(j.active, 1),
                         x.corporate = 1, x.corporate_price = ISNULL(j.price, 0), x.corporate_sellable = ISNULL(j.sellable, 1)
              FROM dbo.products x JOIN #p j ON j.uuid = x.uuid;
            SET @actualizados = @@ROWCOUNT;

            INSERT INTO dbo.products (part_number, nombre, price, stock, active, category_id, brand_id, cost, bar_code,
                                      clave_prod_serv, clave_unidad, objeto_impuesto, tasa_iva, inventory_mode, sellable,
                                      base_uom, allow_decimal_qty, uuid, corporate, corporate_price, corporate_sellable)
            SELECT j.part_number, j.nombre, ISNULL(j.price, 0), 0, ISNULL(j.active, 1), j.category_id, j.brand_id, NULL, j.bar_code,
                   j.clave_prod_serv, j.clave_unidad, ISNULL(j.objeto_impuesto, '02'), ISNULL(j.tasa_iva, 0.16), ISNULL(j.inventory_mode, 'DIRECT'),
                   ISNULL(j.sellable, 1), ISNULL(j.base_uom, 'pza'), ISNULL(j.allow_decimal_qty, 0), j.uuid, 1, ISNULL(j.price, 0), ISNULL(j.sellable, 1)
              FROM #p j WHERE NOT EXISTS (SELECT 1 FROM dbo.products x WHERE x.uuid = j.uuid);
            SET @nuevos = @@ROWCOUNT;

            UPDATE dbo.products SET active = 0
             WHERE corporate = 1 AND ISNULL(active, 1) = 1 AND uuid NOT IN (SELECT uuid FROM #p);
            SET @desactivados = @@ROWCOUNT;

            /* --------------------------------------------- modificadores */
            SELECT g.uuid, g.name, g.role, g.min_select, g.max_select, g.required, g.active, g.sort_order, g.options
              INTO #g
              FROM OPENJSON(@catalog, '$.modifier_groups') WITH (
                     uuid UNIQUEIDENTIFIER '$.uuid', name NVARCHAR(80) '$.name', role NVARCHAR(15) '$.role', min_select INT '$.min_select',
                     max_select INT '$.max_select', required BIT '$.required', active BIT '$.active', sort_order INT '$.sort_order',
                     options NVARCHAR(MAX) '$.options' AS JSON) g
             WHERE g.uuid IS NOT NULL;

            UPDATE x SET x.name = g.name, x.role = g.role, x.min_select = g.min_select, x.max_select = g.max_select,
                         x.required = g.required, x.active = g.active, x.sort_order = ISNULL(g.sort_order, 0)
              FROM dbo.modifier_groups x JOIN #g g ON g.uuid = x.uuid;
            INSERT INTO dbo.modifier_groups (name, role, min_select, max_select, required, active, sort_order, uuid)
            SELECT g.name, g.role, g.min_select, g.max_select, g.required, g.active, ISNULL(g.sort_order, 0), g.uuid
              FROM #g g WHERE NOT EXISTS (SELECT 1 FROM dbo.modifier_groups x WHERE x.uuid = g.uuid);

            SELECT o.*, gr.id AS group_id, ing.id AS ingredient_id, rep.id AS replaces_id
              INTO #o
              FROM #g g
             CROSS APPLY OPENJSON(g.options) WITH (
                     uuid UNIQUEIDENTIFIER '$.uuid', name NVARCHAR(80) '$.name', price_delta DECIMAL(10, 2) '$.price_delta',
                     effect NVARCHAR(12) '$.effect', ingredient_uuid UNIQUEIDENTIFIER '$.ingredient_uuid', replaces_uuid UNIQUEIDENTIFIER '$.replaces_uuid',
                     qty_base DECIMAL(14, 4) '$.qty_base', qty_factor DECIMAL(8, 4) '$.qty_factor', active BIT '$.active', sort_order INT '$.sort_order') o
              JOIN dbo.modifier_groups gr ON gr.uuid = g.uuid
              LEFT JOIN dbo.products ing ON ing.uuid = o.ingredient_uuid
              LEFT JOIN dbo.products rep ON rep.uuid = o.replaces_uuid
             WHERE o.uuid IS NOT NULL;

            UPDATE x SET x.group_id = o.group_id, x.name = o.name, x.price_delta = ISNULL(o.price_delta, 0), x.effect = ISNULL(o.effect, 'NONE'),
                         x.ingredient_product_id = o.ingredient_id, x.replaces_product_id = o.replaces_id,
                         x.qty_base = o.qty_base, x.qty_factor = o.qty_factor, x.active = ISNULL(o.active, 1), x.sort_order = ISNULL(o.sort_order, 0)
              FROM dbo.modifier_options x JOIN #o o ON o.uuid = x.uuid;
            INSERT INTO dbo.modifier_options (group_id, name, price_delta, effect, ingredient_product_id, replaces_product_id, qty_base, qty_factor, active, sort_order, uuid)
            SELECT o.group_id, o.name, ISNULL(o.price_delta, 0), ISNULL(o.effect, 'NONE'), o.ingredient_id, o.replaces_id,
                   o.qty_base, o.qty_factor, ISNULL(o.active, 1), ISNULL(o.sort_order, 0), o.uuid
              FROM #o o WHERE NOT EXISTS (SELECT 1 FROM dbo.modifier_options x WHERE x.uuid = o.uuid);

            /* Que grupos lleva cada producto corporativo: los de la matriz. */
            DELETE pmg FROM dbo.product_modifier_groups pmg JOIN dbo.products p ON p.id = pmg.product_id JOIN #p j ON j.uuid = p.uuid;
            INSERT INTO dbo.product_modifier_groups (product_id, group_id, sort_order)
            SELECT p.id, g.id, ISNULL(MIN(j.sort_order), 0)
              FROM OPENJSON(@catalog, '$.product_modifier_groups') WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid',
                     group_uuid UNIQUEIDENTIFIER '$.group_uuid', sort_order INT '$.sort_order') j
              JOIN dbo.products p ON p.uuid = j.product_uuid
              JOIN dbo.modifier_groups g ON g.uuid = j.group_uuid
             GROUP BY p.id, g.id;

            /* --------------------------------------------------- recetas */
            SELECT r.uuid, p.id AS product_id, vo.id AS variant_option_id, r.active, r.notes, r.lines
              INTO #r
              FROM OPENJSON(@catalog, '$.recipes') WITH (uuid UNIQUEIDENTIFIER '$.uuid', product_uuid UNIQUEIDENTIFIER '$.product_uuid',
                     variant_option_uuid UNIQUEIDENTIFIER '$.variant_option_uuid', active BIT '$.active', notes NVARCHAR(300) '$.notes',
                     lines NVARCHAR(MAX) '$.lines' AS JSON) r
              JOIN dbo.products p ON p.uuid = r.product_uuid
              LEFT JOIN dbo.modifier_options vo ON vo.uuid = r.variant_option_uuid
             WHERE r.uuid IS NOT NULL AND (r.variant_option_uuid IS NULL OR vo.id IS NOT NULL);

            /* Misma receta (producto + variante) con otro uuid: se adopta. */
            UPDATE x SET x.uuid = r.uuid
              FROM dbo.recipes x JOIN #r r ON r.product_id = x.product_id
                    AND ISNULL(r.variant_option_id, -1) = ISNULL(x.variant_option_id, -1)
             WHERE x.uuid <> r.uuid AND NOT EXISTS (SELECT 1 FROM dbo.recipes y WHERE y.uuid = r.uuid);
            UPDATE x SET x.product_id = r.product_id, x.variant_option_id = r.variant_option_id, x.active = ISNULL(r.active, 1),
                         x.notes = r.notes, x.updated_at = SYSDATETIME()
              FROM dbo.recipes x JOIN #r r ON r.uuid = x.uuid;
            INSERT INTO dbo.recipes (product_id, variant_option_id, active, notes, uuid)
            SELECT r.product_id, r.variant_option_id, ISNULL(r.active, 1), r.notes, r.uuid
              FROM #r r WHERE NOT EXISTS (SELECT 1 FROM dbo.recipes x WHERE x.uuid = r.uuid);

            DELETE rl FROM dbo.recipe_lines rl JOIN dbo.recipes x ON x.id = rl.recipe_id JOIN #r r ON r.uuid = x.uuid;
            INSERT INTO dbo.recipe_lines (recipe_id, ingredient_product_id, qty_base, input_qty, input_uom, waste_pct, sort_order)
            SELECT x.id, ip.id, l.qty_base, ISNULL(l.input_qty, l.qty_base), ISNULL(l.input_uom, ip.base_uom), ISNULL(l.waste_pct, 0), ISNULL(l.sort_order, 0)
              FROM #r r JOIN dbo.recipes x ON x.uuid = r.uuid
             CROSS APPLY OPENJSON(r.lines) WITH (ingredient_uuid UNIQUEIDENTIFIER '$.ingredient_uuid', qty_base DECIMAL(14, 4) '$.qty_base',
                     input_qty DECIMAL(12, 3) '$.input_qty', input_uom NVARCHAR(10) '$.input_uom', waste_pct DECIMAL(5, 2) '$.waste_pct',
                     sort_order INT '$.sort_order') l
              JOIN dbo.products ip ON ip.uuid = l.ingredient_uuid
             WHERE l.qty_base > 0;

            /* ------------------------------------------ politica comercial */
            DECLARE @commercial NVARCHAR(MAX) = JSON_QUERY(@catalog, '$.commercial');
            IF @commercial IS NOT NULL
            BEGIN
                IF EXISTS (SELECT 1 FROM dbo.commercial_policy WHERE id = 1)
                    UPDATE dbo.commercial_policy SET payload = @commercial, version = version + 1, updated_at = SYSUTCDATETIME()
                     WHERE id = 1 AND payload <> @commercial;
                ELSE
                    INSERT INTO dbo.commercial_policy (id, version, payload) VALUES (1, 1, @commercial);
            END

            /* --------------------------------------- usuarios de empresa */
            SELECT u.* INTO #u
              FROM OPENJSON(@catalog, '$.users') WITH (uuid UNIQUEIDENTIFIER '$.uuid', usuario NVARCHAR(50) '$.usuario', rol NVARCHAR(20) '$.rol',
                     password_hash NVARCHAR(255) '$.password_hash', active BIT '$.active', scope NVARCHAR(MAX) '$.scope' AS JSON,
                     pin_hash VARCHAR(128) '$.pin_hash', pin_sal VARCHAR(64) '$.pin_sal', pin_set_at DATETIME2(0) '$.pin_set_at') u
             WHERE u.uuid IS NOT NULL AND NULLIF(LTRIM(u.usuario), N'') IS NOT NULL AND u.password_hash IS NOT NULL
               AND EXISTS (SELECT 1 FROM OPENJSON(u.scope) s WHERE s.value = N'*' OR s.value = LOWER(@location_id));

            /* Mismo usuario escrito igual pero creado aqui: se respeta el de la
               sucursal y se avisa (no se le cambia la contrasena a nadie). */
            SELECT @conflictos = CONCAT(@conflictos, N'Usuario «', u.usuario, N'» ya existe en esta sucursal; no se reemplazó. ')
              FROM #u u JOIN dbo.users x ON x.usuario = u.usuario AND x.uuid <> u.uuid;

            UPDATE x SET x.usuario = u.usuario, x.password_hash = u.password_hash, x.rol = u.rol, x.active = ISNULL(u.active, 1), x.corporate = 1
              FROM dbo.users x JOIN #u u ON u.uuid = x.uuid
             WHERE NOT EXISTS (SELECT 1 FROM dbo.users y WHERE y.usuario = u.usuario AND y.uuid <> u.uuid);
            SET @usuarios = @@ROWCOUNT;
            INSERT INTO dbo.users (usuario, password_hash, rol, active, uuid, corporate)
            SELECT u.usuario, u.password_hash, u.rol, ISNULL(u.active, 1), u.uuid, 1
              FROM #u u WHERE NOT EXISTS (SELECT 1 FROM dbo.users x WHERE x.uuid = u.uuid OR x.usuario = u.usuario);
            SET @usuarios = @usuarios + @@ROWCOUNT;

            /* El PIN viaja con su usuario (el mismo scrypt en todas las cajas). */
            UPDATE a SET a.pin_hash = u.pin_hash, a.pin_sal = u.pin_sal, a.pin_creado_en = u.pin_set_at, a.pin_fallos = 0, a.revocado_en = NULL
              FROM dbo.trabajadores_acceso a JOIN dbo.users x ON x.id = a.user_id JOIN #u u ON u.uuid = x.uuid
             WHERE x.corporate = 1 AND u.pin_hash IS NOT NULL
               AND (a.pin_hash IS NULL OR a.pin_hash <> u.pin_hash OR a.revocado_en IS NOT NULL);
            INSERT INTO dbo.trabajadores_acceso (user_id, pin_hash, pin_sal, pin_creado_en)
            SELECT x.id, u.pin_hash, u.pin_sal, u.pin_set_at
              FROM #u u JOIN dbo.users x ON x.uuid = u.uuid
             WHERE x.corporate = 1 AND u.pin_hash IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM dbo.trabajadores_acceso a WHERE a.user_id = x.id);

            /* Quien dejo de ser usuario de empresa (o de esta sucursal) se desactiva. */
            UPDATE dbo.users SET active = 0
             WHERE corporate = 1 AND ISNULL(active, 1) = 1 AND uuid NOT IN (SELECT uuid FROM #u);
        END

        /* ---------------------------------------------------- excepciones */
        IF @overrides IS NOT NULL
        BEGIN
            UPDATE dbo.products SET corporate_override = NULL, corporate_available = NULL WHERE corporate = 1;
            UPDATE x SET x.corporate_override = o.price, x.corporate_available = o.available
              FROM dbo.products x
              JOIN OPENJSON(@overrides) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid', price DECIMAL(10, 2) '$.price', available BIT '$.available') o
                ON o.product_uuid = x.uuid
             WHERE x.corporate = 1;
        END

        /* ----------------------------------------------- precio efectivo */
        UPDATE x SET
            x.price = CASE
                WHEN @precios_sucursal = 1 AND a.id IS NOT NULL AND a.esperado IS NOT NULL AND a.price <> a.esperado THEN x.price
                ELSE ISNULL(x.corporate_override, ISNULL(x.corporate_price, x.price)) END,
            x.sellable = CASE WHEN ISNULL(x.corporate_available, 1) = 0 THEN 0 ELSE ISNULL(x.corporate_sellable, x.sellable) END
          FROM dbo.products x LEFT JOIN #antes a ON a.id = x.id
         WHERE x.corporate = 1;

        /* -------------------------------------------- donde va la sucursal */
        DECLARE @meta TABLE (clave NVARCHAR(64), valor NVARCHAR(255));
        INSERT INTO @meta VALUES
            (N'multi_location_id', LOWER(@location_id)),
            (N'multi_version', CONVERT(NVARCHAR(20), @version)),
            (N'multi_overrides_revision', CONVERT(NVARCHAR(20), @overrides_revision)),
            (N'multi_reglas', LEFT(@reglas, 255)),
            (N'multi_aplicado_en', CONVERT(NVARCHAR(30), SYSDATETIME(), 126));
        DELETE FROM @meta WHERE valor IS NULL;
        UPDATE d SET d.valor = m.valor, d.actualizado_en = SYSDATETIME()
          FROM dbo.database_metadata d JOIN @meta m ON m.clave = d.clave;
        INSERT INTO dbo.database_metadata (clave, valor)
        SELECT m.clave, m.valor FROM @meta m WHERE NOT EXISTS (SELECT 1 FROM dbo.database_metadata d WHERE d.clave = m.clave);

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        DECLARE @e NVARCHAR(2048) = ERROR_MESSAGE();
        RAISERROR(@e, 16, 1);
        RETURN;
    END CATCH

    SELECT @nuevos AS nuevos, @actualizados AS actualizados, @desactivados AS desactivados,
           @usuarios AS usuarios, NULLIF(LTRIM(RTRIM(@conflictos)), N'') AS avisos;
END
GO

/* ---------- sp_corporate_catalog_export (SQL_STORED_PROCEDURE) ---------- */
/* sp_corporate_catalog_export
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_corporate_catalog_export ======================
   0055 · MultiSucursal. El catalogo CORPORATIVO de la matriz, en un JSON:

     categories               uuid y nombre
     products                 TODOS (activos e inactivos: una baja en la matriz
                              es una baja en las sucursales). Sin existencia ni
                              costo de inventario: eso es de cada sucursal.
     modifier_groups          con sus opciones (ingredientes por uuid)
     product_modifier_groups  que grupos lleva cada producto
     recipes                  con sus lineas
     commercial               la politica comercial (canales, precios, ofertas)
     users                    los usuarios de empresa (corporate_scope no nulo),
                              con el hash de su contrasena y de su PIN

   Los numeros viajan como TEXTO (sin flotantes) y los UUID en minusculas,
   igual que sp_catalog_publication. La nube versiona por huella: si nada
   cambio, la version tampoco.
   ======================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_corporate_catalog_export
AS
BEGIN
    SET NOCOUNT ON;
    SELECT (
        SELECT
            1 AS [schema],
            JSON_QUERY((SELECT payload FROM dbo.commercial_policy WHERE id = 1)) AS commercial,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), c.uuid)) AS uuid, c.namee AS nombre
                  FROM dbo.CAT_categories c ORDER BY c.id
                   FOR JSON PATH), '[]')) AS categories,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), p.uuid)) AS uuid,
                       p.part_number, p.nombre,
                       CONVERT(VARCHAR(20), p.price) AS price,
                       p.bar_code,
                       LOWER(CONVERT(VARCHAR(36), c.uuid)) AS category_uuid,
                       b.namee AS brand,
                       p.clave_prod_serv, p.clave_unidad, p.objeto_impuesto,
                       CONVERT(VARCHAR(10), p.tasa_iva) AS tasa_iva,
                       p.inventory_mode,
                       CAST(p.sellable AS BIT) AS sellable,
                       p.base_uom,
                       CAST(p.allow_decimal_qty AS BIT) AS allow_decimal_qty,
                       CAST(ISNULL(p.active, 1) AS BIT) AS active
                  FROM dbo.products p
                  LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
                  LEFT JOIN dbo.CAT_brands b ON b.id = p.brand_id
                 ORDER BY p.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS products,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), g.uuid)) AS uuid, g.name, g.role, g.min_select, g.max_select,
                       CAST(g.required AS BIT) AS required, CAST(g.active AS BIT) AS active, g.sort_order,
                       JSON_QUERY(ISNULL((
                           SELECT LOWER(CONVERT(VARCHAR(36), o.uuid)) AS uuid, o.name,
                                  CONVERT(VARCHAR(20), o.price_delta) AS price_delta, o.effect,
                                  LOWER(CONVERT(VARCHAR(36), ing.uuid)) AS ingredient_uuid,
                                  LOWER(CONVERT(VARCHAR(36), rep.uuid)) AS replaces_uuid,
                                  CONVERT(VARCHAR(30), o.qty_base) AS qty_base,
                                  CONVERT(VARCHAR(20), o.qty_factor) AS qty_factor,
                                  CAST(o.active AS BIT) AS active, o.sort_order
                             FROM dbo.modifier_options o
                             LEFT JOIN dbo.products ing ON ing.id = o.ingredient_product_id
                             LEFT JOIN dbo.products rep ON rep.id = o.replaces_product_id
                            WHERE o.group_id = g.id
                            ORDER BY o.sort_order, o.id
                              FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS options
                  FROM dbo.modifier_groups g
                 ORDER BY g.sort_order, g.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS modifier_groups,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), p.uuid)) AS product_uuid,
                       LOWER(CONVERT(VARCHAR(36), g.uuid)) AS group_uuid, pmg.sort_order
                  FROM dbo.product_modifier_groups pmg
                  JOIN dbo.products p ON p.id = pmg.product_id
                  JOIN dbo.modifier_groups g ON g.id = pmg.group_id
                 ORDER BY p.id, pmg.sort_order, g.id
                   FOR JSON PATH), '[]')) AS product_modifier_groups,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), r.uuid)) AS uuid,
                       LOWER(CONVERT(VARCHAR(36), pr.uuid)) AS product_uuid,
                       LOWER(CONVERT(VARCHAR(36), vo.uuid)) AS variant_option_uuid,
                       CAST(r.active AS BIT) AS active, r.notes,
                       JSON_QUERY(ISNULL((
                           SELECT LOWER(CONVERT(VARCHAR(36), ip.uuid)) AS ingredient_uuid,
                                  CONVERT(VARCHAR(30), rl.qty_base) AS qty_base,
                                  CONVERT(VARCHAR(30), rl.input_qty) AS input_qty,
                                  rl.input_uom,
                                  CONVERT(VARCHAR(10), rl.waste_pct) AS waste_pct,
                                  rl.sort_order
                             FROM dbo.recipe_lines rl JOIN dbo.products ip ON ip.id = rl.ingredient_product_id
                            WHERE rl.recipe_id = r.id
                            ORDER BY rl.sort_order, rl.id
                              FOR JSON PATH), '[]')) AS lines
                  FROM dbo.recipes r
                  JOIN dbo.products pr ON pr.id = r.product_id
                  LEFT JOIN dbo.modifier_options vo ON vo.id = r.variant_option_id
                 ORDER BY r.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS recipes,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), u.uuid)) AS uuid, u.usuario, u.rol, u.password_hash,
                       CAST(ISNULL(u.active, 1) AS BIT) AS active,
                       JSON_QUERY(u.corporate_scope) AS scope,
                       a.pin_hash, a.pin_sal, CONVERT(VARCHAR(19), a.pin_creado_en, 126) AS pin_set_at
                  FROM dbo.users u
                  LEFT JOIN dbo.trabajadores_acceso a ON a.user_id = u.id AND a.revocado_en IS NULL
                 WHERE u.corporate_scope IS NOT NULL
                 ORDER BY u.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS users
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS catalog_json;
END
GO

/* ---------- sp_get_active_products (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_active_products
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<Daniela Luna>
-- Create date: <04/08/2025>
-- Description:	<Productos activos para venta, inventario y compras>
-- Update:      + inventory_mode, sellable, base_uom, allow_decimal_qty,
--                image_version, has_modifiers, cost, category_id (Core).
--              Devuelve TODOS los activos, ingredientes incluidos; las
--              pantallas de venta filtran sellable = 1.
-- Update:      + available_units y limita_* .
--
--              Un producto RECIPE tiene `stock` 0 por diseno: su existencia
--              son sus ingredientes. Las pantallas que leen de aqui -el
--              buscador de Retail, Inventario, Compras- pintaban ese 0 como
--              si fuera disponibilidad y mostraban "0 pz" en un producto que
--              si se podia preparar. El calculo es el mismo que usa
--              sp_get_menu_catalog para Touch, para que las dos experiencias
--              no puedan discrepar.
--
--              + default_presentation_*: en que se compra normalmente el
--              producto, para poder mostrarlo como columna sin una consulta
--              por fila.
-- =============================================

CREATE OR ALTER PROCEDURE [dbo].[sp_get_active_products]
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH receta_base AS (
        SELECT r.product_id, r.id AS recipe_id,
               ROW_NUMBER() OVER (PARTITION BY r.product_id
                                  ORDER BY CASE WHEN r.variant_option_id IS NULL THEN 0 ELSE 1 END, r.id) AS k
        FROM dbo.recipes r
        WHERE r.active = 1
    ),
    lineas AS (
        SELECT rb.product_id,
               i.nombre   AS ing_nombre,
               i.stock    AS ing_stock,
               i.base_uom AS ing_uom,
               rl.qty_base * (1 + rl.waste_pct / 100.0) AS ing_necesita,
               CASE WHEN rl.qty_base * (1 + rl.waste_pct / 100.0) <= 0 THEN 999999
                    ELSE FLOOR(i.stock / (rl.qty_base * (1 + rl.waste_pct / 100.0))) END AS units
        FROM receta_base rb
        JOIN dbo.recipe_lines rl ON rl.recipe_id = rb.recipe_id
        JOIN dbo.products i ON i.id = rl.ingredient_product_id
        WHERE rb.k = 1
    ),
    posibles AS (
        SELECT product_id, units, ing_nombre, ing_stock, ing_uom, ing_necesita
        FROM (
            SELECT l.*, ROW_NUMBER() OVER (PARTITION BY l.product_id
                                           ORDER BY l.units, l.ing_nombre) AS r
            FROM lineas l
        ) t
        WHERE t.r = 1
    )
    SELECT
        p.id,
        p.part_number,
        p.nombre AS product_name,
        p.price,
        p.stock,
        c.namee AS category_name,
        m.namee AS brand_name,
        p.bar_code AS bar_code,
        ds.supplier_name AS default_supplier_name,
        p.category_id,
        p.brand_id,
        p.cost,
        p.clave_prod_serv,
        p.clave_unidad,
        p.objeto_impuesto,
        p.tasa_iva,
        p.inventory_mode,
        p.sellable,
        p.base_uom,
        p.allow_decimal_qty,
        p.image_version,
        /* 0055: lo administra la matriz (MultiSucursal). */
        CAST(p.corporate AS BIT) AS corporate,
        CASE WHEN EXISTS (
            SELECT 1 FROM dbo.product_modifier_groups pmg
            JOIN dbo.modifier_groups g ON g.id = pmg.group_id AND g.active = 1
            WHERE pmg.product_id = p.id) THEN 1 ELSE 0 END AS has_modifiers,

        /* Cuantas unidades hay DE VERDAD, segun lo que el producto es. */
        CASE p.inventory_mode
            WHEN 'NONE'   THEN 999999
            WHEN 'DIRECT' THEN FLOOR(p.stock)
            ELSE ISNULL(po.units, 0)
        END AS available_units,

        /* Solo tiene sentido en una receta: quien limita y por cuanto. */
        CASE WHEN p.inventory_mode = 'RECIPE' THEN po.ing_nombre   END AS limita_nombre,
        CASE WHEN p.inventory_mode = 'RECIPE' THEN po.ing_stock    END AS limita_stock,
        CASE WHEN p.inventory_mode = 'RECIPE' THEN po.ing_uom      END AS limita_uom,
        CASE WHEN p.inventory_mode = 'RECIPE' THEN po.ing_necesita END AS limita_necesita,

        /* En que se compra normalmente: para la columna de Inventario. */
        dp.name           AS default_presentation_name,
        dp.factor_to_base AS default_presentation_factor
    FROM products p
    INNER JOIN CAT_categories c ON p.category_id = c.id
    INNER JOIN CAT_brands m ON p.brand_id = m.id
    LEFT JOIN posibles po ON po.product_id = p.id
    OUTER APPLY (
      SELECT TOP 1 s.nombre AS supplier_name
      FROM dbo.product_suppliers ps
      INNER JOIN dbo.CAT_suppliers s ON s.id = ps.supplier_id
      WHERE ps.product_id = p.id AND ps.active = 1 AND ps.is_default = 1
    ) ds
    OUTER APPLY (
      SELECT TOP 1 pp.name, pp.factor_to_base
      FROM dbo.product_presentations pp
      WHERE pp.product_id = p.id AND pp.active = 1
      ORDER BY pp.is_default DESC, pp.id ASC
    ) dp
    WHERE p.active = 1
    ORDER BY p.id ASC
END;
GO

/* ---------- sp_transfer_list (SQL_STORED_PROCEDURE) ---------- */
/* sp_transfer_list
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_transfer_list ======================
   0052. Transferencias con eventos: lo enviado, lo recibido y la diferencia.
   Primer resultset: encabezados (los mas recientes primero).
   Segundo resultset: lineas de esas transferencias.
   ============================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_transfer_list
    @event_location_uuid UNIQUEIDENTIFIER = NULL,
    @max_rows INT = 100,
    /* 0055: EVENT (lo de siempre: envios y retornos de ferias) o BRANCH
       (traspasos entre sucursales). Sin decirlo, eventos: la pantalla de
       eventos no debe ver los traspasos entre tiendas. */
    @scope VARCHAR(10) = 'EVENT'
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@max_rows) t.id, t.uuid AS transfer_uuid, t.kind, t.status, t.event_location_uuid, t.event_name, t.note,
           t.created_at, t.received_at, u.usuario AS created_by_name, t.created_machine_name,
           (SELECT SUM(l.qty_sent) FROM dbo.stock_transfer_lines l WHERE l.transfer_id = t.id) AS total_sent,
           (SELECT SUM(l.qty_received) FROM dbo.stock_transfer_lines l WHERE l.transfer_id = t.id) AS total_received
      INTO #t
      FROM dbo.stock_transfers t LEFT JOIN dbo.users u ON u.id = t.created_by
     WHERE (@event_location_uuid IS NULL OR t.event_location_uuid = @event_location_uuid)
       AND ((ISNULL(@scope, 'EVENT') = 'EVENT' AND t.kind IN ('OUT', 'RETURN_IN'))
         OR (@scope = 'BRANCH' AND t.kind IN ('BRANCH_OUT', 'BRANCH_IN')))
     ORDER BY t.created_at DESC, t.id DESC;

    SELECT transfer_uuid, kind, status, event_location_uuid, event_name, note, created_at, received_at,
           created_by_name, created_machine_name, total_sent, total_received,
           total_sent - ISNULL(total_received, total_sent) AS difference
      FROM #t ORDER BY created_at DESC, id DESC;

    SELECT t.transfer_uuid, p.uuid AS product_uuid, p.nombre AS product_name, l.qty_sent, l.qty_received
      FROM #t t JOIN dbo.stock_transfer_lines l ON l.transfer_id = t.id JOIN dbo.products p ON p.id = l.product_id
     ORDER BY t.id, l.id;
END
GO
