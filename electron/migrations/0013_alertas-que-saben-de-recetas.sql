/* 0013_alertas-que-saben-de-recetas.sql
 * ---------------------------------------------------------------------------
 * Las alertas de reposicion dejan de inventar existencias.
 *
 * QUE PASABA
 * ----------
 * `sp_reorder_suggestions` medía TODO contra `products.stock` y contra
 * `sale_detail`. Tres consecuencias, las tres visibles en una cafeteria:
 *
 *   1. Un producto RECIPE tiene stock 0 por diseno. La division daba 0 y el
 *      filtro `0 <= @dias_alerta` lo dejaba pasar: cada bebida vendida salia
 *      con "0 dias restantes", que en pantalla se leia como
 *      "se acabara en menos de 0 dias".
 *   2. Un producto NONE -un servicio- tampoco tiene existencias: igual.
 *   3. Un INGREDIENTE nunca aparece en `sale_detail` -se vende el latte, no la
 *      leche-, asi que justo lo que hay que reponer no alertaba nunca.
 *
 * QUE CAMBIA
 * ----------
 * La existencia y el ritmo se miden segun lo que el producto ES:
 *
 *   DIRECT   stock propio; ritmo = salidas de inventario de venta o receta,
 *            asi que un ingrediente por fin alerta cuando se esta acabando.
 *   RECIPE   disponibilidad calculada desde los ingredientes -con conversion
 *            y merma, el mismo calculo que el catalogo de Touch-; ritmo =
 *            unidades vendidas. Devuelve ademas que ingrediente la limita.
 *   NONE     fuera. No hay existencias que reponer.
 *   inactivo fuera, como ya estaba.
 *
 * Los ajustes de conteo fisico no cuentan como ritmo: entran sin `source` y
 * una merma contada una vez no es velocidad de consumo.
 *
 * Los dias no pueden salir negativos ni indefinidos: sin existencia son 0, y
 * el ritmo siempre es mayor que cero porque sin consumo no hay alerta.
 * ---------------------------------------------------------------------------
 */

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Que hay que reponer, y en cuantos dias se acaba.
--
-- QUE ESTABA MAL
-- --------------
-- Media TODO contra `products.stock` y contra `sale_detail`:
--
--   1. Un producto RECIPE tiene stock 0 POR DISENO -su disponibilidad sale de
--      los ingredientes-. La division daba 0 y el filtro `0 <= @dias_alerta`
--      lo dejaba pasar: cada bebida vendida aparecia con "0 dias restantes",
--      que en pantalla se leia como "se acabara en menos de 0 dias".
--   2. Un producto NONE (servicio) tampoco tiene existencias: mismo caso.
--   3. Un INGREDIENTE nunca aparece en `sale_detail` -se vende el latte, no la
--      leche-, asi que justo lo que hay que reponer no generaba alerta nunca.
--
-- COMO SE MIDE AHORA
-- ------------------
--   existencia   DIRECT  ->  products.stock
--                RECIPE  ->  unidades que alcanzan segun sus ingredientes,
--                            con conversion y merma (mismo calculo que
--                            sp_get_menu_catalog)
--                NONE    ->  fuera: no hay nada que reponer
--
--   ritmo        DIRECT  ->  salidas de inventario de venta o receta. Cubre lo
--                            que se vende en caja Y lo que se consume como
--                            ingrediente. Los ajustes de conteo fisico NO
--                            cuentan: entran sin `source` y una merma contada
--                            una vez no es ritmo de consumo.
--                RECIPE  ->  unidades vendidas del producto
--
-- Los dias nunca salen negativos ni indefinidos: si no hay existencia son 0,
-- y el ritmo es siempre > 0 porque sin consumo no hay alerta.
CREATE OR ALTER PROCEDURE sp_reorder_suggestions
  @dias_ventana   INT = 30,   -- ventana para medir la velocidad de consumo
  @dias_alerta    INT = 7,    -- alerta si se acaba en <= estos dias
  @dias_objetivo  INT = 30    -- pedir lo necesario para cubrir estos dias
