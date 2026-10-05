/* ============================================================
   0052 — fase2 transferencias catalogo

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0052_fase2-transferencias-catalogo.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0052_fase2-transferencias-catalogo.sql ========== */
/* ============================================================================
   0052 — FASE 2: CATÁLOGO PUBLICABLE Y TRANSFERENCIAS SUCURSAL <-> EVENTO
   ----------------------------------------------------------------------------
   Aditiva y reejecutable. No borra ni reescribe datos existentes.

   1. UUID EN EL CATÁLOGO (solo lo que cruza a la tablet)
      Un EVENT (feria) vende con el catálogo de su sucursal base. La tablet no
      conoce los ids locales de esta base: producto, receta, grupo y opción de
      modificador, y categoría llevan un UUID estable. La PK local se queda.

   2. TRANSFERENCIAS (stock_transfers / stock_transfer_lines)
      La sucursal es la autoridad de SU inventario. Mandar mercancía a una
      feria es una SALIDA aquí (TRANSFER_OUT) y una ENTRADA allá
      (TRANSFER_IN); recibir el sobrante es la inversa (RETURN_TRANSFER_IN).
      Se guarda lo ENVIADO y lo RECIBIDO por separado: si salen 40 y llegan
      39, la diferencia queda a la vista, no se maquilla.

        kind     OUT        esta sucursal manda a un evento
                 RETURN_IN  esta sucursal recibe lo que regresa de un evento
        status   SENT       salió de aquí (OUT) / la tablet ya lo mandó (RETURN_IN)
                 RECEIVED   la contraparte confirmó (con lo que realmente llegó)
                 CANCELLED  anulada antes de recibirse (se revierte el stock)

      `uuid` es el mismo en la sucursal, en la nube y en la tablet: es lo que
      hace idempotente recibir dos veces la misma transferencia.

   RECUPERACIÓN: tablas nuevas y columnas con default; revertir es dejarlas
   sin uso. Las transferencias ya hechas siguen explicando el stock por sus
   movimientos en `inventory_movements` (source TRANSFER_OUT / RETURN_TRANSFER_IN).
   ========================================================================== */

/* ---------------------------------------------------------------- 1 */
IF COL_LENGTH('dbo.products', 'uuid') IS NULL
    ALTER TABLE dbo.products ADD uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_products_uuid DEFAULT NEWID();
IF COL_LENGTH('dbo.recipes', 'uuid') IS NULL
    ALTER TABLE dbo.recipes ADD uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_recipes_uuid DEFAULT NEWID();
IF COL_LENGTH('dbo.modifier_groups', 'uuid') IS NULL
    ALTER TABLE dbo.modifier_groups ADD uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_modifier_groups_uuid DEFAULT NEWID();
IF COL_LENGTH('dbo.modifier_options', 'uuid') IS NULL
    ALTER TABLE dbo.modifier_options ADD uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_modifier_options_uuid DEFAULT NEWID();
