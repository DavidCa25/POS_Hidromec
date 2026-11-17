/* ============================================================
   0085 — impuestos ticket corte sucursales

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   NO toca tablas ni datos. Solo objetos programables.
   ============================================================ */

/* ---------- sp_cash_closure_ticket (SQL_STORED_PROCEDURE) ---------- */
/* sp_cash_closure_ticket
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_cash_closure_ticket @closure_id INT, @freeze BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @snapshot NVARCHAR(MAX);
 SELECT @snapshot=receipt_snapshot FROM dbo.cash_closures WHERE id=@closure_id;
 IF @snapshot IS NULL BEGIN
 SELECT @snapshot=(SELECT c.id,c.userId,c.opened_at,c.closed_at,c.opening_cash,c.cash_expected,c.cash_delivered,c.difference,c.cash_left,c.closing_note,r.name register_name,u.usuario cashier,
 ISNULL(v.total,0) total,ISNULL(v.tickets,0) tickets,ISNULL(v.discount,0) discount,
 (SELECT ISNULL(SUM(refund_total),0) FROM dbo.sale_refunds f WHERE f.closure_id=c.id) refunds,
 (SELECT ISNULL(SUM(CASE WHEN amount>0 AND typee NOT IN('OPENING','SALE') THEN amount ELSE 0 END),0) FROM dbo.cash_movements m WHERE m.closure_id=c.id) cash_in,
 (SELECT ISNULL(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END),0) FROM dbo.cash_movements m WHERE m.closure_id=c.id) cash_out,
 /* 0083: con la foto de IEPS y locales, el IVA es lo cobrado menos la base sin
    impuestos y menos esos otros impuestos (un impuesto local NO va en la base
    del IVA, así que dividir entre 1+tasa lo inflaba). Sin foto, como antes. */
 (SELECT SUM(CASE WHEN d.base_neta IS NOT NULL THEN d.subtotal-d.base_neta-ISNULL(d.otros_impuestos,0)
                  WHEN d.tax_object='02' THEN d.subtotal-d.subtotal/(1+d.tax_rate) ELSE 0 END) FROM dbo.sales s JOIN dbo.sale_detail d ON d.sale_id=s.id WHERE (s.closure_id=c.id OR (s.closure_id IS NULL AND s.register_id=c.register_id AND s.datee>=c.opened_at AND s.datee<=ISNULL(c.closed_at,SYSDATETIME()))) AND d.tax_rate IS NOT NULL) tax,
 (SELECT ISNULL(SUM(d.otros_impuestos),0) FROM dbo.sales s JOIN dbo.sale_detail d ON d.sale_id=s.id WHERE (s.closure_id=c.id OR (s.closure_id IS NULL AND s.register_id=c.register_id AND s.datee>=c.opened_at AND s.datee<=ISNULL(c.closed_at,SYSDATETIME())))) other_tax,
 JSON_QUERY((SELECT p.payment_method,SUM(p.amount) amount FROM (
 SELECT s.register_id,s.datee,s.closure_id,p.payment_method,p.amount FROM dbo.sales s JOIN dbo.sale_payments p ON p.sale_id=s.id
 UNION ALL SELECT s.register_id,s.datee,s.closure_id,s.payment_method,s.total FROM dbo.sales s WHERE NOT EXISTS(SELECT 1 FROM dbo.sale_payments p WHERE p.sale_id=s.id)
 ) p WHERE (p.closure_id=c.id OR (p.closure_id IS NULL AND c.register_id=p.register_id AND p.datee>=c.opened_at AND p.datee<=ISNULL(c.closed_at,SYSDATETIME()))) GROUP BY p.payment_method FOR JSON PATH)) payments
 FROM dbo.cash_closures c LEFT JOIN dbo.registers r ON r.id=c.register_id LEFT JOIN dbo.users u ON u.id=c.userId
 OUTER APPLY(SELECT SUM(s.total) total,COUNT(*) tickets,SUM(TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(s.commercial_snapshot,'$.discount'))) discount FROM dbo.sales s WHERE (s.closure_id=c.id OR (s.closure_id IS NULL AND s.register_id=c.register_id AND s.datee>=c.opened_at AND s.datee<=ISNULL(c.closed_at,SYSDATETIME())))) v WHERE c.id=@closure_id FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
 END;
 IF @snapshot IS NULL THROW 51000,'No existe ese corte.',1;
 IF @freeze=1 BEGIN
 UPDATE dbo.cash_closures SET receipt_snapshot=@snapshot WHERE id=@closure_id AND closed_at IS NOT NULL AND receipt_snapshot IS NULL;
 RETURN;
 END;
 SELECT @snapshot document_json;
