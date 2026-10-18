/* ============================================================
   0060 — produccion

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0060_produccion.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0060_produccion.sql ========== */
/* ============================================================
   0060 — Producción por tandas (esquema)

   Para lo que se FABRICA antes de venderse (donas, pan, galletas): el
   producto terminado es DIRECT -tiene existencia, se cuenta, se traspasa- y
   los ingredientes se descuentan AL FABRICAR, no al vender.

   production_formulas        La fórmula de un producto DIRECT: para cuántas
   production_formula_lines   piezas es (rendimiento) y qué lleva. Vive APARTE
                              de `recipes`: el motor de la venta
                              (sp_resolver_receta_efectiva) nunca la lee, así
                              que un producto fabricado no puede consumir sus
                              ingredientes dos veces.
   production_batches         Una tanda: planeada -> en preparación -> lista
                              (o cancelada). Quién, cuándo, en qué caja, lo
                              planeado, lo que salió bueno, la merma con su
                              motivo y el costo congelado.
   production_batch_consumption
                              Lo que la tanda consumió DE VERDAD al empezar,
                              con el costo de ese momento. La fórmula puede
                              cambiar después; esto no.
   production_waste           Merma de producto TERMINADO: lo que ya estaba a la
                              venta y se tiró (no se vendió, se cayó, caducó).
                              Sale del inventario con su motivo y su costo. La
                              merma DE PRODUCCIÓN (lo que no salió bueno de una
                              tanda) vive en la tanda: nunca entró.

   Lo preparado al momento (café, frappé) sigue siendo RECIPE: no cambia.
   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF OBJECT_ID(N'dbo.production_formulas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.production_formulas (
        product_id  INT            NOT NULL,
        yield_qty   DECIMAL(12, 2) NOT NULL CONSTRAINT DF_production_formulas_yield DEFAULT (1),
        notes       NVARCHAR(300)  COLLATE Modern_Spanish_CI_AS NULL,
        updated_by  INT            NULL,
        updated_at  DATETIME2(0)   NOT NULL CONSTRAINT DF_production_formulas_updated_at DEFAULT (SYSDATETIME()),
        CONSTRAINT PK_production_formulas PRIMARY KEY CLUSTERED (product_id),
        CONSTRAINT FK_production_formulas_product FOREIGN KEY (product_id) REFERENCES dbo.products (id),
        CONSTRAINT CK_production_formulas_yield CHECK (yield_qty > 0)
    );
END;

IF OBJECT_ID(N'dbo.production_formula_lines', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.production_formula_lines (
        product_id            INT            NOT NULL,
        ingredient_product_id INT            NOT NULL,
        qty_base              DECIMAL(14, 4) NOT NULL,
        input_qty             DECIMAL(12, 3) NOT NULL,
        input_uom             NVARCHAR(10)   COLLATE Modern_Spanish_CI_AS NOT NULL,
        waste_pct             DECIMAL(5, 2)  NOT NULL CONSTRAINT DF_production_formula_lines_waste DEFAULT (0),
        sort_order            INT            NOT NULL CONSTRAINT DF_production_formula_lines_sort DEFAULT (0),
        CONSTRAINT PK_production_formula_lines PRIMARY KEY CLUSTERED (product_id, ingredient_product_id),
        CONSTRAINT FK_production_formula_lines_formula FOREIGN KEY (product_id) REFERENCES dbo.production_formulas (product_id) ON DELETE CASCADE,
        CONSTRAINT FK_production_formula_lines_ingredient FOREIGN KEY (ingredient_product_id) REFERENCES dbo.products (id),
        CONSTRAINT CK_production_formula_lines_qty CHECK (qty_base > 0 AND input_qty > 0),
        CONSTRAINT CK_production_formula_lines_waste CHECK (waste_pct >= 0 AND waste_pct <= 100),
        CONSTRAINT CK_production_formula_lines_self CHECK (ingredient_product_id <> product_id)
    );
END;

IF OBJECT_ID(N'dbo.production_batches', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.production_batches (
        id              INT              IDENTITY(1, 1) NOT NULL,
        uuid            UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_production_batches_uuid DEFAULT (NEWID()),
        product_id      INT              NOT NULL,
        status          VARCHAR(12)      NOT NULL CONSTRAINT DF_production_batches_status DEFAULT ('PLANNED'),
        production_date DATE             NOT NULL,
        planned_qty     DECIMAL(12, 2)   NOT NULL,
        good_qty        DECIMAL(12, 2)   NULL,
        waste_qty       DECIMAL(12, 2)   NULL,
        waste_reason    NVARCHAR(40)     COLLATE Modern_Spanish_CI_AS NULL,
        total_cost      DECIMAL(14, 4)   NULL,
        unit_cost       DECIMAL(14, 4)   NULL,
        note            NVARCHAR(255)    COLLATE Modern_Spanish_CI_AS NULL,
        machine_name    NVARCHAR(120)    COLLATE Modern_Spanish_CI_AS NULL,
        created_by      INT              NOT NULL,
        created_at      DATETIME2(0)     NOT NULL CONSTRAINT DF_production_batches_created_at DEFAULT (SYSDATETIME()),
        started_by      INT              NULL,
        started_at      DATETIME2(0)     NULL,
        finished_by     INT              NULL,
        finished_at     DATETIME2(0)     NULL,
        cancelled_by    INT              NULL,
        cancelled_at    DATETIME2(0)     NULL,
        row_version     ROWVERSION       NOT NULL,
        CONSTRAINT PK_production_batches PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_production_batches_uuid UNIQUE (uuid),
        CONSTRAINT FK_production_batches_product FOREIGN KEY (product_id) REFERENCES dbo.products (id),
        CONSTRAINT FK_production_batches_created_by FOREIGN KEY (created_by) REFERENCES dbo.users (id),
        CONSTRAINT FK_production_batches_started_by FOREIGN KEY (started_by) REFERENCES dbo.users (id),
        CONSTRAINT FK_production_batches_finished_by FOREIGN KEY (finished_by) REFERENCES dbo.users (id),
        CONSTRAINT FK_production_batches_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES dbo.users (id),
        CONSTRAINT CK_production_batches_status CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
        CONSTRAINT CK_production_batches_planned CHECK (planned_qty > 0),
        CONSTRAINT CK_production_batches_good CHECK (good_qty IS NULL OR good_qty >= 0),
        CONSTRAINT CK_production_batches_waste CHECK (waste_qty IS NULL OR waste_qty >= 0)
    );
    CREATE NONCLUSTERED INDEX IX_production_batches_date ON dbo.production_batches (production_date, status);
END;

IF OBJECT_ID(N'dbo.production_waste', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.production_waste (
        id           INT              IDENTITY(1, 1) NOT NULL,
        uuid         UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_production_waste_uuid DEFAULT (NEWID()),
        product_id   INT              NOT NULL,
        waste_date   DATE             NOT NULL,
        qty          DECIMAL(12, 2)   NOT NULL,
        reason       NVARCHAR(40)     COLLATE Modern_Spanish_CI_AS NOT NULL,
        unit_cost    DECIMAL(14, 4)   NULL,
        machine_name NVARCHAR(120)    COLLATE Modern_Spanish_CI_AS NULL,
        created_by   INT              NOT NULL,
        created_at   DATETIME2(0)     NOT NULL CONSTRAINT DF_production_waste_created_at DEFAULT (SYSDATETIME()),
        row_version  ROWVERSION       NOT NULL,
        CONSTRAINT PK_production_waste PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_production_waste_uuid UNIQUE (uuid),
        CONSTRAINT FK_production_waste_product FOREIGN KEY (product_id) REFERENCES dbo.products (id),
        CONSTRAINT FK_production_waste_created_by FOREIGN KEY (created_by) REFERENCES dbo.users (id),
        CONSTRAINT CK_production_waste_qty CHECK (qty > 0)
    );
    CREATE NONCLUSTERED INDEX IX_production_waste_date ON dbo.production_waste (waste_date);
END;

IF OBJECT_ID(N'dbo.production_batch_consumption', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.production_batch_consumption (
        batch_id              INT            NOT NULL,
        ingredient_product_id INT            NOT NULL,
        qty                   DECIMAL(14, 4) NOT NULL,
        unit_cost             DECIMAL(14, 4) NOT NULL,
        CONSTRAINT PK_production_batch_consumption PRIMARY KEY CLUSTERED (batch_id, ingredient_product_id),
        CONSTRAINT FK_production_batch_consumption_batch FOREIGN KEY (batch_id) REFERENCES dbo.production_batches (id),
        CONSTRAINT FK_production_batch_consumption_ingredient FOREIGN KEY (ingredient_product_id) REFERENCES dbo.products (id)
    );
END;
GO

/* ---------- sp_day_close_report (SQL_STORED_PROCEDURE) ---------- */
/* sp_day_close_report
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ROLES V2 · CIERRE DEL DÍA.
   Todo el día del negocio en una consulta, para el Encargado y el
   Administrador (lo abre Inicio): las ventas, los cortes de TODAS las cajas
   -quién cerró, cuánto se esperaba, cuánto se contó, cuánto se quedó-, lo que
   salió del cajón, las promociones por cajero y lo que se autorizó.

   Devuelve siete resultados, en este orden:
     1 resumen        tickets, vendido, ahorro con promociones, devoluciones
     2 pagos          vendido por forma de pago
     3 cortes         turnos del día (abiertos o cerrados) de todas las cajas
     4 salidas        retiros, egresos, pagos a proveedor, devoluciones en efectivo
     5 promociones    descuento aplicado por cajero
     6 eventos        bitácora de seguridad del día
     7 ventas         los tickets del día (hasta 500, los más recientes primero)
   0060 (al final, para no mover los anteriores):
     8 produccion     por producto fabricado: lo producido ese día, la merma
                      de producción, lo vendido, lo traspasado, la merma de
                      terminado y cuánto queda ahora
     9 mermas         la merma de producto terminado del día, una por una */
