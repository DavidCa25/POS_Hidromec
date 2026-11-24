/* ============================================================
   0088 — iva exento

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0088_iva-exento.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0088_iva-exento.sql ========== */
/* ============================================================
   0088 — IVA exento, distinto de la tasa 0

   Hasta aquí «0% / Exento» era una sola opción: tasa_iva = 0. Para el SAT
   son dos cosas:

     tasa 0      el producto causa IVA a la tasa del 0% (medicinas de
                 patente, alimentos sin procesar). El CFDI lleva el
                 traslado con TipoFactor «Tasa» y TasaOCuota 0.000000, y da
                 derecho a acreditar el IVA de las compras.
     exento      el acto no causa IVA (honorarios médicos y dentales,
                 art. 15 fr. XIV LIVA; colegiaturas; renta de casa
                 habitación). El CFDI lleva TipoFactor «Exento», sin tasa ni
                 importe, y el IVA de las compras NO se acredita.

   products.iva_exento   1 = exento. Solo cuenta con tasa_iva = 0: quien lo
                         lee pregunta `tasa_iva = 0 AND iva_exento = 1`. No
                         es un CHECK a propósito: la importación, el catálogo
                         corporativo y la edición rápida cambian la tasa sin
                         saber de esta columna, y un producto que vuelve al
                         16% simplemente deja de ser exento. Por omisión 0:
                         nada existente cambia.

   Esta migración también despliega sp_salud_estudios_catalogo (0087):
   lee iva_exento, que no existe hasta aquí.

   El precio y el ticket no cambian (los dos cobran 0 de IVA); cambia la
   factura y, con ella, la contabilidad del negocio.
   ============================================================ */

IF COL_LENGTH(N'dbo.products', N'iva_exento') IS NULL
    ALTER TABLE dbo.products ADD iva_exento BIT NOT NULL
        CONSTRAINT DF_products_iva_exento DEFAULT (0) WITH VALUES;
GO