END;
GO

/* ---------- sp_corporate_catalog_apply (SQL_STORED_PROCEDURE) ---------- */
/* sp_corporate_catalog_apply
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
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

            /* ---------------------------------------- 0083: impuestos
               El catálogo de la matriz manda: los sembrados por su clave; los
               propios de la matriz entran como «M_<clave>» para no chocar con
               los propios de esta sucursal. Un catálogo viejo (sin «taxes»)
               no toca nada. */
            IF JSON_QUERY(@catalog, '$.taxes') IS NOT NULL
            BEGIN
                SELECT CASE WHEN ISNULL(t.sistema, 0) = 1 THEN t.clave ELSE LEFT(CONCAT('M_', t.clave), 40) END AS clave,
                       LEFT(t.nombre, 80) AS nombre, t.clase, t.factor, t.tasa, t.cuota, t.unidad, ISNULL(t.en_base_iva, 1) AS en_base_iva,
                       t.nota, ISNULL(t.activo, 0) AS activo, ISNULL(t.sistema, 0) AS sistema, t.clave AS clave_matriz
                  INTO #imp
                  FROM OPENJSON(@catalog, '$.taxes') WITH (clave VARCHAR(40) '$.clave', nombre NVARCHAR(80) '$.nombre', clase VARCHAR(10) '$.clase',
                         factor VARCHAR(6) '$.factor', tasa DECIMAL(9, 6) '$.tasa', cuota DECIMAL(12, 4) '$.cuota', unidad NVARCHAR(20) '$.unidad',
                         en_base_iva BIT '$.en_base_iva', nota NVARCHAR(200) '$.nota', activo BIT '$.activo', sistema BIT '$.sistema') t
                 WHERE NULLIF(t.clave, '') IS NOT NULL AND t.clase IN ('IEPS', 'LOCAL') AND t.factor IN ('Tasa', 'Cuota')
                   AND (ISNULL(t.activo, 0) = 0 OR t.tasa IS NOT NULL OR t.cuota IS NOT NULL);
                /* Un nombre de la matriz que esta sucursal ya usa en otro impuesto propio: el de la matriz lleva «(matriz)». */
                UPDATE j SET j.nombre = LEFT(CONCAT(j.nombre, N' (matriz)'), 80)
                  FROM #imp j WHERE EXISTS (SELECT 1 FROM dbo.CAT_impuestos x WHERE x.nombre = j.nombre AND x.clave <> j.clave);
                UPDATE x SET x.nombre = j.nombre, x.clase = j.clase, x.factor = j.factor,
                             x.tasa = CASE WHEN j.factor = 'Tasa' THEN j.tasa END, x.cuota = CASE WHEN j.factor = 'Cuota' THEN j.cuota END,
                             x.unidad = j.unidad, x.en_base_iva = j.en_base_iva, x.nota = j.nota, x.activo = j.activo, x.actualizado_en = SYSDATETIME()
                  FROM dbo.CAT_impuestos x JOIN #imp j ON j.clave = x.clave;
                INSERT INTO dbo.CAT_impuestos (clave, nombre, clase, factor, tasa, cuota, unidad, en_base_iva, nota, activo, sistema)
                SELECT j.clave, j.nombre, j.clase, j.factor, CASE WHEN j.factor = 'Tasa' THEN j.tasa END, CASE WHEN j.factor = 'Cuota' THEN j.cuota END,
                       j.unidad, j.en_base_iva, j.nota, j.activo, j.sistema
                  FROM #imp j WHERE NOT EXISTS (SELECT 1 FROM dbo.CAT_impuestos x WHERE x.clave = j.clave);

                /* Los impuestos de cada producto corporativo: los de la matriz. */
                DELETE x FROM dbo.product_impuestos x JOIN dbo.products p ON p.id = x.product_id JOIN #p j ON j.uuid = p.uuid;
                INSERT INTO dbo.product_impuestos (product_id, impuesto_id, cantidad)
                SELECT p.id, i.id, CASE WHEN i.factor = 'Cuota' THEN MAX(t.cantidad) END
                  FROM OPENJSON(@catalog, '$.product_taxes') WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid', tax_clave VARCHAR(40) '$.tax_clave',
                         cantidad DECIMAL(12, 4) '$.cantidad') t
                  JOIN #imp m ON m.clave_matriz = t.tax_clave
                  JOIN dbo.CAT_impuestos i ON i.clave = m.clave
                  JOIN dbo.products p ON p.uuid = t.product_uuid
                  JOIN #p j ON j.uuid = p.uuid
                 WHERE i.factor = 'Tasa' OR t.cantidad > 0
                 GROUP BY p.id, i.id, i.factor;
            END

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
            /* La version DENTRO del JSON es la de la matriz; aqui manda la de esta
               base. Se reescribe para que coincidan: si no, toda cotizacion de la
               sucursal se rechazaba al cobrar. Y se compara sin ella, para no
               subir de version cuando solo cambio el numero de la matriz. */
            IF @commercial IS NOT NULL
            BEGIN
                IF EXISTS (SELECT 1 FROM dbo.commercial_policy WHERE id = 1)
                    UPDATE dbo.commercial_policy
                       SET payload = JSON_MODIFY(@commercial, '$.version', version + 1), version = version + 1, updated_at = SYSUTCDATETIME()
                     WHERE id = 1 AND JSON_MODIFY(payload, '$.version', 0) <> JSON_MODIFY(@commercial, '$.version', 0);
                ELSE
                    INSERT INTO dbo.commercial_policy (id, version, payload) VALUES (1, 1, JSON_MODIFY(@commercial, '$.version', 1));
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
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
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
            /* 0083: el catálogo de impuestos además del IVA y cuáles lleva cada
               producto. Viajan por clave (los sembrados son iguales en todas
               las bases; los propios llevan la de la matriz). */
            JSON_QUERY(ISNULL((
                SELECT i.clave, i.nombre, i.clase, i.factor,
                       CONVERT(VARCHAR(20), i.tasa) AS tasa, CONVERT(VARCHAR(20), i.cuota) AS cuota,
                       i.unidad, CAST(i.en_base_iva AS BIT) AS en_base_iva, i.nota,
                       CAST(i.activo AS BIT) AS activo, CAST(i.sistema AS BIT) AS sistema
                  FROM dbo.CAT_impuestos i
                 ORDER BY i.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS taxes,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), p.uuid)) AS product_uuid, i.clave AS tax_clave,
                       CONVERT(VARCHAR(20), x.cantidad) AS cantidad
                  FROM dbo.product_impuestos x
                  JOIN dbo.products p ON p.id = x.product_id
                  JOIN dbo.CAT_impuestos i ON i.id = x.impuesto_id
                 ORDER BY p.id, i.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS product_taxes,
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