CREATE OR ALTER PROCEDURE dbo.sp_day_close_report
    @fecha DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @fecha IS NULL SET @fecha = CAST(GETDATE() AS DATE);
    DECLARE @desde DATETIME2(0) = CAST(@fecha AS DATETIME2(0));
    DECLARE @hasta DATETIME2(0) = DATEADD(DAY, 1, @desde);

    /* 1 resumen */
    SELECT COUNT(*) AS tickets,
           ISNULL(SUM(s.total), 0) AS vendido,
           ISNULL(SUM(TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(s.commercial_snapshot, '$.discount'))), 0) AS ahorro_promociones,
           SUM(CASE WHEN TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(s.commercial_snapshot, '$.discount')) > 0 THEN 1 ELSE 0 END) AS tickets_con_promocion,
           (SELECT ISNULL(SUM(r.refund_total), 0) FROM dbo.sale_refunds r WHERE r.datee >= @desde AND r.datee < @hasta) AS devoluciones,
           (SELECT COUNT(*) FROM dbo.sale_refunds r WHERE r.datee >= @desde AND r.datee < @hasta) AS devoluciones_n
      FROM dbo.sales s
     WHERE s.datee >= @desde AND s.datee < @hasta;

    /* 2 pagos: el desglose de un pago mixto; si la venta no lo tiene, su método. */
    SELECT x.metodo, SUM(x.monto) AS monto, COUNT(*) AS movimientos
      FROM (SELECT p.payment_method AS metodo, p.amount AS monto
              FROM dbo.sale_payments p JOIN dbo.sales s ON s.id = p.sale_id
             WHERE s.datee >= @desde AND s.datee < @hasta
            UNION ALL
            SELECT s.payment_method, s.total
              FROM dbo.sales s
             WHERE s.datee >= @desde AND s.datee < @hasta
               AND NOT EXISTS (SELECT 1 FROM dbo.sale_payments p WHERE p.sale_id = s.id)) x
     GROUP BY x.metodo
     ORDER BY SUM(x.monto) DESC;

    /* 3 cortes: los turnos que abrieron o cerraron ese día, y los que siguen abiertos. */
    SELECT c.id, r.name AS caja, u.usuario AS cajero, c.opened_at, c.closed_at,
           c.opening_cash, c.cash_expected, c.cash_delivered, c.difference, c.cash_left, c.closing_note,
           CAST(ISNULL(c.blind_count, 0) AS BIT) AS a_ciegas,
           cb.usuario AS cerro, ca.usuario AS autorizo
      FROM dbo.cash_closures c
      LEFT JOIN dbo.registers r ON r.id = c.register_id
      LEFT JOIN dbo.users u ON u.id = c.userId
      LEFT JOIN dbo.users cb ON cb.id = c.closed_by_user_id
      LEFT JOIN dbo.users ca ON ca.id = c.close_authorized_by
     WHERE (c.opened_at >= @desde AND c.opened_at < @hasta)
        OR (c.closed_at >= @desde AND c.closed_at < @hasta)
        OR (c.closed_at IS NULL AND c.opened_at < @hasta)
     ORDER BY c.opened_at;

    /* 4 salidas de efectivo: todo lo que no es venta, abono, entrada ni fondo. */
    SELECT m.datee, t.label AS tipo, t.grupo, ABS(m.amount) AS monto, m.note, u.usuario AS quien, r.name AS caja
      FROM dbo.cash_movements m
      JOIN dbo.cash_movement_types t ON t.code = m.typee
      LEFT JOIN dbo.users u ON u.id = m.userId
      LEFT JOIN dbo.registers r ON r.id = m.register_id
     WHERE m.datee >= @desde AND m.datee < @hasta
       AND t.grupo NOT IN ('VENTAS', 'FONDO', 'ABONOS', 'ENTRADAS')
     ORDER BY m.datee;

    /* 5 promociones por cajero: quién aplica más descuento. */
    SELECT ISNULL(u.usuario, N'—') AS cajero, COUNT(*) AS tickets,
           SUM(TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(s.commercial_snapshot, '$.discount'))) AS ahorro
      FROM dbo.sales s
      LEFT JOIN dbo.users u ON u.id = s.useer_id
     WHERE s.datee >= @desde AND s.datee < @hasta
       AND TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(s.commercial_snapshot, '$.discount')) > 0
     GROUP BY u.usuario
     ORDER BY ahorro DESC;

    /* 6 eventos de seguridad del día (los más recientes primero). */
    SELECT TOP (300) e.datee, e.event_type, e.amount, e.detail, u.usuario AS quien, a.usuario AS autorizo
      FROM dbo.security_events e
      LEFT JOIN dbo.users u ON u.id = e.user_id
      LEFT JOIN dbo.users a ON a.id = e.authorized_by
     WHERE e.datee >= @desde AND e.datee < @hasta
     ORDER BY e.datee DESC;

    /* 7 ventas del día. */
    SELECT TOP (500) s.id AS folio, s.datee, u.usuario AS cajero, r.name AS caja, s.total, s.payment_method,
           TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(s.commercial_snapshot, '$.discount')) AS ahorro
      FROM dbo.sales s
      LEFT JOIN dbo.users u ON u.id = s.useer_id
      LEFT JOIN dbo.registers r ON r.id = s.register_id
     WHERE s.datee >= @desde AND s.datee < @hasta
     ORDER BY s.datee DESC;

    /* 8 produccion: los productos con formula, o con tandas o merma ese dia. */
    IF OBJECT_ID(N'dbo.production_batches', 'U') IS NOT NULL
    BEGIN
        SELECT p.id AS product_id, p.nombre AS producto, p.stock AS existencia,
               ISNULL(b.planeadas, 0) AS planeadas, ISNULL(b.producidas, 0) AS producidas,
               ISNULL(b.merma_produccion, 0) AS merma_produccion, b.costo_unitario,
               ISNULL(v.vendidas, 0) AS vendidas, ISNULL(t.traspasadas, 0) AS traspasadas,
               ISNULL(w.merma_terminado, 0) AS merma_terminado, ISNULL(w.costo_merma, 0) AS costo_merma
          FROM dbo.products p
          LEFT JOIN (SELECT product_id, SUM(planned_qty) AS planeadas, SUM(ISNULL(good_qty, 0)) AS producidas,
                            SUM(ISNULL(waste_qty, 0)) AS merma_produccion,
                            SUM(ISNULL(total_cost, 0)) / NULLIF(SUM(ISNULL(good_qty, 0)), 0) AS costo_unitario
                       FROM dbo.production_batches
                      WHERE production_date = @fecha AND status = 'DONE'
                      GROUP BY product_id) b ON b.product_id = p.id
          LEFT JOIN (SELECT d.product_id, SUM(d.quantity) AS vendidas
                       FROM dbo.sale_detail d JOIN dbo.sales s ON s.id = d.sale_id
                      WHERE s.datee >= @desde AND s.datee < @hasta
                      GROUP BY d.product_id) v ON v.product_id = p.id
          LEFT JOIN (SELECT product_id, SUM(quantity) AS traspasadas
                       FROM dbo.inventory_movements
                      WHERE source IN ('BRANCH_OUT', 'TRANSFER_OUT') AND typee = 'salida' AND datee >= @desde AND datee < @hasta
                      GROUP BY product_id) t ON t.product_id = p.id
          LEFT JOIN (SELECT product_id, SUM(qty) AS merma_terminado, SUM(qty * ISNULL(unit_cost, 0)) AS costo_merma
                       FROM dbo.production_waste
                      WHERE waste_date = @fecha
                      GROUP BY product_id) w ON w.product_id = p.id
         WHERE p.active = 1 AND p.inventory_mode = 'DIRECT'
           AND (EXISTS (SELECT 1 FROM dbo.production_formulas f WHERE f.product_id = p.id)
                OR b.product_id IS NOT NULL OR w.product_id IS NOT NULL)
         ORDER BY p.nombre;

        /* 9 mermas de producto terminado del dia. */
        SELECT w.created_at, p.nombre AS producto, w.qty, w.reason, w.unit_cost,
               w.qty * ISNULL(w.unit_cost, 0) AS costo, u.usuario AS quien
          FROM dbo.production_waste w
          JOIN dbo.products p ON p.id = w.product_id
          LEFT JOIN dbo.users u ON u.id = w.created_by
         WHERE w.waste_date = @fecha
         ORDER BY w.created_at DESC;
    END
