/* ============================================================
   0064 — puntos sellos

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0064_puntos-sellos.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0064_puntos-sellos.sql ========== */
/* ============================================================
   0064 — Puntos y sellos (esquema)

   Lo acumulable de Fidelización: el cliente junta puntos por lo que compra
   (o por venir) y sellos por los productos de una tarjeta ("10 cafés = 1
   gratis"), y los canjea en caja.

   loyalty_points_config       Una fila. Cada cuántos pesos se gana cuánto,
                               puntos por visita (una al día) y meses sin
                               movimiento tras los que el saldo caduca.
   loyalty_stamp_cards         Una tarjeta de sellos: cuántos sellos se
                               necesitan y qué se regala al llenarla.
   loyalty_stamp_card_products Qué productos sellan la tarjeta.
   loyalty_ledger              EL LIBRO. Cada movimiento de puntos o sellos:
                               EARN (compra o visita), REDEEM (canje),
                               REVERSE (devolución), EXPIRE (caducidad),
                               ADJUST (ajuste manual con nota). El saldo es
                               la SUMA; no hay un saldo guardado que se pueda
                               descuadrar.
   reward_definitions.points_cost
                               Una recompensa con costo se puede canjear con
                               puntos. NULL = no está en el catálogo de canje.

   Viaja a la nube como el Club (LOYALTY_LEDGER / STAMP_CARD /
   POINTS_CONFIG): los movimientos de otras sucursales bajan como REMOTE y el
   saldo vale en todas.

   Aditiva: nada existente cambia de significado.
   ============================================================ */