/* ---------- sp_add_product (SQL_STORED_PROCEDURE) ---------- */
/* sp_add_product
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:      <Daniela Luna>
-- Create date: <04/08/2025>
-- Description: <SP para agregar productos>
-- Update:      + bar_code y campos fiscales SAT (opcionales)
-- Update:      + inventory_mode (DIRECT|RECIPE|NONE), sellable, base_uom,
--                allow_decimal_qty, cost. Los defaults reproducen Retail.
--                Devuelve el id creado.
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[sp_add_product]
    @brand INT,
    @part_number NVARCHAR(100),
    @name NVARCHAR(100),
    @price DECIMAL(10,2),
    @stock DECIMAL(12,2),
    @category INT,
    @bar_code NVARCHAR(100) = NULL,
    @clave_prod_serv NVARCHAR(8) = NULL,
    @clave_unidad NVARCHAR(5) = NULL,
    @objeto_impuesto NVARCHAR(2) = '02',
    @tasa_iva DECIMAL(5,4) = 0.16,
    @iva_exento BIT = 0,              -- 0088: exento, distinto de tasa 0
    @inventory_mode NVARCHAR(10) = 'DIRECT',
    @sellable BIT = 1,
    @base_uom NVARCHAR(10) = 'pza',
    @allow_decimal_qty BIT = 0,
    @cost DECIMAL(14,4) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SET @inventory_mode = UPPER(ISNULL(@inventory_mode, 'DIRECT'));
    SET @base_uom = ISNULL(@base_uom, 'pza');

    IF @inventory_mode NOT IN ('DIRECT', 'RECIPE', 'NONE')
    BEGIN
        RAISERROR('inventory_mode invalido: DIRECT, RECIPE o NONE.', 16, 1);
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.uoms WHERE code = @base_uom AND is_base = 1)
    BEGIN
        RAISERROR('La unidad base debe ser una unidad base (pza, g, ml, cm).', 16, 1);
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM products WHERE part_number = @part_number)
    BEGIN
        RAISERROR('Ya existe un producto con ese número de parte.', 16, 1);
        RETURN;
    END;

    -- Si mandan bar_code no vacio, valida que no lo tenga otro producto
    IF @bar_code IS NOT NULL AND LTRIM(RTRIM(@bar_code)) <> ''
    BEGIN
        IF EXISTS (SELECT 1 FROM products WHERE bar_code = @bar_code)
        BEGIN
            RAISERROR('Ese codigo de barras ya esta asignado a otro producto.', 16, 1);
            RETURN;
        END
    END

    -- Una receta no tiene stock propio: lo tienen sus ingredientes.
    IF @inventory_mode = 'RECIPE' SET @stock = 0;

    INSERT INTO products (
        part_number, nombre, price, stock, category_id, brand_id,
        bar_code, clave_prod_serv, clave_unidad, objeto_impuesto, tasa_iva, iva_exento,
        inventory_mode, sellable, base_uom, allow_decimal_qty, cost,
        active, registrated_date
    )
    VALUES (
        @part_number,
        @name,
        @price,
        ISNULL(@stock, 0),
        @category,
        @brand,
        CASE WHEN @bar_code IS NULL OR LTRIM(RTRIM(@bar_code)) = '' THEN NULL ELSE @bar_code END,
        @clave_prod_serv,
        @clave_unidad,
        ISNULL(@objeto_impuesto, '02'),
        ISNULL(@tasa_iva, 0.16),
        CASE WHEN ISNULL(@tasa_iva, 0.16) = 0 THEN ISNULL(@iva_exento, 0) ELSE 0 END,
        @inventory_mode,
        ISNULL(@sellable, 1),
        @base_uom,
        ISNULL(@allow_decimal_qty, 0),
        @cost,
        1,
        GETDATE()
    );

    SELECT SCOPE_IDENTITY() AS id;
END;
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
        CAST(CASE WHEN p.tasa_iva = 0 AND p.iva_exento = 1 THEN 1 ELSE 0 END AS BIT) AS iva_exento,
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
            WHEN 'DIRECT' THEN FLOOR(p.stock) + ISNULL(vs.extra, 0)
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
    /* 0073 Venta suelta: el suelto alcanza tambien con los paquetes cerrados. */
    OUTER APPLY (SELECT CASE WHEN pk.stock > 0 THEN FLOOR(pk.stock) * v.piezas ELSE 0 END AS extra
                   FROM dbo.venta_suelta v
                   JOIN dbo.products pk ON pk.id = v.parent_product_id
                  WHERE v.product_id = p.id
                    AND EXISTS (SELECT 1 FROM dbo.business_modules
                                 WHERE module_key = N'venta-suelta' AND enabled = 1)) vs
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
      CAST(CASE WHEN p.tasa_iva=0 AND p.iva_exento=1 THEN 1 ELSE 0 END AS BIT) iva_exento,
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
    CAST(CASE WHEN p.tasa_iva = 0 AND p.iva_exento = 1 THEN 1 ELSE 0 END AS BIT) AS iva_exento,
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

/* ---------- sp_salud_estudios_catalogo (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_estudios_catalogo
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Los estudios que ofrece el negocio, con su precio y su ficha.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudios_catalogo]
    @buscar NVARCHAR(100) = NULL,
    @tipo   NVARCHAR(10)  = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @buscar = NULLIF(LTRIM(RTRIM(@buscar)), N'');
    SELECT e.product_id, p.nombre, p.price AS precio, p.tasa_iva,
           CAST(CASE WHEN p.tasa_iva = 0 AND p.iva_exento = 1 THEN 1 ELSE 0 END AS BIT) AS iva_exento,
           e.tipo, e.modalidad, e.preparacion, e.muestra, e.entrega_horas, e.parametros
      FROM dbo.salud_estudios e
      JOIN dbo.products p ON p.id = e.product_id
     WHERE p.active = 1
       AND (@tipo IS NULL OR e.tipo = @tipo)
       AND (@buscar IS NULL OR p.nombre LIKE N'%' + @buscar + N'%')
     ORDER BY e.tipo, p.nombre;
END
GO

/* ---------- sp_service_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_service_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Da de alta un servicio, o convierte en servicio un producto que ya existe.
 *
 * UN SERVICIO ES UN PRODUCTO
 * --------------------------
 * No hay un catalogo paralelo. Este procedimiento escribe en `products` lo
 * que todo lo vendible tiene -nombre, precio, impuestos, clave del SAT- y en
 * `services` lo que solo un servicio tiene: cuanto dura, si necesita a alguien
 * que lo haga y cuanto comisiona.
 *
 * ENLAZAR UN PRODUCTO QUE YA ESTABA
 * ---------------------------------
 * Con `@product_id`, el producto no se recrea: se le anade la ficha de
 * servicio. Es el caso del taller que llevaba anos cobrando "Mano de obra"
 * como un producto mas y ahora quiere agendarlo y comisionarlo. Su historial
 * de ventas sigue siendo el suyo, que es justamente lo que se gana al no
 * inventar una tabla nueva.
 *
 * `inventory_mode = 'NONE'` NO SE NEGOCIA
 * ---------------------------------------
 * Un servicio no tiene existencias. Si el producto enlazado descontaba
 * inventario, deja de hacerlo: cobrar una hora de trabajo no puede restar
 * piezas de un almacen.
 */
