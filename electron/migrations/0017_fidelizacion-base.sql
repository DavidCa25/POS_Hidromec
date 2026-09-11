/* ============================================================
   0017 — fidelizacion base

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0017_fidelizacion-base.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0017_fidelizacion-base.sql ========== */
/* ---------------------------------------------------------------------------
   BLOQUE DE ESQUEMA — FIDELIZACION, base.

   Campanas, recompensas y cupones. Todo ADITIVO: un negocio que no active
   Fidelizacion no tiene ni una fila aqui y no nota ninguna diferencia.

   POR QUE `loyalty_enabled` VIVE EN business_config
   ------------------------------------------------
   Es una decision del NEGOCIO, no de la caja: si el dueno activa
   Fidelizacion, la activa para todas sus cajas a la vez. `business_profile`
   ya vive aqui por la misma razon, y `CapabilityService` lo lee del mismo
   sitio. Ponerlo en `device-config.json` habria significado que la Caja 1 ve
   las rifas y la Caja 2 no.

   DEFINICION E INSTANCIA SON COSAS DISTINTAS
   ------------------------------------------
   `reward_definitions` dice QUE se puede ganar; `reward_instances`, que gano
   ALGUIEN en concreto. Igual con los cupones. Mezclarlas obligaria a elegir
   entre no poder editar nunca la definicion o reescribir el pasado al
   editarla, y las dos salidas son malas.

   LAS INSTANCIAS SON DE LA SUCURSAL, NO DEL EQUIPO
   ------------------------------------------------
   Nada de esto vive en `localStorage`. Una recompensa emitida por la Caja 1
   se redime en la Caja 2 porque las dos leen la misma base. `register_id` y
   `machine_id` quedan registrados como PROCEDENCIA -para auditar donde se
   emitio-, nunca como propiedad.

   Idempotente: se puede reejecutar.
   --------------------------------------------------------------------------- */

IF COL_LENGTH(N'dbo.business_config', N'loyalty_enabled') IS NULL
    ALTER TABLE dbo.business_config ADD loyalty_enabled BIT NOT NULL
        CONSTRAINT DF_business_config_loyalty_enabled DEFAULT ((0));
GO

/* ===========================================================================
   CAMPANAS — QUIEN tiene derecho a QUE
   ===========================================================================
   Una campana decide ELEGIBILIDAD y que se otorga. Las condiciones son
   COLUMNAS TIPADAS, no un motor de reglas: en V1 se cubren los casos reales
   de una cafeteria -importe minimo, producto concreto, dias y horas, primera
   compra- y cada una se puede leer, indexar y explicar. Un motor generico
   habria costado diez veces mas y habria respondido las mismas preguntas.

   `per_amount` es lo que convierte "cada $200, un boleto" en una regla y no
   en un `if` repartido por el codigo: 0 = una sola vez, >0 = una por cada
   tramo de ese importe.
   =========================================================================== */