IF OBJECT_ID(N'dbo.loyalty_points_config', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.loyalty_points_config (
        id             TINYINT       NOT NULL CONSTRAINT DF_loyalty_points_config_id DEFAULT (1),
        enabled        BIT           NOT NULL CONSTRAINT DF_loyalty_points_config_enabled DEFAULT (0),
        per_amount     DECIMAL(12,2) NULL,
        points_per     INT           NOT NULL CONSTRAINT DF_loyalty_points_config_points DEFAULT (1),
        visit_points   INT           NOT NULL CONSTRAINT DF_loyalty_points_config_visit DEFAULT (0),
        expiry_months  INT           NULL,
        updated_at     DATETIME2(0)  NOT NULL CONSTRAINT DF_loyalty_points_config_updated DEFAULT (SYSDATETIME()),
        origin         NVARCHAR(10)  COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_loyalty_points_config_origin DEFAULT (N'LOCAL'),
        row_version    ROWVERSION,
        CONSTRAINT PK_loyalty_points_config PRIMARY KEY CLUSTERED (id),
        CONSTRAINT CK_loyalty_points_config_id CHECK (id = 1),
        CONSTRAINT CK_loyalty_points_config_amount CHECK (per_amount IS NULL OR per_amount > 0),
        CONSTRAINT CK_loyalty_points_config_points CHECK (points_per BETWEEN 1 AND 10000),
        CONSTRAINT CK_loyalty_points_config_visit CHECK (visit_points BETWEEN 0 AND 10000),
        CONSTRAINT CK_loyalty_points_config_expiry CHECK (expiry_months IS NULL OR expiry_months BETWEEN 1 AND 120),
        CONSTRAINT CK_loyalty_points_config_origin CHECK (origin IN (N'LOCAL', N'REMOTE'))
    );
END;
GO
IF NOT EXISTS (SELECT 1 FROM dbo.loyalty_points_config)
    INSERT INTO dbo.loyalty_points_config (id, enabled) VALUES (1, 0);
GO

IF OBJECT_ID(N'dbo.loyalty_stamp_cards', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.loyalty_stamp_cards (
        id                 INT IDENTITY(1, 1) NOT NULL,
        uuid               UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_loyalty_stamp_cards_uuid DEFAULT (NEWID()),
        name               NVARCHAR(80)  COLLATE Modern_Spanish_CI_AS NOT NULL,
        stamps_required    INT           NOT NULL,
        reward_product_id  INT           NULL,
        active             BIT           NOT NULL CONSTRAINT DF_loyalty_stamp_cards_active DEFAULT (1),
        origin             NVARCHAR(10)  COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_loyalty_stamp_cards_origin DEFAULT (N'LOCAL'),
        created_at         DATETIME2(0)  NOT NULL CONSTRAINT DF_loyalty_stamp_cards_created DEFAULT (SYSDATETIME()),
        updated_at         DATETIME2(0)  NOT NULL CONSTRAINT DF_loyalty_stamp_cards_updated DEFAULT (SYSDATETIME()),
        row_version        ROWVERSION,
        CONSTRAINT PK_loyalty_stamp_cards PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UX_loyalty_stamp_cards_uuid UNIQUE (uuid),
        CONSTRAINT FK_loyalty_stamp_cards_reward FOREIGN KEY (reward_product_id) REFERENCES dbo.products (id),
        CONSTRAINT CK_loyalty_stamp_cards_required CHECK (stamps_required BETWEEN 2 AND 100),
        CONSTRAINT CK_loyalty_stamp_cards_origin CHECK (origin IN (N'LOCAL', N'REMOTE'))
    );
END;
GO

IF OBJECT_ID(N'dbo.loyalty_stamp_card_products', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.loyalty_stamp_card_products (
        card_id    INT NOT NULL,
        product_id INT NOT NULL,
        CONSTRAINT PK_loyalty_stamp_card_products PRIMARY KEY CLUSTERED (card_id, product_id),
        CONSTRAINT FK_loyalty_stamp_card_products_card FOREIGN KEY (card_id) REFERENCES dbo.loyalty_stamp_cards (id),
        CONSTRAINT FK_loyalty_stamp_card_products_product FOREIGN KEY (product_id) REFERENCES dbo.products (id)
    );
END;
GO

IF OBJECT_ID(N'dbo.loyalty_ledger', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.loyalty_ledger (
        id                    INT IDENTITY(1, 1) NOT NULL,
        uuid                  UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_loyalty_ledger_uuid DEFAULT (NEWID()),
        customer_id           INT           NOT NULL,
        program               NVARCHAR(10)  COLLATE Modern_Spanish_CI_AS NOT NULL,
        card_id               INT           NULL,
        delta                 INT           NOT NULL,
        kind                  NVARCHAR(10)  COLLATE Modern_Spanish_CI_AS NOT NULL,
        reason                NVARCHAR(12)  COLLATE Modern_Spanish_CI_AS NULL,
        sale_id               INT           NULL,
        sale_detail_id        INT           NULL,
        refund_id             INT           NULL,
        reward_definition_id  INT           NULL,
        amount                DECIMAL(12,2) NULL,
        user_id               INT           NULL,
        note                  NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
        origin                NVARCHAR(10)  COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_loyalty_ledger_origin DEFAULT (N'LOCAL'),
        location_name         NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
        created_at            DATETIME2(0)  NOT NULL CONSTRAINT DF_loyalty_ledger_created DEFAULT (SYSDATETIME()),
        row_version           ROWVERSION,
        CONSTRAINT PK_loyalty_ledger PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UX_loyalty_ledger_uuid UNIQUE (uuid),
        CONSTRAINT FK_loyalty_ledger_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers (id),
        CONSTRAINT FK_loyalty_ledger_card FOREIGN KEY (card_id) REFERENCES dbo.loyalty_stamp_cards (id),
        CONSTRAINT CK_loyalty_ledger_program CHECK (program IN (N'POINTS', N'STAMPS')),
        CONSTRAINT CK_loyalty_ledger_card CHECK ((program = N'STAMPS' AND card_id IS NOT NULL) OR (program = N'POINTS' AND card_id IS NULL)),
        CONSTRAINT CK_loyalty_ledger_kind CHECK (kind IN (N'EARN', N'REDEEM', N'REVERSE', N'EXPIRE', N'ADJUST')),
        CONSTRAINT CK_loyalty_ledger_delta CHECK (delta <> 0),
        CONSTRAINT CK_loyalty_ledger_origin CHECK (origin IN (N'LOCAL', N'REMOTE'))
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_loyalty_ledger_customer' AND object_id = OBJECT_ID(N'dbo.loyalty_ledger'))
    CREATE NONCLUSTERED INDEX IX_loyalty_ledger_customer ON dbo.loyalty_ledger (customer_id, program, card_id) INCLUDE (delta, kind, created_at);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_loyalty_ledger_sale' AND object_id = OBJECT_ID(N'dbo.loyalty_ledger'))
    CREATE NONCLUSTERED INDEX IX_loyalty_ledger_sale ON dbo.loyalty_ledger (sale_id) INCLUDE (program, card_id, kind, reason, delta) WHERE sale_id IS NOT NULL;
GO
/* Una venta gana UNA vez por programa y motivo, aunque la evalúen dos cajas. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_loyalty_ledger_earn' AND object_id = OBJECT_ID(N'dbo.loyalty_ledger'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_loyalty_ledger_earn ON dbo.loyalty_ledger (sale_id, program, card_id, reason)
        WHERE kind = N'EARN' AND origin = N'LOCAL' AND sale_id IS NOT NULL;
GO

IF COL_LENGTH(N'dbo.reward_definitions', N'points_cost') IS NULL
    ALTER TABLE dbo.reward_definitions ADD points_cost INT NULL;
GO
IF OBJECT_ID(N'dbo.CK_reward_definitions_points_cost', 'C') IS NULL
    ALTER TABLE dbo.reward_definitions WITH CHECK ADD CONSTRAINT CK_reward_definitions_points_cost
        CHECK (points_cost IS NULL OR points_cost BETWEEN 1 AND 1000000);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WHERE aggregate_type = 'POINTS_CONFIG')
    INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('POINTS_CONFIG', 0x0000000000000000);
IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WHERE aggregate_type = 'STAMP_CARD')
    INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('STAMP_CARD', 0x0000000000000000);
IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WHERE aggregate_type = 'LOYALTY_LEDGER')
    INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('LOYALTY_LEDGER', 0x0000000000000000);
GO

/* ---------- sp_coupon_validate (SQL_STORED_PROCEDURE) ---------- */
/* sp_coupon_validate
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_coupon_validate — ¿este codigo sirve, y para que?

   Lo llama la caja cuando alguien teclea o escanea un cupon, ANTES de cobrar.
   No consume nada: solo mira. Consumir es `sp_coupon_redeem`, y ocurre cuando
   la venta ya esta cobrada.

   Devuelve SIEMPRE una fila, con `ok` y un `motivo` legible. Un cupon que no
   sirve no es un error del sistema -es el caso normal de un papel caducado- y
   tratarlo como excepcion obligaria a la pantalla a leer mensajes de SQL para
   decidir que ensenar.

   MOTIVOS
   -------
   NO_EXISTE      el codigo no corresponde a ningun cupon
   EXPIRADO       paso su vigencia
   AGOTADO        ya se uso todas las veces que permitia
   ANULADO        alguien lo invalido
   INACTIVO       la definicion se apago despues de emitirlo
   OK             sirve

   APLICABLE
   ---------
   `aplicable` es distinto de `ok`. Un cupon puede ser perfectamente valido y
   aun asi no poder aplicarse en el punto de venta, porque el tipo de
   beneficio no esta soportado todavia. Ver la nota de sp_coupon_redeem.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_coupon_validate]
    @code NVARCHAR(24)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ahora DATETIME2(0) = SYSDATETIME();   /* hora local: misma politica que sp_loyalty_evaluate_sale */

    SET @code = LTRIM(RTRIM(ISNULL(@code, N'')));

    DECLARE @id INT, @estado NVARCHAR(12), @expira DATETIME2(0),
            @permitidos INT, @usados INT, @activa BIT, @kind NVARCHAR(20);

    SELECT @id = ci.id, @estado = ci.status, @expira = ci.expires_at,
           @permitidos = ci.uses_allowed, @usados = ci.uses_count,
           @activa = cd.active, @kind = cd.kind
    FROM dbo.coupon_instances ci
    JOIN dbo.coupon_definitions cd ON cd.id = ci.definition_id
    WHERE ci.code = @code;

    DECLARE @motivo NVARCHAR(20) =
        CASE
            WHEN @id IS NULL THEN 'NO_EXISTE'
            WHEN @estado = 'VOID' THEN 'ANULADO'
            WHEN @activa = 0 THEN 'INACTIVO'
            WHEN @expira IS NOT NULL AND @expira < @ahora THEN 'EXPIRADO'
            WHEN @usados >= @permitidos OR @estado = 'REDEEMED' THEN 'AGOTADO'
            ELSE 'OK'
        END;

    /* 0064: producto gratis, monto y porcentaje se aplican en la cotización
       (el monto se reparte entre los renglones) y se consumen en sp_register_sale. */
    DECLARE @aplicable BIT = CASE WHEN @motivo = 'OK' AND @kind IN ('FREE_PRODUCT', 'AMOUNT', 'PERCENT') THEN 1 ELSE 0 END;

    SELECT
        CAST(CASE WHEN @motivo = 'OK' THEN 1 ELSE 0 END AS BIT) AS ok,
        @motivo AS motivo,
        @aplicable AS aplicable,
        ci.id AS instance_id,
        ci.code,
        ci.definition_id,
        cd.name AS nombre,
        cd.kind,
        cd.amount,
        cd.discount_pct,
        cd.product_id,
        p.nombre AS product_name,
        ci.expires_at,
        ci.uses_allowed,
        ci.uses_count,
        ci.customer_id,
        c.customerName AS cliente,
        CASE @motivo
            WHEN 'NO_EXISTE' THEN N'Ese código no existe.'
            WHEN 'EXPIRADO'  THEN N'Este cupón ya venció.'
            WHEN 'AGOTADO'   THEN N'Este cupón ya se usó.'
            WHEN 'ANULADO'   THEN N'Este cupón fue anulado.'
            WHEN 'INACTIVO'  THEN N'Esta promoción ya no está disponible.'
            ELSE CASE WHEN @aplicable = 1
                      THEN CONCAT(N'Cupón válido: ', cd.name)
                      ELSE N'Cupón válido, pero este tipo de descuento todavía no se puede aplicar en caja.'
                 END
        END AS mensaje
    FROM dbo.coupon_instances ci
    JOIN dbo.coupon_definitions cd ON cd.id = ci.definition_id
    LEFT JOIN dbo.products p ON p.id = cd.product_id
    LEFT JOIN dbo.customers c ON c.id = ci.customer_id
    WHERE ci.id = @id

    UNION ALL

    /* El codigo inexistente tambien tiene que devolver fila: la pantalla
       espera siempre una respuesta con su motivo, no una lista vacia que
       tendria que interpretar. */
    SELECT CAST(0 AS BIT), 'NO_EXISTE', CAST(0 AS BIT), NULL, @code, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           N'Ese código no existe.'
    WHERE @id IS NULL;
END
GO

/* ---------- sp_loyalty_customer_status (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_customer_status (0064) =====================
   Lo que la caja enseña de los puntos y sellos del cliente elegido.

     1  configuración de puntos y el saldo del cliente (con su caducidad)
     2  tarjetas de sellos activas, con los sellos que lleva el cliente
     3  productos que sellan cada tarjeta (y con los que se canjea si la
        tarjeta no fija uno)
     4  catálogo de canje: recompensas con costo en puntos

   CADUCIDAD: si la configuración tiene `expiry_months` y el cliente no ha
   ganado ni canjeado en ese tiempo, su saldo caduca AQUÍ (un movimiento
   EXPIRE). Se hace al preguntar, que es cuando importa: nadie necesita un
   proceso nocturno para un saldo que no se consulta.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_customer_status
    @customer_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @enabled BIT, @per_amount DECIMAL(12,2), @points_per INT, @visit INT, @meses INT;
    SELECT @enabled = enabled, @per_amount = per_amount, @points_per = points_per, @visit = visit_points, @meses = expiry_months
      FROM dbo.loyalty_points_config WHERE id = 1;

    IF @customer_id IS NOT NULL AND @meses IS NOT NULL
    BEGIN
        BEGIN TRAN;
        DECLARE @recurso NVARCHAR(40) = CONCAT(N'wx-loy-', @customer_id);
        EXEC sp_getapplock @Resource = @recurso, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
        DECLARE @saldo INT = (SELECT ISNULL(SUM(delta), 0) FROM dbo.loyalty_ledger WHERE customer_id = @customer_id AND program = N'POINTS');
        DECLARE @ult DATETIME2(0) = (SELECT MAX(created_at) FROM dbo.loyalty_ledger
                                      WHERE customer_id = @customer_id AND program = N'POINTS' AND kind IN (N'EARN', N'REDEEM'));
        IF @saldo > 0 AND @ult IS NOT NULL AND DATEADD(MONTH, @meses, @ult) < SYSDATETIME()
            INSERT INTO dbo.loyalty_ledger (customer_id, program, delta, kind, note)
            VALUES (@customer_id, N'POINTS', -@saldo, N'EXPIRE', CONCAT(N'Sin movimiento desde ', CONVERT(VARCHAR(10), @ult, 23)));
        COMMIT;
    END

    /* 1 configuración y saldo */
    SELECT ISNULL(@enabled, 0) AS enabled, @per_amount AS per_amount, ISNULL(@points_per, 1) AS points_per,
           ISNULL(@visit, 0) AS visit_points, @meses AS expiry_months,
           ISNULL(s.saldo, 0) AS puntos, s.ultimo,
           CASE WHEN @meses IS NULL OR s.ultimo IS NULL OR ISNULL(s.saldo, 0) <= 0 THEN NULL
                ELSE CAST(DATEADD(MONTH, @meses, s.ultimo) AS DATE) END AS vencen
      FROM (SELECT SUM(delta) AS saldo,
                   MAX(CASE WHEN kind IN (N'EARN', N'REDEEM') THEN created_at END) AS ultimo
              FROM dbo.loyalty_ledger WHERE customer_id = @customer_id AND program = N'POINTS') s;

    /* 2 tarjetas de sellos */
    SELECT c.id, LOWER(CONVERT(VARCHAR(36), c.uuid)) AS uuid, c.name, c.stamps_required, c.reward_product_id,
           rp.nombre AS reward_product_name,
           ISNULL((SELECT SUM(l.delta) FROM dbo.loyalty_ledger l
                    WHERE l.customer_id = @customer_id AND l.program = N'STAMPS' AND l.card_id = c.id), 0) AS sellos
      FROM dbo.loyalty_stamp_cards c
      LEFT JOIN dbo.products rp ON rp.id = c.reward_product_id
     WHERE c.active = 1
     ORDER BY c.name;

    /* 3 productos de cada tarjeta (+ el de canje si es otro) */
    SELECT x.card_id, pr.id AS product_id, pr.nombre, pr.price, pr.inventory_mode, pr.tasa_iva, pr.objeto_impuesto,
           pr.clave_prod_serv, pr.clave_unidad, x.es_premio
      FROM (SELECT cp.card_id, cp.product_id, CAST(CASE WHEN c.reward_product_id IS NULL OR c.reward_product_id = cp.product_id THEN 1 ELSE 0 END AS BIT) AS es_premio
              FROM dbo.loyalty_stamp_card_products cp JOIN dbo.loyalty_stamp_cards c ON c.id = cp.card_id WHERE c.active = 1
            UNION
            SELECT c.id, c.reward_product_id, CAST(1 AS BIT) FROM dbo.loyalty_stamp_cards c
             WHERE c.active = 1 AND c.reward_product_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM dbo.loyalty_stamp_card_products cp WHERE cp.card_id = c.id AND cp.product_id = c.reward_product_id)) x
      JOIN dbo.products pr ON pr.id = x.product_id
     ORDER BY x.card_id, pr.nombre;

    /* 4 catálogo de canje */
    SELECT rd.id, rd.name, rd.kind, rd.product_id, rd.amount, rd.discount_pct, rd.points_cost,
           pr.nombre AS product_name, pr.price AS product_price, pr.inventory_mode AS product_inventory_mode,
           pr.tasa_iva AS product_tasa_iva, pr.objeto_impuesto AS product_objeto_impuesto,
           pr.clave_prod_serv AS product_clave_prod_serv, pr.clave_unidad AS product_clave_unidad
      FROM dbo.reward_definitions rd
      LEFT JOIN dbo.products pr ON pr.id = rd.product_id
     WHERE rd.active = 1 AND rd.points_cost IS NOT NULL AND rd.kind IN (N'FREE_PRODUCT', N'AMOUNT', N'PERCENT')
       AND ISNULL(@enabled, 0) = 1
     ORDER BY rd.points_cost, rd.name;
END;
GO

/* ---------- sp_loyalty_evaluate_sale (SQL_STORED_PROCEDURE) ---------- */
/* sp_loyalty_evaluate_sale
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
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

    /* La capacidad apagada no es un error: es un negocio que no usa esto.
       Devuelve CERO FILAS, con la misma forma que el resultado normal: quien
       llama recorre una lista de premios y no tiene por que distinguir entre
       "no gano nada" y "esto esta apagado". */
    IF NOT EXISTS (SELECT 1 FROM dbo.business_config WHERE loyalty_enabled = 1)
    BEGIN
        SELECT CAST(NULL AS VARCHAR(12)) AS tipo, CAST(NULL AS NVARCHAR(40)) AS codigo,
               CAST(NULL AS NVARCHAR(120)) AS nombre, CAST(NULL AS INT) AS numero,
               CAST(NULL AS NVARCHAR(32)) AS token, CAST(NULL AS NVARCHAR(120)) AS rifa
        WHERE 1 = 0;
        RETURN;
    END

    DECLARE @customer_id INT, @total DECIMAL(12,2), @register_id INT, @fecha DATETIME;
    /* ------------------------------------------------------------------
       RELOJ: hora LOCAL del negocio, en todo Fidelizacion.

       Una campana no puede medir unas reglas con un reloj y otras con otro.
       Aqui convivian los dos: la vigencia (`starts_at` / `ends_at`) se
       comparaba contra SYSUTCDATETIME mientras el dia de la semana y el
       horario salian de `sales.datee`, que `sp_register_sale` sella con
       GETDATE() -hora local-. Con el servidor en UTC-6, una campana con
       fecha de fin caducaba SEIS HORAS antes del final del dia elegido.

       La politica para V1 es la hora local del servidor, y no es una
       eleccion arbitraria: es la que ya usa el resto del POS en lo
       operativo -la venta, el turno, los movimientos de caja- y la unica
       que el negocio entiende. "Promocion los martes de 2 a 4" significa
       las dos de la tarde ALLI, no en Greenwich.

       Wybix todavia no tiene una zona horaria configurable. Cuando la
       tenga, este es el unico sitio que hay que mirar: reglas y caducidades
       de Fidelizacion se derivan de aqui.

       Los `created_at` por defecto de las tablas siguen en UTC: son
       auditoria de fila, no reglas, y ningun procedure los deja al valor
       por defecto ni ninguna pantalla los muestra.
       ------------------------------------------------------------------ */
    /* `@ahora` sella lo que se EMITE en este momento (issued_at, caducidades).
       Las CONDICIONES de la campana no lo usan: esas miran a `@fecha`, el
       instante de la venta. Son dos preguntas distintas y cada una tiene su
       reloj, pero ambos son locales. */
    DECLARE @ahora DATETIME2(0) = SYSDATETIME();
    DECLARE @yaEvaluada BIT = 0;

    /* ------------------------------------------------------------------
       UNA venta se evalua UNA vez, aunque la pregunten varios a la vez.

       El `IF EXISTS` de abajo no basta por si solo: es leer y luego escribir,
       y entre las dos cosas cabe otra sesion entera. Con seis evaluaciones
       simultaneas de la misma venta -el reintento del IPC, o dos pantallas
       abiertas sobre el mismo cobro- las seis pasaban la comprobacion y las
       seis repartian premio. Medido: seis recompensas para una sola venta.

       El bloqueo se toma sobre la FILA DE LA VENTA, no sobre las tablas de
       premios ni con un candado global. Asi dos cajas cobrando ventas
       distintas no se esperan nunca: solo se serializa quien pregunta por la
       MISMA venta, que es exactamente lo que hay que serializar.
       ------------------------------------------------------------------ */
    BEGIN TRY
        BEGIN TRAN;

        SELECT @customer_id = customer_id, @total = total, @register_id = register_id, @fecha = datee
        FROM dbo.sales WITH (UPDLOCK, HOLDLOCK) WHERE id = @sale_id;

        IF @total IS NULL
        BEGIN
            IF XACT_STATE() <> 0 ROLLBACK TRAN;
            RAISERROR('La venta no existe.', 16, 1);
            RETURN;
        END

        /* Ya evaluada: no se otorga dos veces. Quien llegue el segundo
           esperaba en el UPDLOCK de arriba, asi que aqui ya ve el premio que
           acaba de escribir el primero. */
        IF EXISTS (SELECT 1 FROM dbo.reward_instances WHERE sale_id = @sale_id)
        OR EXISTS (SELECT 1 FROM dbo.coupon_instances WHERE sale_id = @sale_id)
        OR EXISTS (SELECT 1 FROM dbo.dynamic_attempts WHERE sale_id = @sale_id)
        OR EXISTS (SELECT 1 FROM dbo.raffle_entries WHERE sale_id = @sale_id)
            SET @yaEvaluada = 1;

        IF @yaEvaluada = 0
        BEGIN
    /* Dia de la semana con LUNES = bit 0, que es como lo pinta la pantalla
       ("Lun Mar Mie Jue Vie Sab Dom").

       No se usa `DATEPART(WEEKDAY) - 1` por dos razones. La primera es que
       daria DOMINGO = 0 y una campana de "solo lunes" se entregaria los
       domingos. La segunda es que DATEPART(WEEKDAY) depende de SET DATEFIRST,
       que es una opcion de SESION: con varias cajas conectandose con distinta
       configuracion regional, la misma campana aplicaria en dias distintos
       segun el equipo que cobrara. Esta formula no depende de nada. */
    DECLARE @dow TINYINT = (DATEPART(WEEKDAY, @fecha) + @@DATEFIRST - 2) % 7;
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
      /* Contra el instante de LA VENTA, no contra "ahora".

         Es la misma familia de fallo que el reloj: la pregunta es "¿esta
         campana aplicaba a ESTA venta?", y eso lo decide cuando ocurrio la
         venta, no cuando a alguien le dio por evaluarla.

         Con `@ahora` las cuatro condiciones miraban a dos instantes
         distintos: el dia y el horario salian de la venta, y la vigencia del
         momento de evaluar. En una venta que se evalua al segundo siguiente
         coinciden, asi que no se nota; en una que se reevalua mas tarde -o
         que se cobra a las 23:59:58 y se evalua a las 00:00:01- no. Medido:
         una venta de ayer cobraba premios de una campana que empezo hoy. */
      AND (c.starts_at IS NULL OR c.starts_at <= @fecha)
      AND (c.ends_at IS NULL OR c.ends_at >= @fecha)
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
        /* El tope de boletos de la rifa, si lo tiene. NULL es sin tope. */
        DECLARE @tope INT = (SELECT tickets_total FROM dbo.raffle_definitions WHERE id = @raffle_id);

        DECLARE @i INT = 0;
        WHILE @i < @unidades
        BEGIN
            /* Se comprueba DENTRO del bucle y con el mismo bloqueo que usa
               la numeracion: si dos cajas cobran a la vez y quedan tres
               boletos, no se pueden repartir seis. Al llenarse se deja de
               repartir sin error: la venta es valida y el resto de premios
               tambien. */
            IF @tope IS NOT NULL
               AND (SELECT COUNT(*) FROM dbo.raffle_entries WITH (UPDLOCK, HOLDLOCK)
                     WHERE raffle_id = @raffle_id AND status = 'VALID') >= @tope
                BREAK;

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

        DROP TABLE #aplican;
        END   /* fin del reparto */

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(400) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
        RETURN;
    END CATCH

    /* 0064: puntos y sellos. Después del reparto de campañas y con su propia
       transacción; idempotente por venta como el resto. */
    EXEC dbo.sp_loyalty_points_earn @sale_id = @sale_id;

    /* Lo otorgado, para que la pantalla lo cuente y el ticket lo imprima.
       Se devuelve TAMBIEN cuando la venta ya estaba evaluada: un reintento
       tiene que poder volver a ensenar el premio, no quedarse sin nada que
       mostrar porque alguien pregunto dos veces. */
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
    UNION ALL
    SELECT 'POINTS', NULL, CONCAT(N'+', SUM(l.delta), N' puntos'), SUM(l.delta), NULL, NULL
    FROM dbo.loyalty_ledger l
    WHERE l.sale_id = @sale_id AND l.program = N'POINTS' AND l.kind = N'EARN'
    HAVING SUM(l.delta) > 0
    UNION ALL
    SELECT 'STAMPS', NULL, CONCAT(k.name, N': +', SUM(l.delta), CASE WHEN SUM(l.delta) = 1 THEN N' sello' ELSE N' sellos' END), SUM(l.delta), NULL, k.name
    FROM dbo.loyalty_ledger l
    JOIN dbo.loyalty_stamp_cards k ON k.id = l.card_id
    WHERE l.sale_id = @sale_id AND l.program = N'STAMPS' AND l.kind = N'EARN'
    GROUP BY k.name
    ORDER BY tipo, numero;
END
GO

/* ---------- sp_loyalty_points_admin (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_admin (0064) =====================
   Fidelización > Puntos.

     1  configuración
     2  indicadores del mes: puntos dados, canjeados, vigentes (lo que el
        negocio le debe a sus clientes), clientes con saldo, sellos y
        tarjetas canjeadas
     3  tarjetas de sellos (con sus productos en JSON)
     4  recompensas que se pueden poner en el catálogo de canje
     5  clientes con movimiento (búsqueda por nombre o teléfono)
   ======================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_admin
    @buscar NVARCHAR(80) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @mes DATETIME2(0) = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1);
    SET @buscar = NULLIF(LTRIM(RTRIM(@buscar)), N'');
    DECLARE @digitos NVARCHAR(80) = NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(@buscar, N''), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), N'');
    IF @digitos LIKE N'%[^0-9]%' SET @digitos = NULL;

    /* 1 */
    SELECT enabled, per_amount, points_per, visit_points, expiry_months, updated_at FROM dbo.loyalty_points_config WHERE id = 1;

    /* 2 */
    SELECT
        ISNULL((SELECT SUM(delta) FROM dbo.loyalty_ledger WHERE program = N'POINTS' AND kind = N'EARN' AND created_at >= @mes), 0) AS dados_mes,
        ISNULL((SELECT -SUM(delta) FROM dbo.loyalty_ledger WHERE program = N'POINTS' AND kind = N'REDEEM' AND created_at >= @mes), 0) AS canjeados_mes,
        ISNULL((SELECT SUM(delta) FROM dbo.loyalty_ledger WHERE program = N'POINTS'), 0) AS vigentes,
        (SELECT COUNT(*) FROM (SELECT customer_id FROM dbo.loyalty_ledger WHERE program = N'POINTS'
                                GROUP BY customer_id HAVING SUM(delta) > 0) x) AS clientes_con_saldo,
        ISNULL((SELECT SUM(delta) FROM dbo.loyalty_ledger WHERE program = N'STAMPS' AND kind = N'EARN' AND created_at >= @mes), 0) AS sellos_mes,
        (SELECT COUNT(*) FROM dbo.loyalty_ledger WHERE program = N'STAMPS' AND kind = N'REDEEM' AND created_at >= @mes) AS tarjetas_mes,
        ISNULL((SELECT SUM(amount) FROM dbo.loyalty_ledger WHERE kind = N'REDEEM' AND created_at >= @mes), 0) AS descuento_mes;

    /* 3 */
    SELECT c.id, LOWER(CONVERT(VARCHAR(36), c.uuid)) AS uuid, c.name, c.stamps_required, c.reward_product_id,
           rp.nombre AS reward_product_name, c.active, c.origin,
           (SELECT COUNT(*) FROM (SELECT customer_id FROM dbo.loyalty_ledger l WHERE l.card_id = c.id
                                   GROUP BY customer_id HAVING SUM(delta) > 0) x) AS clientes,
           (SELECT cp.product_id AS id, pr.nombre AS nombre FROM dbo.loyalty_stamp_card_products cp
              JOIN dbo.products pr ON pr.id = cp.product_id WHERE cp.card_id = c.id ORDER BY pr.nombre FOR JSON PATH) AS productos_json
      FROM dbo.loyalty_stamp_cards c
      LEFT JOIN dbo.products rp ON rp.id = c.reward_product_id
     ORDER BY c.active DESC, c.name;

    /* 4 */
    SELECT rd.id, rd.name, rd.kind, rd.product_id, pr.nombre AS product_name, rd.amount, rd.discount_pct, rd.points_cost, rd.active,
           (SELECT COUNT(*) FROM dbo.loyalty_ledger l WHERE l.reward_definition_id = rd.id AND l.kind = N'REDEEM') AS canjes
      FROM dbo.reward_definitions rd
      LEFT JOIN dbo.products pr ON pr.id = rd.product_id
     WHERE rd.kind IN (N'FREE_PRODUCT', N'AMOUNT', N'PERCENT') AND (rd.active = 1 OR rd.points_cost IS NOT NULL)
     ORDER BY CASE WHEN rd.points_cost IS NULL THEN 1 ELSE 0 END, rd.points_cost, rd.name;

    /* 5 */
    SELECT TOP (200) c.id, c.customerName AS cliente, COALESCE(NULLIF(c.mobile, N''), c.phone) AS telefono,
           ISNULL(SUM(CASE WHEN l.program = N'POINTS' THEN l.delta END), 0) AS puntos,
           (SELECT k.name AS tarjeta, k.stamps_required AS requeridos, SUM(s.delta) AS sellos
              FROM dbo.loyalty_ledger s JOIN dbo.loyalty_stamp_cards k ON k.id = s.card_id
             WHERE s.customer_id = c.id AND s.program = N'STAMPS'
             GROUP BY k.name, k.stamps_required FOR JSON PATH) AS sellos_json,
           MAX(l.created_at) AS ultimo
      FROM dbo.customers c
      JOIN dbo.loyalty_ledger l ON l.customer_id = c.id
     WHERE @buscar IS NULL OR c.customerName LIKE N'%' + @buscar + N'%'
        OR (@digitos IS NOT NULL AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(COALESCE(NULLIF(c.mobile, N''), c.phone), N''),
              N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N'') LIKE N'%' + @digitos + N'%')
     GROUP BY c.id, c.customerName, c.mobile, c.phone
     ORDER BY MAX(l.created_at) DESC;
END;
GO

/* ---------- sp_loyalty_points_apply_remote (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_apply_remote (0064) =====================
   Lo que bajó de la nube (club_pull): la configuración de puntos, las
   tarjetas de sellos y los movimientos de puntos y sellos hechos en las
   demás sucursales. Con esto el saldo de un cliente es el mismo en todas.

   @payload = {
     points_config: { enabled, per_amount, points_per, visit_points, expiry_months, updated_local } | null,
     stamp_cards:   [{ uuid, name, stamps_required, reward_product_uuid, active, products: [uuid] }],
     ledger:        [{ uuid, customer_name, phone, program, card_uuid, delta, kind, reason, amount, note,
                       created_local, location_name }]
   }

   Reglas:
   · La configuración más reciente gana (por su hora local de guardado).
   · Un producto que esta sucursal no tiene (por uuid) se ignora.
   · El cliente se busca por teléfono (solo dígitos, últimos 10); si no
     existe aquí, se da de alta con su nombre y teléfono -igual que el Club-.
   · Un movimiento de una tarjeta que aquí no existe se ignora hasta que
     baje la tarjeta.
   Idempotente: un movimiento se reconoce por su uuid.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_apply_remote
    @payload NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF ISJSON(@payload) <> 1 THROW 51000, 'Datos de puntos invalidos.', 1;

    BEGIN TRAN;

    /* ---------------------------------------------------- configuración */
    DECLARE @cfg_hora DATETIME2(0) = TRY_CONVERT(DATETIME2(0), JSON_VALUE(@payload, '$.points_config.updated_local'));
    IF @cfg_hora IS NOT NULL AND @cfg_hora > (SELECT updated_at FROM dbo.loyalty_points_config WHERE id = 1)
        UPDATE dbo.loyalty_points_config
           SET enabled = ISNULL(TRY_CONVERT(BIT, JSON_VALUE(@payload, '$.points_config.enabled')), enabled),
               per_amount = NULLIF(TRY_CONVERT(DECIMAL(12,2), JSON_VALUE(@payload, '$.points_config.per_amount')), 0),
               points_per = ISNULL(TRY_CONVERT(INT, JSON_VALUE(@payload, '$.points_config.points_per')), points_per),
               visit_points = ISNULL(TRY_CONVERT(INT, JSON_VALUE(@payload, '$.points_config.visit_points')), 0),
               expiry_months = TRY_CONVERT(INT, JSON_VALUE(@payload, '$.points_config.expiry_months')),
               origin = N'REMOTE', updated_at = @cfg_hora
         WHERE id = 1;

    /* ---------------------------------------------------------- tarjetas */
    SELECT j.uuid, j.name, j.stamps_required, NULLIF(pr.id, -1) AS reward_product_id, j.active, j.products
      INTO #tarjetas
      FROM OPENJSON(@payload, '$.stamp_cards') WITH (
             uuid UNIQUEIDENTIFIER, name NVARCHAR(80), stamps_required INT, reward_product_uuid UNIQUEIDENTIFIER,
             active BIT, products NVARCHAR(MAX) AS JSON) j
      LEFT JOIN dbo.products pr ON pr.uuid = j.reward_product_uuid
     WHERE j.uuid IS NOT NULL AND j.name IS NOT NULL AND j.stamps_required BETWEEN 2 AND 100;

    UPDATE t SET name = x.name, stamps_required = x.stamps_required, reward_product_id = x.reward_product_id,
                 active = ISNULL(x.active, 1), updated_at = SYSDATETIME()
      FROM dbo.loyalty_stamp_cards t JOIN #tarjetas x ON x.uuid = t.uuid
     WHERE t.origin = N'REMOTE';

    INSERT INTO dbo.loyalty_stamp_cards (uuid, name, stamps_required, reward_product_id, active, origin)
    SELECT x.uuid, x.name, x.stamps_required, x.reward_product_id, ISNULL(x.active, 1), N'REMOTE'
      FROM #tarjetas x
     WHERE NOT EXISTS (SELECT 1 FROM dbo.loyalty_stamp_cards t WHERE t.uuid = x.uuid);

    DELETE cp FROM dbo.loyalty_stamp_card_products cp
      JOIN dbo.loyalty_stamp_cards t ON t.id = cp.card_id AND t.origin = N'REMOTE'
      JOIN #tarjetas x ON x.uuid = t.uuid
     WHERE NOT EXISTS (SELECT 1 FROM OPENJSON(x.products) v JOIN dbo.products pr ON pr.uuid = TRY_CONVERT(UNIQUEIDENTIFIER, v.value)
                        WHERE pr.id = cp.product_id);
    INSERT INTO dbo.loyalty_stamp_card_products (card_id, product_id)
    SELECT DISTINCT t.id, pr.id
      FROM #tarjetas x
      JOIN dbo.loyalty_stamp_cards t ON t.uuid = x.uuid AND t.origin = N'REMOTE'
     CROSS APPLY OPENJSON(x.products) v
      JOIN dbo.products pr ON pr.uuid = TRY_CONVERT(UNIQUEIDENTIFIER, v.value)
     WHERE NOT EXISTS (SELECT 1 FROM dbo.loyalty_stamp_card_products e WHERE e.card_id = t.id AND e.product_id = pr.id);

    /* ------------------------------------------------------- movimientos */
    SELECT j.uuid, NULLIF(LTRIM(RTRIM(j.customer_name)), N'') AS customer_name,
           RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(j.phone, N''), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), 10) AS tel,
           j.program, NULLIF(t.id, -1) AS card_id, j.delta, j.kind, j.reason, j.amount, j.note,
           TRY_CONVERT(DATETIME2(0), j.created_local) AS created_at, j.location_name, CAST(NULL AS INT) AS customer_id
      INTO #libro
      FROM OPENJSON(@payload, '$.ledger') WITH (
             uuid UNIQUEIDENTIFIER, customer_name NVARCHAR(120), phone NVARCHAR(40), program NVARCHAR(10),
             card_uuid UNIQUEIDENTIFIER, delta INT, kind NVARCHAR(10), reason NVARCHAR(12), amount DECIMAL(12,2),
             note NVARCHAR(200), created_local NVARCHAR(30), location_name NVARCHAR(120)) j
      LEFT JOIN dbo.loyalty_stamp_cards t ON t.uuid = j.card_uuid
     WHERE j.uuid IS NOT NULL AND ISNULL(j.delta, 0) <> 0
       AND j.program IN (N'POINTS', N'STAMPS') AND j.kind IN (N'EARN', N'REDEEM', N'REVERSE', N'EXPIRE', N'ADJUST')
       AND NOT EXISTS (SELECT 1 FROM dbo.loyalty_ledger l WHERE l.uuid = j.uuid);
    DELETE FROM #libro WHERE program = N'STAMPS' AND card_id IS NULL;

    /* El cliente por teléfono; si no está, se da de alta (uno por teléfono). */
    UPDATE x SET customer_id = c.id
      FROM #libro x
     CROSS APPLY (SELECT TOP 1 id FROM dbo.customers
                   WHERE LEN(x.tel) = 10
                     AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(NULLIF(mobile, N''), ISNULL(phone, N'')), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), 10) = x.tel
                   ORDER BY active DESC, id) c;
    INSERT INTO dbo.customers (customerName, phone, active)
    SELECT MIN(customer_name), tel, 1 FROM #libro
     WHERE customer_id IS NULL AND LEN(tel) = 10 AND customer_name IS NOT NULL
     GROUP BY tel;
    UPDATE x SET customer_id = c.id
      FROM #libro x
     CROSS APPLY (SELECT TOP 1 id FROM dbo.customers WHERE phone = x.tel ORDER BY id DESC) c
     WHERE x.customer_id IS NULL AND LEN(x.tel) = 10;

    INSERT INTO dbo.loyalty_ledger (uuid, customer_id, program, card_id, delta, kind, reason, amount, note, origin, location_name, created_at)
    SELECT x.uuid, x.customer_id, x.program, CASE WHEN x.program = N'STAMPS' THEN x.card_id END, x.delta, x.kind, x.reason, x.amount, x.note,
           N'REMOTE', x.location_name, ISNULL(x.created_at, SYSDATETIME())
      FROM #libro x
     WHERE x.customer_id IS NOT NULL;

    COMMIT TRAN;

    SELECT (SELECT COUNT(*) FROM #tarjetas) AS tarjetas, (SELECT COUNT(*) FROM #libro WHERE customer_id IS NOT NULL) AS movimientos;
END;
GO

/* ---------- sp_loyalty_points_apply_sale (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_apply_sale (0064) =====================
   El canje de puntos o de una tarjeta de sellos, DENTRO de la transacción de
   sp_register_sale (paso 11, junto al Club). La cotización ya aplicó el
   descuento; aquí se comprueba OTRA VEZ, con el candado del cliente, que el
   saldo alcance -entre cotizar y cobrar pudo canjear en otra caja- y se
   descuenta. Si no alcanza, la venta entera no se registra.

   La cotización trae:
     $.loyaltyCustomerId          el cliente del canje
     $.points  {rewardId, cost, amountApplied}
     $.stamps  {cardId, cost, amountApplied}
   y los renglones con audit.rule = 'points' / 'stamps'. Usa #map (línea de
   la cotización -> sale_detail) que crea sp_register_sale.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_apply_sale
    @sale_id INT,
    @customer_id INT,
    @user_id INT,
    @quote NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    IF @quote IS NULL RETURN;

    DECLARE @reward INT = TRY_CONVERT(INT, JSON_VALUE(@quote, '$.points.rewardId')),
            @costo_q INT = TRY_CONVERT(INT, JSON_VALUE(@quote, '$.points.cost')),
            @monto_p DECIMAL(12,2) = TRY_CONVERT(DECIMAL(12,2), JSON_VALUE(@quote, '$.points.amountApplied')),
            @card INT = TRY_CONVERT(INT, JSON_VALUE(@quote, '$.stamps.cardId')),
            @sellos_q INT = TRY_CONVERT(INT, JSON_VALUE(@quote, '$.stamps.cost')),
            @monto_s DECIMAL(12,2) = TRY_CONVERT(DECIMAL(12,2), JSON_VALUE(@quote, '$.stamps.amountApplied'));
    IF @reward IS NULL AND @card IS NULL RETURN;

    IF @customer_id IS NULL OR @customer_id <> TRY_CONVERT(INT, JSON_VALUE(@quote, '$.loyaltyCustomerId'))
        THROW 51000, 'El canje es de otro cliente: vuelve a elegirlo.', 1;

    DECLARE @recurso NVARCHAR(40) = CONCAT(N'wx-loy-', @customer_id);
    EXEC sp_getapplock @Resource = @recurso, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;

    /* El renglón al que se ata el canje (si es por producto). */
    DECLARE @lineas TABLE (sale_detail_id INT, regla NVARCHAR(40), line_no INT);
    INSERT INTO @lineas
    SELECT m.sale_detail_id, c.regla, m.line_no
      FROM #map m
      JOIN OPENJSON(@quote, '$.lines') WITH (line_no INT, regla NVARCHAR(40) '$.audit.rule') c ON c.line_no = m.line_no
     WHERE c.regla IN (N'points', N'stamps');

    IF @reward IS NOT NULL
    BEGIN
        DECLARE @costo INT, @kind NVARCHAR(20);
        SELECT @costo = points_cost, @kind = kind FROM dbo.reward_definitions
         WHERE id = @reward AND active = 1 AND points_cost IS NOT NULL;
        IF @costo IS NULL OR @costo <> @costo_q
            THROW 51000, 'La recompensa cambió: vuelve a elegir el canje.', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.loyalty_points_config WHERE id = 1 AND enabled = 1)
            THROW 51000, 'Los puntos están apagados.', 1;
        IF ISNULL(@monto_p, 0) <= 0
            THROW 51000, 'El canje de puntos no aplicó a ningún producto.', 1;
        IF (SELECT ISNULL(SUM(delta), 0) FROM dbo.loyalty_ledger WHERE customer_id = @customer_id AND program = N'POINTS') < @costo
            THROW 51000, 'Al cliente ya no le alcanzan los puntos.', 1;
        INSERT INTO dbo.loyalty_ledger (customer_id, program, delta, kind, reason, sale_id, sale_detail_id, reward_definition_id, amount, user_id)
        VALUES (@customer_id, N'POINTS', -@costo, N'REDEEM', N'CANJE', @sale_id,
                CASE WHEN @kind = N'FREE_PRODUCT' THEN (SELECT TOP 1 sale_detail_id FROM @lineas WHERE regla = N'points' ORDER BY line_no) END,
                @reward, @monto_p, @user_id);
    END

    IF @card IS NOT NULL
    BEGIN
        DECLARE @req INT = (SELECT stamps_required FROM dbo.loyalty_stamp_cards WHERE id = @card AND active = 1);
        IF @req IS NULL OR @req <> @sellos_q
            THROW 51000, 'La tarjeta de sellos cambió: vuelve a elegir el canje.', 1;
        IF ISNULL(@monto_s, 0) <= 0
            THROW 51000, 'El canje de sellos no aplicó a ningún producto.', 1;
        IF (SELECT ISNULL(SUM(delta), 0) FROM dbo.loyalty_ledger
             WHERE customer_id = @customer_id AND program = N'STAMPS' AND card_id = @card) < @req
            THROW 51000, 'Al cliente ya no le alcanzan los sellos.', 1;
        INSERT INTO dbo.loyalty_ledger (customer_id, program, card_id, delta, kind, reason, sale_id, sale_detail_id, amount, user_id)
        VALUES (@customer_id, N'STAMPS', @card, -@req, N'REDEEM', N'CANJE', @sale_id,
                (SELECT TOP 1 sale_detail_id FROM @lineas WHERE regla = N'stamps' ORDER BY line_no), @monto_s, @user_id);
    END
