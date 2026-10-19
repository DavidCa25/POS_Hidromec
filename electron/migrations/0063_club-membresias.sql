/* ============================================================
   0063 — club membresias

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0063_club-membresias.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0063_club-membresias.sql ========== */
/* ============================================================
   0063 — Club: membresías (esquema)

   Para la membresía mensual de un negocio ("1 café gratis al día pagando
   una cuota"). La membresía vive en cada caja -funciona sin internet- y
   viaja a la nube para valer en todas las sucursales (sp_sync_capture
   MEMBERSHIP_PLAN / MEMBERSHIP / MEMBERSHIP_REDEMPTION; bajada con
   sp_membership_apply_remote).

   membership_plans           El plan: qué producto se cobra (un producto del
                              catálogo, sin inventario), cuántos días cubre
                              cada pago, cuántos canjes al día, días de gracia.
   membership_plan_products   Qué productos se pueden dar con el plan.
   customer_memberships       Un cliente en un plan: hasta cuándo está
                              pagado. VENCIDA no se guarda: se deduce de
                              paid_until + grace_days contra hoy.
   membership_payments        Cada pago (la venta del producto del plan) y el
                              periodo que cubre. Una devolución lo anula.
   membership_redemptions     Cada canje. LOCAL = en esta caja; REMOTE = en
                              otra sucursal, bajado de la nube. `doble` lo
                              marca la nube (o la bajada) cuando el mismo día
                              se canjeó de más -una caja sin internet no pudo
                              saberlo- y queda para revisión.

   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF OBJECT_ID(N'dbo.membership_plans', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.membership_plans (
        id               INT IDENTITY(1, 1) NOT NULL,
        uuid             UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_membership_plans_uuid DEFAULT (NEWID()),
        name             NVARCHAR(80)  COLLATE Modern_Spanish_CI_AS NOT NULL,
        sale_product_id  INT           NULL,
        period_days      INT           NOT NULL CONSTRAINT DF_membership_plans_period DEFAULT (30),
        daily_limit      INT           NOT NULL CONSTRAINT DF_membership_plans_daily DEFAULT (1),
        grace_days       INT           NOT NULL CONSTRAINT DF_membership_plans_grace DEFAULT (0),
        active           BIT           NOT NULL CONSTRAINT DF_membership_plans_active DEFAULT (1),
        origin           NVARCHAR(10)  COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_membership_plans_origin DEFAULT (N'LOCAL'),
        created_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_membership_plans_created DEFAULT (SYSDATETIME()),
        updated_at       DATETIME2(0)  NOT NULL CONSTRAINT DF_membership_plans_updated DEFAULT (SYSDATETIME()),
        row_version      ROWVERSION,
        CONSTRAINT PK_membership_plans PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UX_membership_plans_uuid UNIQUE (uuid),
        CONSTRAINT FK_membership_plans_product FOREIGN KEY (sale_product_id) REFERENCES dbo.products (id),
        CONSTRAINT CK_membership_plans_period CHECK (period_days BETWEEN 1 AND 366),
        CONSTRAINT CK_membership_plans_daily CHECK (daily_limit BETWEEN 1 AND 20),
        CONSTRAINT CK_membership_plans_grace CHECK (grace_days BETWEEN 0 AND 30),
        CONSTRAINT CK_membership_plans_origin CHECK (origin IN (N'LOCAL', N'REMOTE'))
    );
END;

IF OBJECT_ID(N'dbo.membership_plan_products', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.membership_plan_products (
        plan_id    INT NOT NULL,
        product_id INT NOT NULL,
        CONSTRAINT PK_membership_plan_products PRIMARY KEY CLUSTERED (plan_id, product_id),
        CONSTRAINT FK_membership_plan_products_plan FOREIGN KEY (plan_id) REFERENCES dbo.membership_plans (id),
        CONSTRAINT FK_membership_plan_products_product FOREIGN KEY (product_id) REFERENCES dbo.products (id)
    );
END;

IF OBJECT_ID(N'dbo.customer_memberships', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.customer_memberships (
        id            INT IDENTITY(1, 1) NOT NULL,
        uuid          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_customer_memberships_uuid DEFAULT (NEWID()),
        customer_id   INT           NOT NULL,
        plan_id       INT           NOT NULL,
        status        NVARCHAR(12)  COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_customer_memberships_status DEFAULT (N'ACTIVE'),
        paid_until    DATE          NULL,
        origin        NVARCHAR(10)  COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_customer_memberships_origin DEFAULT (N'LOCAL'),
        created_by    INT           NULL,
        created_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_customer_memberships_created DEFAULT (SYSDATETIME()),
        cancelled_at  DATETIME2(0)  NULL,
        cancelled_by  INT           NULL,
        updated_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_customer_memberships_updated DEFAULT (SYSDATETIME()),
        row_version   ROWVERSION,
        CONSTRAINT PK_customer_memberships PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UX_customer_memberships_uuid UNIQUE (uuid),
        CONSTRAINT UX_customer_memberships_cliente_plan UNIQUE (customer_id, plan_id),
        CONSTRAINT FK_customer_memberships_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers (id),
        CONSTRAINT FK_customer_memberships_plan FOREIGN KEY (plan_id) REFERENCES dbo.membership_plans (id),
        CONSTRAINT CK_customer_memberships_status CHECK (status IN (N'ACTIVE', N'CANCELLED')),
        CONSTRAINT CK_customer_memberships_origin CHECK (origin IN (N'LOCAL', N'REMOTE'))
    );
END;

IF OBJECT_ID(N'dbo.membership_payments', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.membership_payments (
        id              INT IDENTITY(1, 1) NOT NULL,
        uuid            UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_membership_payments_uuid DEFAULT (NEWID()),
        membership_id   INT            NOT NULL,
        sale_id         INT            NULL,
        sale_detail_id  INT            NULL,
        amount          DECIMAL(12, 2) NOT NULL,
        period_from     DATE           NOT NULL,
        period_to       DATE           NOT NULL,
        created_at      DATETIME2(0)   NOT NULL CONSTRAINT DF_membership_payments_created DEFAULT (SYSDATETIME()),
        voided_at       DATETIME2(0)   NULL,
        void_refund_id  INT            NULL,
        CONSTRAINT PK_membership_payments PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UX_membership_payments_uuid UNIQUE (uuid),
        CONSTRAINT FK_membership_payments_membership FOREIGN KEY (membership_id) REFERENCES dbo.customer_memberships (id),
        CONSTRAINT FK_membership_payments_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id)
    );
    CREATE INDEX IX_membership_payments_membership ON dbo.membership_payments (membership_id, period_to);
    CREATE UNIQUE INDEX UX_membership_payments_detalle ON dbo.membership_payments (sale_detail_id) WHERE sale_detail_id IS NOT NULL;
END;

IF OBJECT_ID(N'dbo.membership_redemptions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.membership_redemptions (
        id              INT IDENTITY(1, 1) NOT NULL,
        uuid            UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_membership_redemptions_uuid DEFAULT (NEWID()),
        membership_id   INT            NOT NULL,
        redeem_date     DATE           NOT NULL,
        units           INT            NOT NULL CONSTRAINT DF_membership_redemptions_units DEFAULT (1),
        product_id      INT            NULL,
        product_name    NVARCHAR(100)  COLLATE Modern_Spanish_CI_AS NULL,
        amount          DECIMAL(12, 2) NULL,
        sale_id         INT            NULL,
        sale_detail_id  INT            NULL,
        register_id     INT            NULL,
        origin          NVARCHAR(10)   COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_membership_redemptions_origin DEFAULT (N'LOCAL'),
        location_name   NVARCHAR(120)  COLLATE Modern_Spanish_CI_AS NULL,
        created_at      DATETIME2(0)   NOT NULL CONSTRAINT DF_membership_redemptions_created DEFAULT (SYSDATETIME()),
        voided_at       DATETIME2(0)   NULL,
        doble           BIT            NOT NULL CONSTRAINT DF_membership_redemptions_doble DEFAULT (0),
        reviewed_at     DATETIME2(0)   NULL,
        reviewed_by     INT            NULL,
        review_note     NVARCHAR(200)  COLLATE Modern_Spanish_CI_AS NULL,
        row_version     ROWVERSION,
        CONSTRAINT PK_membership_redemptions PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UX_membership_redemptions_uuid UNIQUE (uuid),
        CONSTRAINT FK_membership_redemptions_membership FOREIGN KEY (membership_id) REFERENCES dbo.customer_memberships (id),
        CONSTRAINT CK_membership_redemptions_units CHECK (units BETWEEN 1 AND 20),
        CONSTRAINT CK_membership_redemptions_origin CHECK (origin IN (N'LOCAL', N'REMOTE'))
    );
    CREATE INDEX IX_membership_redemptions_dia ON dbo.membership_redemptions (membership_id, redeem_date) INCLUDE (units, voided_at);
END;

/* El capturador de la nube recorre estas tablas por rowversion. */
IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WHERE aggregate_type = 'MEMBERSHIP_PLAN')
    INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('MEMBERSHIP_PLAN', 0x0000000000000000);
IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WHERE aggregate_type = 'MEMBERSHIP')
    INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('MEMBERSHIP', 0x0000000000000000);
IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WHERE aggregate_type = 'MEMBERSHIP_REDEMPTION')
    INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('MEMBERSHIP_REDEMPTION', 0x0000000000000000);
GO

/* ---------- sp_membership_admin (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_membership_admin (0063) =====================
   Todo lo que enseña Fidelización > Club, en una llamada:

     1  indicadores del mes: socios activos, ingreso, beneficios dados y su
        costo, por vencer en 7 días, canjes dobles sin revisar
     2  planes, con su producto de cobro, precio y productos del beneficio
     3  socios (filtrables por texto y estado), con su estado de hoy
     4  canjes dobles: los que la nube marcó porque el mismo día se dio el
        beneficio de más (una caja sin internet no podía saberlo)
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_membership_admin
    @buscar NVARCHAR(80) = NULL,
    @estado VARCHAR(12)  = NULL     -- ACTIVA | VENCIDA | CANCELADA | POR_VENCER | NULL = todas
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);
    DECLARE @mes DATE = DATEFROMPARTS(YEAR(@hoy), MONTH(@hoy), 1);
    SET @buscar = NULLIF(LTRIM(RTRIM(@buscar)), N'');
    /* El teléfono se busca por sus dígitos: «477 312 4588» y «4773124588» son el mismo. */
    DECLARE @digitos NVARCHAR(80) = NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(@buscar, N''), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), N'');
    IF @digitos IS NOT NULL AND @digitos LIKE N'%[^0-9]%' SET @digitos = NULL;

    SELECT m.id, LOWER(CONVERT(VARCHAR(36), m.uuid)) AS uuid, c.id AS customer_id, c.customerName AS cliente,
           COALESCE(NULLIF(c.mobile, N''), c.phone) AS telefono,
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(COALESCE(NULLIF(c.mobile, N''), c.phone), N''), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N'') AS tel_digitos, p.id AS plan_id, p.name AS plan_name, m.paid_until, m.origin,
           CASE WHEN m.status = N'CANCELLED' THEN 'CANCELADA'
                WHEN m.paid_until IS NULL OR DATEADD(DAY, p.grace_days, m.paid_until) < @hoy THEN 'VENCIDA'
                WHEN m.paid_until <= DATEADD(DAY, 7, @hoy) THEN 'POR_VENCER'
                ELSE 'ACTIVA' END AS estado,
           (SELECT ISNULL(SUM(r.units), 0) FROM dbo.membership_redemptions r
             WHERE r.membership_id = m.id AND r.voided_at IS NULL AND r.redeem_date >= @mes) AS beneficios_mes,
           (SELECT MAX(r.created_at) FROM dbo.membership_redemptions r WHERE r.membership_id = m.id AND r.voided_at IS NULL) AS ultimo_canje
      INTO #socios
      FROM dbo.customer_memberships m
      JOIN dbo.customers c ON c.id = m.customer_id
      JOIN dbo.membership_plans p ON p.id = m.plan_id;

    /* 1 indicadores */
    SELECT
        (SELECT COUNT(*) FROM #socios WHERE estado IN ('ACTIVA', 'POR_VENCER')) AS activos,
        (SELECT COUNT(*) FROM #socios WHERE estado = 'POR_VENCER') AS por_vencer,
        (SELECT COUNT(*) FROM #socios WHERE estado = 'VENCIDA') AS vencidas,
        (SELECT ISNULL(SUM(amount), 0) FROM dbo.membership_payments WHERE voided_at IS NULL AND created_at >= @mes) AS ingreso_mes,
        (SELECT COUNT(*) FROM dbo.membership_payments WHERE voided_at IS NULL AND created_at >= @mes) AS pagos_mes,
        (SELECT ISNULL(SUM(units), 0) FROM dbo.membership_redemptions WHERE voided_at IS NULL AND redeem_date >= @mes) AS beneficios_mes,
        (SELECT ISNULL(SUM(r.units * ISNULL(d.unit_cost, pr.cost)), 0)
           FROM dbo.membership_redemptions r
           LEFT JOIN dbo.sale_detail d ON d.id = r.sale_detail_id
           LEFT JOIN dbo.products pr ON pr.id = r.product_id
          WHERE r.voided_at IS NULL AND r.redeem_date >= @mes AND r.origin = N'LOCAL') AS costo_beneficios_mes,
        (SELECT COUNT(*) FROM dbo.membership_redemptions WHERE doble = 1 AND reviewed_at IS NULL) AS dobles_pendientes;

    /* 2 planes */
    SELECT p.id, LOWER(CONVERT(VARCHAR(36), p.uuid)) AS uuid, p.name, p.sale_product_id, sp.nombre AS sale_product_name, sp.price,
           p.period_days, p.daily_limit, p.grace_days, p.active, p.origin,
           (SELECT COUNT(*) FROM #socios s WHERE s.plan_id = p.id AND s.estado IN ('ACTIVA', 'POR_VENCER')) AS socios_activos,
           (SELECT pp.product_id AS id, pr.nombre AS nombre FROM dbo.membership_plan_products pp JOIN dbo.products pr ON pr.id = pp.product_id
             WHERE pp.plan_id = p.id ORDER BY pr.nombre FOR JSON PATH) AS productos_json
      FROM dbo.membership_plans p
      LEFT JOIN dbo.products sp ON sp.id = p.sale_product_id
     ORDER BY p.active DESC, p.name;

    /* 3 socios */
    SELECT TOP (500) *
      FROM #socios
     WHERE (@buscar IS NULL OR cliente LIKE N'%' + @buscar + N'%' OR (@digitos IS NOT NULL AND tel_digitos LIKE N'%' + @digitos + N'%'))
       AND (@estado IS NULL OR estado = @estado OR (@estado = 'ACTIVA' AND estado = 'POR_VENCER'))
     ORDER BY CASE estado WHEN 'POR_VENCER' THEN 0 WHEN 'VENCIDA' THEN 1 WHEN 'ACTIVA' THEN 2 ELSE 3 END, paid_until, cliente;

    /* 4 canjes dobles */
    SELECT TOP (200) r.id, r.redeem_date, r.created_at, r.units, r.product_name, r.origin,
           ISNULL(r.location_name, N'Esta sucursal') AS sucursal, r.sale_id, c.customerName AS cliente, p.name AS plan_name,
           r.reviewed_at, u.usuario AS revisado_por, r.review_note
      FROM dbo.membership_redemptions r
      JOIN dbo.customer_memberships m ON m.id = r.membership_id
      JOIN dbo.customers c ON c.id = m.customer_id
      JOIN dbo.membership_plans p ON p.id = m.plan_id
      LEFT JOIN dbo.users u ON u.id = r.reviewed_by
     WHERE r.doble = 1
     ORDER BY CASE WHEN r.reviewed_at IS NULL THEN 0 ELSE 1 END, r.redeem_date DESC, r.created_at DESC;
END;
GO

/* ---------- sp_membership_apply_remote (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_membership_apply_remote (0063) =====================
   Lo que bajó de la nube (club_pull): planes, membresías y canjes de las
   demás sucursales de la empresa. Con esto una caja sabe que Mariana renovó
   en otra sucursal, o que ya tomó su café de hoy allá.

   @payload = {
     plans:       [{ uuid, name, sale_product_uuid, period_days, daily_limit, grace_days, active, products: [uuid] }],
     memberships: [{ uuid, plan_uuid, customer_name, phone, status, paid_until }],
     redemptions: [{ uuid, membership_uuid, redeem_date, units, product_uuid, product_name, location_name, voided, doble }]
   }

   Reglas:
   · Un producto que esta sucursal no tiene (por uuid) se ignora.
   · El cliente se busca por teléfono (solo dígitos, últimos 10). Si no
     existe aquí, se da de alta con su nombre y teléfono.
   · paid_until: se queda el MAYOR de los dos. Una baja en la nube gana.
   · Un canje de esta misma caja solo actualiza su marca de doble.
   Idempotente: aplicar dos veces el mismo lote no cambia nada.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_membership_apply_remote
    @payload NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF ISJSON(@payload) <> 1 THROW 51000, 'Datos del Club invalidos.', 1;

    BEGIN TRAN;

    /* ---------------------------------------------------------- planes */
    SELECT j.uuid, j.name, NULLIF(pr.id, -1) AS sale_product_id, j.period_days, j.daily_limit, j.grace_days, j.active, j.products
      INTO #planes
      FROM OPENJSON(@payload, '$.plans') WITH (
             uuid UNIQUEIDENTIFIER, name NVARCHAR(80), sale_product_uuid UNIQUEIDENTIFIER, period_days INT,
             daily_limit INT, grace_days INT, active BIT, products NVARCHAR(MAX) AS JSON) j
      LEFT JOIN dbo.products pr ON pr.uuid = j.sale_product_uuid
     WHERE j.uuid IS NOT NULL AND j.name IS NOT NULL;

    UPDATE p SET name = x.name, sale_product_id = ISNULL(x.sale_product_id, p.sale_product_id), period_days = x.period_days,
                 daily_limit = x.daily_limit, grace_days = x.grace_days, active = x.active
      FROM dbo.membership_plans p JOIN #planes x ON x.uuid = p.uuid
     WHERE p.origin = N'REMOTE';

    INSERT INTO dbo.membership_plans (uuid, name, sale_product_id, period_days, daily_limit, grace_days, active, origin)
    SELECT x.uuid, x.name, x.sale_product_id, x.period_days, x.daily_limit, x.grace_days, x.active, N'REMOTE'
      FROM #planes x
     WHERE NOT EXISTS (SELECT 1 FROM dbo.membership_plans p WHERE p.uuid = x.uuid)
       AND NOT EXISTS (SELECT 1 FROM dbo.membership_plans p WHERE p.sale_product_id = x.sale_product_id);

    INSERT INTO dbo.membership_plan_products (plan_id, product_id)
    SELECT DISTINCT p.id, pr.id
      FROM #planes x
      JOIN dbo.membership_plans p ON p.uuid = x.uuid AND p.origin = N'REMOTE'
      CROSS APPLY OPENJSON(x.products) v
      JOIN dbo.products pr ON pr.uuid = TRY_CONVERT(UNIQUEIDENTIFIER, v.value)
     WHERE NOT EXISTS (SELECT 1 FROM dbo.membership_plan_products e WHERE e.plan_id = p.id AND e.product_id = pr.id);

    /* ------------------------------------------------------ membresías */
    SELECT j.uuid, CONVERT(INT, p.id) AS plan_id, NULLIF(LTRIM(RTRIM(j.customer_name)), N'') AS customer_name,
           RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(j.phone, N''), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), 10) AS tel,
           j.status, j.paid_until
      INTO #socios
      FROM OPENJSON(@payload, '$.memberships') WITH (
             uuid UNIQUEIDENTIFIER, plan_uuid UNIQUEIDENTIFIER, customer_name NVARCHAR(120), phone NVARCHAR(40),
             status NVARCHAR(12), paid_until DATE) j
      JOIN dbo.membership_plans p ON p.uuid = j.plan_uuid
     WHERE j.uuid IS NOT NULL;

    /* Las que ya existen aquí (por uuid): pagado hasta el mayor, baja gana. */
    UPDATE m
       SET paid_until = CASE WHEN x.paid_until IS NOT NULL AND (m.paid_until IS NULL OR x.paid_until > m.paid_until) THEN x.paid_until ELSE m.paid_until END,
           status = CASE WHEN x.status = N'CANCELLED' THEN N'CANCELLED'
                         WHEN m.status = N'CANCELLED' AND x.paid_until > ISNULL(m.paid_until, '19000101') THEN N'ACTIVE'
                         ELSE m.status END,
           updated_at = SYSDATETIME()
      FROM dbo.customer_memberships m JOIN #socios x ON x.uuid = m.uuid
     WHERE ISNULL(x.paid_until, '19000101') <> ISNULL(m.paid_until, '19000101') OR x.status <> m.status;

    /* Las nuevas: el cliente por teléfono, o se da de alta. */
    DECLARE @u UNIQUEIDENTIFIER, @plan INT, @nombre NVARCHAR(120), @tel NVARCHAR(10), @st NVARCHAR(12), @hasta DATE, @cli INT;
    DECLARE c CURSOR LOCAL FAST_FORWARD FOR
        SELECT uuid, plan_id, customer_name, tel, status, paid_until FROM #socios x
         WHERE NOT EXISTS (SELECT 1 FROM dbo.customer_memberships m WHERE m.uuid = x.uuid);
    OPEN c;
    FETCH NEXT FROM c INTO @u, @plan, @nombre, @tel, @st, @hasta;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @cli = NULL;
        IF LEN(@tel) = 10
            SELECT TOP 1 @cli = id FROM dbo.customers
             WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(NULLIF(mobile, N''), ISNULL(phone, N'')), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), 10) = @tel
             ORDER BY active DESC, id;
        IF @cli IS NULL AND @nombre IS NOT NULL
        BEGIN
            INSERT INTO dbo.customers (customerName, phone, active) VALUES (@nombre, NULLIF(@tel, N''), 1);
            SET @cli = SCOPE_IDENTITY();
        END
        IF @cli IS NOT NULL
        BEGIN
            /* Afiliado en dos sucursales por separado: se queda la de aquí con lo mayor pagado. */
            IF EXISTS (SELECT 1 FROM dbo.customer_memberships WHERE customer_id = @cli AND plan_id = @plan)
                UPDATE dbo.customer_memberships
                   SET paid_until = CASE WHEN @hasta > ISNULL(paid_until, '19000101') THEN @hasta ELSE paid_until END, updated_at = SYSDATETIME()
                 WHERE customer_id = @cli AND plan_id = @plan;
            ELSE
                INSERT INTO dbo.customer_memberships (uuid, customer_id, plan_id, status, paid_until, origin)
                VALUES (@u, @cli, @plan, CASE WHEN @st = N'CANCELLED' THEN N'CANCELLED' ELSE N'ACTIVE' END, @hasta, N'REMOTE');
        END
        FETCH NEXT FROM c INTO @u, @plan, @nombre, @tel, @st, @hasta;
    END
    CLOSE c; DEALLOCATE c;

    /* ---------------------------------------------------------- canjes */
    SELECT j.uuid, CONVERT(INT, m.id) AS membership_id, j.redeem_date, j.units, NULLIF(pr.id, -1) AS product_id, j.product_name, j.location_name, j.voided, j.doble
      INTO #canjes
      FROM OPENJSON(@payload, '$.redemptions') WITH (
             uuid UNIQUEIDENTIFIER, membership_uuid UNIQUEIDENTIFIER, redeem_date DATE, units INT, product_uuid UNIQUEIDENTIFIER,
             product_name NVARCHAR(100), location_name NVARCHAR(120), voided BIT, doble BIT) j
      JOIN dbo.customer_memberships m ON m.uuid = j.membership_uuid
      LEFT JOIN dbo.products pr ON pr.uuid = j.product_uuid
     WHERE j.uuid IS NOT NULL AND j.redeem_date IS NOT NULL;

    /* Los de aquí y los ya bajados: la marca de doble y la anulación. */
    UPDATE r SET doble = ISNULL(x.doble, r.doble),
                 voided_at = CASE WHEN x.voided = 1 AND r.voided_at IS NULL THEN SYSDATETIME() ELSE r.voided_at END
      FROM dbo.membership_redemptions r JOIN #canjes x ON x.uuid = r.uuid
     WHERE r.doble <> ISNULL(x.doble, r.doble) OR (x.voided = 1 AND r.voided_at IS NULL);

    INSERT INTO dbo.membership_redemptions (uuid, membership_id, redeem_date, units, product_id, product_name, origin, location_name, voided_at, doble)
    SELECT x.uuid, x.membership_id, x.redeem_date, CASE WHEN x.units BETWEEN 1 AND 20 THEN x.units ELSE 1 END, x.product_id, x.product_name,
           N'REMOTE', x.location_name, CASE WHEN x.voided = 1 THEN SYSDATETIME() END, ISNULL(x.doble, 0)
      FROM #canjes x
     WHERE NOT EXISTS (SELECT 1 FROM dbo.membership_redemptions r WHERE r.uuid = x.uuid);

    COMMIT TRAN;

    SELECT (SELECT COUNT(*) FROM #planes) AS planes, (SELECT COUNT(*) FROM #socios) AS membresias, (SELECT COUNT(*) FROM #canjes) AS canjes;
END;
GO

/* ---------- sp_membership_apply_sale (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_membership_apply_sale (0063) =====================
   Lo que una venta hace en el Club. Se llama DESDE sp_register_sale, dentro
   de su transacción y con su #map (line_no -> sale_detail_id) a la vista:
   si algo aquí falla, la venta entera no se registra. Nunca queda un café
   regalado sin su venta, ni una venta de membresía sin su periodo.

   1. PAGOS. Cada renglón cuyo producto es el "producto de cobro" de un plan
      activo afilia o renueva al cliente de la venta. Cada pieza cubre
      `period_days`: desde mañana del último día pagado, o desde hoy si ya
      venció. Sin cliente no se puede cobrar una membresía.
   2. CANJE. Si la cotización trae `membership` (la caja pidió el beneficio),
      los renglones con la regla `membership` quedaron en $0 en el motor
      comercial. Aquí se comprueba OTRA VEZ, ya con bloqueo: que la membresía
      sea de este cliente, que esté pagada (o en gracia) y que no se pase del
      límite del día. Va después de los pagos: renovar y tomar el café en la
      misma venta funciona.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_membership_apply_sale
    @sale_id     INT,
    @customer_id INT = NULL,
    @user_id     INT = NULL,
    @register_id INT = NULL,
    @quote       NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);

    /* ---------------------------------------------------------- 1 pagos */
    DECLARE @pagos TABLE (n INT IDENTITY(1, 1), sale_detail_id INT, plan_id INT, qty INT, amount DECIMAL(12, 2));
    INSERT INTO @pagos (sale_detail_id, plan_id, qty, amount)
    SELECT d.id, p.id, CAST(d.quantity AS INT), d.subtotal
      FROM dbo.sale_detail d
      JOIN dbo.membership_plans p ON p.sale_product_id = d.product_id AND p.active = 1
     WHERE d.sale_id = @sale_id;

    IF EXISTS (SELECT 1 FROM @pagos)
    BEGIN
        IF @customer_id IS NULL
            THROW 51000, 'Asigna el cliente para cobrar la membresia.', 1;
        IF EXISTS (SELECT 1 FROM @pagos WHERE qty < 1)
            THROW 51000, 'La membresia se cobra por periodos completos.', 1;

        DECLARE @i INT = 1, @n INT = (SELECT COUNT(*) FROM @pagos);
        WHILE @i <= @n
        BEGIN
            DECLARE @plan INT, @qty INT, @monto DECIMAL(12, 2), @detalle INT, @mid INT, @hasta DATE, @dias INT, @desde DATE;
            SELECT @plan = plan_id, @qty = qty, @monto = amount, @detalle = sale_detail_id FROM @pagos WHERE n = @i;
            SELECT @dias = period_days FROM dbo.membership_plans WHERE id = @plan;

            SELECT @mid = id, @hasta = paid_until
              FROM dbo.customer_memberships WITH (UPDLOCK, HOLDLOCK)
             WHERE customer_id = @customer_id AND plan_id = @plan;
            IF @mid IS NULL
            BEGIN
                INSERT INTO dbo.customer_memberships (customer_id, plan_id, created_by) VALUES (@customer_id, @plan, @user_id);
                SET @mid = SCOPE_IDENTITY();
                SET @hasta = NULL;
            END

            SET @desde = CASE WHEN @hasta IS NOT NULL AND @hasta >= @hoy THEN DATEADD(DAY, 1, @hasta) ELSE @hoy END;
            INSERT INTO dbo.membership_payments (membership_id, sale_id, sale_detail_id, amount, period_from, period_to)
            VALUES (@mid, @sale_id, @detalle, @monto, @desde, DATEADD(DAY, @dias * @qty - 1, @desde));

            UPDATE dbo.customer_memberships
               SET paid_until = DATEADD(DAY, @dias * @qty - 1, @desde), status = N'ACTIVE',
                   cancelled_at = NULL, cancelled_by = NULL, updated_at = SYSDATETIME()
             WHERE id = @mid;

            SELECT @mid = NULL, @hasta = NULL;
            SET @i += 1;
        END
    END

    /* ---------------------------------------------------------- 2 canje */
    DECLARE @canje INT = TRY_CONVERT(INT, JSON_VALUE(@quote, '$.membership.membershipId'));
    IF @canje IS NULL RETURN;

    DECLARE @lineas TABLE (line_no INT, qty INT, amount DECIMAL(12, 2));
    INSERT INTO @lineas (line_no, qty, amount)
    SELECT c.line_no, CAST(c.qty AS INT), TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(c.audit, '$.discount'))
      FROM OPENJSON(@quote, '$.lines') WITH (line_no INT, qty DECIMAL(12, 2), audit NVARCHAR(MAX) AS JSON) c
     WHERE JSON_VALUE(c.audit, '$.rule') = 'membership';

    DECLARE @unidades INT = (SELECT SUM(qty) FROM @lineas);
    IF ISNULL(@unidades, 0) = 0 RETURN;

    DECLARE @limite INT, @gracia INT, @pagado DATE, @estado NVARCHAR(12), @dueno INT;
    SELECT @dueno = m.customer_id, @pagado = m.paid_until, @estado = m.status, @limite = p.daily_limit, @gracia = p.grace_days
      FROM dbo.customer_memberships m WITH (UPDLOCK, HOLDLOCK)
      JOIN dbo.membership_plans p ON p.id = m.plan_id
     WHERE m.id = @canje;

    IF @dueno IS NULL OR @dueno <> ISNULL(@customer_id, -1)
        THROW 51000, 'La membresia no es del cliente de esta venta. La venta no se registro.', 1;
    IF @estado <> N'ACTIVE' OR @pagado IS NULL OR DATEADD(DAY, @gracia, @pagado) < @hoy
        THROW 51000, 'La membresia vencio: renuevala para dar el beneficio. La venta no se registro.', 1;

    DECLARE @usados INT = (SELECT ISNULL(SUM(units), 0) FROM dbo.membership_redemptions WITH (UPDLOCK, HOLDLOCK)
                            WHERE membership_id = @canje AND redeem_date = @hoy AND voided_at IS NULL);
    IF @usados + @unidades > @limite
        THROW 51000, 'El cliente ya uso su beneficio de hoy. La venta no se registro.', 1;

    INSERT INTO dbo.membership_redemptions (membership_id, redeem_date, units, product_id, product_name, amount, sale_id, sale_detail_id, register_id)
    SELECT @canje, @hoy, l.qty, d.product_id, pr.nombre, l.amount, @sale_id, d.id, @register_id
      FROM @lineas l
      JOIN #map mp ON mp.line_no = l.line_no
      JOIN dbo.sale_detail d ON d.id = mp.sale_detail_id
      JOIN dbo.products pr ON pr.id = d.product_id;
