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
       MEMBERSHIP_PLAN        0063: MEMBERSHIP_PLAN_SAVED. Un plan del Club (solo los
                              creados aquí).
       MEMBERSHIP             0063: MEMBERSHIP_UPDATED. Hasta cuándo está pagada.
       MEMBERSHIP_REDEMPTION  0063: MEMBERSHIP_REDEEMED / _VOIDED. Un beneficio dado
                              en esta caja; la nube marca los dobles.
       POINTS_CONFIG          0064: POINTS_CONFIG_SAVED. Cómo se ganan los puntos.
       STAMP_CARD             0064: STAMP_CARD_SAVED. Una tarjeta de sellos (local).
       LOYALTY_LEDGER         0064: LOYALTY_MOVEMENT. Un movimiento de puntos o
                              sellos hecho en esta caja; el saldo de un cliente
                              es la suma de los de todas las sucursales.
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

    /* --------------------------------------------- CLUB: PLANES (0063) */
    DECLARE @cm BINARY(8);
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'MEMBERSHIP_PLAN')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('MEMBERSHIP_PLAN', 0x0000000000000000);
    SELECT @cm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'MEMBERSHIP_PLAN';

    SELECT TOP (@max_rows) p.id, p.row_version AS rv, CAST(p.row_version AS BIGINT) AS version
      INTO #club_planes
      FROM dbo.membership_plans p
     WHERE p.row_version > @cm AND p.row_version < @tope AND p.origin = N'LOCAL'
     ORDER BY p.row_version;

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid, 'MEMBERSHIP_PLAN_SAVED', 'MEMBERSHIP_PLAN', p.uuid, x.version,
           TODATETIMEOFFSET(p.updated_at, @offset),
           (SELECT p.uuid AS uuid, p.name AS name, sp.uuid AS sale_product_uuid, p.period_days AS period_days,
                   p.daily_limit AS daily_limit, p.grace_days AS grace_days, p.active AS active,
                   JSON_QUERY(ISNULL((SELECT N'[' + STRING_AGG(N'"' + LOWER(CONVERT(VARCHAR(36), pr.uuid)) + N'"', N',') + N']'
                                       FROM dbo.membership_plan_products pp JOIN dbo.products pr ON pr.id = pp.product_id
                                      WHERE pp.plan_id = p.id), N'[]')) AS products
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #club_planes x
      JOIN dbo.membership_plans p ON p.id = x.id
      LEFT JOIN dbo.products sp ON sp.id = p.sale_product_id
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256',
                    CONCAT('MEMBERSHIP_PLAN|', CONVERT(VARCHAR(36), p.uuid), '|', x.version)) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #club_planes)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #club_planes), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'MEMBERSHIP_PLAN';

    /* ------------------------------------------ CLUB: MEMBRESÍAS (0063)
       El ESTADO de la membresía (hasta cuándo está pagada). Va también la
       de origen REMOTE cuando aquí cambió: una renovación en esta sucursal
       tiene que llegar a las demás. La nube se queda con el mayor. */
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'MEMBERSHIP')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('MEMBERSHIP', 0x0000000000000000);
    SELECT @cm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'MEMBERSHIP';

    SELECT TOP (@max_rows) m.id, m.row_version AS rv, CAST(m.row_version AS BIGINT) AS version
      INTO #club_socios
      FROM dbo.customer_memberships m
     WHERE m.row_version > @cm AND m.row_version < @tope
     ORDER BY m.row_version;

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid, 'MEMBERSHIP_UPDATED', 'MEMBERSHIP', m.uuid, x.version,
           TODATETIMEOFFSET(m.updated_at, @offset),
           (SELECT m.uuid AS uuid, p.uuid AS plan_uuid, c.customerName AS customer_name,
                   COALESCE(NULLIF(c.mobile, N''), c.phone) AS phone, m.status AS status,
                   CONVERT(VARCHAR(10), m.paid_until, 23) AS paid_until
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #club_socios x
      JOIN dbo.customer_memberships m ON m.id = x.id
      JOIN dbo.membership_plans p ON p.id = m.plan_id
      JOIN dbo.customers c ON c.id = m.customer_id
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256',
                    CONCAT('MEMBERSHIP|', CONVERT(VARCHAR(36), m.uuid), '|', x.version)) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #club_socios)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #club_socios), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'MEMBERSHIP';

    /* --------------------------------------------- CLUB: CANJES (0063)
       Solo los de ESTA caja (origin LOCAL). La nube decide si un día se
       dio de más (doble); eso baja después con sp_membership_apply_remote. */
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'MEMBERSHIP_REDEMPTION')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('MEMBERSHIP_REDEMPTION', 0x0000000000000000);
    SELECT @cm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'MEMBERSHIP_REDEMPTION';

    SELECT TOP (@max_rows) r.id, r.row_version AS rv, CAST(r.row_version AS BIGINT) AS version
      INTO #club_canjes
      FROM dbo.membership_redemptions r
     WHERE r.row_version > @cm AND r.row_version < @tope AND r.origin = N'LOCAL'
     ORDER BY r.row_version;

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid, CASE WHEN r.voided_at IS NULL THEN 'MEMBERSHIP_REDEEMED' ELSE 'MEMBERSHIP_REDEMPTION_VOIDED' END,
           'MEMBERSHIP_REDEMPTION', r.uuid, x.version,
           TODATETIMEOFFSET(r.created_at, @offset),
           (SELECT r.uuid AS uuid, m.uuid AS membership_uuid, CONVERT(VARCHAR(10), r.redeem_date, 23) AS redeem_date,
                   r.units AS units, pr.uuid AS product_uuid, r.product_name AS product_name,
                   CONVERT(VARCHAR(30), r.amount) AS amount, CAST(CASE WHEN r.voided_at IS NULL THEN 0 ELSE 1 END AS BIT) AS voided
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #club_canjes x
      JOIN dbo.membership_redemptions r ON r.id = x.id
      JOIN dbo.customer_memberships m ON m.id = r.membership_id
      LEFT JOIN dbo.products pr ON pr.id = r.product_id
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256',
                    CONCAT('MEMBERSHIP_REDEMPTION|', CONVERT(VARCHAR(36), r.uuid), '|', x.version)) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #club_canjes)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #club_canjes), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'MEMBERSHIP_REDEMPTION';

    /* ------------------------------------- PUNTOS: CONFIGURACIÓN (0064) */
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'POINTS_CONFIG')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('POINTS_CONFIG', 0x0000000000000000);
    SELECT @cm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'POINTS_CONFIG';

    SELECT c.id, c.row_version AS rv, CAST(c.row_version AS BIGINT) AS version
      INTO #pts_config
      FROM dbo.loyalty_points_config c
     WHERE c.row_version > @cm AND c.row_version < @tope AND c.origin = N'LOCAL';

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid, 'POINTS_CONFIG_SAVED', 'POINTS_CONFIG', '00000000-0000-0000-0000-000000000064', x.version,
           TODATETIMEOFFSET(c.updated_at, @offset),
           (SELECT c.enabled AS enabled, CONVERT(VARCHAR(30), c.per_amount) AS per_amount, c.points_per AS points_per, CONVERT(VARCHAR(19), c.updated_at, 126) AS updated_local,
                   c.visit_points AS visit_points, c.expiry_months AS expiry_months
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #pts_config x
      JOIN dbo.loyalty_points_config c ON c.id = x.id
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256', CONCAT('POINTS_CONFIG|', x.version)) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #pts_config)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #pts_config), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'POINTS_CONFIG';

    /* ------------------------------------------ PUNTOS: TARJETAS (0064) */
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'STAMP_CARD')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('STAMP_CARD', 0x0000000000000000);
    SELECT @cm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'STAMP_CARD';

    SELECT TOP (@max_rows) t.id, t.row_version AS rv, CAST(t.row_version AS BIGINT) AS version
      INTO #pts_tarjetas
      FROM dbo.loyalty_stamp_cards t
     WHERE t.row_version > @cm AND t.row_version < @tope AND t.origin = N'LOCAL'
     ORDER BY t.row_version;

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid, 'STAMP_CARD_SAVED', 'STAMP_CARD', t.uuid, x.version,
           TODATETIMEOFFSET(t.updated_at, @offset),
           (SELECT t.uuid AS uuid, t.name AS name, t.stamps_required AS stamps_required, rp.uuid AS reward_product_uuid, t.active AS active,
                   JSON_QUERY(ISNULL((SELECT N'[' + STRING_AGG(N'"' + LOWER(CONVERT(VARCHAR(36), pr.uuid)) + N'"', N',') + N']'
                                       FROM dbo.loyalty_stamp_card_products cp JOIN dbo.products pr ON pr.id = cp.product_id
                                      WHERE cp.card_id = t.id), N'[]')) AS products
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #pts_tarjetas x
      JOIN dbo.loyalty_stamp_cards t ON t.id = x.id
      LEFT JOIN dbo.products rp ON rp.id = t.reward_product_id
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256',
                    CONCAT('STAMP_CARD|', CONVERT(VARCHAR(36), t.uuid), '|', x.version)) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #pts_tarjetas)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #pts_tarjetas), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'STAMP_CARD';

    /* -------------------------------------------- PUNTOS: EL LIBRO (0064)
       Solo los movimientos de ESTA caja. Son inmutables: cada uno viaja una
       vez. El cliente se reconoce en las otras sucursales por su teléfono. */
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'LOYALTY_LEDGER')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('LOYALTY_LEDGER', 0x0000000000000000);
    SELECT @cm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'LOYALTY_LEDGER';

    SELECT TOP (@max_rows) l.id, l.row_version AS rv, CAST(l.row_version AS BIGINT) AS version
      INTO #pts_libro
      FROM dbo.loyalty_ledger l
     WHERE l.row_version > @cm AND l.row_version < @tope AND l.origin = N'LOCAL'
     ORDER BY l.row_version;

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid, 'LOYALTY_MOVEMENT', 'LOYALTY_LEDGER', l.uuid, x.version,
           TODATETIMEOFFSET(l.created_at, @offset),
           (SELECT l.uuid AS uuid, c.customerName AS customer_name, COALESCE(NULLIF(c.mobile, N''), c.phone) AS phone,
                   l.program AS program, t.uuid AS card_uuid, l.delta AS delta, l.kind AS kind, l.reason AS reason,
                   CONVERT(VARCHAR(30), l.amount) AS amount, l.note AS note,
                   CONVERT(VARCHAR(19), l.created_at, 126) AS created_local
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #pts_libro x
      JOIN dbo.loyalty_ledger l ON l.id = x.id
      JOIN dbo.customers c ON c.id = l.customer_id
      LEFT JOIN dbo.loyalty_stamp_cards t ON t.id = l.card_id
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256',
                    CONCAT('LOYALTY_LEDGER|', CONVERT(VARCHAR(36), l.uuid))) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #pts_libro)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #pts_libro), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'LOYALTY_LEDGER';

    COMMIT TRAN;

    SELECT @capturados AS capturados,
           (SELECT COUNT(*) FROM dbo.sync_outbox WHERE status = 'PENDING') AS pendientes;
END
GO