CREATE OR ALTER PROCEDURE dbo.sp_service_save
    @product_id             INT = NULL,
    @nombre                 NVARCHAR(100),
    @price                  DECIMAL(10, 2),
    @part_number            NVARCHAR(100) = NULL,
    @category_id            INT = NULL,
    @clave_prod_serv        NVARCHAR(8) = NULL,
    @clave_unidad           NVARCHAR(5) = NULL,
    @tasa_iva               DECIMAL(5, 4) = NULL,
    @iva_exento             BIT = NULL,   -- 0088: honorarios médicos y dentales
    @duration_minutes       INT = 30,
    @requires_professional  BIT = 1,
    @default_commission_pct DECIMAL(5, 2) = NULL,
    @schedulable            BIT = 1,
    @notes                  NVARCHAR(400) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @nombre IS NULL OR LTRIM(RTRIM(@nombre)) = ''
    BEGIN
        RAISERROR('El servicio necesita un nombre.', 16, 1);
        RETURN;
    END

    IF @price IS NULL OR @price < 0
    BEGIN
        RAISERROR('El precio no puede ser negativo.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    /* ------------------------------------------- CATEGORIA Y MARCA, SIEMPRE
     *
     * `sp_get_active_products` -el catalogo de la pantalla de venta- une
     * products con CAT_categories y CAT_brands con INNER JOIN. Un servicio sin
     * categoria o sin marca queda FUERA de esa consulta: existe en la base, se
     * ve en el catalogo de Servicios y no se puede vender. Un servicio que no
     * se puede cobrar no sirve de nada, y el fallo es silencioso.
     *
     * Asi que se le dan las dos. 'Servicios' como categoria es ademas lo que
     * el negocio querria: los agrupa en la pantalla de venta sin que nadie
     * tenga que crearla a mano el primer dia.
     */
    DECLARE @cat_servicios INT, @marca_general INT;

    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'Servicios')
        INSERT INTO dbo.CAT_categories (namee) VALUES (N'Servicios');
    SELECT @cat_servicios = id FROM dbo.CAT_categories WHERE namee = N'Servicios';

    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'General')
        INSERT INTO dbo.CAT_brands (namee) VALUES (N'General');
    SELECT @marca_general = id FROM dbo.CAT_brands WHERE namee = N'General';

    IF @product_id IS NULL
    BEGIN
        /* Sin clave, se genera una estable y legible. Un servicio rara vez
           tiene codigo de barras, y exigirselo al alta seria pedir un dato que
           el negocio no tiene.

           Se inserta con un valor provisional y se renombra con el identificador
           ya asignado: asi la clave es 'SRV-12' y no un contador aparte que dos
           cajas tendrian que repartirse. */
        DECLARE @generar BIT = CASE WHEN @part_number IS NULL OR LTRIM(RTRIM(@part_number)) = '' THEN 1 ELSE 0 END;
        IF @generar = 1 SET @part_number = 'SRV-TMP-' + CONVERT(NVARCHAR(36), NEWID());

        INSERT INTO dbo.products
            (part_number, nombre, price, stock, active, category_id, brand_id, cost,
             clave_prod_serv, clave_unidad, objeto_impuesto, tasa_iva, iva_exento,
             inventory_mode, sellable, base_uom, allow_decimal_qty)
        VALUES
            (@part_number, @nombre, @price, 0, 1,
             ISNULL(@category_id, @cat_servicios), @marca_general, 0,
             ISNULL(@clave_prod_serv, '80111600'),   -- servicios, clave generica del SAT
             ISNULL(@clave_unidad, 'E48'),           -- unidad de servicio
             '02', ISNULL(@tasa_iva, 0.16),
             CASE WHEN ISNULL(@tasa_iva, 0.16) = 0 THEN ISNULL(@iva_exento, 0) ELSE 0 END,
             'NONE', 1, 'pza', 0);

        SET @product_id = SCOPE_IDENTITY();

        IF @generar = 1
        BEGIN
            DECLARE @clave NVARCHAR(100) = 'SRV-' + CONVERT(NVARCHAR(12), @product_id);
            /* Solo si nadie la usa ya: el mostrador puede haber escrito 'SRV-12'
               a mano hace un ano, y perder el alta por eso seria absurdo. */
            IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = @clave)
                UPDATE dbo.products SET part_number = @clave WHERE id = @product_id;
        END
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
        BEGIN
            ROLLBACK TRAN;
            RAISERROR('El producto no existe.', 16, 1);
            RETURN;
        END

        UPDATE dbo.products
           SET nombre = @nombre,
               price = @price,
               /* Si el producto enlazado no tenia categoria o marca, se le dan:
                  sin ellas desaparece del catalogo de venta. */
               category_id = ISNULL(@category_id, ISNULL(category_id, @cat_servicios)),
               brand_id = ISNULL(brand_id, @marca_general),
               clave_prod_serv = ISNULL(@clave_prod_serv, clave_prod_serv),
               clave_unidad = ISNULL(@clave_unidad, clave_unidad),
               tasa_iva = ISNULL(@tasa_iva, tasa_iva),
               iva_exento = CASE WHEN ISNULL(@tasa_iva, tasa_iva) <> 0 THEN 0 ELSE ISNULL(@iva_exento, iva_exento) END,
               part_number = ISNULL(NULLIF(LTRIM(RTRIM(@part_number)), ''), part_number),
               /* Un servicio no descuenta existencias, venga de donde venga. */
               inventory_mode = 'NONE',
               sellable = 1
         WHERE id = @product_id;
    END

    MERGE dbo.services AS d
    USING (SELECT @product_id AS product_id) AS s ON d.product_id = s.product_id
    WHEN MATCHED THEN UPDATE SET
        duration_minutes = @duration_minutes,
        requires_professional = @requires_professional,
        default_commission_pct = @default_commission_pct,
        schedulable = @schedulable,
        notes = @notes,
        updated_at = SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT
        (product_id, duration_minutes, requires_professional,
         default_commission_pct, schedulable, notes)
        VALUES (@product_id, @duration_minutes, @requires_professional,
                @default_commission_pct, @schedulable, @notes);

    COMMIT TRAN;

    SELECT p.id AS product_id, p.part_number, p.nombre, p.price, p.active,
           s.duration_minutes, s.requires_professional,
           s.default_commission_pct, s.schedulable, s.notes
      FROM dbo.products p
      JOIN dbo.services s ON s.product_id = p.id
     WHERE p.id = @product_id;