IF OBJECT_ID(N'dbo.campaigns', 'U') IS NULL
BEGIN
CREATE TABLE dbo.campaigns (
    id INT IDENTITY(1, 1) NOT NULL,
    name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    description NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,

    -- Que otorga: REWARD | COUPON | DYNAMIC | RAFFLE_ENTRY
    outcome NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    reward_definition_id INT NULL,
    coupon_definition_id INT NULL,
    dynamic_definition_id INT NULL,
    raffle_id INT NULL,

    -- Cuanto otorga. `per_amount` > 0 reparte una unidad por tramo.
    quantity INT NOT NULL CONSTRAINT DF_campaigns_quantity DEFAULT ((1)),
    per_amount DECIMAL(12, 2) NULL,

    -- Condiciones tipadas. NULL = no condiciona.
    min_total DECIMAL(12, 2) NULL,
    product_id INT NULL,
    requires_customer BIT NOT NULL CONSTRAINT DF_campaigns_requires_customer DEFAULT ((0)),
    first_purchase_only BIT NOT NULL CONSTRAINT DF_campaigns_first_purchase_only DEFAULT ((0)),
    -- Mascara de dias: bit 0 = domingo ... bit 6 = sabado. NULL = todos.
    weekday_mask TINYINT NULL,
    time_from TIME(0) NULL,
    time_to TIME(0) NULL,
    starts_at DATETIME2(0) NULL,
    ends_at DATETIME2(0) NULL,

    priority INT NOT NULL CONSTRAINT DF_campaigns_priority DEFAULT ((100)),
    active BIT NOT NULL CONSTRAINT DF_campaigns_active DEFAULT ((1)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_campaigns_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_campaigns PRIMARY KEY CLUSTERED (id)
);
END;
GO

IF OBJECT_ID(N'dbo.CK_campaigns_outcome', 'C') IS NULL
ALTER TABLE dbo.campaigns WITH CHECK ADD CONSTRAINT CK_campaigns_outcome
    CHECK ([outcome] IN ('REWARD', 'COUPON', 'DYNAMIC', 'RAFFLE_ENTRY'));
GO

/* ===========================================================================
   RECOMPENSAS
   =========================================================================== */
IF OBJECT_ID(N'dbo.reward_definitions', 'U') IS NULL
BEGIN
CREATE TABLE dbo.reward_definitions (
    id INT IDENTITY(1, 1) NOT NULL,
    name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    -- FREE_PRODUCT | AMOUNT | PERCENT | UPGRADE | CUSTOM
    kind NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    product_id INT NULL,
    amount DECIMAL(12, 2) NULL,
    discount_pct DECIMAL(5, 2) NULL,
    notes NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL,
    -- Cuantos dias vive la recompensa desde que se emite. NULL = sin caducidad.
    valid_days INT NULL,
    uses_allowed INT NOT NULL CONSTRAINT DF_reward_definitions_uses DEFAULT ((1)),
    active BIT NOT NULL CONSTRAINT DF_reward_definitions_active DEFAULT ((1)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_reward_definitions_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_reward_definitions PRIMARY KEY CLUSTERED (id)
);
END;
GO

IF OBJECT_ID(N'dbo.CK_reward_definitions_kind', 'C') IS NULL
ALTER TABLE dbo.reward_definitions WITH CHECK ADD CONSTRAINT CK_reward_definitions_kind
    CHECK ([kind] IN ('FREE_PRODUCT', 'AMOUNT', 'PERCENT', 'UPGRADE', 'CUSTOM'));
GO

/* El derecho concreto que gano alguien.
   `customer_id` es OPCIONAL a proposito: no se obliga a registrar cliente
   para participar. Sin cliente, el `code` es el que manda el derecho, y se
   puede imprimir en el ticket. */
IF OBJECT_ID(N'dbo.reward_instances', 'U') IS NULL
BEGIN
CREATE TABLE dbo.reward_instances (
    id INT IDENTITY(1, 1) NOT NULL,
    definition_id INT NOT NULL,
    campaign_id INT NULL,
    customer_id INT NULL,
    code NVARCHAR(24) COLLATE Modern_Spanish_CI_AS NOT NULL,

    -- Procedencia: donde se emitio. Nunca propiedad.
    sale_id INT NULL,
    register_id INT NULL,
    machine_id NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,

    -- ISSUED | REDEEMED | EXPIRED | CANCELLED
    status NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_reward_instances_status DEFAULT ('ISSUED'),
    uses_allowed INT NOT NULL CONSTRAINT DF_reward_instances_uses_allowed DEFAULT ((1)),
    uses_count INT NOT NULL CONSTRAINT DF_reward_instances_uses_count DEFAULT ((0)),
    issued_at DATETIME2(0) NOT NULL CONSTRAINT DF_reward_instances_issued_at DEFAULT (sysutcdatetime()),
    expires_at DATETIME2(0) NULL,
    CONSTRAINT PK_reward_instances PRIMARY KEY CLUSTERED (id)
);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_reward_instances_code' AND object_id = OBJECT_ID(N'dbo.reward_instances'))
CREATE UNIQUE NONCLUSTERED INDEX UX_reward_instances_code ON dbo.reward_instances (code);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_reward_instances_customer' AND object_id = OBJECT_ID(N'dbo.reward_instances'))
CREATE NONCLUSTERED INDEX IX_reward_instances_customer ON dbo.reward_instances (customer_id, status) INCLUDE (expires_at);
GO

/* ===========================================================================
   CUPONES
   =========================================================================== */
IF OBJECT_ID(N'dbo.coupon_definitions', 'U') IS NULL
BEGIN
CREATE TABLE dbo.coupon_definitions (
    id INT IDENTITY(1, 1) NOT NULL,
    name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    -- AMOUNT | PERCENT | FREE_PRODUCT
    kind NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    amount DECIMAL(12, 2) NULL,
    discount_pct DECIMAL(5, 2) NULL,
    product_id INT NULL,
    valid_days INT NULL,
    uses_allowed INT NOT NULL CONSTRAINT DF_coupon_definitions_uses DEFAULT ((1)),
    -- Prefijo del codigo visible. El sufijo se genera al emitir.
    code_prefix NVARCHAR(8) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_coupon_definitions_prefix DEFAULT ('WYBIX'),
    active BIT NOT NULL CONSTRAINT DF_coupon_definitions_active DEFAULT ((1)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_coupon_definitions_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_coupon_definitions PRIMARY KEY CLUSTERED (id)
);
END;
GO

IF OBJECT_ID(N'dbo.CK_coupon_definitions_kind', 'C') IS NULL
ALTER TABLE dbo.coupon_definitions WITH CHECK ADD CONSTRAINT CK_coupon_definitions_kind
    CHECK ([kind] IN ('AMOUNT', 'PERCENT', 'FREE_PRODUCT'));
GO

IF OBJECT_ID(N'dbo.coupon_instances', 'U') IS NULL
BEGIN
CREATE TABLE dbo.coupon_instances (
    id INT IDENTITY(1, 1) NOT NULL,
    definition_id INT NOT NULL,
    campaign_id INT NULL,
    customer_id INT NULL,
    code NVARCHAR(24) COLLATE Modern_Spanish_CI_AS NOT NULL,
    sale_id INT NULL,
    register_id INT NULL,
    machine_id NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,
    status NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_coupon_instances_status DEFAULT ('ISSUED'),
    uses_allowed INT NOT NULL CONSTRAINT DF_coupon_instances_uses_allowed DEFAULT ((1)),
    uses_count INT NOT NULL CONSTRAINT DF_coupon_instances_uses_count DEFAULT ((0)),
    issued_at DATETIME2(0) NOT NULL CONSTRAINT DF_coupon_instances_issued_at DEFAULT (sysutcdatetime()),
    expires_at DATETIME2(0) NULL,
    CONSTRAINT PK_coupon_instances PRIMARY KEY CLUSTERED (id)
);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_coupon_instances_code' AND object_id = OBJECT_ID(N'dbo.coupon_instances'))
CREATE UNIQUE NONCLUSTERED INDEX UX_coupon_instances_code ON dbo.coupon_instances (code);
GO

/* ===========================================================================
   REDENCIONES — cuando un derecho se convirtio en dinero
   ===========================================================================
   Va ligada a `sale_id`: una redencion sin venta no significa nada, y esta
   es la unica tabla que contesta "¿en que venta se gasto este cupon?".
   =========================================================================== */
IF OBJECT_ID(N'dbo.loyalty_redemptions', 'U') IS NULL
BEGIN
CREATE TABLE dbo.loyalty_redemptions (
    id INT IDENTITY(1, 1) NOT NULL,
    -- REWARD | COUPON
    kind NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    reward_instance_id INT NULL,
    coupon_instance_id INT NULL,
    sale_id INT NOT NULL,
    register_id INT NULL,
    machine_id NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,
    amount_applied DECIMAL(12, 2) NOT NULL CONSTRAINT DF_loyalty_redemptions_amount DEFAULT ((0)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_loyalty_redemptions_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_loyalty_redemptions PRIMARY KEY CLUSTERED (id)
);
END;
GO

IF OBJECT_ID(N'dbo.CK_loyalty_redemptions_kind', 'C') IS NULL
ALTER TABLE dbo.loyalty_redemptions WITH CHECK ADD CONSTRAINT CK_loyalty_redemptions_kind
    CHECK (([kind] = 'REWARD' AND [reward_instance_id] IS NOT NULL)
        OR ([kind] = 'COUPON' AND [coupon_instance_id] IS NOT NULL));
GO

/* Claves foraneas. Las de catalogo se declaran; las de PROCEDENCIA
   (`sale_id`, `register_id`) tambien, porque esas filas no se borran nunca.
   `machine_id` no lleva FK a proposito: es una huella, no un catalogo. */
IF OBJECT_ID(N'dbo.FK_reward_instances_definition', 'F') IS NULL
ALTER TABLE dbo.reward_instances WITH CHECK ADD CONSTRAINT FK_reward_instances_definition
    FOREIGN KEY (definition_id) REFERENCES dbo.reward_definitions (id);
GO

IF OBJECT_ID(N'dbo.FK_coupon_instances_definition', 'F') IS NULL
ALTER TABLE dbo.coupon_instances WITH CHECK ADD CONSTRAINT FK_coupon_instances_definition
    FOREIGN KEY (definition_id) REFERENCES dbo.coupon_definitions (id);
GO

IF OBJECT_ID(N'dbo.FK_loyalty_redemptions_sale', 'F') IS NULL
ALTER TABLE dbo.loyalty_redemptions WITH CHECK ADD CONSTRAINT FK_loyalty_redemptions_sale
    FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);
GO

/* ---------- sp_loyalty_catalog (SQL_STORED_PROCEDURE) ---------- */
/* sp_loyalty_catalog
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_loyalty_catalog — todo Fidelizacion en UNA consulta.

   La pantalla de administracion necesita campanas, recompensas, cupones,
   dinamicas, rifas y los numeros del panel a la vez. Pedirlos uno a uno
   serian seis viajes para pintar una sola pantalla, y con la base en otra
   maquina de la LAN eso se nota.

   Mismo criterio que `sp_get_menu_catalog`, que ya resolvia esto para Touch.

   Devuelve SIETE resultsets, en este orden:
     1 campanas            5 rifas (con su conteo de participaciones)
     2 recompensas         6 resumen para el panel
     3 cupones             7 productos elegibles (para las condiciones)
     4 dinamicas
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_loyalty_catalog]
AS
BEGIN
    SET NOCOUNT ON;

    SELECT c.id, c.name, c.description, c.outcome,
           c.reward_definition_id, c.coupon_definition_id, c.dynamic_definition_id, c.raffle_id,
           c.quantity, c.per_amount,
           c.min_total, c.product_id, c.requires_customer, c.first_purchase_only,
           c.weekday_mask, c.time_from, c.time_to, c.starts_at, c.ends_at,
           c.priority, c.active, c.created_at,
           p.nombre AS product_name,
           /* Que otorga, ya resuelto: la pantalla no tiene que cruzar cuatro
              catalogos para escribir una linea de resumen. */
           COALESCE(rd.name, cd.name, dd.name, rf.name) AS outcome_name
    FROM dbo.campaigns c
    LEFT JOIN dbo.products p ON p.id = c.product_id
    LEFT JOIN dbo.reward_definitions rd ON rd.id = c.reward_definition_id
    LEFT JOIN dbo.coupon_definitions cd ON cd.id = c.coupon_definition_id
    LEFT JOIN dbo.dynamic_definitions dd ON dd.id = c.dynamic_definition_id
    LEFT JOIN dbo.raffle_definitions rf ON rf.id = c.raffle_id
    ORDER BY c.active DESC, c.priority, c.id;

    SELECT r.id, r.name, r.kind, r.product_id, r.amount, r.discount_pct, r.notes,
           r.valid_days, r.uses_allowed, r.active, r.created_at,
           p.nombre AS product_name,
           (SELECT COUNT(*) FROM dbo.reward_instances i WHERE i.definition_id = r.id) AS emitidas
    FROM dbo.reward_definitions r
    LEFT JOIN dbo.products p ON p.id = r.product_id
    ORDER BY r.active DESC, r.name;

    SELECT c.id, c.name, c.kind, c.amount, c.discount_pct, c.product_id,
           c.valid_days, c.uses_allowed, c.code_prefix, c.active, c.created_at,
           p.nombre AS product_name,
           (SELECT COUNT(*) FROM dbo.coupon_instances i WHERE i.definition_id = c.id) AS emitidos
    FROM dbo.coupon_definitions c
    LEFT JOIN dbo.products p ON p.id = c.product_id
    ORDER BY c.active DESC, c.name;

    SELECT d.id, d.name, d.type, d.description, d.target_value, d.tolerance,
           d.attempts_allowed, d.reward_definition_id, d.active, d.created_at,
           rd.name AS reward_name,
           (SELECT COUNT(*) FROM dbo.dynamic_attempts a WHERE a.definition_id = d.id) AS intentos,
           (SELECT COUNT(*) FROM dbo.dynamic_attempts a WHERE a.definition_id = d.id AND a.result = 'WIN') AS ganados
    FROM dbo.dynamic_definitions d
    LEFT JOIN dbo.reward_definitions rd ON rd.id = d.reward_definition_id
    ORDER BY d.active DESC, d.name;

    SELECT r.id, r.name, r.description, r.prize, r.starts_at, r.ends_at,
           r.status, r.winners_count, r.code_prefix, r.created_at,
           (SELECT COUNT(*) FROM dbo.raffle_entries e WHERE e.raffle_id = r.id AND e.status = 'VALID') AS participaciones,
           (SELECT COUNT(*) FROM dbo.raffle_draws d WHERE d.raffle_id = r.id) AS sorteos
    FROM dbo.raffle_definitions r
    ORDER BY CASE r.status WHEN 'OPEN' THEN 0 WHEN 'DRAFT' THEN 1 WHEN 'CLOSED' THEN 2 ELSE 3 END, r.id DESC;

    /* El panel. Numeros que se entienden de un vistazo, no un informe. */
    SELECT
        (SELECT COUNT(*) FROM dbo.campaigns WHERE active = 1) AS campanas_activas,
        (SELECT COUNT(*) FROM dbo.reward_instances WHERE status = 'ISSUED') AS recompensas_vigentes,
        (SELECT COUNT(*) FROM dbo.coupon_instances WHERE status = 'ISSUED') AS cupones_vigentes,
        (SELECT COUNT(*) FROM dbo.raffle_entries WHERE status = 'VALID') AS participaciones,
        (SELECT COUNT(*) FROM dbo.raffle_definitions WHERE status = 'OPEN') AS rifas_abiertas,
        (SELECT COUNT(*) FROM dbo.dynamic_attempts WHERE status = 'PENDING') AS dinamicas_pendientes,
        (SELECT COUNT(*) FROM dbo.loyalty_redemptions) AS redenciones,
        (SELECT ISNULL(loyalty_enabled, 0) FROM dbo.business_config WHERE id = (SELECT MIN(id) FROM dbo.business_config)) AS habilitado;

    /* Los productos vendibles, para condicionar una campana a uno concreto. */
    SELECT TOP 300 id, nombre AS name, price
    FROM dbo.products
    WHERE active = 1 AND sellable = 1
    ORDER BY nombre;
END
GO

/* ---------- sp_loyalty_evaluate_sale (SQL_STORED_PROCEDURE) ---------- */
/* sp_loyalty_evaluate_sale
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_loyalty_evaluate_sale — que gano esta venta.

   CUANDO SE LLAMA
   ---------------
   DESPUES de que la venta esta confirmada, nunca dentro de su transaccion.
   Una campana jamas puede otorgar nada por una venta que acabo en ROLLBACK:
   la venta es la fuente de verdad y esto es una consecuencia suya.

   Por eso no vive dentro de `sp_register_sale`: meterlo ahi haria que un fallo
   de fidelizacion -una campana mal configurada- tumbara un cobro. El cobro es
   lo unico que no se puede perder.

   QUE HACE
   --------
   Recorre las campanas activas y vigentes, comprueba sus condiciones contra
   la venta, y por cada una que aplica otorga lo suyo:

     REWARD        una recompensa a nombre del cliente (o con codigo)
     COUPON        un cupon con su codigo
     DYNAMIC       un intento de dinamica, PENDIENTE de jugarse
     RAFFLE_ENTRY  una o varias participaciones de rifa

   `per_amount` es lo que convierte "cada $200, un boleto" en una regla: con
   $650 y per_amount 200 salen 3. Sin el, `quantity` manda tal cual.

   IDEMPOTENTE POR VENTA
   ---------------------
   Si se vuelve a llamar con la misma venta no otorga nada nuevo. Un reintento
   del IPC -o dos pantallas pidiendo lo mismo- no puede duplicar premios.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_loyalty_evaluate_sale]
    @sale_id INT,
    @machine_id NVARCHAR(64) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    /* La capacidad apagada no es un error: es un negocio que no usa esto. */
    IF NOT EXISTS (SELECT 1 FROM dbo.business_config WHERE loyalty_enabled = 1)
    BEGIN
        SELECT CAST(0 AS INT) AS otorgados;
        RETURN;
    END

    DECLARE @customer_id INT, @total DECIMAL(12,2), @register_id INT, @fecha DATETIME;
    SELECT @customer_id = customer_id, @total = total, @register_id = register_id, @fecha = datee
    FROM dbo.sales WHERE id = @sale_id;

    IF @total IS NULL
    BEGIN
        RAISERROR('La venta no existe.', 16, 1);
        RETURN;
    END

    /* Ya evaluada: no se otorga dos veces. */
    IF EXISTS (SELECT 1 FROM dbo.reward_instances WHERE sale_id = @sale_id)
    OR EXISTS (SELECT 1 FROM dbo.coupon_instances WHERE sale_id = @sale_id)
    OR EXISTS (SELECT 1 FROM dbo.dynamic_attempts WHERE sale_id = @sale_id)
    OR EXISTS (SELECT 1 FROM dbo.raffle_entries WHERE sale_id = @sale_id)
    BEGIN
        SELECT CAST(0 AS INT) AS otorgados;
        RETURN;
    END

    DECLARE @ahora DATETIME2(0) = SYSUTCDATETIME();
    DECLARE @dow TINYINT = DATEPART(WEEKDAY, @fecha) - 1;   -- 0 = domingo
    DECLARE @hora TIME(0) = CAST(@fecha AS TIME(0));

    /* Las campanas que APLICAN a esta venta. Cada condicion es una columna, y
       NULL significa "no condiciona": asi una campana sin condiciones aplica
       siempre y no hay que inventarse valores centinela. */
    SELECT c.*,
           CAST(CASE WHEN ISNULL(c.per_amount, 0) > 0
                     THEN FLOOR(@total / c.per_amount) * c.quantity
                     ELSE c.quantity END AS INT) AS unidades
    INTO #aplican
    FROM dbo.campaigns c
    WHERE c.active = 1
      AND (c.starts_at IS NULL OR c.starts_at <= @ahora)
      AND (c.ends_at IS NULL OR c.ends_at >= @ahora)
      AND (c.min_total IS NULL OR @total >= c.min_total)
      AND (c.weekday_mask IS NULL OR (c.weekday_mask & POWER(2, @dow)) > 0)
      AND (c.time_from IS NULL OR @hora >= c.time_from)
      AND (c.time_to IS NULL OR @hora <= c.time_to)
      AND (c.requires_customer = 0 OR @customer_id IS NOT NULL)
      AND (c.product_id IS NULL OR EXISTS (
              SELECT 1 FROM dbo.sale_detail d
              WHERE d.sale_id = @sale_id AND d.product_id = c.product_id))
      AND (c.first_purchase_only = 0 OR (
              @customer_id IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM dbo.sales s
                  WHERE s.customer_id = @customer_id AND s.id <> @sale_id)))
      /* Una campana que no reparte nada no es una campana. */
      AND (ISNULL(c.per_amount, 0) = 0 OR @total >= c.per_amount);

    DELETE FROM #aplican WHERE unidades < 1;

    /* -------------------------------------------------------- RECOMPENSAS
       El codigo se deriva del `id`, que ya es unico: alguien lo va a dictar
       por telefono o leerlo de un ticket, asi que tiene que ser corto y sin
       caracteres que se confundan. Se inserta un valor provisional -unico por
       construccion- y se reescribe con el id definitivo.

       Se descarto una SEQUENCE a proposito: es un tipo de objeto mas que el
       constructor del baseline no despliega, y ya hubo dos incidentes por
       objetos que estaban en Git y no llegaban al instalador. */
    INSERT INTO dbo.reward_instances
        (definition_id, campaign_id, customer_id, code, sale_id, register_id, machine_id,
         status, uses_allowed, issued_at, expires_at)
    SELECT rd.id, a.id, @customer_id,
           LEFT(REPLACE(CAST(NEWID() AS NVARCHAR(36)), '-', ''), 24),
           @sale_id, @register_id, @machine_id,
           'ISSUED', rd.uses_allowed, @ahora,
           CASE WHEN rd.valid_days IS NULL THEN NULL ELSE DATEADD(DAY, rd.valid_days, @ahora) END
    FROM #aplican a
    JOIN dbo.reward_definitions rd ON rd.id = a.reward_definition_id AND rd.active = 1
    WHERE a.outcome = 'REWARD';

    UPDATE dbo.reward_instances
       SET code = CONCAT('RW-', RIGHT(CONCAT('00000', CAST(id AS NVARCHAR(20))), 6))
     WHERE sale_id = @sale_id;

    /* ------------------------------------------------------------ CUPONES */
    INSERT INTO dbo.coupon_instances
        (definition_id, campaign_id, customer_id, code, sale_id, register_id, machine_id,
         status, uses_allowed, issued_at, expires_at)
    SELECT cd.id, a.id, @customer_id,
           LEFT(REPLACE(CAST(NEWID() AS NVARCHAR(36)), '-', ''), 24),
           @sale_id, @register_id, @machine_id,
           'ISSUED', cd.uses_allowed, @ahora,
           CASE WHEN cd.valid_days IS NULL THEN NULL ELSE DATEADD(DAY, cd.valid_days, @ahora) END
    FROM #aplican a
    JOIN dbo.coupon_definitions cd ON cd.id = a.coupon_definition_id AND cd.active = 1
    WHERE a.outcome = 'COUPON';

    UPDATE ci
       SET code = CONCAT(cd.code_prefix, '-', RIGHT(CONCAT('00000', CAST(ci.id AS NVARCHAR(20))), 6))
    FROM dbo.coupon_instances ci
    JOIN dbo.coupon_definitions cd ON cd.id = ci.definition_id
    WHERE ci.sale_id = @sale_id;

    /* ---------------------------------------------------------- DINAMICAS
       Nace PENDIENTE. El token es lo unico que la pantalla necesita conocer,
       y solo sirve mientras el intento siga sin jugarse. */
    INSERT INTO dbo.dynamic_attempts
        (definition_id, campaign_id, customer_id, token, sale_id, register_id, machine_id,
         status, created_at, expires_at)
    SELECT dd.id, a.id, @customer_id,
           REPLACE(CAST(NEWID() AS NVARCHAR(36)), '-', ''),
           @sale_id, @register_id, @machine_id,
           'PENDING', @ahora, DATEADD(HOUR, 2, @ahora)
    FROM #aplican a
    JOIN dbo.dynamic_definitions dd ON dd.id = a.dynamic_definition_id AND dd.active = 1
    WHERE a.outcome = 'DYNAMIC';

    /* -------------------------------------------------------------- RIFAS
       La numeracion sale de la BASE, no de un contador por equipo: la Caja 1
       y la Caja 2 escriben en la misma tabla y los numeros no se pisan. El
       indice unico (raffle_id, entry_number) lo garantiza aunque dos cajas
       cobren en el mismo instante.

       Una rifa que no esta OPEN no admite entradas: es lo que hace que un
       sorteo ya hecho no se pueda alterar a posteriori. */
    DECLARE @raffle_id INT, @unidades INT, @campaign_id INT;
    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT a.raffle_id, a.unidades, a.id
        FROM #aplican a
        JOIN dbo.raffle_definitions r ON r.id = a.raffle_id AND r.status = 'OPEN'
        WHERE a.outcome = 'RAFFLE_ENTRY';
    OPEN cur;
    FETCH NEXT FROM cur INTO @raffle_id, @unidades, @campaign_id;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        DECLARE @i INT = 0;
        WHILE @i < @unidades
        BEGIN
            INSERT INTO dbo.raffle_entries
                (raffle_id, entry_number, customer_id, sale_id, register_id, machine_id, campaign_id, status, created_at)
            SELECT @raffle_id,
                   ISNULL((SELECT MAX(entry_number) FROM dbo.raffle_entries WITH (UPDLOCK, HOLDLOCK)
                            WHERE raffle_id = @raffle_id), 0) + 1,
                   @customer_id, @sale_id, @register_id, @machine_id, @campaign_id, 'VALID', @ahora;
            SET @i = @i + 1;
        END
        FETCH NEXT FROM cur INTO @raffle_id, @unidades, @campaign_id;
    END
    CLOSE cur; DEALLOCATE cur;

    /* Lo otorgado, para que la pantalla lo cuente y el ticket lo imprima. */
    SELECT 'REWARD' AS tipo, r.code AS codigo, rd.name AS nombre, NULL AS numero,
           NULL AS token, NULL AS rifa
    FROM dbo.reward_instances r
    JOIN dbo.reward_definitions rd ON rd.id = r.definition_id
    WHERE r.sale_id = @sale_id
    UNION ALL
    SELECT 'COUPON', c.code, cd.name, NULL, NULL, NULL
    FROM dbo.coupon_instances c
    JOIN dbo.coupon_definitions cd ON cd.id = c.definition_id
    WHERE c.sale_id = @sale_id
    UNION ALL
    SELECT 'DYNAMIC', NULL, dd.name, NULL, d.token, NULL
    FROM dbo.dynamic_attempts d
    JOIN dbo.dynamic_definitions dd ON dd.id = d.definition_id
    WHERE d.sale_id = @sale_id
    UNION ALL
    SELECT 'RAFFLE_ENTRY',
           CONCAT(rf.code_prefix, '-', RIGHT(CONCAT('0000000', CAST(e.entry_number AS NVARCHAR(20))), 8)),
           rf.name, e.entry_number, NULL, rf.name
    FROM dbo.raffle_entries e
    JOIN dbo.raffle_definitions rf ON rf.id = e.raffle_id
    WHERE e.sale_id = @sale_id
    ORDER BY tipo, numero;

    DROP TABLE #aplican;
END
GO

/* ---------- sp_loyalty_save_campaign (SQL_STORED_PROCEDURE) ---------- */
/* sp_loyalty_save_campaign
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Crear o actualizar una campana.
   `@id` nulo = alta. Las condiciones nulas NO condicionan, que es lo que
   permite una campana sin requisitos sin inventar valores centinela. */
CREATE OR ALTER PROCEDURE [dbo].[sp_loyalty_save_campaign]
    @id INT = NULL,
    @name NVARCHAR(120),
    @description NVARCHAR(400) = NULL,
    @outcome NVARCHAR(20),
    @reward_definition_id INT = NULL,
    @coupon_definition_id INT = NULL,
    @dynamic_definition_id INT = NULL,
    @raffle_id INT = NULL,
    @quantity INT = 1,
    @per_amount DECIMAL(12,2) = NULL,
    @min_total DECIMAL(12,2) = NULL,
    @product_id INT = NULL,
    @requires_customer BIT = 0,
    @first_purchase_only BIT = 0,
    @weekday_mask TINYINT = NULL,
    @time_from TIME(0) = NULL,
    @time_to TIME(0) = NULL,
    @starts_at DATETIME2(0) = NULL,
    @ends_at DATETIME2(0) = NULL,
    @priority INT = 100,
    @active BIT = 1
AS
BEGIN
    SET NOCOUNT ON;

    IF LTRIM(RTRIM(ISNULL(@name, N''))) = N''
    BEGIN RAISERROR('La campana necesita un nombre.', 16, 1); RETURN; END

    /* Una campana que no dice QUE otorga no sirve para nada, y dejarla
       guardar seria dejar que falle en silencio la primera vez que se venda. */
    IF (@outcome = 'REWARD' AND @reward_definition_id IS NULL)
    OR (@outcome = 'COUPON' AND @coupon_definition_id IS NULL)
    OR (@outcome = 'DYNAMIC' AND @dynamic_definition_id IS NULL)
    OR (@outcome = 'RAFFLE_ENTRY' AND @raffle_id IS NULL)
    BEGIN RAISERROR('Falta indicar que otorga la campana.', 16, 1); RETURN; END

    IF ISNULL(@quantity, 0) < 1 SET @quantity = 1;

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.campaigns
            (name, description, outcome, reward_definition_id, coupon_definition_id,
             dynamic_definition_id, raffle_id, quantity, per_amount, min_total, product_id,
             requires_customer, first_purchase_only, weekday_mask, time_from, time_to,
             starts_at, ends_at, priority, active)
        VALUES
            (@name, @description, @outcome, @reward_definition_id, @coupon_definition_id,
             @dynamic_definition_id, @raffle_id, @quantity, @per_amount, @min_total, @product_id,
             @requires_customer, @first_purchase_only, @weekday_mask, @time_from, @time_to,
             @starts_at, @ends_at, @priority, @active);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.campaigns
           SET name = @name, description = @description, outcome = @outcome,
               reward_definition_id = @reward_definition_id,
               coupon_definition_id = @coupon_definition_id,
               dynamic_definition_id = @dynamic_definition_id,
               raffle_id = @raffle_id,
               quantity = @quantity, per_amount = @per_amount,
               min_total = @min_total, product_id = @product_id,
               requires_customer = @requires_customer, first_purchase_only = @first_purchase_only,
               weekday_mask = @weekday_mask, time_from = @time_from, time_to = @time_to,
               starts_at = @starts_at, ends_at = @ends_at,
               priority = @priority, active = @active
         WHERE id = @id;
    END

    SELECT id, name, outcome, active FROM dbo.campaigns WHERE id = @id;
END
GO

/* ---------- sp_loyalty_save_definition (SQL_STORED_PROCEDURE) ---------- */
/* sp_loyalty_save_definition
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Crear o actualizar una DEFINICION de recompensa, cupon o dinamica.
   Un solo procedimiento para los tres porque el alta es la misma operacion
   -nombre, tipo, parametros, activo- y separarla en tres habria triplicado la
   misma validacion. `@kind_of` dice de cual se trata.

   Cada tipo exige lo suyo ANTES de guardar: una recompensa de importe sin
   importe, o una dinamica TIMING sin objetivo, se guardarian y fallarian mas
   tarde, cuando ya hay un cliente delante de la pantalla. */
CREATE OR ALTER PROCEDURE [dbo].[sp_loyalty_save_definition]
    @kind_of NVARCHAR(10),              -- REWARD | COUPON | DYNAMIC
    @id INT = NULL,
    @name NVARCHAR(120),
    @kind NVARCHAR(20) = NULL,          -- recompensa/cupon: FREE_PRODUCT, AMOUNT, PERCENT...
    @type NVARCHAR(20) = NULL,          -- dinamica: TIMING, WHEEL...
    @description NVARCHAR(400) = NULL,
    @product_id INT = NULL,
    @amount DECIMAL(12,2) = NULL,
    @discount_pct DECIMAL(5,2) = NULL,
    @valid_days INT = NULL,
    @uses_allowed INT = 1,
    @code_prefix NVARCHAR(8) = NULL,
    @target_value DECIMAL(12,4) = NULL,
    @tolerance DECIMAL(12,4) = NULL,
    @attempts_allowed INT = 1,
    @reward_definition_id INT = NULL,
    @active BIT = 1
AS
BEGIN
    SET NOCOUNT ON;

    IF LTRIM(RTRIM(ISNULL(@name, N''))) = N''
    BEGIN RAISERROR('Falta el nombre.', 16, 1); RETURN; END
    IF ISNULL(@uses_allowed, 0) < 1 SET @uses_allowed = 1;

    IF @kind_of = 'REWARD'
    BEGIN
        IF @kind = 'FREE_PRODUCT' AND @product_id IS NULL
        BEGIN RAISERROR('Una recompensa de producto gratis necesita el producto.', 16, 1); RETURN; END
        IF @kind = 'AMOUNT' AND ISNULL(@amount, 0) <= 0
        BEGIN RAISERROR('Una recompensa de importe necesita un importe mayor que cero.', 16, 1); RETURN; END
        IF @kind = 'PERCENT' AND ISNULL(@discount_pct, 0) <= 0
        BEGIN RAISERROR('Una recompensa de porcentaje necesita un porcentaje mayor que cero.', 16, 1); RETURN; END

        IF @id IS NULL
        BEGIN
            INSERT INTO dbo.reward_definitions (name, kind, product_id, amount, discount_pct, notes, valid_days, uses_allowed, active)
            VALUES (@name, @kind, @product_id, @amount, @discount_pct, @description, @valid_days, @uses_allowed, @active);
            SET @id = SCOPE_IDENTITY();
        END
        ELSE
            UPDATE dbo.reward_definitions
               SET name = @name, kind = @kind, product_id = @product_id, amount = @amount,
                   discount_pct = @discount_pct, notes = @description, valid_days = @valid_days,
                   uses_allowed = @uses_allowed, active = @active
             WHERE id = @id;

        SELECT id, name, kind, active FROM dbo.reward_definitions WHERE id = @id;
        RETURN;
    END

    IF @kind_of = 'COUPON'
    BEGIN
        IF @kind = 'FREE_PRODUCT' AND @product_id IS NULL
        BEGIN RAISERROR('Un cupon de producto gratis necesita el producto.', 16, 1); RETURN; END
        IF @kind = 'AMOUNT' AND ISNULL(@amount, 0) <= 0
        BEGIN RAISERROR('Un cupon de importe necesita un importe mayor que cero.', 16, 1); RETURN; END
        IF @kind = 'PERCENT' AND ISNULL(@discount_pct, 0) <= 0
        BEGIN RAISERROR('Un cupon de porcentaje necesita un porcentaje mayor que cero.', 16, 1); RETURN; END
        IF LTRIM(RTRIM(ISNULL(@code_prefix, N''))) = N'' SET @code_prefix = N'WYBIX';

        IF @id IS NULL
        BEGIN
            INSERT INTO dbo.coupon_definitions (name, kind, amount, discount_pct, product_id, valid_days, uses_allowed, code_prefix, active)
            VALUES (@name, @kind, @amount, @discount_pct, @product_id, @valid_days, @uses_allowed, @code_prefix, @active);
            SET @id = SCOPE_IDENTITY();
        END
        ELSE
            UPDATE dbo.coupon_definitions
               SET name = @name, kind = @kind, amount = @amount, discount_pct = @discount_pct,
                   product_id = @product_id, valid_days = @valid_days,
                   uses_allowed = @uses_allowed, code_prefix = @code_prefix, active = @active
             WHERE id = @id;

        SELECT id, name, kind, active FROM dbo.coupon_definitions WHERE id = @id;
        RETURN;
    END

    IF @kind_of = 'DYNAMIC'
    BEGIN
        IF @type = 'TIMING' AND (ISNULL(@target_value, 0) <= 0 OR ISNULL(@tolerance, 0) <= 0)
        BEGIN RAISERROR('Una dinamica de tiempo necesita objetivo y tolerancia mayores que cero.', 16, 1); RETURN; END
        IF ISNULL(@attempts_allowed, 0) < 1 SET @attempts_allowed = 1;

        IF @id IS NULL
        BEGIN
            INSERT INTO dbo.dynamic_definitions (name, type, description, target_value, tolerance, attempts_allowed, reward_definition_id, active)
            VALUES (@name, @type, @description, @target_value, @tolerance, @attempts_allowed, @reward_definition_id, @active);
            SET @id = SCOPE_IDENTITY();
        END
        ELSE
            UPDATE dbo.dynamic_definitions
               SET name = @name, type = @type, description = @description,
                   target_value = @target_value, tolerance = @tolerance,
                   attempts_allowed = @attempts_allowed,
                   reward_definition_id = @reward_definition_id, active = @active
             WHERE id = @id;

        SELECT id, name, type, active FROM dbo.dynamic_definitions WHERE id = @id;
        RETURN;
    END

    RAISERROR('Tipo de definicion desconocido.', 16, 1);
END
GO