END
GO

/* ---------- sp_production_board (SQL_STORED_PROCEDURE) ---------- */
/* sp_production_board
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · El tablero de produccion de un dia.

   1) Las tandas del dia (y las que siguen en preparacion de dias anteriores:
      algo que se metio al horno ayer no desaparece del tablero). Las
      planeadas traen cuantos ingredientes no alcanzan para ELLAS SOLAS.
   2) Lo que piden TODAS las tandas planeadas juntas contra la existencia:
      el aviso «no alcanza» de la parte de arriba.
   3) Los productos que tienen formula, para «Agregar».

   Es informacion para la pantalla: empezar una tanda vuelve a validar
   existencias dentro de su transaccion. */
CREATE OR ALTER PROCEDURE dbo.sp_production_board
    @production_date DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @production_date = ISNULL(@production_date, CAST(GETDATE() AS DATE));

    SELECT b.id INTO #b
      FROM dbo.production_batches b
     WHERE b.production_date = @production_date OR b.status = 'IN_PROGRESS';

    /* Requerimiento de cada tanda planeada, por ingrediente. */
    SELECT b.id AS batch_id, r.ingredient_product_id, r.qty
      INTO #req
      FROM dbo.production_batches b
      JOIN #b x ON x.id = b.id
     CROSS APPLY (SELECT l.ingredient_product_id,
                   CAST(ROUND(l.qty_base * (1 + l.waste_pct / 100.0) * b.planned_qty / f.yield_qty, 2) AS DECIMAL(14, 2)) AS qty
              FROM dbo.production_formula_lines l
              JOIN dbo.production_formulas f ON f.product_id = l.product_id
                   WHERE l.product_id = b.product_id) r
     WHERE b.status = 'PLANNED';

    SELECT b.id, LOWER(CONVERT(VARCHAR(36), b.uuid)) AS uuid, b.product_id, p.nombre AS product_name, p.base_uom,
           b.status, b.production_date, b.planned_qty, b.good_qty, b.waste_qty, b.waste_reason,
           b.total_cost, b.unit_cost, b.note,
           b.created_at, uc.usuario AS created_by_name,
           b.started_at, us.usuario AS started_by_name,
           b.finished_at, uf.usuario AS finished_by_name,
           ( SELECT COUNT(*) FROM #req r JOIN dbo.products i ON i.id = r.ingredient_product_id
              WHERE r.batch_id = b.id AND i.stock < r.qty ) AS faltantes
      FROM dbo.production_batches b
      JOIN #b x ON x.id = b.id
      JOIN dbo.products p ON p.id = b.product_id
      LEFT JOIN dbo.users uc ON uc.id = b.created_by
      LEFT JOIN dbo.users us ON us.id = b.started_by
      LEFT JOIN dbo.users uf ON uf.id = b.finished_by
     WHERE b.status <> 'CANCELLED'
     ORDER BY CASE b.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END, b.created_at;

    SELECT r.ingredient_product_id, i.nombre AS ingredient_name, i.base_uom,
           SUM(r.qty) AS needed, i.stock,
           CASE WHEN SUM(r.qty) > i.stock THEN SUM(r.qty) - i.stock ELSE 0 END AS missing
      FROM #req r
      JOIN dbo.products i ON i.id = r.ingredient_product_id
     GROUP BY r.ingredient_product_id, i.nombre, i.base_uom, i.stock
     ORDER BY CASE WHEN SUM(r.qty) > i.stock THEN 0 ELSE 1 END, i.nombre;

    SELECT f.product_id, p.nombre AS product_name, p.base_uom, f.yield_qty, p.stock,
           ( SELECT ISNULL(SUM(l.qty_base * (1 + l.waste_pct / 100.0) * ISNULL(i.cost, 0)), 0)
               FROM dbo.production_formula_lines l JOIN dbo.products i ON i.id = l.ingredient_product_id
              WHERE l.product_id = f.product_id ) / f.yield_qty AS unit_cost
      FROM dbo.production_formulas f
      JOIN dbo.products p ON p.id = f.product_id
     WHERE p.active = 1 AND p.inventory_mode = 'DIRECT'
     ORDER BY p.nombre;
END
GO

/* ---------- sp_production_cancel (SQL_STORED_PROCEDURE) ---------- */
/* sp_production_cancel
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · Cancela una tanda PLANEADA (no movio nada). Una que ya empezo no
   se cancela: sus ingredientes ya se usaron. Si no salio nada, se termina
   con 0 piezas buenas y su motivo, y queda como merma. */
CREATE OR ALTER PROCEDURE dbo.sp_production_cancel
    @user_id  INT,
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.production_batches
       SET status = 'CANCELLED', cancelled_by = @user_id, cancelled_at = SYSDATETIME()
     WHERE id = @batch_id AND status = 'PLANNED';
    IF @@ROWCOUNT = 0
    BEGIN RAISERROR('Solo se cancela una tanda planeada. Si ya empezo y no salio nada, terminala con 0 piezas buenas.', 16, 1); RETURN; END
    SELECT @batch_id AS id, 'CANCELLED' AS status;