END
GO

/* ---------- sp_update_product (SQL_STORED_PROCEDURE) ---------- */
/* sp_update_product
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Update: + campos fiscales SAT (opcionales)
-- Conserva la logica original de bar_code.
-- Update: + inventory_mode, sellable, base_uom, allow_decimal_qty, cost.
--   NULL conserva el valor actual. Guardas de un solo nivel: un producto que
--   ya es ingrediente no puede volverse RECIPE; una RECIPE con recetas no
--   puede dejar de serlo sin borrarlas; la unidad base no cambia de
--   dimension mientras haya recetas que consuman el producto.
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[sp_update_product]
    @product_id INT,
    @nombre NVARCHAR(100),
    @precio DECIMAL(10,2),
    @stock DECIMAL(10,2),
    @numero_parte NVARCHAR(100),
    @bar_code NVARCHAR(100) = NULL,
    @clave_prod_serv NVARCHAR(8) = NULL,
    @clave_unidad NVARCHAR(5) = NULL,
    @objeto_impuesto NVARCHAR(2) = NULL,
    @tasa_iva DECIMAL(5,4) = NULL,
    @iva_exento BIT = NULL,           -- 0088: NULL conserva; con tasa distinta de 0 se apaga
    @inventory_mode NVARCHAR(10) = NULL,
    @sellable BIT = NULL,
    @base_uom NVARCHAR(10) = NULL,
    @allow_decimal_qty BIT = NULL,
    @cost DECIMAL(14,4) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @modo_actual NVARCHAR(10), @uom_actual NVARCHAR(10);
    SELECT @modo_actual = inventory_mode, @uom_actual = base_uom FROM products WHERE id = @product_id;
    IF @modo_actual IS NULL
    BEGIN
        RAISERROR('El producto no existe.', 16, 1);
        RETURN;
    END

    IF @inventory_mode IS NOT NULL
    BEGIN
        SET @inventory_mode = UPPER(@inventory_mode);
        IF @inventory_mode NOT IN ('DIRECT', 'RECIPE', 'NONE')
        BEGIN
            RAISERROR('inventory_mode invalido: DIRECT, RECIPE o NONE.', 16, 1);
            RETURN;
        END
        IF @inventory_mode <> @modo_actual
        BEGIN
            IF @inventory_mode = 'RECIPE' AND (
                   EXISTS (SELECT 1 FROM dbo.recipe_lines WHERE ingredient_product_id = @product_id)
                OR EXISTS (SELECT 1 FROM dbo.modifier_options WHERE ingredient_product_id = @product_id OR replaces_product_id = @product_id))
            BEGIN
                RAISERROR('Este producto es ingrediente de una receta o modificador: no puede convertirse en receta.', 16, 1);
                RETURN;
            END
            IF @modo_actual = 'RECIPE' AND EXISTS (SELECT 1 FROM dbo.recipes WHERE product_id = @product_id)
            BEGIN
                RAISERROR('Este producto tiene recetas. Eliminalas antes de cambiar su tipo de inventario.', 16, 1);
                RETURN;
            END
            IF @modo_actual <> 'DIRECT' AND @inventory_mode = 'DIRECT' AND EXISTS (SELECT 1 FROM dbo.recipes WHERE product_id = @product_id)
            BEGIN
                RAISERROR('Este producto tiene recetas. Eliminalas antes de cambiar su tipo de inventario.', 16, 1);
                RETURN;
            END
        END
    END

    IF @base_uom IS NOT NULL AND @base_uom <> @uom_actual
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.uoms WHERE code = @base_uom AND is_base = 1)
        BEGIN
            RAISERROR('La unidad base debe ser una unidad base (pza, g, ml, cm).', 16, 1);
            RETURN;
        END
        IF EXISTS (SELECT 1 FROM dbo.recipe_lines WHERE ingredient_product_id = @product_id)
           OR EXISTS (SELECT 1 FROM dbo.modifier_options WHERE ingredient_product_id = @product_id OR replaces_product_id = @product_id)
        BEGIN
            RAISERROR('Este producto ya se usa en recetas o modificadores: su unidad base no puede cambiar.', 16, 1);
            RETURN;
        END
    END

    -- Si mandan un bar_code no vacio, valida que no lo tenga otro producto
    IF @bar_code IS NOT NULL AND LTRIM(RTRIM(@bar_code)) <> ''
    BEGIN
        IF EXISTS (
            SELECT 1 FROM products
            WHERE bar_code = @bar_code AND id <> @product_id
        )
        BEGIN
            RAISERROR('Ese codigo de barras ya esta asignado a otro producto.', 16, 1);
            RETURN;
        END
    END

    UPDATE products
    SET nombre = @nombre,
        price = @precio,
        stock = CASE WHEN ISNULL(@inventory_mode, inventory_mode) = 'RECIPE' THEN 0 ELSE @stock END,
        part_number = @numero_parte,
        bar_code = CASE
                     WHEN @bar_code IS NULL THEN bar_code           -- no lo tocan: conserva
                     WHEN LTRIM(RTRIM(@bar_code)) = '' THEN NULL     -- vacio: lo limpia
                     ELSE @bar_code
                   END,
        -- Campos fiscales: si mandan NULL, conservan el valor actual
        clave_prod_serv = ISNULL(@clave_prod_serv, clave_prod_serv),
        clave_unidad    = ISNULL(@clave_unidad, clave_unidad),
        objeto_impuesto = ISNULL(@objeto_impuesto, objeto_impuesto),
        tasa_iva        = ISNULL(@tasa_iva, tasa_iva),
        iva_exento      = CASE WHEN ISNULL(@tasa_iva, tasa_iva) <> 0 THEN 0 ELSE ISNULL(@iva_exento, iva_exento) END,
        inventory_mode    = ISNULL(@inventory_mode, inventory_mode),
        sellable          = ISNULL(@sellable, sellable),
        base_uom          = ISNULL(@base_uom, base_uom),
        allow_decimal_qty = ISNULL(@allow_decimal_qty, allow_decimal_qty),
        cost              = ISNULL(@cost, cost)
    WHERE id = @product_id;
END;
GO
