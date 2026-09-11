/* ============================================================
   0016 — receta efectiva

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0016_receta-efectiva.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0016_receta-efectiva.sql ========== */
/* ---------------------------------------------------------------------------
   BLOQUE DE ESQUEMA — snapshot de la receta efectiva.

   Todo ADITIVO y anulable. Ninguna venta historica cambia de significado: las
   columnas nuevas quedan en NULL para lo ya vendido, que es la verdad -de esas
   ventas no sabemos con que receta se prepararon- y no se inventa nada.

   QUE SE CONGELA Y DONDE
   ----------------------
   sale_detail.recipe_id / variant_option_id
       con QUE receta se preparo la linea. No es el historico completo: si
       manana editan `recipe_lines`, esa receta ya no dice lo mismo.

   sale_detail_modifiers.ingredient_product_id / replaces_product_id /
   qty_base_aplicado / qty_factor_aplicado
       que hizo FISICAMENTE cada modificador en el momento de la venta. Antes
       solo quedaba el nombre y el precio, asi que auditar "por que esta venta
       consumio leche de almendra" obligaba a mirar la definicion ACTUAL de la
       opcion, que pudo cambiar.

   El consumo REAL -que producto, cuanto, a que costo- ya estaba congelado en
   `inventory_movements`, ligado a la linea vendida. Por eso no se duplica aqui
   la cantidad efectiva de cada ingrediente: existiria dos veces y podrian
   discrepar. El reembolso sigue leyendo los movimientos, nunca recalculando.

   Idempotente: se puede reejecutar.
   --------------------------------------------------------------------------- */

IF COL_LENGTH(N'dbo.sale_detail', N'recipe_id') IS NULL
    ALTER TABLE dbo.sale_detail ADD recipe_id INT NULL;
GO

IF COL_LENGTH(N'dbo.sale_detail', N'variant_option_id') IS NULL
    ALTER TABLE dbo.sale_detail ADD variant_option_id INT NULL;
GO

IF COL_LENGTH(N'dbo.sale_detail_modifiers', N'ingredient_product_id') IS NULL
    ALTER TABLE dbo.sale_detail_modifiers ADD ingredient_product_id INT NULL;
GO

IF COL_LENGTH(N'dbo.sale_detail_modifiers', N'replaces_product_id') IS NULL
    ALTER TABLE dbo.sale_detail_modifiers ADD replaces_product_id INT NULL;
GO

IF COL_LENGTH(N'dbo.sale_detail_modifiers', N'qty_base_aplicado') IS NULL
    ALTER TABLE dbo.sale_detail_modifiers ADD qty_base_aplicado DECIMAL(14, 4) NULL;
GO

IF COL_LENGTH(N'dbo.sale_detail_modifiers', N'qty_factor_aplicado') IS NULL
    ALTER TABLE dbo.sale_detail_modifiers ADD qty_factor_aplicado DECIMAL(8, 4) NULL;
GO