/* ---------- sp_get_sale_by_folio (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_sale_by_folio
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE [dbo].[sp_get_sale_by_folio]
  @sale_id INT
AS
BEGIN
  SET NOCOUNT ON;

  IF @sale_id IS NULL OR @sale_id <= 0
  BEGIN
    RAISERROR('sale_id inválido.',16,1);
    RETURN;
  END

  SELECT
    s.id AS sale_id,
    s.datee,
    s.useer_id AS user_id,
    s.total,
    s.payment_method,
    (SELECT payment_method,amount,received,reference FROM dbo.sale_payments WHERE sale_id=s.id FOR JSON PATH) payments_json,
    JSON_VALUE(s.commercial_snapshot,'$.channelId') commercial_channel,
    TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(s.commercial_snapshot,'$.discount')) commercial_discount,
    s.customer_id,
    s.paid_amount,
    s.balance,
    s.due_date,
    s.invoice_status,
    ISNULL(r.refund_total,0) AS refund_total,
    s.service_mode,
    s.register_id
  FROM dbo.sales s
  OUTER APPLY (
    SELECT SUM(sr.refund_total) AS refund_total
    FROM dbo.sale_refunds sr
    WHERE sr.sale_id = s.id
  ) r
  WHERE s.id = @sale_id;

  IF EXISTS(SELECT 1 FROM dbo.sales WHERE id=@sale_id AND commercial_snapshot IS NOT NULL)
  BEGIN
    ;WITH sold AS(SELECT product_id,SUM(quantity) quantity,SUM(quantity*unitary_price) line_total,MAX(unit_cost) unit_cost,MAX(inventory_mode) inventory_mode FROM dbo.sale_detail WHERE sale_id=@sale_id GROUP BY product_id),
    returned AS(SELECT d.product_id,SUM(d.quantity) qty FROM dbo.sale_refund_detail d JOIN dbo.sale_refunds r ON r.id=d.refund_id WHERE r.sale_id=@sale_id GROUP BY d.product_id)
    SELECT @sale_id sale_id,s.product_id,p.nombre,s.quantity,CAST(s.line_total/s.quantity AS DECIMAL(10,2)) unitary_price,s.line_total,
      ISNULL(r.qty,0) refunded_qty,s.quantity-ISNULL(r.qty,0) remaining_qty,NULL sale_detail_id,s.unit_cost,s.inventory_mode,
      N'Oferta comercial: devolución proporcional al importe pagado' note,p.clave_prod_serv,p.clave_unidad,p.objeto_impuesto,p.tasa_iva,
      N'Oferta comercial' modifiers,
      /* 0085: la foto de IEPS y locales del producto en esta venta (NULL: solo IVA). */
      (SELECT CASE WHEN COUNT(dd.base_neta) = COUNT(*) THEN SUM(dd.base_neta) END FROM dbo.sale_detail dd
        WHERE dd.sale_id = @sale_id AND dd.product_id = s.product_id) base_neta,
      (SELECT x.nombre, x.clase, x.factor, x.tasa, x.cuota, SUM(x.cantidad) unidades, SUM(x.importe) importe
         FROM dbo.sale_detail_impuestos x JOIN dbo.sale_detail dd ON dd.id = x.sale_detail_id
        WHERE dd.sale_id = @sale_id AND dd.product_id = s.product_id
        GROUP BY x.nombre, x.clase, x.factor, x.tasa, x.cuota FOR JSON PATH) impuestos_json
    FROM sold s JOIN dbo.products p ON p.id=s.product_id LEFT JOIN returned r ON r.product_id=s.product_id;
    RETURN;
  END;
  ;WITH refunded AS (
    SELECT
      srd.product_id,
      SUM(srd.quantity) AS refunded_qty
    FROM dbo.sale_refunds sr
    JOIN dbo.sale_refund_detail srd ON srd.refund_id = sr.id
    WHERE sr.sale_id = @sale_id
    GROUP BY srd.product_id
  )
  SELECT
    d.sale_id,
    d.product_id,
    p.nombre,
    d.quantity,
    d.unitary_price,
    (d.quantity * d.unitary_price) AS line_total,
    ISNULL(r.refunded_qty,0) AS refunded_qty,
    (d.quantity - ISNULL(r.refunded_qty,0)) AS remaining_qty,
    d.id AS sale_detail_id,
    d.unit_cost,
    d.inventory_mode,
    d.note,
    p.clave_prod_serv,
    p.clave_unidad,
    p.objeto_impuesto,
    p.tasa_iva,
    /* 0085: la foto de IEPS y locales del renglón (NULL: solo IVA). */
    d.base_neta,
    (SELECT x.nombre, x.clase, x.factor, x.tasa, x.cuota, x.cantidad unidades, x.importe
       FROM dbo.sale_detail_impuestos x WHERE x.sale_detail_id = d.id FOR JSON PATH) AS impuestos_json,
    mods.modifiers
  FROM dbo.sale_detail d
  JOIN dbo.products p ON p.id = d.product_id
  LEFT JOIN refunded r ON r.product_id = d.product_id
  OUTER APPLY (
    SELECT STRING_AGG(CONCAT(CASE WHEN m.quantity > 1 THEN CONCAT(m.quantity, 'x ') ELSE '' END, m.option_name), ', ')
           WITHIN GROUP (ORDER BY m.id) AS modifiers
    FROM dbo.sale_detail_modifiers m
    WHERE m.sale_detail_id = d.id
  ) mods
  WHERE d.sale_id = @sale_id
  ORDER BY d.product_id, d.id;