END;
GO

/* ---------- sp_loyalty_points_config_save (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_config_save (0064) =====================
   Cómo se ganan los puntos. `@per_amount` NULL = no se gana por compra (solo
   por visita, si la hay). Encender sin ninguna de las dos es un error: un
   programa de puntos que no reparte nada confunde a quien lo ve encendido.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_config_save
    @enabled BIT,
    @per_amount DECIMAL(12,2) = NULL,
    @points_per INT = 1,
    @visit_points INT = 0,
    @expiry_months INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @per_amount IS NOT NULL AND @per_amount <= 0 SET @per_amount = NULL;
    IF ISNULL(@points_per, 0) < 1 SET @points_per = 1;
    IF ISNULL(@visit_points, 0) < 0 SET @visit_points = 0;
    IF @expiry_months IS NOT NULL AND @expiry_months < 1 SET @expiry_months = NULL;
    IF @enabled = 1 AND @per_amount IS NULL AND @visit_points = 0
        THROW 51000, 'Di cómo se ganan: por cada cierto monto, por visita o ambos.', 1;

    UPDATE dbo.loyalty_points_config
       SET enabled = @enabled, per_amount = @per_amount, points_per = @points_per,
           visit_points = @visit_points, expiry_months = @expiry_months,
           origin = N'LOCAL', updated_at = SYSDATETIME()
     WHERE id = 1;
END;
GO

/* ---------- sp_loyalty_points_earn (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_earn (0064) =====================
   Lo que una venta suma al cliente: puntos por lo pagado, puntos por la
   visita del día y un sello por cada unidad de los productos de una tarjeta.

   Se llama desde sp_loyalty_evaluate_sale, DESPUÉS del cobro y fuera de su
   transacción, por la misma razón que las campañas: un error aquí nunca
   puede tumbar un cobro.

   IDEMPOTENTE: UX_loyalty_ledger_earn impide ganar dos veces por la misma
   venta, y el candado por cliente hace que dos ventas simultáneas del mismo
   cliente no cuenten dos visitas el mismo día.

   No suma:
     · ventas sin cliente;
     · unidades en $0 (el café del Club, el producto canjeado): un regalo no
       sella la tarjeta que lo regala;
     · nada si la venta ya tiene devoluciones (se evaluó tarde).
   ======================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_earn
    @sale_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @c INT, @total DECIMAL(12,2), @fecha DATETIME;
    SELECT @c = customer_id, @total = total, @fecha = datee FROM dbo.sales WHERE id = @sale_id;
    IF @c IS NULL RETURN;
    IF EXISTS (SELECT 1 FROM dbo.sale_refunds WHERE sale_id = @sale_id) RETURN;

    DECLARE @enabled BIT, @per_amount DECIMAL(12,2), @points_per INT, @visit INT;
    SELECT @enabled = enabled, @per_amount = per_amount, @points_per = points_per, @visit = visit_points
      FROM dbo.loyalty_points_config WHERE id = 1;

    BEGIN TRAN;
    DECLARE @recurso NVARCHAR(40) = CONCAT(N'wx-loy-', @c);
    EXEC sp_getapplock @Resource = @recurso, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;

    IF @enabled = 1
    BEGIN
        DECLARE @pts INT = CASE WHEN @per_amount IS NULL OR @total <= 0 THEN 0
                                ELSE CAST(FLOOR(@total / @per_amount) AS INT) * @points_per END;
        IF @pts > 0 AND NOT EXISTS (SELECT 1 FROM dbo.loyalty_ledger
                                     WHERE sale_id = @sale_id AND program = N'POINTS' AND kind = N'EARN' AND reason = N'PURCHASE')
            INSERT INTO dbo.loyalty_ledger (customer_id, program, delta, kind, reason, sale_id, amount)
            VALUES (@c, N'POINTS', @pts, N'EARN', N'PURCHASE', @sale_id, @total);

        IF @visit > 0
           AND NOT EXISTS (SELECT 1 FROM dbo.loyalty_ledger l
                            LEFT JOIN dbo.sales s ON s.id = l.sale_id
                            WHERE l.customer_id = @c AND l.program = N'POINTS' AND l.kind = N'EARN' AND l.reason = N'VISIT'
                              AND CAST(ISNULL(s.datee, l.created_at) AS DATE) = CAST(@fecha AS DATE))
            INSERT INTO dbo.loyalty_ledger (customer_id, program, delta, kind, reason, sale_id)
            VALUES (@c, N'POINTS', @visit, N'EARN', N'VISIT', @sale_id);
    END

    /* Sellos: unidades enteras cobradas (> $0) de los productos de cada tarjeta. */
    INSERT INTO dbo.loyalty_ledger (customer_id, program, card_id, delta, kind, reason, sale_id)
    SELECT @c, N'STAMPS', c.id, u.unidades, N'EARN', N'PURCHASE', @sale_id
      FROM dbo.loyalty_stamp_cards c
     CROSS APPLY (SELECT CAST(FLOOR(SUM(d.quantity)) AS INT) AS unidades
                    FROM dbo.sale_detail d
                    JOIN dbo.loyalty_stamp_card_products cp ON cp.card_id = c.id AND cp.product_id = d.product_id
                   WHERE d.sale_id = @sale_id AND d.unitary_price > 0) u
     WHERE c.active = 1 AND u.unidades > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.loyalty_ledger l
                        WHERE l.sale_id = @sale_id AND l.program = N'STAMPS' AND l.card_id = c.id AND l.kind = N'EARN');

    COMMIT;