END;
GO

/* ---------- sp_membership_manage (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_membership_manage (0063) =====================
   Las dos acciones a mano de Fidelización > Club:

     @accion = 'CANCELAR'  da de baja una membresía (no devuelve dinero: eso
                           es una devolución de la venta). Deja de dar el
                           beneficio desde ya.
     @accion = 'REVISAR'   marca un canje doble como revisado, con su nota.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_membership_manage
    @accion  VARCHAR(10),
    @id      INT,
    @user_id INT,
    @nota    NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @accion = 'CANCELAR'
    BEGIN
        UPDATE dbo.customer_memberships
           SET status = N'CANCELLED', cancelled_at = SYSDATETIME(), cancelled_by = @user_id, updated_at = SYSDATETIME()
         WHERE id = @id AND status <> N'CANCELLED';
        IF @@ROWCOUNT = 0 THROW 51000, 'Esa membresia no existe o ya estaba cancelada.', 1;
    END
    ELSE IF @accion = 'REVISAR'
    BEGIN
        UPDATE dbo.membership_redemptions
           SET reviewed_at = SYSDATETIME(), reviewed_by = @user_id, review_note = NULLIF(LTRIM(RTRIM(@nota)), N'')
         WHERE id = @id AND doble = 1 AND reviewed_at IS NULL;
        IF @@ROWCOUNT = 0 THROW 51000, 'Ese canje no esta pendiente de revision.', 1;
    END
    ELSE THROW 51000, 'Accion no valida.', 1;
    SELECT @id AS id;
END;
GO

/* ---------- sp_membership_on_refund (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_membership_on_refund (0063) =====================
   Una devolución deshace lo que la venta hizo en el Club. Se llama desde
   sp_refund_sale, dentro de su transacción.

   · Si se devuelve el producto de cobro de un plan: el pago de esa venta se
     anula y la membresía pierde esos días (paid_until retrocede lo que el
     pago cubría).
   · Si se devuelve un producto que se dio con el beneficio: el canje se
     anula y el cliente recupera su café del día.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_membership_on_refund
    @refund_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @sale_id INT = (SELECT sale_id FROM dbo.sale_refunds WHERE id = @refund_id);
    IF @sale_id IS NULL RETURN;

    /* Pagos: por cada renglón de membresía devuelto. */
    DECLARE @anulados TABLE (membership_id INT, dias INT);
    UPDATE pay
       SET voided_at = SYSDATETIME(), void_refund_id = @refund_id
    OUTPUT inserted.membership_id, DATEDIFF(DAY, inserted.period_from, inserted.period_to) + 1 INTO @anulados
      FROM dbo.membership_payments pay
      JOIN dbo.sale_detail d ON d.id = pay.sale_detail_id
     WHERE pay.sale_id = @sale_id AND pay.voided_at IS NULL
       AND d.product_id IN (SELECT product_id FROM dbo.sale_refund_detail WHERE refund_id = @refund_id);

    UPDATE m
       SET paid_until = CASE WHEN a.dias IS NULL OR m.paid_until IS NULL THEN m.paid_until
                             ELSE DATEADD(DAY, -a.dias, m.paid_until) END,
           updated_at = SYSDATETIME()
      FROM dbo.customer_memberships m
      JOIN (SELECT membership_id, SUM(dias) AS dias FROM @anulados GROUP BY membership_id) a ON a.membership_id = m.id;

    /* Canjes: el producto regalado que se devolvió. */
    UPDATE r
       SET voided_at = SYSDATETIME()
      FROM dbo.membership_redemptions r
     WHERE r.sale_id = @sale_id AND r.voided_at IS NULL
       AND r.product_id IN (SELECT product_id FROM dbo.sale_refund_detail WHERE refund_id = @refund_id);