END
GO

/* ---------- sp_get_sale_ticket (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_sale_ticket
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David>
-- Create date: <11-12-2025>
-- Description:	<Store procedure para generar un ticket de venta>
-- Update:      + register_name y + impuestos por linea.
--
--              El ticket calculaba el IVA dividiendo el total entre 1.16, con
--              la tasa escrita a mano en el codigo. Eso solo es cierto si
--              TODO lo vendido es objeto de impuesto a la tasa general: en una
--              venta con productos exentos el ticket inventaba un IVA que
--              nadie cobro. La tasa de cada producto viaja ahora con su linea
--              y el desglose se calcula linea por linea.
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_sale_ticket
    @sale_id INT
AS
BEGIN
    SET NOCOUNT ON;

    --------------------------
    -- 1) Encabezado de venta
    --------------------------
    SELECT
        s.id,
        s.datee,
        s.total,
        (SELECT payment_method,amount,received,reference FROM dbo.sale_payments WHERE sale_id=s.id FOR JSON PATH) payments_json,
        s.payment_method,
        s.paid_amount,
        s.balance,
        s.customer_id,
        s.due_date,
        u.usuario AS cashier,
        c.customerName AS customer_name,
        s.service_mode,
        s.register_id,
        r.name AS register_name,
        JSON_VALUE(s.commercial_snapshot,'$.channelName') AS commercial_channel,
        TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(s.commercial_snapshot,'$.discount')) AS commercial_discount
    FROM dbo.sales s
    INNER JOIN dbo.users u ON u.id = s.useer_id
    LEFT JOIN dbo.customers c ON c.id = s.customer_id
    LEFT JOIN dbo.registers r ON r.id = s.register_id
    WHERE s.id = @sale_id;
    SELECT
        d.product_id,
        p.nombre,
        d.quantity,
        d.unitary_price,
        d.subtotal AS line_total,
        d.note,
        /* La tasa de CADA producto: sin esto el ticket tiene que suponer que
           todo lleva IVA general, y con un producto exento miente. */
        COALESCE(d.tax_object,p.objeto_impuesto) objeto_impuesto,
        COALESCE(d.tax_rate,p.tasa_iva) tasa_iva,
        /* 0083: la foto de IEPS y locales del renglón (NULL: solo IVA). */
        d.base_neta,
        (SELECT x.clase, x.factor, x.tasa, x.importe FROM dbo.sale_detail_impuestos x
          WHERE x.sale_detail_id = d.id FOR JSON PATH) AS impuestos_json,
        p.base_uom,
        mods.modifiers,
        JSON_VALUE(d.commercial_snapshot,'$.ruleName') AS commercial_offer
    FROM dbo.sale_detail d
    INNER JOIN dbo.products p ON p.id = d.product_id
    /* Los modificadores TAL COMO SE COBRARON, con su importe.
       Antes solo salia el nombre: un ticket con "Leche de almendra" y un total
       $12 mas alto obliga al cliente a fiarse. Ahora cada extra dice lo que
       sumo, y los que no suman nada -"Sin azucar"- no llevan cifra.
       Se lee del snapshot de la venta, no de la configuracion de hoy: un
       ticket reimpreso manana tiene que decir lo mismo que el de hoy.
       Nada tecnico: nombres e importes, nunca identificadores. */
    OUTER APPLY (
        SELECT STRING_AGG(
                   CONCAT(
                       CASE WHEN m.quantity > 1 THEN CONCAT(m.quantity, 'x ') ELSE '' END,
                       m.option_name,
                       CASE WHEN ISNULL(m.price_delta, 0) <> 0
                            THEN CONCAT(' +', FORMAT(m.price_delta * m.quantity, 'N2'))
                            ELSE '' END),
                   ', ')
               WITHIN GROUP (ORDER BY m.id) AS modifiers
        FROM dbo.sale_detail_modifiers m
        WHERE m.sale_detail_id = d.id
    ) mods
    WHERE d.sale_id = @sale_id
    ORDER BY d.id;