END
GO

/* ---------- sp_production_finish (SQL_STORED_PROCEDURE) ---------- */
/* sp_production_finish
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · Termina una tanda: entran las piezas BUENAS.

   Lo que falta para lo planeado es merma de produccion y pide motivo. Salir
   mas de lo planeado se permite (la masa rindio). Costo por pieza buena =
   lo consumido al empezar / piezas buenas: la merma queda absorbida en el
   costo, y ese costo pasa a ser el del producto. */
CREATE OR ALTER PROCEDURE dbo.sp_production_finish
    @user_id      INT,
    @batch_id     INT,
    @good_qty     DECIMAL(12, 2),
    @waste_reason NVARCHAR(40) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @status VARCHAR(12), @product_id INT, @planned DECIMAL(12, 2), @total DECIMAL(14, 4), @uuid UNIQUEIDENTIFIER;

    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Usuario invalido.', 16, 1); RETURN; END
    IF @good_qty IS NULL OR @good_qty < 0
    BEGIN RAISERROR('Indica cuantas piezas salieron buenas.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        SELECT @status = status, @product_id = product_id, @planned = planned_qty, @total = total_cost, @uuid = uuid
          FROM dbo.production_batches WITH (UPDLOCK, HOLDLOCK) WHERE id = @batch_id;
        IF @status IS NULL RAISERROR('La tanda no existe.', 16, 1);
        IF @status = 'DONE' RAISERROR('Esta tanda ya se registro.', 16, 1);
        IF @status <> 'IN_PROGRESS' RAISERROR('Primero empieza la tanda: asi salen sus ingredientes.', 16, 1);

        DECLARE @waste DECIMAL(12, 2) = CASE WHEN @planned > @good_qty THEN @planned - @good_qty ELSE 0 END;
        SET @waste_reason = NULLIF(LTRIM(RTRIM(@waste_reason)), N'');
        IF @waste > 0 AND @waste_reason IS NULL RAISERROR('Indica el motivo de la merma.', 16, 1);

        DECLARE @unit DECIMAL(14, 4) = CASE WHEN @good_qty > 0 THEN ISNULL(@total, 0) / @good_qty END;

        IF @good_qty > 0
        BEGIN
            UPDATE dbo.products
               SET stock = stock + @good_qty, cost = @unit
             WHERE id = @product_id;
            INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
            VALUES (@product_id, 'entrada', CONVERT(NVARCHAR(36), @uuid), @good_qty, GETDATE(),
                    LEFT(CONCAT(N'Produccion terminada',
                         CASE WHEN @waste > 0 THEN CONCAT(N' (merma ', CONVERT(NVARCHAR(30), @waste), N': ', @waste_reason, N')') ELSE N'' END), 255),
                    'PRODUCTION', @unit);
        END

        UPDATE dbo.production_batches
           SET status = 'DONE', good_qty = @good_qty, waste_qty = @waste,
               waste_reason = CASE WHEN @waste > 0 THEN @waste_reason END,
               unit_cost = @unit, finished_by = @user_id, finished_at = SYSDATETIME()
         WHERE id = @batch_id;
        COMMIT TRAN;
        SELECT @batch_id AS id, 'DONE' AS status, @good_qty AS good_qty, @waste AS waste_qty, @unit AS unit_cost;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_production_formula_delete (SQL_STORED_PROCEDURE) ---------- */
/* sp_production_formula_delete
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · Quita la fórmula de un producto. No mientras tenga tandas
   planeadas o en preparación: esas ya cuentan con ella. Las tandas
   terminadas conservan lo que consumieron (production_batch_consumption). */
CREATE OR ALTER PROCEDURE dbo.sp_production_formula_delete
    @product_id INT
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM dbo.production_batches WHERE product_id = @product_id AND status IN ('PLANNED', 'IN_PROGRESS'))
    BEGIN RAISERROR('Este producto tiene tandas planeadas o en preparacion. Terminalas o cancelalas antes de quitar su formula.', 16, 1); RETURN; END
    DELETE FROM dbo.production_formulas WHERE product_id = @product_id;
    SELECT @@ROWCOUNT AS borradas;
END
GO

/* ---------- sp_production_formula_get (SQL_STORED_PROCEDURE) ---------- */
/* sp_production_formula_get
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · La fórmula de producción de un producto DIRECT.
   Dos resultados: cabecera (el producto con su precio y existencia; si tiene
   fórmula, su rendimiento y costo por pieza al costo actual) y líneas (con
   existencia y costo por línea). */
CREATE OR ALTER PROCEDURE dbo.sp_production_formula_get
    @product_id INT
AS
BEGIN
    SET NOCOUNT ON;

    /* El producto siempre (precio y existencia, para el margen), con o sin
       formula: tiene_formula dice si ya existe. */
    SELECT p.id AS product_id, p.nombre AS product_name, p.base_uom, p.price AS product_price, p.stock AS product_stock,
           CAST(CASE WHEN f.product_id IS NULL THEN 0 ELSE 1 END AS BIT) AS tiene_formula,
           f.yield_qty, f.notes, f.updated_at,
           ( SELECT ISNULL(SUM(l.qty_base * (1 + l.waste_pct / 100.0) * ISNULL(i.cost, 0)), 0)
               FROM dbo.production_formula_lines l JOIN dbo.products i ON i.id = l.ingredient_product_id
              WHERE l.product_id = p.id ) / NULLIF(f.yield_qty, 0) AS unit_cost
    FROM dbo.products p
    LEFT JOIN dbo.production_formulas f ON f.product_id = p.id
    WHERE p.id = @product_id;

    SELECT l.ingredient_product_id, i.nombre AS ingredient_name, i.base_uom, u.dimension,
           l.qty_base, l.input_qty, l.input_uom, l.waste_pct, l.sort_order,
           i.stock AS ingredient_stock, i.cost AS ingredient_cost,
           l.qty_base * (1 + l.waste_pct / 100.0) * ISNULL(i.cost, 0) AS line_cost
    FROM dbo.production_formula_lines l
    JOIN dbo.products i ON i.id = l.ingredient_product_id
    LEFT JOIN dbo.uoms u ON u.code = i.base_uom
    WHERE l.product_id = @product_id
    ORDER BY l.sort_order, i.nombre;
END
GO

/* ---------- sp_production_formula_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_production_formula_save
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · Guarda (crea o reemplaza) la fórmula de producción de un producto.

   El producto debe ser DIRECT: lo que se fabrica tiene existencia propia. Los
   ingredientes también DIRECT (y distintos del producto). Un ingrediente
   puede tener a su vez fórmula -una masa que se fabrica aparte-: producir
   consume su EXISTENCIA, nunca la expande, así que no hay ciclos que seguir.

   Las cantidades son para @yield_qty piezas y se convierten AQUÍ a la unidad
   base del ingrediente, igual que sp_save_recipe: producir nunca convierte. */