END;
GO

/* ---------- sp_loyalty_points_ledger (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_ledger (0064) =====================
   El historial de puntos y sellos de un cliente, del más reciente al más
   antiguo. Es la respuesta a "¿por qué tengo estos puntos?".
   ========================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_ledger
    @customer_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (300) l.id, l.created_at, l.program, l.card_id, k.name AS tarjeta, l.delta, l.kind, l.reason,
           l.sale_id, l.refund_id, rd.name AS recompensa, l.amount, u.usuario, l.note, l.origin, l.location_name
      FROM dbo.loyalty_ledger l
      LEFT JOIN dbo.loyalty_stamp_cards k ON k.id = l.card_id
      LEFT JOIN dbo.reward_definitions rd ON rd.id = l.reward_definition_id
      LEFT JOIN dbo.users u ON u.id = l.user_id
     WHERE l.customer_id = @customer_id
     ORDER BY l.created_at DESC, l.id DESC;
END;
GO

/* ---------- sp_loyalty_points_manage (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_manage (0064) =====================
   COSTO   pone (o quita, @valor NULL) el costo en puntos de una recompensa:
           eso la mete o la saca del catálogo de canje.
   AJUSTE  suma o resta puntos (o sellos de @card_id) a un cliente. La nota
           es obligatoria y queda quién lo hizo: un ajuste sin motivo es
           dinero que nadie puede explicar.
   ========================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_manage
    @accion VARCHAR(10),
    @id INT,
    @valor INT = NULL,
    @card_id INT = NULL,
    @nota NVARCHAR(200) = NULL,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @accion = 'COSTO'
    BEGIN
        IF @valor IS NOT NULL AND @valor NOT BETWEEN 1 AND 1000000 THROW 51000, 'El costo va de 1 a 1,000,000 puntos.', 1;
        IF @valor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.reward_definitions WHERE id = @id AND kind IN (N'FREE_PRODUCT', N'AMOUNT', N'PERCENT'))
            THROW 51000, 'Solo se canjean recompensas de producto gratis, monto o porcentaje.', 1;
        UPDATE dbo.reward_definitions SET points_cost = @valor WHERE id = @id;
        IF @@ROWCOUNT = 0 THROW 51000, 'La recompensa no existe.', 1;
        RETURN;
    END
    IF @accion = 'AJUSTE'
    BEGIN
        SET @nota = NULLIF(LTRIM(RTRIM(ISNULL(@nota, N''))), N'');
        IF @nota IS NULL THROW 51000, 'Escribe el motivo del ajuste.', 1;
        IF ISNULL(@valor, 0) = 0 THROW 51000, 'El ajuste no puede ser cero.', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @id) THROW 51000, 'El cliente no existe.', 1;
        IF @card_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.loyalty_stamp_cards WHERE id = @card_id)
            THROW 51000, 'La tarjeta no existe.', 1;
        BEGIN TRAN;
        DECLARE @recurso NVARCHAR(40) = CONCAT(N'wx-loy-', @id);
        EXEC sp_getapplock @Resource = @recurso, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
        INSERT INTO dbo.loyalty_ledger (customer_id, program, card_id, delta, kind, reason, user_id, note)
        VALUES (@id, CASE WHEN @card_id IS NULL THEN N'POINTS' ELSE N'STAMPS' END, @card_id, @valor, N'ADJUST', NULL, @user_id, @nota);
        COMMIT;
        RETURN;
    END
    ;THROW 51000, 'Acción no válida.', 1;
END;
GO

/* ---------- sp_loyalty_points_on_refund (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_points_on_refund (0064) =====================
   Una devolución deshace lo que la venta dio en Fidelización. Se llama desde
   sp_refund_sale, dentro de su transacción. Es ACUMULATIVA: cada vez mira
   todas las devoluciones de la venta y escribe solo la diferencia, así dos
   devoluciones parciales no revierten de más.

     · Puntos por compra: en proporción a lo devuelto (todo, si se devolvió
       la venta completa).
     · Puntos por visita: solo si se devolvió la venta completa.
     · Sellos: uno por unidad devuelta de los productos de la tarjeta.
     · Canjes: si se devuelve el producto canjeado -o la venta completa, en
       un canje de $ o %- el cliente recupera sus puntos o sellos.
     · Recompensas y cupones de campaña que la venta generó y no se han
       usado: se anulan si se devolvió la venta completa.

   El saldo puede quedar negativo (ganó, gastó y devolvió): es la deuda real
   del cliente y se ve tal cual en su historial.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_points_on_refund
    @refund_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @sale INT = (SELECT sale_id FROM dbo.sale_refunds WHERE id = @refund_id);
    IF @sale IS NULL RETURN;
    DECLARE @c INT, @total DECIMAL(12,2);
    SELECT @c = customer_id, @total = total FROM dbo.sales WHERE id = @sale;

    DECLARE @devuelto DECIMAL(12,2) = (SELECT ISNULL(SUM(refund_total), 0) FROM dbo.sale_refunds WHERE sale_id = @sale);
    DECLARE @dev TABLE (product_id INT PRIMARY KEY, q DECIMAL(12,2), q_cobrada DECIMAL(12,2));
    INSERT INTO @dev
    SELECT rd.product_id, SUM(rd.quantity), SUM(CASE WHEN rd.unitary_price > 0 THEN rd.quantity ELSE 0 END)
      FROM dbo.sale_refund_detail rd JOIN dbo.sale_refunds r ON r.id = rd.refund_id
     WHERE r.sale_id = @sale GROUP BY rd.product_id;
    DECLARE @completa BIT = CASE WHEN NOT EXISTS (
            SELECT 1 FROM (SELECT product_id, SUM(quantity) AS q FROM dbo.sale_detail WHERE sale_id = @sale GROUP BY product_id) s
              LEFT JOIN @dev d ON d.product_id = s.product_id
             WHERE ISNULL(d.q, 0) < s.q) THEN 1 ELSE 0 END;

    IF @completa = 1
    BEGIN
        UPDATE dbo.reward_instances SET status = 'VOID' WHERE sale_id = @sale AND status = 'ISSUED' AND uses_count = 0;
        UPDATE dbo.coupon_instances SET status = 'VOID' WHERE sale_id = @sale AND status = 'ISSUED' AND uses_count = 0;
    END

    IF @c IS NULL RETURN;

    /* Puntos por compra y por visita. */
    DECLARE @g_compra INT, @g_visita INT, @r_compra INT, @r_visita INT;
    SELECT @g_compra = ISNULL(SUM(CASE WHEN kind = N'EARN' AND reason = N'PURCHASE' THEN delta END), 0),
           @g_visita = ISNULL(SUM(CASE WHEN kind = N'EARN' AND reason = N'VISIT' THEN delta END), 0),
           @r_compra = ISNULL(-SUM(CASE WHEN kind = N'REVERSE' AND reason = N'PURCHASE' THEN delta END), 0),
           @r_visita = ISNULL(-SUM(CASE WHEN kind = N'REVERSE' AND reason = N'VISIT' THEN delta END), 0)
      FROM dbo.loyalty_ledger WHERE sale_id = @sale AND program = N'POINTS';

    DECLARE @obj_compra INT = CASE WHEN @completa = 1 THEN @g_compra
                                   WHEN @total > 0 THEN CAST(FLOOR(@g_compra * (@devuelto / @total)) AS INT) ELSE 0 END;
    IF @obj_compra > @g_compra SET @obj_compra = @g_compra;
    IF @obj_compra - @r_compra > 0
        INSERT INTO dbo.loyalty_ledger (customer_id, program, delta, kind, reason, sale_id, refund_id)
        VALUES (@c, N'POINTS', -(@obj_compra - @r_compra), N'REVERSE', N'PURCHASE', @sale, @refund_id);
    IF @completa = 1 AND @g_visita - @r_visita > 0
        INSERT INTO dbo.loyalty_ledger (customer_id, program, delta, kind, reason, sale_id, refund_id)
        VALUES (@c, N'POINTS', -(@g_visita - @r_visita), N'REVERSE', N'VISIT', @sale, @refund_id);

    /* Sellos por tarjeta. */
    INSERT INTO dbo.loyalty_ledger (customer_id, program, card_id, delta, kind, reason, sale_id, refund_id)
    SELECT @c, N'STAMPS', g.card_id, -(x.objetivo - g.revertido), N'REVERSE', N'PURCHASE', @sale, @refund_id
      FROM (SELECT card_id,
                   SUM(CASE WHEN kind = N'EARN' THEN delta ELSE 0 END) AS ganado,
                   ISNULL(-SUM(CASE WHEN kind = N'REVERSE' AND reason = N'PURCHASE' THEN delta ELSE 0 END), 0) AS revertido
              FROM dbo.loyalty_ledger WHERE sale_id = @sale AND program = N'STAMPS' GROUP BY card_id) g
     CROSS APPLY (SELECT CASE WHEN u.unidades > g.ganado THEN g.ganado ELSE u.unidades END AS objetivo
                    FROM (SELECT CAST(FLOOR(ISNULL(SUM(d.q_cobrada), 0)) AS INT) AS unidades
                            FROM @dev d JOIN dbo.loyalty_stamp_card_products cp ON cp.card_id = g.card_id AND cp.product_id = d.product_id) u) x
     WHERE g.ganado > 0 AND x.objetivo - g.revertido > 0;

    /* Canjes devueltos: se regresa lo gastado, una vez. */
    INSERT INTO dbo.loyalty_ledger (customer_id, program, card_id, delta, kind, reason, sale_id, sale_detail_id, reward_definition_id, refund_id)
    SELECT l.customer_id, l.program, l.card_id, -l.delta, N'REVERSE', N'CANJE', @sale, l.sale_detail_id, l.reward_definition_id, @refund_id
      FROM dbo.loyalty_ledger l
      LEFT JOIN dbo.sale_detail sd ON sd.id = l.sale_detail_id
     WHERE l.sale_id = @sale AND l.kind = N'REDEEM'
       AND ((l.sale_detail_id IS NOT NULL AND EXISTS (SELECT 1 FROM @dev d WHERE d.product_id = sd.product_id))
            OR (l.sale_detail_id IS NULL AND @completa = 1))
       AND NOT EXISTS (SELECT 1 FROM dbo.loyalty_ledger v
                        WHERE v.sale_id = @sale AND v.kind = N'REVERSE' AND v.reason = N'CANJE'
                          AND v.program = l.program AND ISNULL(v.card_id, 0) = ISNULL(l.card_id, 0));