END;
GO

/* ---------- sp_producto_impuestos_guardar (SQL_STORED_PROCEDURE) ---------- */
/* sp_producto_impuestos_guardar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================= sp_producto_impuestos_guardar (0083) =================
   Reemplaza los impuestos además del IVA de un producto.
   @impuestos  JSON: [{ "id": 3 }, { "id": 9, "cantidad": 0.6 }]
               cantidad = unidades de la cuota que trae UNA pieza (litros,
               cigarros); solo para los de cuota, y obligatoria en ellos.
   Un impuesto apagado se puede dejar marcado (no se cobra hasta encenderlo);
   uno nuevo apagado no se puede marcar.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_producto_impuestos_guardar
    @product_id INT,
    @impuestos  NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id) THROW 51000, 'Ese producto no existe.', 1;
    /* Un producto de la matriz trae sus impuestos de allá (sp_corporate_catalog_apply). */
    IF EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id AND corporate = 1)
        THROW 51000, 'Este producto lo administra la matriz: sus impuestos se cambian allá y llegan solos.', 1;
    IF ISJSON(ISNULL(@impuestos, N'[]')) = 0 THROW 51000, 'Lista de impuestos inválida.', 1;

    SELECT DISTINCT j.id, j.cantidad
      INTO #n
      FROM OPENJSON(ISNULL(@impuestos, N'[]')) WITH (id INT '$.id', cantidad DECIMAL(12, 4) '$.cantidad') j
     WHERE j.id IS NOT NULL;

    IF EXISTS (SELECT 1 FROM #n n LEFT JOIN dbo.CAT_impuestos i ON i.id = n.id WHERE i.id IS NULL)
        THROW 51000, 'Uno de los impuestos no existe.', 1;
    IF EXISTS (SELECT 1 FROM #n n JOIN dbo.CAT_impuestos i ON i.id = n.id
                WHERE i.activo = 0 AND NOT EXISTS (SELECT 1 FROM dbo.product_impuestos pi WHERE pi.product_id = @product_id AND pi.impuesto_id = n.id))
        THROW 51000, 'Ese impuesto está apagado: enciéndelo en Configuración → Impuestos.', 1;
    IF EXISTS (SELECT 1 FROM #n n JOIN dbo.CAT_impuestos i ON i.id = n.id WHERE i.factor = 'Cuota' AND (n.cantidad IS NULL OR n.cantidad <= 0))
        THROW 51000, 'Un impuesto por cuota necesita cuánto trae una pieza (por ejemplo, 0.6 litros).', 1;

    BEGIN TRAN;
        DELETE FROM dbo.product_impuestos WHERE product_id = @product_id;
        INSERT INTO dbo.product_impuestos (product_id, impuesto_id, cantidad)
        SELECT @product_id, n.id, CASE WHEN i.factor = 'Cuota' THEN n.cantidad END
          FROM #n n JOIN dbo.CAT_impuestos i ON i.id = n.id;
    COMMIT;

    EXEC dbo.sp_producto_impuestos_get @product_id = @product_id;
END
GO
