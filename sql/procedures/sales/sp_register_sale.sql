/* sp_register_sale
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
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
    @service_mode   NVARCHAR(10) = NULL,
    -- Identidad del equipo. Ver el bloque MULTICAJA mas abajo: NULO = no se
    -- exige nada, que es el contrato de MonoCaja y el de las versiones previas.
    @machine_id     NVARCHAR(64) = NULL,
    @machine_name   NVARCHAR(120) = NULL,
    -- MODO VENTA ESENCIAL (licencia sin suscripcion activa). Lo decide el
    -- proceso principal con la licencia firmada, nunca la pantalla. Se vende
    -- y se cobra igual, pero el inventario NO se administra: no se valida
    -- existencia, no se descuenta y no se crean movimientos. No se toca
    -- ningun producto (vendible, modo de inventario, recetas, stock): al
    -- renovar todo vuelve tal cual estaba. La venta queda marcada para poder
    -- avisar cuantas hubo y desde cuando.
    @venta_esencial BIT = 0,
    @commercial_quote UNIQUEIDENTIFIER = NULL,
    @commercial_payment_reference NVARCHAR(100) = NULL,
    @payments_json NVARCHAR(MAX) = NULL,
    @client_sale_key UNIQUEIDENTIFIER = NULL,
    @client_sale_hash VARCHAR(64) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @sale_id INT;
    DECLARE @total   DECIMAL(10,2);
    DECLARE @is_credit BIT;
    DECLARE @errmsg NVARCHAR(400);

    /* Si este equipo dice quien es, SU caja es la que tiene arrendada. Caer a
       `TOP 1 ... ORDER BY id` significaria "la Caja 1", que es de otro equipo:
       el mismo error que hacia que la laptop validara la caja de la VM. */
    IF @register_id IS NULL AND NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N'') IS NOT NULL
        SELECT @register_id = a.register_id
        FROM dbo.register_assignments a
        WHERE a.machine_id = @machine_id
          AND a.released_at IS NULL
          AND a.lease_until > SYSUTCDATETIME();

    IF @register_id IS NULL
        SELECT TOP 1 @register_id = id FROM dbo.registers ORDER BY id;

    IF @client_sale_key IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.sales WHERE client_sale_key=@client_sale_key) BEGIN
      IF @client_sale_hash IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.sales WHERE client_sale_key=@client_sale_key AND client_sale_hash=@client_sale_hash AND useer_id=@user_id AND register_id=@register_id) THROW 51000,'La clave de venta ya pertenece a otro cobro.',1;
      SELECT id sale_id,total,payment_method,register_id,service_mode,CAST(CASE WHEN payment_method='CREDITO' THEN 1 ELSE 0 END AS BIT) is_credit FROM dbo.sales WHERE client_sale_key=@client_sale_key;
      RETURN;
    END;

    SET @is_credit =
      CASE WHEN @customer_id IS NOT NULL AND UPPER(@payment_method) = 'CREDITO' THEN 1 ELSE 0 END;

    /* Una venta A CREDITO sin cliente quedaba con @is_credit = 0 y se
       registraba como PAGADA: saldo 0, nadie a quien cobrarle. */
    IF UPPER(@payment_method) = 'CREDITO' AND @customer_id IS NULL
    BEGIN
        RAISERROR('Una venta a credito necesita el cliente.', 16, 1);
        RETURN;
    END


    /* ---------------- MULTICAJA: esta caja es de este equipo ----------------
       La proteccion NO puede vivir solo en el selector de la pantalla. El
       turno es de la CAJA (`cash_closures.register_id`), asi que dos equipos
       declarados C1 comparten turno y comparten corte: las ventas de ambos
       caen en el mismo arqueo. Eso es dinero, y tiene que rechazarse aqui,
       donde no hay UI que saltarse.

       `@machine_id` NULO = el que llama no dice quien es. Entonces NO se
       exige nada: es el contrato de siempre, el que usan las instalaciones de
       una sola caja, las pruebas y cualquier version anterior de la app.

       Cuando SI se identifica, la llamada ademas RENUEVA el arriendo. Vender
       es la senal de vida mas fuerte que existe: una caja que esta cobrando
       no puede perder su identidad porque un temporizador se estrangulo.
       Se comprueba ANTES de abrir transaccion: no hay nada que deshacer.
       ---------------------------------------------------------------------- */
    IF NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N'') IS NOT NULL
    BEGIN
        DECLARE @lease_res NVARCHAR(20), @lease_holder NVARCHAR(64),
                @lease_holder_name NVARCHAR(120), @lease_hasta DATETIME2(0);

        EXEC dbo.sp_register_lease_touch
            @register_id   = @register_id,
            @machine_id    = @machine_id,
            @machine_name  = @machine_name,
            @lease_seconds = 300,
            @resultado     = @lease_res OUTPUT,
            @holder_id     = @lease_holder OUTPUT,
            @holder_name   = @lease_holder_name OUTPUT,
            @lease_until   = @lease_hasta OUTPUT;

        IF @lease_res = N'OCUPADA'
        BEGIN
            /* Sin acentos a proposito: el texto de un error de SQL Server llega
               degradado a un byte por caracter y los acentos se pierden. */
            DECLARE @lease_quien NVARCHAR(120) =
                ISNULL(NULLIF(LTRIM(RTRIM(@lease_holder_name)), N''), N'otro equipo');
            RAISERROR('Esta caja la esta usando %s. Dos equipos no pueden operar la misma caja: cada una lleva su propio turno y su propio corte.', 16, 1, @lease_quien);
            RETURN;
        END
    END

    /* Sin turno abierto en ESTA caja no se vende, se cobre como se cobre.
       Antes solo se exigia para el efectivo, porque el turno hacia falta para
       colgar el movimiento de caja: una venta con tarjeta o a credito entraba
       sin turno y quedaba fuera del corte del dia. El turno no es un detalle
       del efectivo, es a quien pertenece la venta.
       Se comprueba ANTES de abrir transaccion: no hay nada que deshacer. */
    IF NOT EXISTS (
        SELECT 1 FROM dbo.cash_closures
        WHERE register_id = @register_id AND closed_at IS NULL)
    BEGIN
        RAISERROR('No hay un turno abierto en esta caja. Abre el turno antes de vender.', 16, 1);
        RETURN;
    END

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
        variant_option_id INT NULL,
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

    /* En Venta Esencial solo se vende lo COMERCIALMENTE vendible (sellable = 1).
       Un ingrediente o insumo no aparece en la venta, y aqui tampoco entra
       aunque alguien llame el canal a mano: la regla no depende de la
       pantalla. Fuera de Venta Esencial no cambia nada (una orden de servicio
       puede cobrar una refaccion que no se vende en mostrador, y en Venta
       Esencial Servicios esta en pausa). */
    IF ISNULL(@venta_esencial, 0) = 1
    BEGIN
        DECLARE @novendible NVARCHAR(100) = NULL;
        SELECT TOP 1 @novendible = p.nombre
        FROM #lines l
        JOIN dbo.products p ON p.id = l.product_id
        WHERE p.sellable = 0
        ORDER BY l.line_no;

        IF @novendible IS NOT NULL
        BEGIN
            SET @errmsg = N'"' + @novendible + N'" no es un producto de venta: no se puede cobrar en Venta Esencial.';
            RAISERROR(@errmsg, 16, 1);
            RETURN;
        END
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

    /* ------------------------- 3) LA RECETA EFECTIVA -------------------------
       El calculo NO vive aqui: vive en `sp_resolver_receta_efectiva`, que es
       el mismo que usa `sp_check_availability`. Tenerlo escrito dos veces
       seria tener dos motores que empiezan iguales y terminan distintos, y el
       sintoma seria el peor posible: la pantalla dice que hay y el cobro dice
       que no.

       El contrato son tablas temporales. No puede ser una funcion -el
       constructor del baseline solo despliega procedimientos- ni devolver un
       resultset -`INSERT ... EXEC` prohibe el ROLLBACK que este procedimiento
       necesita-.
       ------------------------------------------------------------------------ */
    CREATE TABLE #ef_lineas (
        line_no INT NOT NULL PRIMARY KEY,
        product_id INT NOT NULL,
        inventory_mode NVARCHAR(10) NULL,
        recipe_id INT NULL,
        variant_option_id INT NULL,
        scale DECIMAL(8,4) NULL
    );
    CREATE TABLE #ef_opciones (
        line_no INT NOT NULL,
        modifier_option_id INT NOT NULL,
        qty INT NOT NULL
    );
    CREATE TABLE #ef_requerimientos (
        line_no INT NOT NULL,
        product_id INT NOT NULL,
        qty_per_unit DECIMAL(18,6) NOT NULL,
        origen NVARCHAR(12) NOT NULL,
        modifier_option_id INT NULL,
        recipe_id INT NULL
    );

    INSERT INTO #ef_lineas (line_no, product_id, inventory_mode, scale)
    SELECT line_no, product_id, inventory_mode, 1 FROM #lines;
    INSERT INTO #ef_opciones (line_no, modifier_option_id, qty)
    SELECT line_no, option_id, qty FROM #mods;

    EXEC dbo.sp_resolver_receta_efectiva;

    /* La receta que se uso queda en la linea: es lo que se guarda en el
       detalle para poder decir despues con que receta se preparo. */
    UPDATE l SET recipe_id = e.recipe_id, variant_option_id = e.variant_option_id, scale = e.scale
    FROM #lines l JOIN #ef_lineas e ON e.line_no = l.line_no;

    /* ------------------------------------------------------------------------
       CUANDO NO HAY RECETA, DECIR CUAL DE LAS TRES COSAS PASA.

       El mensaje era siempre el mismo -"no tiene receta configurada"- y en QA
       fue falso: los productos 5 y 7 SI tenian receta, pero solo la de la
       variante (`variant_option_id = 1`). Retail no mandaba ninguna opcion de
       tamano, el CROSS APPLY de arriba no encontraba nada, y la venta se
       rechazaba diciendo que faltaba algo que estaba ahi. Quien lea eso va a
       buscar el problema en el sitio equivocado.

       Son tres situaciones distintas y cada una se arregla en otro lugar:

         SIN RECETA        no hay ninguna fila en `recipes`  -> configurarla
         FALTA LA VARIANTE hay recetas, pero todas por variante y la venta no
                           eligio tamano                     -> elegirlo
         VARIANTE SIN RECETA se eligio un tamano que no tiene receta propia y
                           tampoco hay receta base           -> configurarla

       No se toca la resolucion: una receta puede depender de la variante y eso
       es correcto. Lo que cambia es lo que se cuenta cuando falla.
       ------------------------------------------------------------------------ */
    IF EXISTS (SELECT 1 FROM #lines WHERE inventory_mode = 'RECIPE' AND recipe_id IS NULL)
    BEGIN
        SELECT TOP 1 @errmsg =
            CASE
                WHEN NOT EXISTS (SELECT 1 FROM dbo.recipes r
                                  WHERE r.product_id = l.product_id AND r.active = 1)
                    THEN CONCAT('El producto "', l.product_name, '" no tiene receta configurada.')
                WHEN NOT EXISTS (SELECT 1 FROM #mods m
                                  WHERE m.line_no = l.line_no AND m.role = 'SIZE')
                    THEN CONCAT('Falta elegir el tamano de "', l.product_name,
                                '": su receta depende del tamano y la venta no indico ninguno.')
                ELSE CONCAT('El tamano elegido para "', l.product_name,
                            '" no tiene receta, y el producto no tiene receta base.')
            END
        FROM #lines l
        WHERE l.inventory_mode = 'RECIPE' AND l.recipe_id IS NULL
        ORDER BY l.line_no;
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END


    /* Los requerimientos efectivos pasan a la estructura que ya usaba el resto
       del procedimiento. `source` conserva su significado historico -lo leen
       los reembolsos y las alertas de reposicion-: 'SALE' cuando el producto
       se consume a si mismo, 'RECIPE' cuando sale de una receta o de un
       modificador. */
    CREATE TABLE #req (
        line_no INT NOT NULL,
        product_id INT NOT NULL,
        qty_per_unit DECIMAL(18,6) NOT NULL,
        source NVARCHAR(20) NOT NULL,
        origen NVARCHAR(12) NOT NULL,
        modifier_option_id INT NULL
    );

    INSERT INTO #req (line_no, product_id, qty_per_unit, source, origen, modifier_option_id)
    SELECT line_no, product_id, qty_per_unit,
           CASE WHEN origen = 'DIRECT' THEN 'SALE' ELSE 'RECIPE' END,
           origen, modifier_option_id
    FROM #ef_requerimientos;

    /* Una cotización proviene del proceso principal, nunca de precios enviados por UI.
       La lista de partidas/opciones debe coincidir exactamente. Su consumo es atómico abajo. */
    DECLARE @cq NVARCHAR(MAX) = NULL;
    IF @commercial_quote IS NOT NULL
    BEGIN
      SELECT @cq=payload FROM dbo.commercial_quotes WHERE id=@commercial_quote AND actor_id=@user_id
        AND ISNULL(register_id,-1)=ISNULL(@register_id,-1) AND sale_id IS NULL
        AND ((@commercial_payment_reference IS NULL AND payment_reference IS NULL AND expires_at>SYSUTCDATETIME())
          OR (@payment_method='TERMINAL_MP' AND payment_reference=@commercial_payment_reference));
      IF @cq IS NULL THROW 51000,'La cotización venció o pertenece a otra cuenta.',1;
      IF (SELECT COUNT(*) FROM OPENJSON(@cq,'$.lines'))<>(SELECT COUNT(*) FROM #lines)
        THROW 51000,'Las partidas no coinciden con la cotización.',1;
      IF EXISTS(SELECT 1 FROM OPENJSON(@cq,'$.lines') WITH(line_no INT, productId INT, qty DECIMAL(12,2), unitPrice DECIMAL(10,2)) c
        LEFT JOIN #lines l ON l.line_no=c.line_no WHERE l.line_no IS NULL OR l.product_id<>c.productId OR l.quantity<>c.qty OR l.unit_price<>c.unitPrice)
        THROW 51000,'El precio o cantidad no coincide con la cotización.',1;
      IF EXISTS(SELECT 1 FROM (SELECT line_no,option_id,qty FROM #mods EXCEPT
        SELECT c.line_no,m.optionId,m.quantity FROM OPENJSON(@cq,'$.lines') WITH(line_no INT,options NVARCHAR(MAX) AS JSON) c
        CROSS APPLY OPENJSON(c.options) WITH(optionId INT,quantity INT) m) x)
        OR EXISTS(SELECT 1 FROM (SELECT c.line_no,m.optionId,m.quantity FROM OPENJSON(@cq,'$.lines') WITH(line_no INT,options NVARCHAR(MAX) AS JSON) c
        CROSS APPLY OPENJSON(c.options) WITH(optionId INT,quantity INT) m EXCEPT SELECT line_no,option_id,qty FROM #mods) x)
        THROW 51000,'Las opciones no coinciden con la cotización.',1;
    END;

    /* ------------------------ PRECIO DE LOS MODIFICADORES --------------------
       El precio de las opciones lo decide SQL, no la pantalla.

       Hasta ahora la interfaz sumaba los `price_delta` y mandaba un
       `unit_price` ya calculado, y aqui se aceptaba tal cual. Es la unica
       parte del flujo donde la interfaz podia cobrar una cosa y el inventario
       aplicar otra: elegir leche de almendra -que SI se descuenta del
       almacen- y cobrar el precio de la normal.

       Se compara SOLO la parte que pertenece a los modificadores, y solo en
       las lineas que llevan alguno con precio. Una linea sin opciones no se
       toca: el precio de un producto suelto sigue siendo cosa de la pantalla,
       con sus politicas y sus excepciones.

       La tolerancia de un centavo absorbe el redondeo decimal; cualquier cosa
       mayor es una discrepancia de verdad.
       ------------------------------------------------------------------------ */
    IF @commercial_quote IS NULL AND EXISTS (SELECT 1 FROM #mods WHERE ISNULL(price_delta, 0) <> 0)
    BEGIN
        DECLARE @linea_mal INT, @esperado DECIMAL(10,2), @recibido DECIMAL(10,2), @prod NVARCHAR(100);

        SELECT TOP 1
               @linea_mal = l.line_no,
               @prod      = l.product_name,
               @recibido  = l.unit_price,
               @esperado  = CAST(p.price + d.delta AS DECIMAL(10,2))
        FROM #lines l
        JOIN dbo.products p ON p.id = l.product_id
        CROSS APPLY (SELECT delta = ISNULL(SUM(m.price_delta * m.qty), 0)
                       FROM #mods m WHERE m.line_no = l.line_no) d
        WHERE d.delta <> 0
          AND ABS(l.unit_price - (p.price + d.delta)) > 0.01
        ORDER BY l.line_no;

        IF @linea_mal IS NOT NULL
        BEGIN
            SET @errmsg = CONCAT(
                'El precio de "', @prod, '" no coincide con sus opciones: se esperaba ',
                CONVERT(NVARCHAR(30), @esperado), ' y llego ', CONVERT(NVARCHAR(30), @recibido),
                '. Vuelve a agregar el producto.');
            RAISERROR(@errmsg, 16, 1);
            RETURN;
        END
    END

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
        IF @client_sale_key IS NOT NULL BEGIN
          DECLARE @prior_id INT, @prior_hash VARCHAR(64);
          SELECT @prior_id=id,@prior_hash=client_sale_hash FROM dbo.sales WITH(UPDLOCK,HOLDLOCK) WHERE client_sale_key=@client_sale_key;
          IF @prior_id IS NOT NULL BEGIN
            IF @prior_hash IS NULL OR @client_sale_hash IS NULL OR @prior_hash<>@client_sale_hash THROW 51000,'La identidad del cobro ya pertenece a otra intencion.',1;
            COMMIT TRAN; SELECT id AS sale_id,total,payment_method,register_id,service_mode,CAST(0 AS BIT) AS is_credit FROM dbo.sales WHERE id=@prior_id; RETURN;
          END
        END
        DECLARE @sale_closure INT;
        SELECT TOP 1 @sale_closure=id FROM dbo.cash_closures WITH(UPDLOCK,HOLDLOCK) WHERE register_id=@register_id AND closed_at IS NULL ORDER BY id DESC;
        IF @sale_closure IS NULL THROW 51000,'Abre el turno de esta caja antes de vender.',1;
        IF @commercial_quote IS NOT NULL
        BEGIN
          IF NOT EXISTS(SELECT 1 FROM dbo.commercial_quotes WITH(UPDLOCK,HOLDLOCK) WHERE id=@commercial_quote
              AND sale_id IS NULL AND ((@commercial_payment_reference IS NULL AND payment_reference IS NULL AND expires_at>SYSUTCDATETIME() AND policy_version=(SELECT version FROM dbo.commercial_policy WITH(HOLDLOCK) WHERE id=1))
                OR (@payment_method='TERMINAL_MP' AND payment_reference=@commercial_payment_reference)))
            THROW 51000,'La cotización cambió o ya se utilizó. Revisa la cuenta.',1;
          IF @commercial_payment_reference IS NULL AND EXISTS(SELECT 1 FROM OPENJSON(@cq,'$.catalog') WITH(id INT,price DECIMAL(10,2)) c
             JOIN dbo.products p WITH(HOLDLOCK) ON p.id=c.id WHERE p.price<>c.price)
            THROW 51000,'Cambió el precio del catálogo. Revisa la cuenta.',1;
          IF @commercial_payment_reference IS NULL AND EXISTS(SELECT 1 FROM OPENJSON(@cq,'$.optionPrices') WITH(id INT,price DECIMAL(10,2)) c
             LEFT JOIN dbo.modifier_options o WITH(HOLDLOCK) ON o.id=c.id WHERE o.id IS NULL OR o.active=0 OR o.price_delta<>c.price)
            THROW 51000,'Cambió el precio de una opción. Revisa la cuenta.',1;
        END;

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

        IF @pid IS NOT NULL AND ISNULL(@venta_esencial, 0) = 0
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
        DECLARE @cash_applied DECIMAL(12,2)=CASE WHEN @payment_method='EFECTIVO' THEN @total ELSE 0 END;
        DECLARE @pay TABLE(method NVARCHAR(50),amount DECIMAL(12,2),received DECIMAL(12,2),reference NVARCHAR(100));
        IF @payments_json IS NOT NULL BEGIN
          IF ISJSON(@payments_json)<>1 OR LEFT(LTRIM(@payments_json),1)<>'[' OR @is_credit=1 OR @payment_method='TERMINAL_MP' THROW 51000,'Distribucion de pagos invalida.',1;
          IF EXISTS(SELECT 1 FROM OPENJSON(@payments_json) j WHERE j.type<>5 OR TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(j.value,'$.amount')) IS NULL OR TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(j.value,'$.amount'))<>TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(j.value,'$.amount')) OR (JSON_VALUE(j.value,'$.received') IS NOT NULL AND (TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(j.value,'$.received')) IS NULL OR TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(j.value,'$.received'))<>TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(j.value,'$.received')))) OR LEN(JSON_VALUE(j.value,'$.reference'))>100) THROW 51000,'Importe o referencia de pago invalido.',1;
          INSERT @pay SELECT method,amount,CASE WHEN method='EFECTIVO' THEN ISNULL(received,amount) ELSE NULL END,reference FROM OPENJSON(@payments_json) WITH(method NVARCHAR(50),amount DECIMAL(12,2),received DECIMAL(12,2),reference NVARCHAR(100));
          IF (SELECT COUNT(*) FROM @pay) NOT BETWEEN 1 AND 4 OR EXISTS(SELECT 1 FROM @pay WHERE method IS NULL OR method NOT IN('EFECTIVO','TARJETA','TRANSFERENCIA','PLATAFORMA') OR amount IS NULL OR amount<=0 OR (method='EFECTIVO' AND received<amount)) OR EXISTS(SELECT method FROM @pay GROUP BY method HAVING COUNT(*)>1) OR (SELECT SUM(amount) FROM @pay)<>@total THROW 51000,'Los pagos deben cubrir exactamente la venta, sin metodos duplicados.',1;
          SELECT @cash_applied=ISNULL(SUM(CASE WHEN method='EFECTIVO' THEN amount ELSE 0 END),0) FROM @pay;
          SET @payment_method=CASE WHEN (SELECT COUNT(*) FROM @pay)>1 THEN 'MIXTO' ELSE (SELECT TOP 1 method FROM @pay) END;
        END
        ELSE IF @payment_method='MIXTO' THROW 51000,'Falta la distribucion del pago mixto.',1;

        /* 5b) CREDITO: el cliente puede llevarselo fiado.
           La pantalla ya filtra, pero la regla vive AQUI, donde no hay pantalla
           que saltarse. La fila del cliente se bloquea: dos cajas vendiendole a
           la vez no pueden gastar dos veces el mismo disponible.

           Misma regla que sp_get_customers y sp_get_customers_with_credit_available:
             - activo, con limite, y sin riesgo alto (3);
             - sin ventas VENCIDAS: vencida = vencimiento + dias de gracia < hoy;
             - la deuda abierta mas esta venta no pasa del limite.
           Y si la venta no trae vencimiento, vence a los dias de plazo del cliente. */
        IF @is_credit = 1
        BEGIN
            DECLARE @cr_limite DECIMAL(12,2), @cr_activo BIT, @cr_riesgo TINYINT,
                    @cr_plazo INT, @cr_gracia INT, @cr_deuda DECIMAL(12,2), @cr_vencidas INT,
                    @cr_hoy DATE = CONVERT(date, GETDATE());

            SELECT @cr_limite = credit_limit, @cr_activo = active, @cr_riesgo = risk_level,
                   @cr_plazo = terms_days, @cr_gracia = grace_days
            FROM dbo.customers WITH (UPDLOCK, HOLDLOCK)
            WHERE id = @customer_id;

            IF @cr_limite IS NULL
                RAISERROR('El cliente de la venta a credito no existe.', 16, 1);
            IF @cr_activo = 0
                RAISERROR('El cliente esta inactivo: no se le puede vender a credito.', 16, 1);
            IF @cr_limite <= 0
                RAISERROR('Este cliente no tiene credito autorizado.', 16, 1);
            IF @cr_riesgo >= 3
                RAISERROR('Este cliente esta en riesgo alto: el credito nuevo esta suspendido.', 16, 1);

            SELECT @cr_deuda = ISNULL(SUM(balance), 0),
                   @cr_vencidas = ISNULL(SUM(CASE WHEN due_date IS NOT NULL
                                                   AND DATEADD(DAY, @cr_gracia, due_date) < @cr_hoy
                                                  THEN 1 ELSE 0 END), 0)
            FROM dbo.sales
            WHERE customer_id = @customer_id
              AND UPPER(payment_method) = 'CREDITO'
              AND balance > 0;

            IF @cr_vencidas > 0
                RAISERROR('Este cliente tiene ventas a credito vencidas. Registra un abono antes de volver a venderle a credito.', 16, 1);

            IF @cr_deuda + @total > @cr_limite
            BEGIN
                SET @errmsg = CONCAT('La venta ($', FORMAT(@total, 'N2', 'es-MX'),
                                     ') supera el credito disponible del cliente ($',
                                     FORMAT(CASE WHEN @cr_limite - @cr_deuda > 0 THEN @cr_limite - @cr_deuda ELSE 0 END, 'N2', 'es-MX'),
                                     ').');
                RAISERROR(@errmsg, 16, 1);
            END

            IF @due_date IS NULL AND @cr_plazo > 0
                SET @due_date = DATEADD(DAY, @cr_plazo, @cr_hoy);
        END

        /* 6) Venta */
        INSERT INTO sales (datee, useer_id, total, payment_method, customer_id, paid_amount, balance, due_date, register_id, service_mode, venta_esencial)
        VALUES (
          GETDATE(), @user_id, @total, @payment_method,
          @customer_id,
          CASE WHEN @is_credit = 1 THEN 0 ELSE @total END,
          CASE WHEN @is_credit = 1 THEN @total ELSE 0 END,
          @due_date,
          @register_id,
          @service_mode,
          ISNULL(@venta_esencial, 0)
        );

        SET @sale_id = SCOPE_IDENTITY();
        UPDATE dbo.sales SET client_sale_key=@client_sale_key,client_sale_hash=@client_sale_hash,closure_id=@sale_closure WHERE id=@sale_id;
        IF @payments_json IS NOT NULL INSERT dbo.sale_payments(sale_id,payment_method,amount,received,reference) SELECT @sale_id,method,amount,received,reference FROM @pay;
        ELSE IF @is_credit=0 INSERT dbo.sale_payments(sale_id,payment_method,amount) VALUES(@sale_id,@payment_method,@total);
        IF @commercial_quote IS NOT NULL BEGIN
          UPDATE dbo.commercial_quotes SET sale_id=@sale_id WHERE id=@commercial_quote;
          UPDATE dbo.sales SET commercial_snapshot=@cq WHERE id=@sale_id;
        END;

        /* El cupón de una cotización se consume DENTRO de la transacción de venta. */
        DECLARE @coupon_code NVARCHAR(24)=JSON_VALUE(@cq,'$.coupon.code'),@coupon_id INT;
        IF @coupon_code IS NOT NULL
        BEGIN
          UPDATE ci SET uses_count=ci.uses_count+1,status=CASE WHEN ci.uses_count+1>=ci.uses_allowed THEN 'REDEEMED' ELSE ci.status END,sale_id=ISNULL(ci.sale_id,@sale_id)
          FROM dbo.coupon_instances ci JOIN dbo.coupon_definitions cd ON cd.id=ci.definition_id
          WHERE ci.code=@coupon_code AND ci.id=TRY_CONVERT(INT,JSON_VALUE(@cq,'$.coupon.instanceId')) AND cd.kind='FREE_PRODUCT' AND cd.product_id=TRY_CONVERT(INT,JSON_VALUE(@cq,'$.coupon.productId')) AND ci.status='ISSUED' AND cd.active=1 AND ci.uses_count<ci.uses_allowed AND (ci.expires_at IS NULL OR ci.expires_at>=SYSDATETIME());
          IF @@ROWCOUNT<>1 THROW 51000,'El cupón venció o ya se utilizó. La venta no se registró.',1;
          SELECT @coupon_id=id FROM dbo.coupon_instances WHERE code=@coupon_code;
          INSERT dbo.loyalty_redemptions(kind,reward_instance_id,coupon_instance_id,sale_id,register_id,machine_id,amount_applied,created_at)
          VALUES('COUPON',NULL,@coupon_id,@sale_id,@register_id,@machine_id,TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(@cq,'$.coupon.amountApplied')),SYSDATETIME());
        END;

        /* 7) Detalle (MERGE para recuperar line_no -> sale_detail_id) */
        /* `recipe_id` y `variant_option_id` dejan constancia de CON QUE receta
           se preparo esta linea. No son el historico completo -si manana
           cambian `recipe_lines`, la receta ya no dice lo mismo-, pero
           permiten responder "esto se hizo con la receta Grande" sin tener que
           deducirlo. El consumo real queda congelado en inventory_movements. */
        MERGE INTO dbo.sale_detail AS t
        USING (SELECT line_no, product_id, quantity, unit_price, unit_cost, inventory_mode, note,
                      recipe_id, variant_option_id FROM #lines) AS s
           ON 1 = 0
        WHEN NOT MATCHED THEN
            INSERT (sale_id, product_id, quantity, unitary_price, unit_cost, inventory_mode, note,
                    recipe_id, variant_option_id)
            VALUES (@sale_id, s.product_id, s.quantity, s.unit_price, s.unit_cost, s.inventory_mode, s.note,
                    s.recipe_id, s.variant_option_id)
        OUTPUT inserted.id, s.line_no INTO #map (sale_detail_id, line_no);
        UPDATE d SET tax_rate=p.tasa_iva,tax_object=p.objeto_impuesto FROM dbo.sale_detail d JOIN dbo.products p ON p.id=d.product_id WHERE d.sale_id=@sale_id;

        IF @cq IS NOT NULL UPDATE d SET commercial_snapshot=c.audit
          FROM dbo.sale_detail d JOIN #map m ON m.sale_detail_id=d.id
          JOIN OPENJSON(@cq,'$.lines') WITH(line_no INT,audit NVARCHAR(MAX) AS JSON) c ON c.line_no=m.line_no;

        /* El snapshot guarda lo que se COBRO y ahora tambien lo que el
           modificador HIZO fisicamente: que ingrediente metio, cual quito y
           con que cantidades. Antes solo quedaba el nombre y el precio, asi
           que auditar "por que esta venta consumio leche de almendra" obligaba
           a mirar la definicion ACTUAL de la opcion, que pudo cambiar.
           `price_delta` sale de `modifier_options`, no de lo que mando la
           pantalla: el precio canonico es el de la configuracion. */
        INSERT INTO dbo.sale_detail_modifiers (
            sale_detail_id, modifier_option_id, group_name, option_name, price_delta, quantity, effect,
            ingredient_product_id, replaces_product_id, qty_base_aplicado, qty_factor_aplicado)
        SELECT mp.sale_detail_id, m.option_id, m.group_name, m.option_name, ISNULL(m.price_delta, 0), m.qty, m.effect,
               m.ingredient_product_id, m.replaces_product_id, m.qty_base, m.qty_factor
        FROM #mods m
        JOIN #map mp ON mp.line_no = m.line_no;

        /* 8 y 9) Inventario. En Venta Esencial NO se administra: ni stock ni
              movimientos. La venta registrada es la evidencia. */
        IF ISNULL(@venta_esencial, 0) = 0
        BEGIN
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
        END

        /* 10) Movimiento CAJA (solo EFECTIVO contado) - turno POR CAJA */
        IF @is_credit = 0 AND @cash_applied > 0
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
            (GETDATE(), @user_id, 'SALE', @sale_id, CONCAT('Venta ', @sale_id), @cash_applied, NULL, @closure_id_open, @register_id);
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