END;
GO

/* ---------- sp_membership_plan_save (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_membership_plan_save (0063) =====================
   Alta o cambio de un plan del Club.

   El precio NO vive aquí: es el del producto de cobro, que se vende como
   cualquier otro (corte, factura, estado de resultados). Ese producto debe
   ser "sin inventario" y no puede ser el producto de cobro de otro plan.
   @products_json: los productos que se pueden dar, como [12, 15, 31].
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_membership_plan_save
    @id              INT = NULL,
    @name            NVARCHAR(80),
    @sale_product_id INT,
    @period_days     INT = 30,
    @daily_limit     INT = 1,
    @grace_days      INT = 0,
    @active          BIT = 1,
    @products_json   NVARCHAR(MAX) = N'[]'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @name = NULLIF(LTRIM(RTRIM(@name)), N'');
    IF @name IS NULL THROW 51000, 'Ponle nombre al plan.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @sale_product_id AND active = 1)
        THROW 51000, 'Elige el producto con el que se cobra la membresia.', 1;
    IF EXISTS (SELECT 1 FROM dbo.products WHERE id = @sale_product_id AND inventory_mode <> 'NONE')
        THROW 51000, 'El producto de la membresia debe ser sin inventario.', 1;
    IF EXISTS (SELECT 1 FROM dbo.membership_plans WHERE sale_product_id = @sale_product_id AND id <> ISNULL(@id, -1))
        THROW 51000, 'Ese producto ya cobra otro plan.', 1;

    DECLARE @prods TABLE (product_id INT PRIMARY KEY);
    INSERT INTO @prods (product_id)
    SELECT DISTINCT TRY_CONVERT(INT, value) FROM OPENJSON(ISNULL(@products_json, N'[]'))
     WHERE TRY_CONVERT(INT, value) IN (SELECT id FROM dbo.products WHERE active = 1);
    IF NOT EXISTS (SELECT 1 FROM @prods) THROW 51000, 'Elige al menos un producto que se pueda dar con el plan.', 1;
    IF EXISTS (SELECT 1 FROM @prods WHERE product_id = @sale_product_id)
        THROW 51000, 'El producto de cobro no puede ser parte del beneficio.', 1;

    BEGIN TRAN;
    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.membership_plans (name, sale_product_id, period_days, daily_limit, grace_days, active)
        VALUES (@name, @sale_product_id, @period_days, @daily_limit, @grace_days, @active);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.membership_plans
           SET name = @name, sale_product_id = @sale_product_id, period_days = @period_days, daily_limit = @daily_limit,
               grace_days = @grace_days, active = @active, updated_at = SYSDATETIME()
         WHERE id = @id;
        IF @@ROWCOUNT = 0 THROW 51000, 'Ese plan no existe.', 1;
    END

    DELETE FROM dbo.membership_plan_products WHERE plan_id = @id AND product_id NOT IN (SELECT product_id FROM @prods);
    INSERT INTO dbo.membership_plan_products (plan_id, product_id)
    SELECT @id, product_id FROM @prods WHERE product_id NOT IN (SELECT product_id FROM dbo.membership_plan_products WHERE plan_id = @id);
    /* Que la nube se entere aunque solo cambien los productos. */
    UPDATE dbo.membership_plans SET updated_at = SYSDATETIME() WHERE id = @id;
    COMMIT TRAN;

    SELECT @id AS id;