/* Sin clave foranea a proposito: el snapshot tiene que sobrevivir aunque la
   receta o la opcion se borren manana. Una FK obligaria a conservarlas para
   siempre o a perder el historico, y las dos cosas son peores. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sale_detail_recipe' AND object_id = OBJECT_ID(N'dbo.sale_detail'))
CREATE NONCLUSTERED INDEX IX_sale_detail_recipe ON dbo.sale_detail (recipe_id) WHERE recipe_id IS NOT NULL;
GO

/* ---------- sp_check_availability (SQL_STORED_PROCEDURE) ---------- */
/* sp_check_availability
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_check_availability — cuantas puedo preparar CON ESTAS OPCIONES.

   QUE PROBLEMA RESUELVE
   ---------------------
   `sp_get_menu_catalog` calcula la disponibilidad desde la receta BASE. Es
   correcto para pintar la rejilla, cuando todavia no hay nada elegido, pero
   deja de serlo en cuanto alguien elige: un latte podia mostrarse disponible y
   fallar al cobrar porque la leche de almendra que eligio estaba agotada. El
   mensaje que veia el cajero no hablaba de la leche.

   Son DOS preguntas distintas y aqui se responde la segunda:

     catalogo    "¿puedo ofrecer este producto?"   -> receta base, estimacion
     efectiva    "¿puedo preparar ESTA combinacion?" -> receta efectiva real

   USA EL MISMO MOTOR QUE LA VENTA
   -------------------------------
   `sp_resolver_receta_efectiva`, el mismo procedimiento que usa
   `sp_register_sale`. No es una copia parecida: es el mismo codigo. Si fueran
   dos, empezarian iguales y terminarian distintos, y el sintoma seria que la
   pantalla promete lo que el cobro rechaza.

   ESTO NO AUTORIZA NADA
   ---------------------
   Es informacion para la interfaz. La venta vuelve a validar existencias
   DENTRO de su transaccion, con los productos bloqueados. Entre esta consulta
   y el cobro puede vender otra caja, y esa carrera la resuelve la transaccion,
   no esta respuesta.

   Devuelve una fila: disponible (unidades enteras), y si algo limita, cual es
   y cuanto hay.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_check_availability]
    @product_id INT,
    @SaleModifiers dbo.SaleModifierType READONLY
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id AND active = 1)
    BEGIN
        SELECT CAST(0 AS INT) AS disponible, CAST(0 AS BIT) AS hay_receta,
               CAST(NULL AS INT) AS limita_product_id, CAST(NULL AS NVARCHAR(100)) AS limita_nombre,
               CAST(NULL AS DECIMAL(18,6)) AS limita_necesita, CAST(NULL AS DECIMAL(12,2)) AS limita_stock,
               CAST(NULL AS NVARCHAR(10)) AS limita_uom,
               N'El producto no existe o esta inactivo.' AS motivo;
        RETURN;
    END

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

    INSERT INTO #ef_lineas (line_no, product_id, scale) VALUES (1, @product_id, 1);
    INSERT INTO #ef_opciones (line_no, modifier_option_id, qty)
    SELECT 1, modifier_option_id, ISNULL(quantity, 1) FROM @SaleModifiers;

    EXEC dbo.sp_resolver_receta_efectiva;

    DECLARE @modo NVARCHAR(10), @recipe_id INT;
    SELECT @modo = inventory_mode, @recipe_id = recipe_id FROM #ef_lineas WHERE line_no = 1;

    /* Un producto con receta y sin receta resoluble no es "cero disponible":
       es que falta configurarlo, o falta elegir el tamano. Se distingue. */
    IF @modo = 'RECIPE' AND @recipe_id IS NULL
    BEGIN
        SELECT CAST(0 AS INT) AS disponible, CAST(0 AS BIT) AS hay_receta,
               CAST(NULL AS INT) AS limita_product_id, CAST(NULL AS NVARCHAR(100)) AS limita_nombre,
               CAST(NULL AS DECIMAL(18,6)) AS limita_necesita, CAST(NULL AS DECIMAL(12,2)) AS limita_stock,
               CAST(NULL AS NVARCHAR(10)) AS limita_uom,
               CASE
                   WHEN NOT EXISTS (SELECT 1 FROM dbo.recipes r WHERE r.product_id = @product_id AND r.active = 1)
                       THEN N'Este producto no tiene receta configurada.'
                   WHEN NOT EXISTS (SELECT 1 FROM #ef_opciones o
                                     JOIN dbo.modifier_options mo ON mo.id = o.modifier_option_id
                                     JOIN dbo.modifier_groups g ON g.id = mo.group_id AND g.role = 'SIZE')
                       THEN N'Falta elegir el tamano: la receta depende de el.'
                   ELSE N'El tamano elegido no tiene receta.'
               END AS motivo;
        RETURN;
    END

    /* NONE no consume nada: siempre se puede preparar. */
    IF NOT EXISTS (SELECT 1 FROM #ef_requerimientos)
    BEGIN
        SELECT CAST(999999 AS INT) AS disponible, CAST(1 AS BIT) AS hay_receta,
               CAST(NULL AS INT) AS limita_product_id, CAST(NULL AS NVARCHAR(100)) AS limita_nombre,
               CAST(NULL AS DECIMAL(18,6)) AS limita_necesita, CAST(NULL AS DECIMAL(12,2)) AS limita_stock,
               CAST(NULL AS NVARCHAR(10)) AS limita_uom, CAST(NULL AS NVARCHAR(200)) AS motivo;
        RETURN;
    END

    /* Cuantas unidades alcanzan, y cual es el ingrediente que pone el limite.
       Se agrupa por producto: si un ingrediente aparece dos veces -receta mas
       un extra del mismo- lo que manda es la suma, no cada parte. */
    SELECT TOP 1
        CAST(CASE WHEN t.necesita <= 0 THEN 999999
                  ELSE FLOOR(ISNULL(p.stock, 0) / t.necesita) END AS INT) AS disponible,
        CAST(1 AS BIT) AS hay_receta,
        p.id AS limita_product_id,
        p.nombre AS limita_nombre,
        t.necesita AS limita_necesita,
        ISNULL(p.stock, 0) AS limita_stock,
        p.base_uom AS limita_uom,
        CASE WHEN ISNULL(p.stock, 0) < t.necesita
             THEN CONCAT(N'No hay suficiente ', p.nombre, N' para preparar esta combinacion.')
             ELSE NULL END AS motivo
    FROM (SELECT product_id, SUM(qty_per_unit) AS necesita
            FROM #ef_requerimientos GROUP BY product_id) t
    JOIN dbo.products p ON p.id = t.product_id
    ORDER BY CASE WHEN t.necesita <= 0 THEN 999999
                  ELSE FLOOR(ISNULL(p.stock, 0) / t.necesita) END ASC,
             p.id ASC;
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

/* ---------- sp_register_sale (SQL_STORED_PROCEDURE) ---------- */
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
    @machine_name   NVARCHAR(120) = NULL
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

    SET @is_credit =
      CASE WHEN @customer_id IS NOT NULL AND UPPER(@payment_method) = 'CREDITO' THEN 1 ELSE 0 END;


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
    IF EXISTS (SELECT 1 FROM #mods WHERE ISNULL(price_delta, 0) <> 0)
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

/* ---------- sp_resolver_receta_efectiva (SQL_STORED_PROCEDURE) ---------- */
/* sp_resolver_receta_efectiva
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_resolver_receta_efectiva — LA receta efectiva. Una sola.

   QUE ES LA RECETA EFECTIVA
   -------------------------
   Lo que de verdad hay que sacar del almacen para preparar UNA unidad de un
   producto, con las opciones que eligio el cliente ya aplicadas:

       receta base (o la del tamano)
       x factor de escala
       - ingredientes removidos
       ~ ingredientes sustituidos
       + ingredientes anadidos

   POR QUE VIVE AQUI Y NO DENTRO DE LA VENTA
   -----------------------------------------
   Este calculo lo necesitan DOS cosas: registrar la venta y responder
   "¿cuantos de estos puedo preparar?". Tenerlo escrito dos veces es tener dos
   motores que empiezan iguales y terminan distintos, y el sintoma seria el
   peor posible: la pantalla dice que hay y el cobro dice que no, o al reves.

   POR QUE UN PROCEDIMIENTO Y NO UNA FUNCION
   -----------------------------------------
   Una funcion de tabla seria mas comoda de invocar, pero el constructor del
   baseline solo despliega objetos de tipo SQL_STORED_PROCEDURE: una funcion
   tendria su archivo en Git y NO viajaria al instalador. Ya paso dos veces
   (`sp_get_product_dependencies`, `sp_register_lease_touch`) y no se repite.

   Tampoco puede devolver un resultset: `sp_register_sale` tendria que hacer
   `INSERT ... EXEC`, y SQL Server prohibe el ROLLBACK dentro de esa
   construccion -sustituye el error real por otro que no dice nada-.

   Asi que el contrato son TABLAS TEMPORALES que crea quien llama:

     #ef_lineas       line_no, product_id, inventory_mode
                      + recipe_id, variant_option_id, scale  (los rellena este
                        procedimiento: son su respuesta, no su entrada)
     #ef_opciones     line_no, modifier_option_id, qty
     #ef_requerimientos  se llena aqui: que producto, cuanto, y de donde sale

   Es un acoplamiento explicito y documentado, y a cambio hay UNA sola
   implementacion de la regla.

   NO decide si algo esta mal: si un producto RECIPE se queda sin receta, deja
   `recipe_id` en NULL y quien llama dice por que (la venta con un mensaje, la
   disponibilidad devolviendo cero). Los mensajes son de quien tiene contexto.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_resolver_receta_efectiva]
AS
BEGIN
    SET NOCOUNT ON;

    /* Lo que el producto ES, si quien llama no lo dijo. */
    UPDATE l SET inventory_mode = ISNULL(l.inventory_mode, p.inventory_mode)
    FROM #ef_lineas l JOIN dbo.products p ON p.id = l.product_id;

    /* ---------------------------------------------------- 1) opciones
       Se releen de `modifier_options` en vez de fiarse de lo que llegue: el
       efecto, el ingrediente y las cantidades son configuracion, no algo que
       pueda decidir quien pide la venta. */
    IF OBJECT_ID('tempdb..#ef_op') IS NOT NULL DROP TABLE #ef_op;
    CREATE TABLE #ef_op (
        line_no INT NOT NULL,
        option_id INT NOT NULL,
        qty INT NOT NULL,
        role NVARCHAR(15) NULL,
        effect NVARCHAR(12) NULL,
        ingredient_product_id INT NULL,
        replaces_product_id INT NULL,
        qty_base DECIMAL(14,4) NULL,
        qty_factor DECIMAL(8,4) NULL
    );

    INSERT INTO #ef_op (line_no, option_id, qty, role, effect,
                        ingredient_product_id, replaces_product_id, qty_base, qty_factor)
    SELECT o.line_no, o.modifier_option_id, CASE WHEN ISNULL(o.qty, 1) < 1 THEN 1 ELSE o.qty END,
           g.role, mo.effect, mo.ingredient_product_id, mo.replaces_product_id, mo.qty_base, mo.qty_factor
    FROM #ef_opciones o
    JOIN dbo.modifier_options mo ON mo.id = o.modifier_option_id AND mo.active = 1
    JOIN dbo.modifier_groups g ON g.id = mo.group_id AND g.active = 1;

    /* ---------------------------------------------------- 2) que receta
       La del TAMANO elegido si existe; si no, la base. El orden del CASE es
       lo que da preferencia a la variante: una receta propia de "Grande" gana
       siempre a la base, y por eso el tamano no es una etiqueta.

       Una receta por variante SOLO se alcanza con su opcion SIZE en la linea.
       Eso es correcto y deliberado: la receta depende del tamano. */
    UPDATE l
       SET recipe_id = r.id,
           variant_option_id = r.variant_option_id
    FROM #ef_lineas l
    CROSS APPLY (
        SELECT TOP 1 rc.id, rc.variant_option_id
        FROM dbo.recipes rc
        WHERE rc.product_id = l.product_id AND rc.active = 1
          AND (rc.variant_option_id IS NULL
               OR rc.variant_option_id IN (SELECT o.option_id FROM #ef_op o
                                            WHERE o.line_no = l.line_no AND o.role = 'SIZE'))
        ORDER BY CASE WHEN rc.variant_option_id IS NULL THEN 1 ELSE 0 END
    ) r
    WHERE l.inventory_mode = 'RECIPE';

    /* ---------------------------------------------------- 3) escala
       SCALE multiplica la receta BASE. No se aplica sobre una receta de
       variante porque esa ya trae sus propias cantidades: multiplicarla seria
       contar el tamano dos veces. */
    UPDATE #ef_lineas SET scale = 1 WHERE scale IS NULL;

    UPDATE l SET scale = o.qty_factor
    FROM #ef_lineas l
    JOIN dbo.recipes r ON r.id = l.recipe_id AND r.variant_option_id IS NULL
    JOIN #ef_op o ON o.line_no = l.line_no AND o.effect = 'SCALE' AND o.qty_factor > 0
    WHERE l.inventory_mode = 'RECIPE';

    /* ---------------------------------------------------- 4) DIRECT
       Un producto de inventario directo se consume a si mismo. */
    INSERT INTO #ef_requerimientos (line_no, product_id, qty_per_unit, origen, modifier_option_id, recipe_id)
    SELECT l.line_no, l.product_id, 1, 'DIRECT', NULL, NULL
    FROM #ef_lineas l
    WHERE l.inventory_mode = 'DIRECT';

    /* NONE no consume nada: no se inserta ninguna fila, a proposito. */

    /* ---------------------------------------------------- 5) receta base
       La merma es parte del consumo real: preparar 240 ml con 2% de merma
       gasta 244.8 ml de almacen. `origen` distingue si la cantidad viene de
       una receta de tamano o de la base, para poder auditarlo despues. */
    INSERT INTO #ef_requerimientos (line_no, product_id, qty_per_unit, origen, modifier_option_id, recipe_id)
    SELECT l.line_no, rl.ingredient_product_id,
           rl.qty_base * (1 + rl.waste_pct / 100.0) * l.scale,
           CASE WHEN l.variant_option_id IS NOT NULL THEN 'SIZE' ELSE 'BASE' END,
           NULL, l.recipe_id
    FROM #ef_lineas l
    JOIN dbo.recipe_lines rl ON rl.recipe_id = l.recipe_id
    WHERE l.inventory_mode = 'RECIPE';

    /* ---------------------------------------------------- 6) REMOVE
       "Sin azucar" quita el requerimiento entero de ese ingrediente. Si el
       ingrediente no estaba en la receta, no hay nada que quitar y tampoco es
       un error: pedir "sin crema" un cafe que no lleva crema es inofensivo. */
    DELETE r
    FROM #ef_requerimientos r
    JOIN #ef_op o ON o.line_no = r.line_no AND o.effect = 'REMOVE'
                 AND o.replaces_product_id = r.product_id
    WHERE r.origen IN ('BASE', 'SIZE');

    /* ---------------------------------------------------- 7) SUBSTITUTE
       Cambia el ingrediente conservando la cantidad, salvo que la opcion
       traiga una cantidad propia (`qty_base`), que entonces manda y escala
       con el tamano. El requerimiento sustituido queda marcado con su opcion
       para poder auditar por que se consumio leche de almendra. */
    UPDATE r
       SET product_id = o.ingredient_product_id,
           qty_per_unit = ISNULL(o.qty_base * l.scale, r.qty_per_unit),
           origen = 'SUBSTITUTE',
           modifier_option_id = o.option_id
    FROM #ef_requerimientos r
    JOIN #ef_lineas l ON l.line_no = r.line_no
    JOIN #ef_op o ON o.line_no = r.line_no AND o.effect = 'SUBSTITUTE'
                 AND o.replaces_product_id = r.product_id
    WHERE r.origen IN ('BASE', 'SIZE');

    /* ---------------------------------------------------- 8) ADD
       Consumo extra. La cantidad elegida multiplica: dos shots son 2 x 30 g.
       NO escala con el tamano, a proposito: un shot es un shot, lo pidas en
       vaso chico o grande. */
    INSERT INTO #ef_requerimientos (line_no, product_id, qty_per_unit, origen, modifier_option_id, recipe_id)
    SELECT o.line_no, o.ingredient_product_id, o.qty_base * o.qty, 'ADD', o.option_id, NULL
    FROM #ef_op o
    JOIN #ef_lineas l ON l.line_no = o.line_no
    WHERE o.effect = 'ADD' AND o.ingredient_product_id IS NOT NULL AND o.qty_base > 0
      AND l.inventory_mode IN ('RECIPE', 'DIRECT');

    /* Un requerimiento de cantidad cero no consume nada y solo ensucia el
       historial y los movimientos de inventario. */
    DELETE FROM #ef_requerimientos WHERE qty_per_unit IS NULL OR qty_per_unit <= 0;

    DROP TABLE #ef_op;
END
GO