END;
GO

/* ---------- sp_loyalty_stamp_card_save (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_loyalty_stamp_card_save (0064) =====================
   Alta o cambio de una tarjeta de sellos. `@products_json` = [id, id, ...]:
   los productos que sellan. `@reward_product_id` NULL = al llenarla se regala
   cualquiera de esos productos.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_loyalty_stamp_card_save
    @id INT = NULL,
    @name NVARCHAR(80),
    @stamps_required INT,
    @reward_product_id INT = NULL,
    @active BIT = 1,
    @products_json NVARCHAR(MAX) = N'[]'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @name = LTRIM(RTRIM(ISNULL(@name, N'')));
    IF @name = N'' THROW 51000, 'Ponle nombre a la tarjeta.', 1;
    IF ISNULL(@stamps_required, 0) NOT BETWEEN 2 AND 100 THROW 51000, 'Los sellos para llenarla van de 2 a 100.', 1;

    DECLARE @prods TABLE (product_id INT PRIMARY KEY);
    INSERT INTO @prods SELECT DISTINCT TRY_CONVERT(INT, value) FROM OPENJSON(ISNULL(@products_json, N'[]'))
     WHERE TRY_CONVERT(INT, value) IS NOT NULL;
    DELETE p FROM @prods p WHERE NOT EXISTS (SELECT 1 FROM dbo.products x WHERE x.id = p.product_id);
    IF NOT EXISTS (SELECT 1 FROM @prods) THROW 51000, 'Elige al menos un producto que selle la tarjeta.', 1;
    IF @reward_product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @reward_product_id)
        THROW 51000, 'El producto de regalo no existe.', 1;

    BEGIN TRAN;
    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.loyalty_stamp_cards (name, stamps_required, reward_product_id, active)
        VALUES (@name, @stamps_required, @reward_product_id, ISNULL(@active, 1));
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE dbo.loyalty_stamp_cards
           SET name = @name, stamps_required = @stamps_required, reward_product_id = @reward_product_id,
               active = ISNULL(@active, 1), origin = N'LOCAL', updated_at = SYSDATETIME()
         WHERE id = @id;
        IF @@ROWCOUNT = 0 THROW 51000, 'La tarjeta no existe.', 1;
    END
    DELETE FROM dbo.loyalty_stamp_card_products WHERE card_id = @id AND product_id NOT IN (SELECT product_id FROM @prods);
    INSERT INTO dbo.loyalty_stamp_card_products (card_id, product_id)
    SELECT @id, p.product_id FROM @prods p
     WHERE NOT EXISTS (SELECT 1 FROM dbo.loyalty_stamp_card_products x WHERE x.card_id = @id AND x.product_id = p.product_id);
    COMMIT;

    SELECT @id AS id;
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
    /* 0064: una venta en $0 (todo canjeado) no tiene pagos ni reparte dinero al devolverse. */
    END ELSE IF @refund_total>0 INSERT @rp VALUES(@payment_method,@refund_total);
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
    /* 0064: puntos, sellos, canjes y premios de campaña de esa venta. */
    EXEC dbo.sp_loyalty_points_on_refund @refund_id = @refund_id;

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
          /* 0064: también $ y %, que la cotización reparte entre los renglones. */
          IF ISNULL(TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(@cq,'$.coupon.amountApplied')),0)<=0 THROW 51000,'El cupón no aplicó a ningún producto.',1;
          UPDATE ci SET uses_count=ci.uses_count+1,status=CASE WHEN ci.uses_count+1>=ci.uses_allowed THEN 'REDEEMED' ELSE ci.status END,sale_id=ISNULL(ci.sale_id,@sale_id)
          FROM dbo.coupon_instances ci JOIN dbo.coupon_definitions cd ON cd.id=ci.definition_id
          WHERE ci.code=@coupon_code AND ci.id=TRY_CONVERT(INT,JSON_VALUE(@cq,'$.coupon.instanceId')) AND (cd.kind IN ('AMOUNT','PERCENT') OR (cd.kind='FREE_PRODUCT' AND cd.product_id=TRY_CONVERT(INT,JSON_VALUE(@cq,'$.coupon.productId')))) AND ci.status='ISSUED' AND cd.active=1 AND ci.uses_count<ci.uses_allowed AND (ci.expires_at IS NULL OR ci.expires_at>=SYSDATETIME());
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
        /* 12) Puntos y sellos (0064): el canje se descuenta aquí, con el
           saldo comprobado bajo candado. */
        EXEC dbo.sp_loyalty_points_apply_sale @sale_id = @sale_id, @customer_id = @customer_id,
             @user_id = @user_id, @quote = @cq;

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