END;
GO

/* ---------- sp_membership_status (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_membership_status (0063) =====================
   Lo que la caja enseña del Club al elegir a un cliente.

     1  membresías del cliente, con su estado de HOY:
          ACTIVA     pagada (o dentro de los días de gracia)
          VENCIDA    paid_until + gracia < hoy: el beneficio no se da
          CANCELADA  dada de baja
        y cuántos canjes le quedan hoy (los de TODAS las sucursales que ya
        bajaron de la nube cuentan).
     2  productos que se pueden dar con cada plan
     3  planes activos, para afiliar a quien todavía no es socio

   Solo lectura.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_membership_status
    @customer_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);

    SELECT m.id, LOWER(CONVERT(VARCHAR(36), m.uuid)) AS uuid, m.plan_id, p.name AS plan_name, m.paid_until,
           p.grace_days, p.daily_limit,
           CASE WHEN m.status = N'CANCELLED' THEN 'CANCELADA'
                WHEN m.paid_until IS NULL OR DATEADD(DAY, p.grace_days, m.paid_until) < @hoy THEN 'VENCIDA'
                ELSE 'ACTIVA' END AS estado,
           ISNULL(h.usados, 0) AS usados_hoy,
           CASE WHEN p.daily_limit - ISNULL(h.usados, 0) < 0 THEN 0 ELSE p.daily_limit - ISNULL(h.usados, 0) END AS disponibles_hoy,
           h.ultimo AS ultimo_canje, h.donde AS ultimo_canje_en,
           p.sale_product_id, sp.nombre AS sale_product_name, sp.price AS sale_product_price,
           sp.inventory_mode AS sale_product_inventory_mode, sp.tasa_iva AS sale_product_tasa_iva, sp.objeto_impuesto AS sale_product_objeto_impuesto,
           sp.clave_prod_serv AS sale_product_clave_prod_serv, sp.clave_unidad AS sale_product_clave_unidad
      FROM dbo.customer_memberships m
      JOIN dbo.membership_plans p ON p.id = m.plan_id
      LEFT JOIN dbo.products sp ON sp.id = p.sale_product_id
      OUTER APPLY (SELECT SUM(r.units) AS usados, MAX(r.created_at) AS ultimo,
                          (SELECT TOP 1 ISNULL(r2.location_name, N'esta sucursal') FROM dbo.membership_redemptions r2
                            WHERE r2.membership_id = m.id AND r2.redeem_date = @hoy AND r2.voided_at IS NULL ORDER BY r2.created_at DESC) AS donde
                     FROM dbo.membership_redemptions r
                    WHERE r.membership_id = m.id AND r.redeem_date = @hoy AND r.voided_at IS NULL) h
     WHERE m.customer_id = @customer_id
     ORDER BY CASE WHEN m.status = N'ACTIVE' THEN 0 ELSE 1 END, m.paid_until DESC;

    SELECT pp.plan_id, pr.id AS product_id, pr.nombre, pr.price, pr.inventory_mode, pr.tasa_iva, pr.objeto_impuesto, pr.clave_prod_serv, pr.clave_unidad
      FROM dbo.membership_plan_products pp
      JOIN dbo.products pr ON pr.id = pp.product_id
     WHERE pp.plan_id IN (SELECT plan_id FROM dbo.customer_memberships WHERE customer_id = @customer_id)
     ORDER BY pp.plan_id, pr.nombre;

    SELECT p.id, p.name, p.period_days, p.daily_limit, p.sale_product_id, sp.nombre AS sale_product_name, sp.price AS sale_product_price,
           sp.inventory_mode AS sale_product_inventory_mode, sp.tasa_iva AS sale_product_tasa_iva, sp.objeto_impuesto AS sale_product_objeto_impuesto,
           sp.clave_prod_serv AS sale_product_clave_prod_serv, sp.clave_unidad AS sale_product_clave_unidad
      FROM dbo.membership_plans p
      JOIN dbo.products sp ON sp.id = p.sale_product_id
     WHERE p.active = 1
     ORDER BY p.name;
END;
GO

/* ---------- sp_refund_sale (SQL_STORED_PROCEDURE) ---------- */
/* sp_refund_sale
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* -------------------- sp_refund_sale --------------------
   Devolucion / cambio. Lo que se repone al inventario es lo que ESA venta
   consumio realmente (inventory_movements ligados al producto vendido), por
   unidad devuelta: quantity / units. Un Latte devuelto repone cafe, leche,
   vaso y tapa segun la receta y modificadores DE ESE DIA, no la receta de
   hoy. Un producto DIRECT repone el propio producto (como siempre). Ventas
   anteriores a Wybix Core (sin movimientos ligados) reponen el producto.
   -------------------------------------------------------- */