IF COL_LENGTH('dbo.CAT_categories', 'uuid') IS NULL
    ALTER TABLE dbo.CAT_categories ADD uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_CAT_categories_uuid DEFAULT NEWID();
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_products_uuid' AND object_id = OBJECT_ID(N'dbo.products'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_products_uuid ON dbo.products (uuid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_recipes_uuid' AND object_id = OBJECT_ID(N'dbo.recipes'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_recipes_uuid ON dbo.recipes (uuid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_modifier_groups_uuid' AND object_id = OBJECT_ID(N'dbo.modifier_groups'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_modifier_groups_uuid ON dbo.modifier_groups (uuid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_modifier_options_uuid' AND object_id = OBJECT_ID(N'dbo.modifier_options'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_modifier_options_uuid ON dbo.modifier_options (uuid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_CAT_categories_uuid' AND object_id = OBJECT_ID(N'dbo.CAT_categories'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_CAT_categories_uuid ON dbo.CAT_categories (uuid);
GO

/* ---------------------------------------------------------------- 2 */
IF OBJECT_ID(N'dbo.stock_transfers', 'U') IS NULL
BEGIN
CREATE TABLE dbo.stock_transfers (
    id                   INT IDENTITY(1, 1) NOT NULL,
    uuid                 UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_stock_transfers_uuid DEFAULT NEWID(),
    kind                 VARCHAR(12) NOT NULL,
    status               VARCHAR(12) NOT NULL,
    event_location_uuid  UNIQUEIDENTIFIER NOT NULL,
    event_name           NVARCHAR(120) NULL,
    note                 NVARCHAR(255) NULL,
    created_by           INT NOT NULL,
    created_at           DATETIME2(0) NOT NULL CONSTRAINT DF_stock_transfers_created_at DEFAULT SYSDATETIME(),
    created_machine_name NVARCHAR(120) NULL,
    received_by          INT NULL,
    received_at          DATETIME2(0) NULL,
    cancelled_at         DATETIME2(0) NULL,
    manifest_signature   NVARCHAR(200) NULL,
    rv                   ROWVERSION NOT NULL,
    CONSTRAINT PK_stock_transfers PRIMARY KEY CLUSTERED (id),
    CONSTRAINT CK_stock_transfers_kind CHECK (kind IN ('OUT', 'RETURN_IN')),
    CONSTRAINT CK_stock_transfers_status CHECK (status IN ('SENT', 'RECEIVED', 'CANCELLED')),
    CONSTRAINT FK_stock_transfers_created_by FOREIGN KEY (created_by) REFERENCES dbo.users (id)
);
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_stock_transfers_uuid' AND object_id = OBJECT_ID(N'dbo.stock_transfers'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_stock_transfers_uuid ON dbo.stock_transfers (uuid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_stock_transfers_rv' AND object_id = OBJECT_ID(N'dbo.stock_transfers'))
    CREATE NONCLUSTERED INDEX IX_stock_transfers_rv ON dbo.stock_transfers (rv);
GO

IF OBJECT_ID(N'dbo.stock_transfer_lines', 'U') IS NULL
BEGIN
CREATE TABLE dbo.stock_transfer_lines (
    id            INT IDENTITY(1, 1) NOT NULL,
    transfer_id   INT NOT NULL,
    product_id    INT NOT NULL,
    qty_sent      DECIMAL(12, 2) NOT NULL,
    qty_received  DECIMAL(12, 2) NULL,
    CONSTRAINT PK_stock_transfer_lines PRIMARY KEY CLUSTERED (id),
    CONSTRAINT FK_stock_transfer_lines_transfer FOREIGN KEY (transfer_id) REFERENCES dbo.stock_transfers (id),
    CONSTRAINT FK_stock_transfer_lines_product FOREIGN KEY (product_id) REFERENCES dbo.products (id),
    CONSTRAINT CK_stock_transfer_lines_qty CHECK (qty_sent >= 0 AND (qty_received IS NULL OR qty_received >= 0))
);
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_stock_transfer_lines_transfer' AND object_id = OBJECT_ID(N'dbo.stock_transfer_lines'))
    CREATE NONCLUSTERED INDEX IX_stock_transfer_lines_transfer ON dbo.stock_transfer_lines (transfer_id);
GO

/* ---------- sp_catalog_publication (SQL_STORED_PROCEDURE) ---------- */
/* sp_catalog_publication
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_catalog_publication ======================
   0052. El catalogo de ESTA sucursal tal como lo necesita una tablet de un
   evento que la tiene como sucursal base: un solo JSON.

   QUE INCLUYE (y nada mas)
     products         lo vendible (activo y sellable) + todo lo activo con
                      inventario propio (DIRECT: vasos, servilletas... se pueden
                      mandar a la feria aunque no se vendan) + los insumos que
                      usan las recetas y las opciones activas (sus costos y su
                      existencia en el evento dependen de ellos)
     recipes          activas, con sus lineas (cantidad base y merma)
     modifier_groups  activos, con sus opciones activas
     categories

   Los numeros viajan como TEXTO: JSON los convertiria en flotantes y la
   tablet tiene que calcular exactamente lo mismo que sp_register_sale.
   Los UUID van en minusculas para que comparar sea comparar texto.

   La nube asigna `catalog_version`: si el JSON no cambio, la version tampoco.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_catalog_publication
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH ref AS (
        SELECT rl.ingredient_product_id AS id
          FROM dbo.recipe_lines rl JOIN dbo.recipes r ON r.id = rl.recipe_id AND r.active = 1
        UNION
        SELECT ingredient_product_id FROM dbo.modifier_options WHERE active = 1 AND ingredient_product_id IS NOT NULL
        UNION
        SELECT replaces_product_id FROM dbo.modifier_options WHERE active = 1 AND replaces_product_id IS NOT NULL
    ), prods AS (
        SELECT p.* FROM dbo.products p
         WHERE (ISNULL(p.active, 1) = 1 AND (p.sellable = 1 OR p.inventory_mode = 'DIRECT')) OR p.id IN (SELECT id FROM ref)
    )
    SELECT (
        SELECT
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), p.uuid)) AS uuid,
                       p.nombre,
                       CONVERT(VARCHAR(20), p.price) AS price,
                       CONVERT(VARCHAR(30), p.cost) AS cost,
                       p.inventory_mode,
                       CAST(p.sellable AS BIT) AS sellable,
                       CAST(ISNULL(p.active, 1) AS BIT) AS active,
                       CAST(p.allow_decimal_qty AS BIT) AS allow_decimal_qty,
                       LOWER(CONVERT(VARCHAR(36), c.uuid)) AS category_uuid,
                       CONVERT(VARCHAR(10), p.tasa_iva) AS tasa_iva,
                       p.base_uom,
                       JSON_QUERY(ISNULL((
                           SELECT '[' + STRING_AGG('"' + LOWER(CONVERT(VARCHAR(36), g.uuid)) + '"', ',')
                                        WITHIN GROUP (ORDER BY pmg.sort_order, g.id) + ']'
                             FROM dbo.product_modifier_groups pmg JOIN dbo.modifier_groups g ON g.id = pmg.group_id
                            WHERE pmg.product_id = p.id), '[]')) AS modifier_groups
                  FROM prods p LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
                 ORDER BY p.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS products,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), r.uuid)) AS uuid,
                       LOWER(CONVERT(VARCHAR(36), pr.uuid)) AS product_uuid,
                       LOWER(CONVERT(VARCHAR(36), vo.uuid)) AS variant_option_uuid,
                       CAST(r.active AS BIT) AS active,
                       JSON_QUERY(ISNULL((
                           SELECT LOWER(CONVERT(VARCHAR(36), ip.uuid)) AS ingredient_uuid,
                                  CONVERT(VARCHAR(30), rl.qty_base) AS qty_base,
                                  CONVERT(VARCHAR(10), rl.waste_pct) AS waste_pct
                             FROM dbo.recipe_lines rl JOIN dbo.products ip ON ip.id = rl.ingredient_product_id
                            WHERE rl.recipe_id = r.id
                            ORDER BY rl.sort_order, rl.id
                              FOR JSON PATH), '[]')) AS lines
                  FROM dbo.recipes r
                  JOIN dbo.products pr ON pr.id = r.product_id
                  LEFT JOIN dbo.modifier_options vo ON vo.id = r.variant_option_id
                 WHERE r.active = 1 AND r.product_id IN (SELECT id FROM prods)
                 ORDER BY r.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS recipes,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), g.uuid)) AS uuid, g.name, g.role, g.min_select, g.max_select,
                       CAST(g.required AS BIT) AS required, CAST(g.active AS BIT) AS active,
                       JSON_QUERY(ISNULL((
                           SELECT LOWER(CONVERT(VARCHAR(36), o.uuid)) AS uuid, o.name,
                                  CONVERT(VARCHAR(20), o.price_delta) AS price_delta, o.effect,
                                  LOWER(CONVERT(VARCHAR(36), ing.uuid)) AS ingredient_uuid,
                                  LOWER(CONVERT(VARCHAR(36), rep.uuid)) AS replaces_uuid,
                                  CONVERT(VARCHAR(30), o.qty_base) AS qty_base,
                                  CONVERT(VARCHAR(20), o.qty_factor) AS qty_factor,
                                  CAST(o.active AS BIT) AS active
                             FROM dbo.modifier_options o
                             LEFT JOIN dbo.products ing ON ing.id = o.ingredient_product_id
                             LEFT JOIN dbo.products rep ON rep.id = o.replaces_product_id
                            WHERE o.group_id = g.id AND o.active = 1
                            ORDER BY o.sort_order, o.id
                              FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS options
                  FROM dbo.modifier_groups g
                 WHERE g.active = 1
                 ORDER BY g.sort_order, g.id
                   FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS modifier_groups,
            JSON_QUERY(ISNULL((
                SELECT LOWER(CONVERT(VARCHAR(36), c.uuid)) AS uuid, c.namee AS nombre
                  FROM dbo.CAT_categories c ORDER BY c.id
                   FOR JSON PATH), '[]')) AS categories
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS catalog_json;
END
GO

/* ---------- sp_staff_publication (SQL_STORED_PROCEDURE) ---------- */
/* sp_staff_publication
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_staff_publication ======================
   0052. Las personas de ESTA sucursal que pueden trabajar en un evento:
   activas y con PIN personal vigente.

   Viaja el HASH del PIN (scrypt N=16384 r=8 p=1, 32 bytes) y su sal, nunca
   el PIN ni la contrasena: la tablet tiene que identificar a la persona sin
   Internet y no puede preguntarle a nadie. El rol de SUCURSAL viaja como
   referencia; el rol que vale en el evento lo asigna el dueno por ubicacion
   (ser encargado aqui no da permisos en la feria).
   ================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_staff_publication
AS
BEGIN
    SET NOCOUNT ON;
    SELECT JSON_QUERY(ISNULL((
        SELECT LOWER(CONVERT(VARCHAR(36), u.uuid)) AS uuid,
               u.usuario AS name,
               LOWER(LTRIM(RTRIM(u.rol))) AS branch_role,
               a.pin_hash,
               a.pin_sal,
               'scrypt:16384:8:1:32' AS pin_algo,
               CONVERT(VARCHAR(19), a.pin_creado_en, 126) AS pin_set_at
          FROM dbo.users u
          JOIN dbo.trabajadores_acceso a ON a.user_id = u.id
         WHERE u.active = 1 AND a.pin_hash IS NOT NULL AND a.revocado_en IS NULL
         ORDER BY u.id
           FOR JSON PATH), '[]')) AS staff_json;
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
                s.service_mode                  AS service_mode,
                s.venta_esencial                AS venta_esencial,
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

    COMMIT TRAN;

    SELECT @capturados AS capturados,
           (SELECT COUNT(*) FROM dbo.sync_outbox WHERE status = 'PENDING') AS pendientes;
END
GO

/* ---------- sp_transfer_confirm_out (SQL_STORED_PROCEDURE) ---------- */
/* sp_transfer_confirm_out
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_transfer_confirm_out ======================
   0052. El evento confirmo lo que RECIBIO de un envio de esta sucursal.

   No cambia el stock de aqui (ya salio al enviar): solo registra cuanto
   llego, para que la diferencia en transito quede a la vista en la
   transferencia. Idempotente: confirmar otra vez no cambia nada.

   @lines JSON: [{"product_uuid":"...","qty_received":39}, ...]
   ===================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_transfer_confirm_out
    @transfer_uuid UNIQUEIDENTIFIER,
    @lines         NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @id INT, @status VARCHAR(12);
    SELECT @id = id, @status = status FROM dbo.stock_transfers WHERE uuid = @transfer_uuid AND kind = 'OUT';
    IF @id IS NULL
    BEGIN RAISERROR('La transferencia no existe en esta sucursal.', 16, 1); RETURN; END

    IF @status = 'SENT'
    BEGIN
        BEGIN TRAN;
        UPDATE l SET qty_received = j.qty_received
          FROM dbo.stock_transfer_lines l
          JOIN dbo.products p ON p.id = l.product_id
          JOIN OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid', qty_received DECIMAL(12,2) '$.qty_received') j
            ON j.product_uuid = p.uuid
         WHERE l.transfer_id = @id;
        UPDATE dbo.stock_transfers SET status = 'RECEIVED', received_at = SYSDATETIME() WHERE id = @id;
        COMMIT TRAN;
    END

    SELECT t.uuid AS transfer_uuid, t.status,
           (SELECT SUM(l.qty_sent - ISNULL(l.qty_received, l.qty_sent)) FROM dbo.stock_transfer_lines l WHERE l.transfer_id = t.id) AS diferencia
      FROM dbo.stock_transfers t WHERE t.id = @id;
END
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
    @max_rows INT = 100
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@max_rows) t.id, t.uuid AS transfer_uuid, t.kind, t.status, t.event_location_uuid, t.event_name, t.note,
           t.created_at, t.received_at, u.usuario AS created_by_name, t.created_machine_name,
           (SELECT SUM(l.qty_sent) FROM dbo.stock_transfer_lines l WHERE l.transfer_id = t.id) AS total_sent,
           (SELECT SUM(l.qty_received) FROM dbo.stock_transfer_lines l WHERE l.transfer_id = t.id) AS total_received
      INTO #t
      FROM dbo.stock_transfers t LEFT JOIN dbo.users u ON u.id = t.created_by
     WHERE @event_location_uuid IS NULL OR t.event_location_uuid = @event_location_uuid
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

/* ---------- sp_transfer_receive_return (SQL_STORED_PROCEDURE) ---------- */
/* sp_transfer_receive_return
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_transfer_receive_return ======================
   0052. La sucursal RECIBE el sobrante que regresa de un evento.

   La tablet registro RETURN_TRANSFER_OUT (lo que mando). Aqui se cuenta lo
   que llego: entra al almacen (entrada / RETURN_TRANSFER_IN) y se guardan
   las dos cantidades. Si la feria mando 8 y llegaron 7, la diferencia queda
   en la transferencia; no se ajusta nada en silencio.

   @transfer_uuid  el UUID que genero la tablet. Recibir dos veces la misma
                   transferencia no suma dos veces: devuelve la existente.
   @lines  JSON: [{"product_uuid":"...","qty_sent":8,"qty_received":8}, ...]
   ======================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_transfer_receive_return
    @user_id             INT,
    @transfer_uuid       UNIQUEIDENTIFIER,
    @event_location_uuid UNIQUEIDENTIFIER,
    @event_name          NVARCHAR(120),
    @lines               NVARCHAR(MAX),
    @machine_name        NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @errmsg NVARCHAR(400);

    IF @transfer_uuid IS NULL
    BEGIN RAISERROR('Falta la transferencia que se recibe.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.stock_transfers WHERE uuid = @transfer_uuid)
    BEGIN
        SELECT uuid AS transfer_uuid, status, kind, CAST(1 AS BIT) AS ya_existia
          FROM dbo.stock_transfers WHERE uuid = @transfer_uuid;
        RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Falta quien recibe la mercancia.', 16, 1); RETURN; END

    CREATE TABLE #l (product_id INT NOT NULL PRIMARY KEY, qty_sent DECIMAL(12,2) NOT NULL, qty_received DECIMAL(12,2) NOT NULL);
    INSERT INTO #l (product_id, qty_sent, qty_received)
    SELECT p.id, SUM(j.qty_sent), SUM(j.qty_received)
      FROM OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid',
                                  qty_sent DECIMAL(12,2) '$.qty_sent', qty_received DECIMAL(12,2) '$.qty_received') j
      JOIN dbo.products p ON p.uuid = j.product_uuid
     GROUP BY p.id;

    IF (SELECT COUNT(DISTINCT j.product_uuid) FROM OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid') j) <> (SELECT COUNT(*) FROM #l)
       OR NOT EXISTS (SELECT 1 FROM #l)
    BEGIN RAISERROR('Un producto del retorno no existe en esta sucursal.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM #l WHERE qty_sent < 0 OR qty_received < 0)
    BEGIN RAISERROR('Las cantidades del retorno no pueden ser negativas.', 16, 1); RETURN; END

    DECLARE @id INT;
    BEGIN TRY
        BEGIN TRAN;
        INSERT INTO dbo.stock_transfers (uuid, kind, status, event_location_uuid, event_name, created_by, created_machine_name,
                                         received_by, received_at)
        VALUES (@transfer_uuid, 'RETURN_IN', 'RECEIVED', @event_location_uuid, LEFT(@event_name, 120), @user_id, @machine_name,
                @user_id, SYSDATETIME());
        SET @id = SCOPE_IDENTITY();

        INSERT INTO dbo.stock_transfer_lines (transfer_id, product_id, qty_sent, qty_received)
        SELECT @id, product_id, qty_sent, qty_received FROM #l;

        UPDATE p SET p.stock = p.stock + l.qty_received
          FROM dbo.products p WITH (UPDLOCK, HOLDLOCK) JOIN #l l ON l.product_id = p.id
         WHERE l.qty_received > 0;

        INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        SELECT l.product_id, 'entrada', CONVERT(NVARCHAR(36), @transfer_uuid), l.qty_received, GETDATE(),
               LEFT(CONCAT(N'Regreso de evento: ', @event_name), 255), 'RETURN_TRANSFER_IN', p.cost
          FROM #l l JOIN dbo.products p ON p.id = l.product_id
         WHERE l.qty_received > 0;
        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        SET @errmsg = ERROR_MESSAGE();
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END CATCH

    SELECT uuid AS transfer_uuid, status, kind, CAST(0 AS BIT) AS ya_existia FROM dbo.stock_transfers WHERE id = @id;
END
GO

/* ---------- sp_transfer_send (SQL_STORED_PROCEDURE) ---------- */
/* sp_transfer_send
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_transfer_send ======================
   0052. La sucursal MANDA mercancia a un evento (feria).

   Es una SALIDA de esta sucursal: baja el stock aqui, en la misma
   transaccion, y deja su movimiento (salida / TRANSFER_OUT). La entrada en
   el evento la registra la tablet cuando la recibe, con lo que realmente
   llego: la diferencia, si la hay, se ve en la transferencia.

   @lines  JSON: [{"product_uuid":"...","qty":40}, ...]  (UUID: lo mismo que
           ve la tablet; un id local no significa nada fuera de esta base).
   @transfer_uuid  si se manda y ya existe, devuelve la existente sin tocar
           nada (reintento de la pantalla = un solo envio).

   No se permite dejar la sucursal en negativo: lo que no esta en el almacen
   no puede salir hacia la feria.
   ============================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_transfer_send
    @user_id             INT,
    @event_location_uuid UNIQUEIDENTIFIER,
    @event_name          NVARCHAR(120),
    @lines               NVARCHAR(MAX),
    @note                NVARCHAR(255) = NULL,
    @machine_name        NVARCHAR(120) = NULL,
    @transfer_uuid       UNIQUEIDENTIFIER = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @errmsg NVARCHAR(400);

    IF @transfer_uuid IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.stock_transfers WHERE uuid = @transfer_uuid)
    BEGIN
        SELECT t.uuid AS transfer_uuid, t.status, t.kind, CAST(1 AS BIT) AS ya_existia
          FROM dbo.stock_transfers t WHERE t.uuid = @transfer_uuid;
        RETURN;
    END

    IF @event_location_uuid IS NULL
    BEGIN RAISERROR('Indica el evento al que se manda la mercancia.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND active = 1)
    BEGIN RAISERROR('Falta quien envia la mercancia.', 16, 1); RETURN; END

    CREATE TABLE #l (product_id INT NOT NULL PRIMARY KEY, qty DECIMAL(12,2) NOT NULL);
    INSERT INTO #l (product_id, qty)
    SELECT p.id, SUM(CAST(j.qty AS DECIMAL(12,2)))
      FROM OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid', qty DECIMAL(12,2) '$.qty') j
      JOIN dbo.products p ON p.uuid = j.product_uuid
     GROUP BY p.id;

    IF (SELECT COUNT(*) FROM OPENJSON(@lines)) = 0
    BEGIN RAISERROR('La transferencia no tiene productos.', 16, 1); RETURN; END
    IF (SELECT COUNT(DISTINCT j.product_uuid) FROM OPENJSON(@lines) WITH (product_uuid UNIQUEIDENTIFIER '$.product_uuid') j) <> (SELECT COUNT(*) FROM #l)
    BEGIN RAISERROR('Un producto de la transferencia no existe en esta sucursal.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM #l WHERE qty <= 0)
    BEGIN RAISERROR('Cada cantidad a enviar debe ser mayor a cero.', 16, 1); RETURN; END

    DECLARE @id INT, @uuid UNIQUEIDENTIFIER = ISNULL(@transfer_uuid, NEWID());

    BEGIN TRY
        BEGIN TRAN;

        /* Bloqueo en orden de id y validacion de existencias. */
        DECLARE @pid INT = NULL, @stk DECIMAL(12,2), @rq DECIMAL(12,2), @pname NVARCHAR(100);
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
        VALUES (@uuid, 'OUT', 'SENT', @event_location_uuid, LEFT(@event_name, 120), @note, @user_id, @machine_name);
        SET @id = SCOPE_IDENTITY();

        INSERT INTO dbo.stock_transfer_lines (transfer_id, product_id, qty_sent)
        SELECT @id, product_id, qty FROM #l;

        UPDATE p SET p.stock = p.stock - l.qty
          FROM dbo.products p JOIN #l l ON l.product_id = p.id;

        INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
        SELECT l.product_id, 'salida', CONVERT(NVARCHAR(36), @uuid), l.qty, GETDATE(),
               LEFT(CONCAT(N'Envio a evento: ', @event_name), 255), 'TRANSFER_OUT', p.cost
          FROM #l l JOIN dbo.products p ON p.id = l.product_id;

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        SET @errmsg = ERROR_MESSAGE();
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END CATCH

    SELECT t.uuid AS transfer_uuid, t.status, t.kind, CAST(0 AS BIT) AS ya_existia
      FROM dbo.stock_transfers t WHERE t.id = @id;
    SELECT p.uuid AS product_uuid, p.nombre AS product_name, l.qty_sent
      FROM dbo.stock_transfer_lines l JOIN dbo.products p ON p.id = l.product_id
     WHERE l.transfer_id = @id ORDER BY l.id;
END
GO