AS
BEGIN
  SET NOCOUNT ON;

  IF @dias_ventana  IS NULL OR @dias_ventana  <= 0 SET @dias_ventana  = 30;
  IF @dias_alerta   IS NULL OR @dias_alerta   <  0 SET @dias_alerta   = 7;
  IF @dias_objetivo IS NULL OR @dias_objetivo <= 0 SET @dias_objetivo = 30;

  DECLARE @desde DATE = DATEADD(DAY, -@dias_ventana, CAST(GETDATE() AS DATE));

  ;WITH
  /* Lo que de verdad salio del inventario. Un ingrediente no esta en
     sale_detail, pero deja salida cada vez que se prepara la bebida. */
  consumo_directo AS (
      SELECT m.product_id, SUM(m.quantity) AS consumido
      FROM dbo.inventory_movements m
      WHERE m.typee = 'salida'
        AND m.source IN ('SALE', 'RECIPE')
        AND m.datee >= @desde
      GROUP BY m.product_id
  ),
  /* Una receta no mueve stock propio: su ritmo son las unidades vendidas. */
  consumo_receta AS (
      SELECT sd.product_id, SUM(sd.quantity) AS consumido
      FROM dbo.sale_detail sd
      JOIN dbo.sales s ON s.id = sd.sale_id
      WHERE s.datee >= @desde
      GROUP BY sd.product_id
  ),
  receta_base AS (
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
  /* El ingrediente que primero se acaba: manda el minimo y se dice cual es. */
  limita AS (
      SELECT product_id, units, ing_nombre, ing_stock, ing_uom, ing_necesita
      FROM (
          SELECT l.*, ROW_NUMBER() OVER (PARTITION BY l.product_id
                                         ORDER BY l.units, l.ing_nombre) AS r
          FROM lineas l
      ) t
      WHERE t.r = 1
  ),
  base AS (
      SELECT
          p.id, p.nombre, p.part_number, p.inventory_mode, p.base_uom,
          CASE p.inventory_mode
               WHEN 'DIRECT' THEN CAST(p.stock AS DECIMAL(18,4))
               ELSE CAST(ISNULL(li.units, 0) AS DECIMAL(18,4))
          END AS existencia,
          CASE p.inventory_mode
               WHEN 'DIRECT' THEN CAST(ISNULL(cd.consumido, 0) AS DECIMAL(18,4))
               ELSE CAST(ISNULL(cr.consumido, 0) AS DECIMAL(18,4))
          END AS consumido,
          li.ing_nombre, li.ing_stock, li.ing_uom, li.ing_necesita
      FROM dbo.products p
      LEFT JOIN consumo_directo cd ON cd.product_id = p.id
      LEFT JOIN consumo_receta  cr ON cr.product_id = p.id
      LEFT JOIN limita li          ON li.product_id = p.id
      /* NONE no tiene existencias que reponer; un producto de baja tampoco. */
      WHERE p.active = 1
        AND p.inventory_mode IN ('DIRECT', 'RECIPE')
  ),
  ritmo AS (
      SELECT b.*,
             CAST(b.consumido / @dias_ventana AS DECIMAL(18,6)) AS prom_diario
      FROM base b
      WHERE b.consumido > 0
  )
  SELECT
      r.id,
      r.nombre,
      r.part_number,
      r.inventory_mode,
      r.base_uom,
      CAST(r.existencia AS DECIMAL(18,2)) AS stock,
      CAST(r.consumido  AS DECIMAL(18,2)) AS vendido_ventana,
      CAST(r.prom_diario AS DECIMAL(12,2)) AS prom_diario,
      /* Nunca negativo ni indefinido: sin existencia son 0 dias. */
      CAST(FLOOR(CASE WHEN r.existencia <= 0 THEN 0
                      ELSE r.existencia / r.prom_diario END) AS INT) AS dias_restantes,
      /* Reponer una receta no se hace comprando la receta: se compra el
         ingrediente que limita. Por eso solo DIRECT lleva sugerido. */
      CASE WHEN r.inventory_mode = 'DIRECT' THEN
           CASE WHEN CEILING(r.prom_diario * @dias_objetivo) - r.existencia > 0
                THEN CEILING(r.prom_diario * @dias_objetivo) - r.existencia
                ELSE 0 END
      END AS sugerido,
      /* Solo tiene sentido en una receta: quien limita y por cuanto. */
      CASE WHEN r.inventory_mode = 'RECIPE' THEN r.ing_nombre   END AS limita_nombre,
      CASE WHEN r.inventory_mode = 'RECIPE' THEN r.ing_stock    END AS limita_stock,
      CASE WHEN r.inventory_mode = 'RECIPE' THEN r.ing_uom      END AS limita_uom,
      CASE WHEN r.inventory_mode = 'RECIPE' THEN r.ing_necesita END AS limita_necesita
  FROM ritmo r
  WHERE (CASE WHEN r.existencia <= 0 THEN 0 ELSE r.existencia / r.prom_diario END) <= @dias_alerta
  ORDER BY dias_restantes ASC, r.nombre ASC;
END
GO
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
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Que esta usando este producto, para poder DECIRLO con su nombre correcto.
--
-- POR QUE EXISTE
-- --------------
-- `sp_delete_product` ya bloquea la baja y explica el motivo en su mensaje de
-- error. El problema es el canal: el driver (msnodesqlv8) degrada el texto de
-- los ERRORES a un solo byte, asi que "QA Frappe" con acento llegaba a
-- pantalla como "QA Frapp?". Comprobado: las FILAS de datos conservan el
-- acento intacto; solo el mensaje de error lo pierde.
--
-- Cambiar RAISERROR por THROW no arregla nada -se probo, se degrada igual-,
-- porque la perdida no ocurre en SQL Server sino al leer el error. La
-- solucion es no mandar datos del usuario por el canal de errores: SQL sigue
-- negando la baja, y los nombres viajan por donde viajan bien.
--
-- OJO: las condiciones de aqui y las de `sp_delete_product` describen la MISMA
-- regla -receta viva o modificador activo- y tienen que moverse juntas. Este
-- procedimiento solo informa; el que decide es el otro.
CREATE OR ALTER PROCEDURE dbo.sp_get_product_dependencies
    @product_id INT
AS
BEGIN
    SET NOCOUNT ON;

    /* Recetas vivas que lo llevan como ingrediente. Una receta desactivada, o
       la de un producto que ya esta de baja, no consume nada. */
    SELECT DISTINCT
           N'RECIPE' AS tipo,
           pr.id     AS owner_id,
           pr.nombre AS nombre
    FROM dbo.recipe_lines rl
    JOIN dbo.recipes  r  ON r.id = rl.recipe_id AND r.active = 1
    JOIN dbo.products pr ON pr.id = r.product_id AND pr.active = 1
    WHERE rl.ingredient_product_id = @product_id

    UNION ALL

    /* Opciones de modificador que lo agregan o lo sustituyen. */
    SELECT DISTINCT
           N'MODIFIER' AS tipo,
           o.id        AS owner_id,
           g.name + N' / ' + o.name AS nombre
    FROM dbo.modifier_options o
    JOIN dbo.modifier_groups g ON g.id = o.group_id AND g.active = 1
    WHERE o.active = 1
      AND (o.ingredient_product_id = @product_id OR o.replaces_product_id = @product_id)

    ORDER BY tipo, nombre;
END;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Estado de cuenta de cada proveedor.
--
-- QUE FALTABA
-- -----------
-- Solo devolvia `total_paid`, asi que la pantalla de Proveedores podia
-- ensenar cuanto se le ha pagado a alguien pero no cuanto se le compro ni
-- cuanto se le debe. Para saber si habia una deuda pendiente habia que ir a
-- la Tabla de compras y sumar a mano.
--
-- LA FUENTE DE VERDAD ES `purchase.balance`
-- -----------------------------------------
-- El saldo NO se calcula como comprado - pagado. Esos dos numeros pueden no
-- cuadrar por motivos legitimos -un pago suelto sin compra asociada, o
-- historico anterior al catalogo de proveedores- y restarlos inventaria una
-- deuda que nadie registro. `purchase.balance` es lo que la Tabla de compras
-- muestra en la columna Pago, y es lo que se usa aqui: una sola cifra, una
-- sola fuente.
--
-- El proveedor de una compra se lee de la cabecera, con respaldo en la linea
-- para las compras anteriores a "una compra, un proveedor" -misma regla que
-- `sp_get_purchases`, o los totales no cuadrarian entre las dos pantallas-.
CREATE OR ALTER PROCEDURE dbo.sp_get_suppliers_account
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH compras AS (
        SELECT
            COALESCE(p.supplier_id, pd.supplier_id) AS supplier_id,
            p.id,
            p.total,
            p.balance,
            p.datee
        FROM dbo.purchase p
        OUTER APPLY (
            SELECT TOP 1 d.supplier_id
            FROM dbo.purchase_detail d
            WHERE d.puchase_id = p.id AND d.supplier_id IS NOT NULL
            ORDER BY d.id
        ) pd
    ),
    resumen AS (
        SELECT
            supplier_id,
            SUM(ISNULL(total, 0))                                     AS total_comprado,
            SUM(ISNULL(balance, 0))                                   AS saldo_pendiente,
            SUM(CASE WHEN ISNULL(balance, 0) > 0 THEN 1 ELSE 0 END)   AS compras_pendientes,
            COUNT(*)                                                  AS compras,
            MAX(datee)                                                AS last_purchase
        FROM compras
        WHERE supplier_id IS NOT NULL
        GROUP BY supplier_id
    )
    SELECT
        s.id                            AS supplier_id,
        s.nombre,
        s.telefono,
        s.correo,
        s.rfc,
        ISNULL(pg.total_paid, 0)        AS total_paid,
        pg.last_payment,
        ISNULL(c.total_comprado, 0)     AS total_comprado,
        ISNULL(c.saldo_pendiente, 0)    AS saldo_pendiente,
        ISNULL(c.compras_pendientes, 0) AS compras_pendientes,
        ISNULL(c.compras, 0)            AS compras,
        c.last_purchase
    FROM CAT_suppliers s
    LEFT JOIN (
        SELECT supplier_id, SUM(amount) AS total_paid, MAX(datee) AS last_payment
        FROM supplier_payments
        GROUP BY supplier_id
    ) pg ON pg.supplier_id = s.id
    LEFT JOIN resumen c ON c.supplier_id = s.id
    WHERE ISNULL(s.activo, 1) = 1
    ORDER BY s.nombre ASC;
END
GO
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
        s.payment_method,
        s.paid_amount,
        s.balance,
        s.customer_id,
        s.due_date,
        u.usuario AS cashier,
        c.customerName AS customer_name,
        s.service_mode,
        s.register_id,
        r.name AS register_name
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
        p.objeto_impuesto,
        p.tasa_iva,
        p.base_uom,
        mods.modifiers
    FROM dbo.sale_detail d
    INNER JOIN dbo.products p ON p.id = d.product_id
    OUTER APPLY (
        SELECT STRING_AGG(CONCAT(CASE WHEN m.quantity > 1 THEN CONCAT(m.quantity, 'x ') ELSE '' END, m.option_name), ', ')
               WITHIN GROUP (ORDER BY m.id) AS modifiers
        FROM dbo.sale_detail_modifiers m
        WHERE m.sale_detail_id = d.id
    ) mods
    WHERE d.sale_id = @sale_id
    ORDER BY d.id;
END;
GO