CREATE OR ALTER PROCEDURE [dbo].[sp_refund_sale]
  @sale_id INT,
  @user_id INT,
  @payment_method NVARCHAR(50),
  @RefundDetails dbo.SaleDetailType READONLY,
  @note NVARCHAR(400) = NULL,
  @apply_net_update BIT = 1,
  -- 0049: la caja que DEVUELVE el efectivo. El turno se busca por caja, no
  -- por quien lo abrio: si devolvia otra persona fallaba con "no hay turno", y
  -- en MultiCaja el dinero podia salir del corte de otra caja.
  @register_id INT = NULL,
  @machine_id NVARCHAR(64) = NULL,
  @machine_name NVARCHAR(120) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  IF @sale_id IS NULL OR @sale_id <= 0
  BEGIN
    RAISERROR('sale_id inválido.',16,1);
    RETURN;
  END

  BEGIN TRY
    BEGIN TRAN;

    DECLARE @commercial BIT = CASE WHEN EXISTS(SELECT 1 FROM dbo.sales WHERE id=@sale_id AND commercial_snapshot IS NOT NULL) THEN 1 ELSE 0 END;
    IF @commercial=1 AND @apply_net_update=1 THROW 51000,'Las ventas con ofertas conservan su historial. Devuelve sin modificar la venta original.',1;
    DECLARE @sale_total DECIMAL(12,2);
    DECLARE @sale_method NVARCHAR(50);
    DECLARE @customer_id INT;

    SELECT
      @sale_total = s.total,
      @sale_method = s.payment_method,
      @customer_id = s.customer_id
    FROM dbo.sales s WITH (UPDLOCK, HOLDLOCK)
    WHERE s.id = @sale_id;

    IF @sale_total IS NULL
    BEGIN
      RAISERROR('La venta no existe.',16,1);
    END

    ;WITH r AS (
      SELECT product_id, SUM(quantity) AS qty
      FROM @RefundDetails
      GROUP BY product_id
    )
    SELECT * INTO #req FROM r;

    SELECT d.product_id, SUM(d.quantity) AS sold_qty, MAX(d.unitary_price) AS price, SUM(d.quantity*d.unitary_price) AS net_amount
    INTO #sold
    FROM dbo.sale_detail d WITH (UPDLOCK, HOLDLOCK)
    WHERE d.sale_id = @sale_id
    GROUP BY d.product_id;

    SELECT srd.product_id, SUM(srd.quantity) AS refunded_qty, SUM(COALESCE(srd.commercial_amount,srd.quantity*srd.unitary_price)) AS refunded_amount
    INTO #ref
    FROM dbo.sale_refunds sr
    JOIN dbo.sale_refund_detail srd ON srd.refund_id = sr.id
    WHERE sr.sale_id = @sale_id
    GROUP BY srd.product_id;

    IF EXISTS (
      SELECT 1
      FROM #req q
      LEFT JOIN #sold s ON s.product_id = q.product_id
      LEFT JOIN #ref  r2 ON r2.product_id = q.product_id
      WHERE ISNULL(s.sold_qty,0) - ISNULL(r2.refunded_qty,0) < q.qty
    )
    BEGIN
      RAISERROR('Reembolso inválido: excede lo vendido/disponible para devolver.',16,1);
    END

    IF EXISTS(SELECT 1 FROM #req WHERE qty<=0) THROW 51000,'Cantidad de devolución inválida.',1;
    IF NOT EXISTS(SELECT 1 FROM #req) THROW 51000,'Selecciona productos para devolver.',1;
    SELECT q.product_id,q.qty,CAST(CASE WHEN @commercial=1 THEN
      ROUND(s.net_amount*(ISNULL(r.refunded_qty,0)+q.qty)/s.sold_qty,2)-ISNULL(r.refunded_amount,0)
      ELSE q.qty*s.price END AS DECIMAL(12,2)) amount
    INTO #refund_amount FROM #req q JOIN #sold s ON s.product_id=q.product_id LEFT JOIN #ref r ON r.product_id=q.product_id;
    DECLARE @refund_total DECIMAL(12,2);
    SELECT @refund_total=ISNULL(SUM(amount),0) FROM #refund_amount;

    IF @refund_total < 0 OR (@refund_total=0 AND @commercial=0)
    BEGIN
      RAISERROR('El total del reembolso debe ser mayor a cero.',16,1);
    END

    DECLARE @rp TABLE(method NVARCHAR(50) PRIMARY KEY,amount DECIMAL(12,2));
    IF EXISTS(SELECT 1 FROM dbo.sale_payments WHERE sale_id=@sale_id) BEGIN
      SET @apply_net_update=0;
      DECLARE @rest DECIMAL(12,2)=@refund_total,@pm NVARCHAR(50),@available DECIMAL(12,2),@part DECIMAL(12,2);
      DECLARE refunds_cursor CURSOR LOCAL FAST_FORWARD FOR
      SELECT p.payment_method,p.amount-ISNULL((SELECT SUM(rp.amount) FROM dbo.refund_payments rp JOIN dbo.sale_refunds r ON r.id=rp.refund_id WHERE r.sale_id=@sale_id AND rp.payment_method=p.payment_method),0)-ISNULL((SELECT SUM(r.refund_total) FROM dbo.sale_refunds r WHERE r.sale_id=@sale_id AND r.payment_method=p.payment_method AND NOT EXISTS(SELECT 1 FROM dbo.refund_payments rp WHERE rp.refund_id=r.id)),0)
      FROM dbo.sale_payments p WHERE p.sale_id=@sale_id ORDER BY CASE WHEN p.payment_method='EFECTIVO' THEN 0 ELSE 1 END,p.id;
      OPEN refunds_cursor;FETCH NEXT FROM refunds_cursor INTO @pm,@available;
      WHILE @@FETCH_STATUS=0 AND @rest>0 BEGIN
        SET @part=CASE WHEN @available>@rest THEN @rest ELSE @available END;
        IF @part>0 BEGIN INSERT @rp VALUES(@pm,@part);SET @rest=@rest-@part;END;
        FETCH NEXT FROM refunds_cursor INTO @pm,@available;
      END;
      CLOSE refunds_cursor;DEALLOCATE refunds_cursor;
      IF @rest>0 THROW 51000,'El reembolso supera los pagos originales disponibles.',1;
      /* 0063: devolver algo de $0 (un beneficio del Club) no reparte dinero: conserva la forma de pago indicada. */
      SET @payment_method=ISNULL(CASE WHEN (SELECT COUNT(*) FROM @rp)>1 THEN 'MIXTO' ELSE (SELECT TOP 1 method FROM @rp) END, @payment_method);
    END ELSE INSERT @rp VALUES(@payment_method,@refund_total);
    DECLARE @refund_cash DECIMAL(12,2)=ISNULL((SELECT amount FROM @rp WHERE method='EFECTIVO'),0);
    DECLARE @closure_id_open INT = NULL;
    DECLARE @caja INT = NULL;
    IF @refund_cash>0
    BEGIN
      EXEC dbo.sp_resolve_cash_register
          @register_id = @register_id, @machine_id = @machine_id,
          @machine_name = @machine_name, @user_id = @user_id, @resolved = @caja OUTPUT;
      IF @caja IS NULL
        RAISERROR('No se pudo determinar la caja de la que sale la devolucion. Abre el turno en esta caja e intenta de nuevo.',16,1);

      SELECT TOP(1) @closure_id_open = id
      FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
      WHERE register_id = @caja AND closed_at IS NULL
      ORDER BY opened_at DESC, id DESC;

      IF @closure_id_open IS NULL
      BEGIN
        RAISERROR('No hay turno abierto para registrar el reembolso en efectivo.',16,1);
      END
    END

    DECLARE @refund_id INT;
    INSERT INTO dbo.sale_refunds (sale_id, user_id, payment_method, refund_total, note, closure_id)
    VALUES (@sale_id, @user_id, @payment_method, @refund_total, @note, @closure_id_open);

    SET @refund_id = SCOPE_IDENTITY();
    INSERT dbo.refund_payments(refund_id,payment_method,amount) SELECT @refund_id,method,amount FROM @rp;

    INSERT INTO dbo.sale_refund_detail(refund_id,product_id,quantity,unitary_price,commercial_amount)
    SELECT @refund_id,q.product_id,q.qty,
      CASE WHEN @commercial=1 THEN CAST(a.amount/q.qty AS DECIMAL(10,2)) ELSE s.price END,
      CASE WHEN @commercial=1 THEN a.amount ELSE NULL END
    FROM #req q JOIN #sold s ON s.product_id=q.product_id JOIN #refund_amount a ON a.product_id=q.product_id;

    /* 0063: lo que la venta hizo en el Club (membresía cobrada, café dado). */
    EXEC dbo.sp_membership_on_refund @refund_id = @refund_id;

    /* ---- Que repone cada producto devuelto: consumo REAL de esta venta ---- */
    SELECT q.product_id AS sold_product_id, m.product_id, SUM(m.quantity) AS consumed, SUM(m.units) AS units
    INTO #consumo
    FROM #req q
    JOIN dbo.inventory_movements m
      ON m.reference = CAST(@sale_id AS NVARCHAR(50))
     AND m.sold_product_id = q.product_id
     AND m.typee = 'salida'
     AND m.source IN ('SALE', 'RECIPE')
    GROUP BY q.product_id, m.product_id
    HAVING SUM(m.units) > 0;

    /* Ventas sin movimientos ligados (anteriores a Wybix Core): el propio producto. */
    INSERT INTO #consumo (sold_product_id, product_id, consumed, units)
    SELECT q.product_id, q.product_id, 1, 1
    FROM #req q
    JOIN dbo.products p ON p.id = q.product_id
    WHERE p.inventory_mode = 'DIRECT'
      AND NOT EXISTS (SELECT 1 FROM #consumo c WHERE c.sold_product_id = q.product_id);

    SELECT c.product_id,
           c.sold_product_id,
           CAST(q.qty * c.consumed / c.units AS DECIMAL(14,4)) AS qty,
           q.qty AS units
    INTO #restore
    FROM #consumo c
    JOIN #req q ON q.product_id = c.sold_product_id;

    UPDATE p
    SET p.stock = p.stock + r.qty
    FROM dbo.products p
    JOIN (SELECT product_id, SUM(qty) AS qty FROM #restore GROUP BY product_id) r ON r.product_id = p.id;

    INSERT INTO dbo.inventory_movements
      (product_id, typee, reference, quantity, datee, descriptionn, source, sold_product_id, units, unit_cost)
    SELECT
      r.product_id,
      'entrada',
      CAST(@sale_id AS NVARCHAR(50)),
      r.qty,
      GETDATE(),
      CONCAT('Reembolso venta ', @sale_id, ' (refund_id ', @refund_id, ')', COALESCE(CONCAT(' - ', @note), '')),
      'REFUND',
      r.sold_product_id,
      r.units,
      p.cost
    FROM #restore r
    JOIN dbo.products p ON p.id = r.product_id;

    IF @refund_cash>0
    BEGIN
      INSERT INTO dbo.cash_movements
        (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
      VALUES
        (GETDATE(), @user_id, 'REFUND', @sale_id,
         CONCAT('Reembolso Venta ', @sale_id, ' (', @refund_id, ')'),
         -@refund_cash,
         @note,
         @closure_id_open,
         @caja);
    END

    IF @apply_net_update = 1
    BEGIN
      UPDATE d
      SET d.quantity = d.quantity - q.qty
      FROM dbo.sale_detail d
      JOIN #req q ON q.product_id = d.product_id
      WHERE d.sale_id = @sale_id;

      DELETE FROM dbo.sale_detail
      WHERE sale_id = @sale_id AND quantity <= 0;

      UPDATE dbo.sales
      SET total = total - @refund_total,
          paid_amount = CASE WHEN @customer_id IS NULL THEN (total - @refund_total) ELSE paid_amount END,
          balance = CASE WHEN @customer_id IS NULL THEN 0 ELSE (balance - @refund_total) END
      WHERE id = @sale_id;
    END

    COMMIT TRAN;

    SELECT
      @refund_id AS refund_id,
      @sale_id AS sale_id,
      @refund_total AS refund_total,
      @closure_id_open AS closure_id;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRAN;
    DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@msg,16,1);
  END CATCH
END
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
        /* 0063: una venta de $0 (solo el beneficio del Club o un producto gratis) no tiene pago que registrar. */
        ELSE IF @is_credit=0 AND @total>0 INSERT dbo.sale_payments(sale_id,payment_method,amount) VALUES(@sale_id,@payment_method,@total);
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

        /* 11) Club (0063): membresías que se cobran en esta venta y el
           beneficio del día. Dentro de la transacción: si no procede, la
           venta no se registra. */
        EXEC dbo.sp_membership_apply_sale @sale_id = @sale_id, @customer_id = @customer_id,
             @user_id = @user_id, @register_id = @register_id, @quote = @cq;

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
       MEMBERSHIP_PLAN        0063: MEMBERSHIP_PLAN_SAVED. Un plan del Club (solo los
                              creados aquí).
       MEMBERSHIP             0063: MEMBERSHIP_UPDATED. Hasta cuándo está pagada.
       MEMBERSHIP_REDEMPTION  0063: MEMBERSHIP_REDEEMED / _VOIDED. Un beneficio dado
                              en esta caja; la nube marca los dobles.
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

    COMMIT TRAN;

    SELECT @capturados AS capturados,
           (SELECT COUNT(*) FROM dbo.sync_outbox WHERE status = 'PENDING') AS pendientes;
END
GO
