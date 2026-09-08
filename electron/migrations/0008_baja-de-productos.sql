/* 0008_baja-de-productos.sql
 * ---------------------------------------------------------------------------
 * La baja de un producto se valida y se respeta.
 *
 * QUE PASABA
 * ----------
 * `sp_delete_product` hacia el UPDATE a `active = 0` sin mirar nada. Con eso se
 * podia retirar un ingrediente que una receta activa seguia necesitando -o un
 * producto al que apunta un modificador vivo-, y la configuracion quedaba
 * apuntando a algo retirado. Nadie se enteraba hasta intentar vender.
 *
 * Y por el otro lado, `sp_register_sale` no comprobaba `products.active`: las
 * pantallas filtran los productos de baja, pero un catalogo ya cargado en
 * memoria, o una caja secundaria que aun no lo sabe, llegaban igual hasta el
 * registro de la venta.
 *
 * QUE CAMBIA
 * ----------
 * 1. `sp_delete_product` bloquea la baja cuando el producto se usa como
 *    ingrediente de una receta VIVA o lo referencia un modificador VIVO, y
 *    devuelve en el mensaje que recetas o que modificadores son. Vivo significa
 *    activo y, en el caso de una receta, con su producto tambien activo: una
 *    receta apagada no consume nada.
 *
 * 2. `sp_register_sale` rechaza cualquier linea cuyo producto este de baja.
 *
 * NO toca el esquema y NO borra nada: la baja sigue siendo logica. Recetas,
 * lineas de receta, ventas y movimientos de inventario se quedan como estan,
 * porque un ticket de hace seis meses tiene que seguir siendo legible.
 * ---------------------------------------------------------------------------
 */

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Description: Baja LOGICA de un producto (active = 0).
--
-- Nunca borra la fila: sale_detail, purchase_detail e inventory_movements la
-- referencian, y un ticket de hace seis meses tiene que seguir diciendo que se
-- vendio. Dar de baja significa "no se vende mas", no "nunca existio".
--
-- Update: + validacion de dependencias vivas. Antes solo hacia el UPDATE, asi
--         que se podia retirar un ingrediente que una receta activa seguia
--         necesitando y la receta quedaba apuntando a algo retirado. La guarda
--         vive aqui y no solo en la pantalla: el boton se puede deshabilitar,
--         pero el procedimiento es lo unico que no se puede saltar.
-- =============================================
CREATE OR ALTER PROCEDURE sp_delete_product
    @product_id INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @nombre NVARCHAR(100), @activo BIT, @usos NVARCHAR(600), @msg NVARCHAR(900);

    SELECT @nombre = nombre, @activo = active
    FROM dbo.products
    WHERE id = @product_id;

    IF @nombre IS NULL
    BEGIN
        RAISERROR('El producto no existe.', 16, 1);
        RETURN;
    END

    IF @activo = 0
    BEGIN
        RAISERROR('Este producto ya estaba dado de baja.', 16, 1);
        RETURN;
    END

    /* ---------------------------------------------------------- RECETAS
       Solo cuentan las vivas: una receta desactivada, o la de un producto que
       ya esta de baja, no consume nada y no debe bloquear a nadie. */
    SET @usos = STUFF((
        SELECT DISTINCT N', ' + pr.nombre
        FROM dbo.recipe_lines rl
        JOIN dbo.recipes  r  ON r.id = rl.recipe_id AND r.active = 1
        JOIN dbo.products pr ON pr.id = r.product_id AND pr.active = 1
        WHERE rl.ingredient_product_id = @product_id
        FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(600)'), 1, 2, N'');

    IF @usos IS NOT NULL
    BEGIN
        SET @msg = N'"' + @nombre + N'" se usa como ingrediente en: ' + @usos
                 + N'. Quitalo de esas recetas antes de darlo de baja.';
        RAISERROR(@msg, 16, 1);
        RETURN;
    END

    /* ---------------------------------------------------- MODIFICADORES
       ADD y SUBSTITUTE lo agregan; REMOVE y SUBSTITUTE lo reemplazan. En los
       cuatro casos la opcion quedaria apuntando a un producto retirado. */
    SET @usos = STUFF((
        SELECT DISTINCT N', ' + g.name + N' / ' + o.name
        FROM dbo.modifier_options o
        JOIN dbo.modifier_groups g ON g.id = o.group_id AND g.active = 1
        WHERE o.active = 1
          AND (o.ingredient_product_id = @product_id OR o.replaces_product_id = @product_id)
        FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(600)'), 1, 2, N'');

    IF @usos IS NOT NULL
    BEGIN
        SET @msg = N'"' + @nombre + N'" se usa en los modificadores: ' + @usos
                 + N'. Cambialos antes de darlo de baja.';
        RAISERROR(@msg, 16, 1);
        RETURN;
    END

    /* Sin dependencias vivas. El historico se queda donde esta: no se toca
       ninguna receta, ninguna venta y ningun movimiento de inventario. */
    UPDATE dbo.products
    SET active = 0
    WHERE id = @product_id;

    SELECT @product_id AS id, @nombre AS nombre;
END;
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_register_sale — UNICA transaccion de venta de Wybix (Retail y Touch)

   La APP declara: que se vendio, cuanto, a que precio y que opciones eligio.
   La APP NO calcula inventario. Este procedure:

     lineas ─┬─ DIRECT  → requiere el propio producto
             ├─ RECIPE  → receta (variante por tamano, o base × SCALE)
             │            + modificadores ADD / REMOVE / SUBSTITUTE
             └─ NONE    → sin inventario
     ↓ agrupa requerimientos por producto
     ↓ bloquea products en orden ascendente de id (UPDLOCK, HOLDLOCK)
     ↓ valida stock → registra sale, sale_detail (con unit_cost), modifiers
     ↓ inventory_movements (ligados a la linea y al producto vendido)
     ↓ caja (solo efectivo contado, turno de la caja) → COMMIT

   Transicion ADITIVA: @SaleDetails (tipo v1) sigue funcionando tal cual;
   @SaleDetails2 / @SaleModifiers / @service_mode son opcionales.

   Errores dentro de la transaccion: se lanzan con RAISERROR (severidad 16),
   que dentro de un TRY transfiere al CATCH; ES EL CATCH quien hace el
   ROLLBACK. Una sola salida, un solo sitio donde se deshace todo.

   COMO INVOCARLO: directamente (EXEC / Command.Execute), como hace el IPC.
   NO se puede envolver en "INSERT ... EXEC": SQL Server prohibe el ROLLBACK
   dentro de esa construccion y sustituye cualquier error del procedure por
   "Cannot use the ROLLBACK statement within an INSERT-EXEC statement",
   ocultando la causa real (por ejemplo, que falto stock). Es una limitacion
   de INSERT-EXEC, no de este procedure.

   Concurrencia: transaccion corta, sin dispositivos dentro, bloqueo en orden
   consistente. Si SQL Server elige a esta sesion como victima de deadlock
   (1205) NADA quedo escrito: el IPC puede reintentar la misma intencion.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_register_sale]
    @user_id INT,
    @payment_method NVARCHAR(50),
    @SaleDetails dbo.SaleDetailType READONLY,
    @customer_id    INT = NULL,
    @due_date       DATE = NULL,
    @register_id    INT = NULL,
    @SaleDetails2   dbo.SaleDetailType2 READONLY,
    @SaleModifiers  dbo.SaleModifierType READONLY,
    @service_mode   NVARCHAR(10) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @sale_id INT;
    DECLARE @total   DECIMAL(10,2);
    DECLARE @is_credit BIT;
    DECLARE @errmsg NVARCHAR(400);

    IF @register_id IS NULL
        SELECT TOP 1 @register_id = id FROM dbo.registers ORDER BY id;

    SET @is_credit =
      CASE WHEN @customer_id IS NOT NULL AND UPPER(@payment_method) = 'CREDITO' THEN 1 ELSE 0 END;

    IF @service_mode IS NOT NULL
    BEGIN
        SET @service_mode = UPPER(LTRIM(RTRIM(@service_mode)));
        IF @service_mode = '' SET @service_mode = NULL;
        ELSE IF @service_mode NOT IN ('DINE_IN', 'TAKEAWAY')
        BEGIN
            RAISERROR('service_mode invalido: DINE_IN o TAKEAWAY.', 16, 1);
            RETURN;
        END
    END

    /* ---------------------------------------------------- 0) Lineas */
    IF EXISTS (SELECT line_no FROM @SaleDetails2 GROUP BY line_no HAVING COUNT(*) > 1)
    BEGIN
        RAISERROR('line_no repetido en el detalle de la venta.', 16, 1);
        RETURN;
    END

    CREATE TABLE #lines (
        line_no        INT NOT NULL PRIMARY KEY CLUSTERED,
        product_id     INT NOT NULL,
        product_name   NVARCHAR(100) NULL,
        quantity       DECIMAL(12,2) NOT NULL,
        unit_price     DECIMAL(10,2) NOT NULL,
        note           NVARCHAR(200) NULL,
        inventory_mode NVARCHAR(10) NULL,
        product_cost   DECIMAL(14,4) NULL,
        recipe_id      INT NULL,
        scale          DECIMAL(8,4) NOT NULL DEFAULT 1,
        unit_cost      DECIMAL(14,4) NULL
    );

    /* Las lineas v1 reciben line_no >= 100000 para no chocar con v2. */
    INSERT INTO #lines (line_no, product_id, quantity, unit_price, note)
    SELECT 100000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)), product_id, ISNULL(quantity, 0), ISNULL(unit_price, 0), NULL
    FROM @SaleDetails
    UNION ALL
    SELECT line_no, product_id, quantity, unit_price, note
    FROM @SaleDetails2;

    IF NOT EXISTS (SELECT 1 FROM #lines)
    BEGIN
        RAISERROR('La venta no tiene partidas.', 16, 1);
        RETURN;
    END
    IF EXISTS (SELECT 1 FROM #lines WHERE quantity <= 0)
    BEGIN
        RAISERROR('Cada partida necesita una cantidad mayor a cero.', 16, 1);
        RETURN;
    END

    UPDATE l
       SET inventory_mode = p.inventory_mode,
           product_cost   = ISNULL(p.cost, 0),
           product_name   = p.nombre
    FROM #lines l
    JOIN dbo.products p ON p.id = l.product_id;

    IF EXISTS (SELECT 1 FROM #lines WHERE inventory_mode IS NULL)
    BEGIN
        RAISERROR('Un producto de la venta no existe.', 16, 1);
        RETURN;
    END

    /* Un producto dado de baja no vuelve a venderse.
       Las pantallas ya lo ocultan -sp_get_active_products y sp_get_menu_catalog
       filtran active = 1-, pero un catalogo cargado en memoria antes de la baja,
       o una caja secundaria que aun no lo sabe, llegan igual hasta aqui. La
       unica comprobacion que nadie puede saltarse es esta. */
    DECLARE @debaja NVARCHAR(100) = NULL;
    SELECT TOP 1 @debaja = p.nombre
    FROM #lines l
    JOIN dbo.products p ON p.id = l.product_id
    WHERE p.active = 0
    ORDER BY l.line_no;

    IF @debaja IS NOT NULL
    BEGIN
        SET @errmsg = N'El producto "' + @debaja + N'" esta dado de baja y ya no puede venderse.';
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END

    /* ---------------------------------------------- 1) Modificadores */
    CREATE TABLE #mods (
        line_no INT NOT NULL,
        option_id INT NOT NULL,
        qty INT NOT NULL,
        group_id INT NULL,
        role NVARCHAR(15) NULL,
        effect NVARCHAR(12) NULL,
        ingredient_product_id INT NULL,
        replaces_product_id INT NULL,
        qty_base DECIMAL(14,4) NULL,
        qty_factor DECIMAL(8,4) NULL,
        price_delta DECIMAL(10,2) NULL,
        group_name NVARCHAR(80) NULL,
        option_name NVARCHAR(80) NULL
    );

    INSERT INTO #mods
    SELECT m.line_no, m.modifier_option_id, ISNULL(m.quantity, 1),
           o.group_id, g.role, o.effect, o.ingredient_product_id, o.replaces_product_id,
           o.qty_base, o.qty_factor, o.price_delta, g.name, o.name
    FROM @SaleModifiers m
    LEFT JOIN dbo.modifier_options o ON o.id = m.modifier_option_id AND o.active = 1
    LEFT JOIN dbo.modifier_groups g ON g.id = o.group_id AND g.active = 1;

    IF EXISTS (SELECT 1 FROM #mods WHERE group_id IS NULL)
    BEGIN RAISERROR('Un modificador no existe o esta inactivo.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM #mods WHERE qty <= 0)
    BEGIN RAISERROR('La cantidad de un modificador debe ser mayor a cero.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM #mods m LEFT JOIN #lines l ON l.line_no = m.line_no WHERE l.line_no IS NULL)
    BEGIN RAISERROR('Un modificador apunta a una partida inexistente.', 16, 1); RETURN; END
    IF EXISTS (
        SELECT 1 FROM #mods m JOIN #lines l ON l.line_no = m.line_no
        WHERE NOT EXISTS (SELECT 1 FROM dbo.product_modifier_groups pmg WHERE pmg.product_id = l.product_id AND pmg.group_id = m.group_id))
    BEGIN RAISERROR('Un modificador no corresponde al producto de su partida.', 16, 1); RETURN; END
    IF EXISTS (
        SELECT 1 FROM #mods m JOIN dbo.modifier_groups g ON g.id = m.group_id
        GROUP BY m.line_no, m.group_id, g.max_select
        HAVING COUNT(DISTINCT m.option_id) > g.max_select)
    BEGIN RAISERROR('Se eligieron mas opciones de las permitidas en un grupo de modificadores.', 16, 1); RETURN; END
    /* Grupos obligatorios: solo se exigen a las lineas v2 (las v1 no pueden declararlos). */
    IF EXISTS (
        SELECT 1
        FROM #lines l
        JOIN dbo.product_modifier_groups pmg ON pmg.product_id = l.product_id
        JOIN dbo.modifier_groups g ON g.id = pmg.group_id AND g.active = 1 AND g.required = 1
        WHERE l.line_no < 100000
          AND (SELECT COUNT(DISTINCT m.option_id) FROM #mods m WHERE m.line_no = l.line_no AND m.group_id = g.id)
              < CASE WHEN g.min_select > 0 THEN g.min_select ELSE 1 END)
    BEGIN
        SELECT TOP 1 @errmsg = CONCAT('Falta elegir "', g.name, '" para ', l.product_name, '.')
        FROM #lines l
        JOIN dbo.product_modifier_groups pmg ON pmg.product_id = l.product_id
        JOIN dbo.modifier_groups g ON g.id = pmg.group_id AND g.active = 1 AND g.required = 1
        WHERE l.line_no < 100000
          AND (SELECT COUNT(DISTINCT m.option_id) FROM #mods m WHERE m.line_no = l.line_no AND m.group_id = g.id)
              < CASE WHEN g.min_select > 0 THEN g.min_select ELSE 1 END
        ORDER BY l.line_no;
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END

    /* ------------------------------------------------- 2) Recetas */
    /* Receta de la variante elegida (SIZE) si existe; si no, la base. */
    UPDATE l SET recipe_id = r.id
    FROM #lines l
    CROSS APPLY (
        SELECT TOP 1 r.id
        FROM dbo.recipes r
        WHERE r.product_id = l.product_id AND r.active = 1
          AND (r.variant_option_id IS NULL
               OR r.variant_option_id IN (SELECT m.option_id FROM #mods m WHERE m.line_no = l.line_no AND m.role = 'SIZE'))
        ORDER BY CASE WHEN r.variant_option_id IS NULL THEN 1 ELSE 0 END
    ) r
    WHERE l.inventory_mode = 'RECIPE';

    IF EXISTS (SELECT 1 FROM #lines WHERE inventory_mode = 'RECIPE' AND recipe_id IS NULL)
    BEGIN
        SELECT TOP 1 @errmsg = CONCAT('El producto "', product_name, '" no tiene receta configurada.')
        FROM #lines WHERE inventory_mode = 'RECIPE' AND recipe_id IS NULL ORDER BY line_no;
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END

    /* SCALE solo aplica cuando se usa la receta base (la variante ya trae su cantidad). */
    UPDATE l SET scale = m.qty_factor
    FROM #lines l
    JOIN dbo.recipes r ON r.id = l.recipe_id AND r.variant_option_id IS NULL
    JOIN #mods m ON m.line_no = l.line_no AND m.effect = 'SCALE'
    WHERE l.inventory_mode = 'RECIPE';

    /* -------------------------------- 3) Requerimientos por unidad */
    CREATE TABLE #req (
        line_no INT NOT NULL,
        product_id INT NOT NULL,
        qty_per_unit DECIMAL(18,6) NOT NULL,
        source NVARCHAR(20) NOT NULL
    );

    INSERT INTO #req (line_no, product_id, qty_per_unit, source)
    SELECT line_no, product_id, 1, 'SALE' FROM #lines WHERE inventory_mode = 'DIRECT';

    INSERT INTO #req (line_no, product_id, qty_per_unit, source)
    SELECT l.line_no, rl.ingredient_product_id, rl.qty_base * (1 + rl.waste_pct / 100.0) * l.scale, 'RECIPE'
    FROM #lines l
    JOIN dbo.recipe_lines rl ON rl.recipe_id = l.recipe_id
    WHERE l.inventory_mode = 'RECIPE';

    /* REMOVE: retira el ingrediente de la receta. */
    DELETE r
    FROM #req r
    JOIN #mods m ON m.line_no = r.line_no AND m.effect = 'REMOVE' AND m.replaces_product_id = r.product_id
    WHERE r.source = 'RECIPE';

    /* SUBSTITUTE: mismo consumo con otro ingrediente (o el qty_base explicito). */
    UPDATE r
       SET product_id = m.ingredient_product_id,
           qty_per_unit = ISNULL(m.qty_base * l.scale, r.qty_per_unit)
    FROM #req r
    JOIN #lines l ON l.line_no = r.line_no
    JOIN #mods m ON m.line_no = r.line_no AND m.effect = 'SUBSTITUTE' AND m.replaces_product_id = r.product_id
    WHERE r.source = 'RECIPE';

    /* ADD: consumo extra (no escala con el tamano: un shot es un shot). */
    INSERT INTO #req (line_no, product_id, qty_per_unit, source)
    SELECT m.line_no, m.ingredient_product_id, m.qty_base * m.qty, 'RECIPE'
    FROM #mods m
    WHERE m.effect = 'ADD';

    /* Costo de UNA unidad vendida de cada linea, al costo actual de los ingredientes. */
    UPDATE l
       SET unit_cost = CAST(
              CASE WHEN l.inventory_mode = 'NONE' THEN l.product_cost ELSE 0 END
            + ISNULL((SELECT SUM(r.qty_per_unit * ISNULL(p.cost, 0))
                        FROM #req r JOIN dbo.products p ON p.id = r.product_id
                       WHERE r.line_no = l.line_no), 0) AS DECIMAL(14,4))
    FROM #lines l;

    /* Necesidad total por producto, en orden de id (orden de bloqueo). */
    CREATE TABLE #need (
        product_id INT NOT NULL PRIMARY KEY CLUSTERED,
        qty DECIMAL(14,4) NOT NULL
    );
    INSERT INTO #need (product_id, qty)
    SELECT r.product_id, SUM(r.qty_per_unit * l.quantity)
    FROM #req r JOIN #lines l ON l.line_no = r.line_no
    GROUP BY r.product_id;

    CREATE TABLE #map (sale_detail_id INT NOT NULL, line_no INT NOT NULL);

    BEGIN TRY
        BEGIN TRAN;

        /* 4) Bloqueo consistente y validacion de stock.
           LOOP JOIN + FORCE ORDER: se recorre #need por su clave y se toma el
           bloqueo de cada products en orden ascendente de id. */
        SELECT p.id AS product_id, p.stock, n.qty, p.nombre
        INTO #stk
        FROM #need AS n
        INNER LOOP JOIN dbo.products AS p WITH (UPDLOCK, HOLDLOCK) ON p.id = n.product_id
        OPTION (FORCE ORDER);

        DECLARE @pid INT = NULL, @stk DECIMAL(12,2), @rq DECIMAL(14,4), @pname NVARCHAR(100);
        SELECT TOP 1 @pid = product_id, @stk = stock, @rq = qty, @pname = nombre
        FROM #stk WHERE stock < qty ORDER BY product_id;

        IF @pid IS NOT NULL
        BEGIN
            SET @errmsg =
                CONCAT('No hay stock suficiente. ProductoId=', @pid,
                       ', Stock=', CONVERT(NVARCHAR(30), @stk),
                       ', Requerido=', CONVERT(NVARCHAR(30), @rq),
                       ' (', @pname, ')');
            /* El CATCH hace el ROLLBACK: ver nota de cabecera. */
            RAISERROR(@errmsg, 16, 1);
        END

        /* 5) Total */
        SELECT @total = SUM(quantity * unit_price) FROM #lines;

        /* 6) Venta */
        INSERT INTO sales (datee, useer_id, total, payment_method, customer_id, paid_amount, balance, due_date, register_id, service_mode)
        VALUES (
          GETDATE(), @user_id, @total, @payment_method,
          @customer_id,
          CASE WHEN @is_credit = 1 THEN 0 ELSE @total END,
          CASE WHEN @is_credit = 1 THEN @total ELSE 0 END,
          @due_date,
          @register_id,
          @service_mode
        );

        SET @sale_id = SCOPE_IDENTITY();

        /* 7) Detalle (MERGE para recuperar line_no -> sale_detail_id) */
        MERGE INTO dbo.sale_detail AS t
        USING (SELECT line_no, product_id, quantity, unit_price, unit_cost, inventory_mode, note FROM #lines) AS s
           ON 1 = 0
        WHEN NOT MATCHED THEN
            INSERT (sale_id, product_id, quantity, unitary_price, unit_cost, inventory_mode, note)
            VALUES (@sale_id, s.product_id, s.quantity, s.unit_price, s.unit_cost, s.inventory_mode, s.note)
        OUTPUT inserted.id, s.line_no INTO #map (sale_detail_id, line_no);

        INSERT INTO dbo.sale_detail_modifiers (sale_detail_id, modifier_option_id, group_name, option_name, price_delta, quantity, effect)
        SELECT mp.sale_detail_id, m.option_id, m.group_name, m.option_name, ISNULL(m.price_delta, 0), m.qty, m.effect
        FROM #mods m
        JOIN #map mp ON mp.line_no = m.line_no;

        /* 8) Stock */
        UPDATE p
        SET p.stock = p.stock - n.qty
        FROM products p
        JOIN #need n ON n.product_id = p.id;

        /* 9) Movimientos: uno por linea e ingrediente, ligados a la linea y al
              producto vendido; units = unidades vendidas que cubre. */
        INSERT INTO inventory_movements
            (product_id, typee, reference, quantity, datee, descriptionn, source, sale_detail_id, unit_cost, sold_product_id, units)
        SELECT r.product_id,
               'salida',
               CAST(@sale_id AS NVARCHAR(50)),
               SUM(r.qty_per_unit) * l.quantity,
               GETDATE(),
               CASE WHEN MAX(r.source) = 'SALE' THEN 'Venta' ELSE CONCAT('Venta: ', l.product_name) END,
               MAX(r.source),
               mp.sale_detail_id,
               ISNULL(p.cost, 0),
               l.product_id,
               l.quantity
        FROM #req r
        JOIN #lines l ON l.line_no = r.line_no
        JOIN #map mp ON mp.line_no = r.line_no
        JOIN dbo.products p ON p.id = r.product_id
        GROUP BY r.line_no, r.product_id, l.quantity, l.product_name, l.product_id, mp.sale_detail_id, p.cost;

        /* 10) Movimiento CAJA (solo EFECTIVO contado) - turno POR CAJA */
        IF @is_credit = 0 AND UPPER(@payment_method) = 'EFECTIVO'
        BEGIN
            DECLARE @closure_id_open INT;

            SELECT TOP(1) @closure_id_open = id
            FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
            WHERE register_id = @register_id
              AND closed_at IS NULL
            ORDER BY opened_at DESC, id DESC;

            IF @closure_id_open IS NULL
            BEGIN
                RAISERROR('No hay un turno abierto en esta caja para registrar la venta en efectivo.',16,1);
            END

            INSERT INTO cash_movements
            (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES
            (GETDATE(), @user_id, 'SALE', @sale_id, CONCAT('Venta ', @sale_id), @total, NULL, @closure_id_open, @register_id);
        END

        COMMIT TRAN;

        SELECT
            @sale_id        AS sale_id,
            @total          AS total,
            @payment_method AS payment_method,
            @is_credit      AS is_credit,
            @register_id    AS register_id,
            @service_mode   AS service_mode;

    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @num INT = ERROR_NUMBER();
        /* 1205 (deadlock) se re-lanza con su numero original en el mensaje
           para que el IPC lo reconozca y reintente la misma intencion. */
        IF @num = 1205 SET @msg = CONCAT('[1205] ', @msg);
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
