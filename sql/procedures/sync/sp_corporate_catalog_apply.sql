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