CREATE OR ALTER PROCEDURE dbo.sp_production_formula_save
    @product_id INT,
    @yield_qty  DECIMAL(12, 2),
    @notes      NVARCHAR(300) = NULL,
    @user_id    INT = NULL,
    @Lines      dbo.RecipeLineType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id AND active = 1)
    BEGIN RAISERROR('El producto no existe o esta inactivo.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id AND inventory_mode = 'DIRECT')
    BEGIN RAISERROR('Solo un producto con inventario directo se puede fabricar: lo que se produce tiene existencia propia.', 16, 1); RETURN; END
    IF @yield_qty IS NULL OR @yield_qty <= 0
    BEGIN RAISERROR('Indica para cuantas piezas es la formula.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM @Lines)
    BEGIN RAISERROR('La formula necesita al menos un ingrediente.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Lines WHERE input_qty IS NULL OR input_qty <= 0)
    BEGIN RAISERROR('Cada ingrediente necesita una cantidad mayor a cero.', 16, 1); RETURN; END
    IF EXISTS (SELECT ingredient_product_id FROM @Lines GROUP BY ingredient_product_id HAVING COUNT(*) > 1)
    BEGIN RAISERROR('Hay un ingrediente repetido en la formula.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Lines WHERE ingredient_product_id = @product_id)
    BEGIN RAISERROR('Un producto no puede ser ingrediente de si mismo.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Lines l LEFT JOIN dbo.products i ON i.id = l.ingredient_product_id AND i.active = 1
               WHERE i.id IS NULL OR i.inventory_mode <> 'DIRECT')
    BEGIN RAISERROR('Cada ingrediente debe ser un producto activo con inventario directo.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Lines l
               JOIN dbo.products i ON i.id = l.ingredient_product_id
               JOIN dbo.uoms ub ON ub.code = i.base_uom
               LEFT JOIN dbo.uoms ui ON ui.code = l.input_uom
               WHERE ui.code IS NULL OR ui.dimension <> ub.dimension)
    BEGIN RAISERROR('La unidad de una linea no corresponde a la unidad base del ingrediente (peso, volumen, longitud o piezas).', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Lines WHERE waste_pct IS NOT NULL AND (waste_pct < 0 OR waste_pct > 100))
    BEGIN RAISERROR('La merma debe estar entre 0 y 100 por ciento.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        IF EXISTS (SELECT 1 FROM dbo.production_formulas WITH (UPDLOCK, HOLDLOCK) WHERE product_id = @product_id)
        BEGIN
            UPDATE dbo.production_formulas
               SET yield_qty = @yield_qty, notes = @notes, updated_by = @user_id, updated_at = SYSDATETIME()
             WHERE product_id = @product_id;
            DELETE FROM dbo.production_formula_lines WHERE product_id = @product_id;
        END
        ELSE
            INSERT INTO dbo.production_formulas (product_id, yield_qty, notes, updated_by)
            VALUES (@product_id, @yield_qty, @notes, @user_id);

        INSERT INTO dbo.production_formula_lines (product_id, ingredient_product_id, qty_base, input_qty, input_uom, waste_pct, sort_order)
        SELECT @product_id, l.ingredient_product_id,
               CAST(l.input_qty * ui.factor_to_base / ub.factor_to_base AS DECIMAL(14, 4)),
               l.input_qty, l.input_uom, ISNULL(l.waste_pct, 0),
               ISNULL(l.sort_order, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)))
        FROM @Lines l
        JOIN dbo.products i ON i.id = l.ingredient_product_id
        JOIN dbo.uoms ub ON ub.code = i.base_uom
        JOIN dbo.uoms ui ON ui.code = l.input_uom;

        IF EXISTS (SELECT 1 FROM dbo.production_formula_lines WHERE product_id = @product_id AND qty_base <= 0)
        BEGIN
            RAISERROR('Una cantidad es demasiado pequena para la unidad base (queda en cero).', 16, 1);
        END
        COMMIT TRAN;
        SELECT @product_id AS product_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_production_plan (SQL_STORED_PROCEDURE) ---------- */
/* sp_production_plan
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · Planea una tanda (no mueve inventario).

   Con @batch_id cambia lo planeado de una tanda TODAVIA planeada. Sin el,
   crea una; @uuid hace el reintento idempotente: la misma tanda, no otra. */
CREATE OR ALTER PROCEDURE dbo.sp_production_plan
    @user_id         INT,
    @product_id      INT = NULL,
    @planned_qty     DECIMAL(12, 2),
    @production_date DATE = NULL,
    @note            NVARCHAR(255) = NULL,
    @machine_name    NVARCHAR(120) = NULL,
    @uuid            UNIQUEIDENTIFIER = NULL,
    @batch_id        INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @planned_qty IS NULL OR @planned_qty <= 0
    BEGIN RAISERROR('Indica cuantas piezas vas a producir.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Usuario invalido.', 16, 1); RETURN; END

    IF @batch_id IS NOT NULL
    BEGIN
        UPDATE dbo.production_batches SET planned_qty = @planned_qty, note = ISNULL(@note, note)
         WHERE id = @batch_id AND status = 'PLANNED';
        IF @@ROWCOUNT = 0
        BEGIN RAISERROR('Esta tanda ya empezo: lo planeado ya no se cambia.', 16, 1); RETURN; END
        SELECT id, LOWER(CONVERT(VARCHAR(36), uuid)) AS uuid FROM dbo.production_batches WHERE id = @batch_id;
        RETURN;
    END

    IF @uuid IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.production_batches WHERE uuid = @uuid)
    BEGIN
        SELECT id, LOWER(CONVERT(VARCHAR(36), uuid)) AS uuid FROM dbo.production_batches WHERE uuid = @uuid;
        RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.production_formulas f JOIN dbo.products p ON p.id = f.product_id
                   WHERE f.product_id = @product_id AND p.active = 1 AND p.inventory_mode = 'DIRECT')
    BEGIN RAISERROR('Este producto no tiene formula de produccion.', 16, 1); RETURN; END

    DECLARE @nuevo UNIQUEIDENTIFIER = ISNULL(@uuid, NEWID());
    INSERT INTO dbo.production_batches (uuid, product_id, status, production_date, planned_qty, note, machine_name, created_by)
    VALUES (@nuevo, @product_id, 'PLANNED', ISNULL(@production_date, CAST(GETDATE() AS DATE)),
            @planned_qty, @note, @machine_name, @user_id);
    SELECT id, LOWER(CONVERT(VARCHAR(36), uuid)) AS uuid FROM dbo.production_batches WHERE uuid = @nuevo;
END
GO

/* ---------- sp_production_start (SQL_STORED_PROCEDURE) ---------- */
/* sp_production_start
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · Empieza una tanda: AQUI salen los ingredientes.

   Una transaccion, como la venta: bloquea la tanda y los ingredientes en
   orden de id, valida que alcancen (no deja existencias negativas), los
   descuenta con su movimiento (salida / PRODUCTION, referencia = uuid de la
   tanda) y congela lo consumido y su costo. Reintentar una tanda que ya
   empezo no vuelve a descontar. */
CREATE OR ALTER PROCEDURE dbo.sp_production_start
    @user_id      INT,
    @batch_id     INT,
    @machine_name NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @status VARCHAR(12), @product_id INT, @planned DECIMAL(12, 2), @uuid UNIQUEIDENTIFIER,
            @nombre NVARCHAR(100), @errmsg NVARCHAR(400), @faltan INT;

    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Usuario invalido.', 16, 1); RETURN; END

    CREATE TABLE #req (ingredient_product_id INT NOT NULL PRIMARY KEY, qty DECIMAL(14, 2) NOT NULL);
    CREATE TABLE #stk (id INT NOT NULL PRIMARY KEY, stock DECIMAL(12, 2) NOT NULL, nombre NVARCHAR(100) NULL,
                       base_uom NVARCHAR(10) NULL, cost DECIMAL(14, 4) NOT NULL, qty DECIMAL(14, 2) NOT NULL);

    BEGIN TRY
        BEGIN TRAN;
        SELECT @status = b.status, @product_id = b.product_id, @planned = b.planned_qty, @uuid = b.uuid, @nombre = p.nombre
          FROM dbo.production_batches b WITH (UPDLOCK, HOLDLOCK)
          JOIN dbo.products p ON p.id = b.product_id
         WHERE b.id = @batch_id;

        IF @status IS NULL RAISERROR('La tanda no existe.', 16, 1);
        IF @status = 'IN_PROGRESS'
        BEGIN
            COMMIT TRAN;
            SELECT @batch_id AS id, 'IN_PROGRESS' AS status;
            RETURN;
        END
        IF @status <> 'PLANNED' RAISERROR('Esta tanda ya no se puede empezar.', 16, 1);

        INSERT INTO #req (ingredient_product_id, qty)
        SELECT l.ingredient_product_id,
                   CAST(ROUND(l.qty_base * (1 + l.waste_pct / 100.0) * @planned / f.yield_qty, 2) AS DECIMAL(14, 2)) AS qty
              FROM dbo.production_formula_lines l
              JOIN dbo.production_formulas f ON f.product_id = l.product_id
             WHERE l.product_id = @product_id;
        IF NOT EXISTS (SELECT 1 FROM #req) RAISERROR('Este producto no tiene formula de produccion.', 16, 1);
        DELETE FROM #req WHERE qty <= 0;

        /* Bloqueo en orden de id, igual que sp_register_sale. */
        INSERT INTO #stk (id, stock, nombre, base_uom, cost, qty)
        SELECT p.id, p.stock, p.nombre, p.base_uom, ISNULL(p.cost, 0), r.qty
          FROM dbo.products p WITH (UPDLOCK, HOLDLOCK)
          JOIN #req r ON r.ingredient_product_id = p.id
         ORDER BY p.id;

        SET @faltan = (SELECT COUNT(*) FROM #stk WHERE stock < qty);
        IF @faltan > 0
        BEGIN
            SELECT TOP 1 @errmsg = CONCAT('No alcanza ', nombre, ': necesitas ', CONVERT(NVARCHAR(30), CAST(qty AS FLOAT)), ' ', base_uom,
                                          ' y hay ', CONVERT(NVARCHAR(30), CAST(stock AS FLOAT)), ' ', base_uom,
                                          CASE WHEN @faltan > 1 THEN CONCAT(' (y ', @faltan - 1, ' ingrediente(s) mas)') ELSE '' END,
                                          '. Registra la compra o ajusta lo planeado.')
              FROM #stk WHERE stock < qty ORDER BY nombre;
            RAISERROR(@errmsg, 16, 1);
        END

        UPDATE p SET p.stock = p.stock - s.qty
          FROM dbo.products p JOIN #stk s ON s.id = p.id;

        INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        SELECT s.id, 'salida', CONVERT(NVARCHAR(36), @uuid), s.qty, GETDATE(),
               LEFT(CONCAT(N'Produccion: ', @nombre, N' x', CONVERT(NVARCHAR(30), @planned)), 255), 'PRODUCTION', s.cost
          FROM #stk s;

        INSERT INTO dbo.production_batch_consumption (batch_id, ingredient_product_id, qty, unit_cost)
        SELECT @batch_id, s.id, s.qty, s.cost FROM #stk s;

        UPDATE dbo.production_batches
           SET status = 'IN_PROGRESS', started_by = @user_id, started_at = SYSDATETIME(),
               total_cost = (SELECT ISNULL(SUM(qty * cost), 0) FROM #stk),
               machine_name = ISNULL(@machine_name, machine_name)
         WHERE id = @batch_id;

        COMMIT TRAN;
        SELECT @batch_id AS id, 'IN_PROGRESS' AS status;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_production_waste (SQL_STORED_PROCEDURE) ---------- */
/* sp_production_waste
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · Merma de producto TERMINADO: lo que estaba a la venta y se tiro.

   Sale de la existencia con su movimiento (salida / WASTE, referencia = uuid)
   y queda con su motivo, quien y su costo. No deja la existencia negativa: no
   se puede tirar lo que el sistema dice que no hay. @uuid hace el reintento
   idempotente. */
CREATE OR ALTER PROCEDURE dbo.sp_production_waste
    @user_id      INT,
    @product_id   INT,
    @qty          DECIMAL(12, 2),
    @reason       NVARCHAR(40),
    @waste_date   DATE = NULL,
    @machine_name NVARCHAR(120) = NULL,
    @uuid         UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @stock DECIMAL(12, 2), @cost DECIMAL(14, 4), @nombre NVARCHAR(100), @errmsg NVARCHAR(300);
    SET @reason = NULLIF(LTRIM(RTRIM(@reason)), N'');

    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Usuario invalido.', 16, 1); RETURN; END
    IF @qty IS NULL OR @qty <= 0
    BEGIN RAISERROR('Indica cuantas piezas se tiraron.', 16, 1); RETURN; END
    IF @reason IS NULL
    BEGIN RAISERROR('Indica el motivo de la merma.', 16, 1); RETURN; END
    IF @uuid IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.production_waste WHERE uuid = @uuid)
    BEGIN
        SELECT id, LOWER(CONVERT(VARCHAR(36), uuid)) AS uuid FROM dbo.production_waste WHERE uuid = @uuid;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;
        SELECT @stock = stock, @cost = ISNULL(cost, 0), @nombre = nombre
          FROM dbo.products WITH (UPDLOCK, HOLDLOCK)
         WHERE id = @product_id AND active = 1 AND inventory_mode = 'DIRECT';
        IF @stock IS NULL RAISERROR('Solo se registra merma de un producto con inventario directo.', 16, 1);
        IF @stock < @qty
        BEGIN
            SET @errmsg = CONCAT('Solo hay ', CONVERT(NVARCHAR(30), CAST(@stock AS FLOAT)), ' de ', @nombre, ' en el sistema. Revisa la cantidad o haz un conteo.');
            RAISERROR(@errmsg, 16, 1);
        END

        DECLARE @nuevo UNIQUEIDENTIFIER = ISNULL(@uuid, NEWID());
        UPDATE dbo.products SET stock = stock - @qty WHERE id = @product_id;
        INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        VALUES (@product_id, 'salida', CONVERT(NVARCHAR(36), @nuevo), @qty, GETDATE(), LEFT(CONCAT(N'Merma: ', @reason), 255), 'WASTE', @cost);
        INSERT INTO dbo.production_waste (uuid, product_id, waste_date, qty, reason, unit_cost, machine_name, created_by)
        VALUES (@nuevo, @product_id, ISNULL(@waste_date, CAST(GETDATE() AS DATE)), @qty, @reason, @cost, @machine_name, @user_id);
        COMMIT TRAN;
        SELECT id, LOWER(CONVERT(VARCHAR(36), uuid)) AS uuid FROM dbo.production_waste WHERE uuid = @nuevo;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_sync_capture (SQL_STORED_PROCEDURE) ---------- */
/* sp_sync_capture
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_sync_capture ======================
   0051. Convierte lo que cambio desde la ultima captura en EVENTOS del outbox.

   POR QUE ASI Y NO DESDE CADA PROCEDURE
   -------------------------------------
   Una venta se escribe por varios caminos (Retail, Touch, Hospitality,
   importacion, edicion, devolucion). Emitir el evento dentro de cada uno era
   tocar `sp_register_sale` y otros cinco procedures criticos, y bastaba
   olvidar un camino para perder hechos. Aqui se lee la VERSION de fila
   (`rowversion`): todo lo confirmado, venga de donde venga, se captura.

   SIN PERDER NADA
   ---------------
   Una transaccion abierta puede tener una version MENOR que otra ya
   confirmada. Si se capturara hasta "lo mas nuevo", esa fila se confirmaria
   despues por debajo de la marca y nunca se veria. Por eso el tope es
   `MIN_ACTIVE_ROWVERSION()`: solo se captura por debajo de la transaccion
   abierta mas antigua.

   IDEMPOTENTE
   -----------
   El UUID de cada evento se DERIVA de (agregado, uuid, version): capturar dos
   veces lo mismo produce el mismo UUID y la llave unica del outbox lo
   descarta. La nube hace lo mismo del otro lado.

   QUE ES CADA EVENTO
   ------------------
   La carga es el ESTADO del agregado en esa version (una venta con su total y
   sus devoluciones; un turno con sus montos). Los saldos (existencias,
   credito) NO viajan: se reconstruyen de los hechos.
       SALE          SALE_RECORDED / SALE_UPDATED
       SHIFT         SHIFT_OPENED / SHIFT_CLOSED
       CASH_MOVEMENT CASH_MOVEMENT_RECORDED (todo menos SALE, que ya va en la venta)
       TRANSFER      0052: TRANSFER_SENT / TRANSFER_RECEIVED (salida a un evento
                     y su confirmación) · RETURN_RECEIVED (el sobrante que volvió).
                     Lleva sus líneas con UUID de producto: la nube arma el ledger
                     del evento y la tablet recibe la mercancía.
       PRODUCTION    0060: PRODUCTION_PLANNED / _STARTED / _FINISHED / _CANCELLED.
                     Una tanda con lo planeado, lo bueno, su merma y lo que
                     consumió: el dueño ve cuánto se produjo y a qué costo.
       WASTE         0060: WASTE_RECORDED. Merma de producto terminado.
   ============================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_sync_capture
    @max_rows INT = 500
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @offset INT = DATEPART(TZOFFSET, SYSDATETIMEOFFSET());
    DECLARE @tope BINARY(8) = MIN_ACTIVE_ROWVERSION();
    DECLARE @capturados INT = 0;

    BEGIN TRAN;

    /* La primera vez no se arrastra toda la historia: se parte de lo que tiene
       menos de 62 dias. Lo anterior que cambie despues tambien se captura. */
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'SALE')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv)
        SELECT 'SALE', ISNULL(MAX(rv), 0x0000000000000000) FROM dbo.sales WHERE datee < DATEADD(DAY, -62, GETDATE());
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'SHIFT')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv)
        SELECT 'SHIFT', ISNULL(MAX(rv), 0x0000000000000000) FROM dbo.cash_closures WHERE opened_at < DATEADD(DAY, -62, SYSDATETIME());
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'CASH_MOVEMENT')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv)
        SELECT 'CASH_MOVEMENT', ISNULL(MAX(rv), 0x0000000000000000) FROM dbo.cash_movements WHERE datee < DATEADD(DAY, -62, SYSDATETIME());
    /* Las transferencias se capturan TODAS (son pocas y la feria las necesita). */
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'TRANSFER')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('TRANSFER', 0x0000000000000000);
    /* 0060: la produccion y su merma, todas (son pocas por dia). */
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'PRODUCTION')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('PRODUCTION', 0x0000000000000000);
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'WASTE')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('WASTE', 0x0000000000000000);

    DECLARE @wm BINARY(8);

    /* ------------------------------------------------------------- VENTAS */
    SELECT @wm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'SALE';

    SELECT TOP (@max_rows) s.id, s.uuid, s.rv, CAST(s.rv AS BIGINT) AS version
      INTO #ventas
      FROM dbo.sales s
     WHERE s.rv > @wm AND s.rv < @tope
     ORDER BY s.rv;

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid,
           CASE WHEN EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.aggregate_uuid = s.uuid) THEN 'SALE_UPDATED' ELSE 'SALE_RECORDED' END,
           'SALE', s.uuid, v.version, TODATETIMEOFFSET(s.datee, @offset),
           (SELECT
                s.uuid                          AS sale_uuid,
                s.id                            AS folio,
                CONVERT(VARCHAR(10), CAST(s.datee AS DATE), 23) AS business_date,
                CONVERT(VARCHAR(19), s.datee, 126) AS occurred_local,
                s.total                         AS total,
                s.paid_amount                   AS paid_amount,
                s.balance                       AS balance,
                s.payment_method                AS payment_method,
                JSON_QUERY((SELECT payment_method method,amount,received,reference FROM dbo.sale_payments WHERE sale_id=s.id FOR JSON PATH)) AS payments,
                s.service_mode                  AS service_mode,
                s.venta_esencial                AS venta_esencial,
                JSON_QUERY(s.commercial_snapshot) AS commercial,
                ISNULL((SELECT SUM(r.refund_total) FROM dbo.sale_refunds r WHERE r.sale_id = s.id), 0) AS refunded_total,
                rg.uuid AS [register.uuid], rg.code AS [register.code], rg.name AS [register.name],
                u.uuid  AS [user.uuid],     u.usuario AS [user.name]
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #ventas v
      JOIN dbo.sales s ON s.id = v.id
      LEFT JOIN dbo.registers rg ON rg.id = s.register_id
      LEFT JOIN dbo.users u ON u.id = s.useer_id
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256',
                    CONCAT('SALE|', CONVERT(VARCHAR(36), s.uuid), '|', v.version)) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #ventas)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #ventas), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'SALE';

    /* ------------------------------------------------------------- TURNOS */
    SELECT @wm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'SHIFT';

    SELECT TOP (@max_rows) c.id, c.uuid, c.rv, CAST(c.rv AS BIGINT) AS version
      INTO #turnos
      FROM dbo.cash_closures c
     WHERE c.rv > @wm AND c.rv < @tope
     ORDER BY c.rv;

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid,
           CASE WHEN c.closed_at IS NULL THEN 'SHIFT_OPENED' ELSE 'SHIFT_CLOSED' END,
           'SHIFT', c.uuid, t.version,
           TODATETIMEOFFSET(ISNULL(c.closed_at, c.opened_at), @offset),
           (SELECT
                c.uuid                AS shift_uuid,
                c.id                  AS closure_id,
                CASE WHEN c.closed_at IS NULL THEN 'OPEN' ELSE 'CLOSED' END AS status,
                CONVERT(VARCHAR(10), CAST(c.opened_at AS DATE), 23) AS business_date,
                CONVERT(VARCHAR(19), c.opened_at, 126) AS opened_local,
                CONVERT(VARCHAR(19), c.closed_at, 126) AS closed_local,
                c.opening_cash        AS opening_cash,
                CASE WHEN c.closed_at IS NULL THEN NULL ELSE c.cash_expected END  AS cash_expected,
                CASE WHEN c.closed_at IS NULL THEN NULL ELSE c.cash_delivered END AS cash_counted,
                CASE WHEN c.closed_at IS NULL THEN NULL ELSE c.difference END     AS difference,
                c.blind_count         AS blind_count,
                c.opened_machine_name AS opened_device,
                c.closed_machine_name AS closed_device,
                rg.uuid AS [register.uuid], rg.code AS [register.code], rg.name AS [register.name],
                uo.uuid AS [opened_by.uuid], uo.usuario AS [opened_by.name],
                uc.uuid AS [closed_by.uuid], uc.usuario AS [closed_by.name],
                ua.uuid AS [authorized_by.uuid], ua.usuario AS [authorized_by.name]
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #turnos t
      JOIN dbo.cash_closures c ON c.id = t.id
      LEFT JOIN dbo.registers rg ON rg.id = c.register_id
      LEFT JOIN dbo.users uo ON uo.id = ISNULL(c.opening_user_id, c.userId)
      LEFT JOIN dbo.users uc ON uc.id = c.closed_by_user_id
      LEFT JOIN dbo.users ua ON ua.id = c.close_authorized_by
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256',
                    CONCAT('SHIFT|', CONVERT(VARCHAR(36), c.uuid), '|', t.version)) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #turnos)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #turnos), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'SHIFT';

    /* ------------------------------------------------- MOVIMIENTOS DE CAJA */
    SELECT @wm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'CASH_MOVEMENT';

    SELECT TOP (@max_rows) m.id, m.uuid, m.rv, CAST(m.rv AS BIGINT) AS version, m.typee
      INTO #movs
      FROM dbo.cash_movements m
     WHERE m.rv > @wm AND m.rv < @tope
     ORDER BY m.rv;

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid, 'CASH_MOVEMENT_RECORDED', 'CASH_MOVEMENT', m.uuid, x.version,
           TODATETIMEOFFSET(CAST(m.datee AS DATETIME2(0)), @offset),
           (SELECT
                m.uuid          AS movement_uuid,
                m.typee         AS type,
                m.amount        AS amount,
                CONVERT(VARCHAR(10), CAST(m.datee AS DATE), 23) AS business_date,
                CONVERT(VARCHAR(19), CAST(m.datee AS DATETIME2(0)), 126) AS occurred_local,
                m.reference     AS reference,
                m.note          AS note,
                c.uuid          AS shift_uuid,
                rg.uuid AS [register.uuid], rg.code AS [register.code], rg.name AS [register.name],
                u.uuid  AS [user.uuid], u.usuario AS [user.name]
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #movs x
      JOIN dbo.cash_movements m ON m.id = x.id
      LEFT JOIN dbo.cash_closures c ON c.id = m.closure_id
      LEFT JOIN dbo.registers rg ON rg.id = m.register_id
      LEFT JOIN dbo.users u ON u.id = m.userId
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256',
                    CONCAT('CASH_MOVEMENT|', CONVERT(VARCHAR(36), m.uuid), '|', x.version)) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE x.typee <> 'SALE'
       AND NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #movs)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #movs), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'CASH_MOVEMENT';

    /* ------------------------------------------------------ TRANSFERENCIAS */
    SELECT @wm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'TRANSFER';

    SELECT TOP (@max_rows) t.id, t.uuid, t.rv, CAST(t.rv AS BIGINT) AS version
      INTO #transf
      FROM dbo.stock_transfers t
     WHERE t.rv > @wm AND t.rv < @tope
     ORDER BY t.rv;

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid,
           CASE WHEN t.kind = 'RETURN_IN' THEN 'RETURN_RECEIVED'
                WHEN t.status = 'RECEIVED' THEN 'TRANSFER_RECEIVED'
                ELSE 'TRANSFER_SENT' END,
           'TRANSFER', t.uuid, x.version,
           TODATETIMEOFFSET(ISNULL(t.received_at, t.created_at), @offset),
           (SELECT
                t.uuid                 AS transfer_uuid,
                t.kind                 AS kind,
                t.status               AS status,
                t.event_location_uuid  AS event_location_uuid,
                t.event_name           AS event_name,
                t.note                 AS note,
                CONVERT(VARCHAR(19), t.created_at, 126)  AS created_local,
                CONVERT(VARCHAR(19), t.received_at, 126) AS received_local,
                t.created_machine_name AS device,
                t.manifest_signature   AS signature,
                u.uuid AS [created_by.uuid], u.usuario AS [created_by.name],
                (SELECT p.uuid AS product_uuid, p.nombre AS product_name,
                        CONVERT(VARCHAR(20), l.qty_sent) AS qty_sent,
                        CONVERT(VARCHAR(20), l.qty_received) AS qty_received
                   FROM dbo.stock_transfer_lines l JOIN dbo.products p ON p.id = l.product_id
                  WHERE l.transfer_id = t.id
                  ORDER BY l.id
                    FOR JSON PATH) AS lines
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #transf x
      JOIN dbo.stock_transfers t ON t.id = x.id
      LEFT JOIN dbo.users u ON u.id = t.created_by
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256',
                    CONCAT('TRANSFER|', CONVERT(VARCHAR(36), t.uuid), '|', x.version)) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #transf)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #transf), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'TRANSFER';

    /* ------------------------------------------------------ PRODUCCION (0060) */
    SELECT @wm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'PRODUCTION';

    SELECT TOP (@max_rows) b.id, b.row_version AS rv, CAST(b.row_version AS BIGINT) AS version
      INTO #tandas
      FROM dbo.production_batches b
     WHERE b.row_version > @wm AND b.row_version < @tope
     ORDER BY b.row_version;

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid,
           CASE b.status WHEN 'DONE' THEN 'PRODUCTION_FINISHED' WHEN 'IN_PROGRESS' THEN 'PRODUCTION_STARTED'
                         WHEN 'CANCELLED' THEN 'PRODUCTION_CANCELLED' ELSE 'PRODUCTION_PLANNED' END,
           'PRODUCTION', b.uuid, x.version,
           TODATETIMEOFFSET(COALESCE(b.finished_at, b.cancelled_at, b.started_at, b.created_at), @offset),
           (SELECT
                b.uuid                 AS batch_uuid,
                p.uuid                 AS product_uuid,
                p.nombre               AS product_name,
                b.status               AS status,
                CONVERT(VARCHAR(10), b.production_date, 23) AS production_date,
                CONVERT(VARCHAR(20), b.planned_qty)  AS planned_qty,
                CONVERT(VARCHAR(20), b.good_qty)     AS good_qty,
                CONVERT(VARCHAR(20), b.waste_qty)    AS waste_qty,
                b.waste_reason         AS waste_reason,
                CONVERT(VARCHAR(30), b.total_cost)   AS total_cost,
                CONVERT(VARCHAR(30), b.unit_cost)    AS unit_cost,
                CONVERT(VARCHAR(19), b.started_at, 126)  AS started_local,
                CONVERT(VARCHAR(19), b.finished_at, 126) AS finished_local,
                b.machine_name         AS device,
                uc.usuario AS created_by, us.usuario AS started_by, uf.usuario AS finished_by,
                (SELECT i.uuid AS product_uuid, i.nombre AS product_name,
                        CONVERT(VARCHAR(20), c.qty) AS qty, CONVERT(VARCHAR(30), c.unit_cost) AS unit_cost
                   FROM dbo.production_batch_consumption c JOIN dbo.products i ON i.id = c.ingredient_product_id
                  WHERE c.batch_id = b.id
                  ORDER BY i.nombre
                    FOR JSON PATH) AS consumption
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #tandas x
      JOIN dbo.production_batches b ON b.id = x.id
      JOIN dbo.products p ON p.id = b.product_id
      LEFT JOIN dbo.users uc ON uc.id = b.created_by
      LEFT JOIN dbo.users us ON us.id = b.started_by
      LEFT JOIN dbo.users uf ON uf.id = b.finished_by
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256',
                    CONCAT('PRODUCTION|', CONVERT(VARCHAR(36), b.uuid), '|', x.version)) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #tandas)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #tandas), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'PRODUCTION';

    /* ------------------------------------------- MERMA DE TERMINADO (0060) */
    SELECT @wm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'WASTE';

    SELECT TOP (@max_rows) w.id, w.row_version AS rv, CAST(w.row_version AS BIGINT) AS version
      INTO #mermas
      FROM dbo.production_waste w
     WHERE w.row_version > @wm AND w.row_version < @tope
     ORDER BY w.row_version;

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid, 'WASTE_RECORDED', 'WASTE', w.uuid, x.version,
           TODATETIMEOFFSET(w.created_at, @offset),
           (SELECT
                w.uuid                 AS waste_uuid,
                p.uuid                 AS product_uuid,
                p.nombre               AS product_name,
                CONVERT(VARCHAR(20), w.qty)        AS qty,
                w.reason               AS reason,
                CONVERT(VARCHAR(30), w.unit_cost)  AS unit_cost,
                CONVERT(VARCHAR(10), w.waste_date, 23) AS waste_date,
                w.machine_name         AS device,
                u.usuario              AS created_by
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #mermas x
      JOIN dbo.production_waste w ON w.id = x.id
      JOIN dbo.products p ON p.id = w.product_id
      LEFT JOIN dbo.users u ON u.id = w.created_by
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256',
                    CONCAT('WASTE|', CONVERT(VARCHAR(36), w.uuid), '|', x.version)) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #mermas)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #mermas), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'WASTE';

    COMMIT TRAN;

    SELECT @capturados AS capturados,
           (SELECT COUNT(*) FROM dbo.sync_outbox WHERE status = 'PENDING') AS pendientes;
END
GO
