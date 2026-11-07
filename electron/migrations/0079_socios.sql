/* ============================================================
   0079 — socios

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0079_socios.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0079_socios.sql ========== */
/* ============================================================
   0079 — Socios y Propinas (esquema)

   Dos aplicaciones del nucleo (docs/socios.md). Solo existen para el negocio
   que las activa desde Aplicaciones:
   business_modules.module_key = 'socios' / 'propinas'.

   SOCIOS
   socios_config        las respuestas del asistente, una fila (id = 1).
   socios               de 2 a 10 activos. No se borran: se desactivan.
   socios_duenos        de quien es una CATEGORIA o un PRODUCTO, con %. Lo
                        del producto gana sobre lo de su categoria.
   socios_reparto       lo que le toco a cada socio de cada renglon vendido
                        (o devuelto). Se CONGELA al asignarse: cambiar la
                        regla, el dueno o un costo no reescribe lo vendido.
                        costo + ganancia = lo que le toca; la suma de todos
                        los socios es exactamente el ingreso del renglon.
   socios_gasto         a cargo de quien es un gasto y quien lo pago.
   socios_gasto_lineas  el % de cada socio cuando el gasto no es comun.
   socios_compra        una compra que pago un socio de su bolsa (sin fila:
                        la pago el negocio y es anticipo del dueno).
   socios_movimientos   retiros, aportaciones y pagos de saldo.
   socios_liquidaciones y sus lineas: un periodo cerrado, que ya no cambia.

   PROPINAS
   propinas_config      reparto, % sugeridos y comision de tarjeta (id = 1).
   propinas             una por venta. No es venta: no lleva IVA ni entra en
                        utilidad ni en socios.
   propinas_repartos    y sus lineas: lo que se pago a cada persona.

   Caja: cuatro tipos de movimiento nuevos (retiro y aportacion de socio,
   propina en efectivo y pago de propinas). El corte los suma como a todos.

   Aditiva: nada existente cambia.
   ============================================================ */

/* ----------------------------------------------------------- socios */
IF OBJECT_ID(N'dbo.socios', N'U') IS NULL
CREATE TABLE dbo.socios (
    id          INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_socios PRIMARY KEY CLUSTERED,
    nombre      NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    user_id     INT NULL,
    /* El % de los gastos comunes cuando la regla es FIJO. */
    pct_fijo    DECIMAL(7, 4) NULL,
    activo      BIT NOT NULL CONSTRAINT DF_socios_activo DEFAULT (1),
    orden       INT NOT NULL CONSTRAINT DF_socios_orden DEFAULT (0),
    created_at  DATETIME2(0) NOT NULL CONSTRAINT DF_socios_created DEFAULT (SYSDATETIME()),
    CONSTRAINT FK_socios_user FOREIGN KEY (user_id) REFERENCES dbo.users (id),
    CONSTRAINT CK_socios_nombre CHECK (LEN(LTRIM(RTRIM(nombre))) > 0),
    CONSTRAINT CK_socios_pct CHECK (pct_fijo IS NULL OR (pct_fijo >= 0 AND pct_fijo <= 100))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_socios_nombre' AND object_id = OBJECT_ID(N'dbo.socios'))
CREATE UNIQUE NONCLUSTERED INDEX UX_socios_nombre ON dbo.socios (nombre);
GO

IF OBJECT_ID(N'dbo.socios_config', N'U') IS NULL
CREATE TABLE dbo.socios_config (
    id              TINYINT NOT NULL CONSTRAINT PK_socios_config PRIMARY KEY CLUSTERED
                            CONSTRAINT CK_socios_config_id CHECK (id = 1),
    /* A = quien vende, B = quien aporta, C = mixta. Lo que cuenta es
       pct_vende: A = 100, B = 0, C = lo que se eligio. */
    regla           CHAR(1) NOT NULL CONSTRAINT DF_socios_config_regla DEFAULT ('C'),
    pct_vende       DECIMAL(5, 2) NOT NULL CONSTRAINT DF_socios_config_pct DEFAULT (30),
    gasto_regla     VARCHAR(8) NOT NULL CONSTRAINT DF_socios_config_gasto DEFAULT ('IGUALES'),
    faltante_regla  VARCHAR(8) NOT NULL CONSTRAINT DF_socios_config_falt DEFAULT ('VENTAS'),
    /* Productos sin dueno: a este socio; NULL = partes iguales. */
    sin_dueno_socio_id INT NULL,
    liquidacion     VARCHAR(8) NOT NULL CONSTRAINT DF_socios_config_liq DEFAULT ('SEMANAL'),
    /* Dia de cierre de la semana: 1 = lunes ... 7 = domingo. */
    dia_cierre      TINYINT NULL,
    inicio          DATE NOT NULL,
    updated_at      DATETIME2(0) NOT NULL CONSTRAINT DF_socios_config_upd DEFAULT (SYSDATETIME()),
    updated_by      INT NULL,
    CONSTRAINT FK_socios_config_sin_dueno FOREIGN KEY (sin_dueno_socio_id) REFERENCES dbo.socios (id),
    CONSTRAINT CK_socios_config_regla CHECK (regla IN ('A', 'B', 'C')),
    CONSTRAINT CK_socios_config_pct CHECK (pct_vende >= 0 AND pct_vende <= 100),
    CONSTRAINT CK_socios_config_gasto CHECK (gasto_regla IN ('IGUALES', 'FIJO', 'VENTAS')),
    CONSTRAINT CK_socios_config_falt CHECK (faltante_regla IN ('IGUALES', 'VENTAS')),
    CONSTRAINT CK_socios_config_liq CHECK (liquidacion IN ('SEMANAL', 'MENSUAL')),
    CONSTRAINT CK_socios_config_dia CHECK (dia_cierre IS NULL OR dia_cierre BETWEEN 1 AND 7)
);
GO

IF OBJECT_ID(N'dbo.socios_duenos', N'U') IS NULL
CREATE TABLE dbo.socios_duenos (
    entidad     VARCHAR(10) NOT NULL,
    entidad_id  INT NOT NULL,
    socio_id    INT NOT NULL,
    pct         DECIMAL(7, 4) NOT NULL,
    CONSTRAINT PK_socios_duenos PRIMARY KEY CLUSTERED (entidad, entidad_id, socio_id),
    CONSTRAINT FK_socios_duenos_socio FOREIGN KEY (socio_id) REFERENCES dbo.socios (id),
    CONSTRAINT CK_socios_duenos_entidad CHECK (entidad IN ('CATEGORIA', 'PRODUCTO')),
    CONSTRAINT CK_socios_duenos_pct CHECK (pct > 0 AND pct <= 100)
);
GO

IF OBJECT_ID(N'dbo.socios_reparto', N'U') IS NULL
CREATE TABLE dbo.socios_reparto (
    id               INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_socios_reparto PRIMARY KEY CLUSTERED,
    origen           VARCHAR(10) NOT NULL,
    sale_id          INT NOT NULL,
    sale_detail_id   INT NULL,
    refund_detail_id INT NULL,
    socio_id         INT NOT NULL,
    fecha            DATETIME2(0) NOT NULL,
    register_id      INT NULL,
    /* Lo que vendio como dueno del producto (ingreso x su %). Informativo. */
    ingreso          DECIMAL(14, 4) NOT NULL,
    /* El costo de sus insumos que gasto el renglon: se le devuelve. */
    costo            DECIMAL(14, 4) NOT NULL,
    ganancia         DECIMAL(14, 4) NOT NULL,
    total            AS (costo + ganancia) PERSISTED,
    CONSTRAINT FK_socios_reparto_socio FOREIGN KEY (socio_id) REFERENCES dbo.socios (id),
    CONSTRAINT FK_socios_reparto_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id),
    CONSTRAINT FK_socios_reparto_detail FOREIGN KEY (sale_detail_id) REFERENCES dbo.sale_detail (id),
    CONSTRAINT FK_socios_reparto_refund FOREIGN KEY (refund_detail_id) REFERENCES dbo.sale_refund_detail (id),
    CONSTRAINT CK_socios_reparto_origen CHECK (
        (origen = 'VENTA' AND sale_detail_id IS NOT NULL AND refund_detail_id IS NULL)
     OR (origen = 'DEVOLUCION' AND refund_detail_id IS NOT NULL AND sale_detail_id IS NULL))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_socios_reparto_venta' AND object_id = OBJECT_ID(N'dbo.socios_reparto'))
CREATE UNIQUE NONCLUSTERED INDEX UX_socios_reparto_venta ON dbo.socios_reparto (sale_detail_id, socio_id) WHERE (sale_detail_id IS NOT NULL);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_socios_reparto_devolucion' AND object_id = OBJECT_ID(N'dbo.socios_reparto'))
CREATE UNIQUE NONCLUSTERED INDEX UX_socios_reparto_devolucion ON dbo.socios_reparto (refund_detail_id, socio_id) WHERE (refund_detail_id IS NOT NULL);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_socios_reparto_fecha' AND object_id = OBJECT_ID(N'dbo.socios_reparto'))
CREATE NONCLUSTERED INDEX IX_socios_reparto_fecha ON dbo.socios_reparto (fecha) INCLUDE (socio_id, ingreso, costo, ganancia);
GO

IF OBJECT_ID(N'dbo.socios_gasto', N'U') IS NULL
CREATE TABLE dbo.socios_gasto (
    expense_id          INT NOT NULL CONSTRAINT PK_socios_gasto PRIMARY KEY CLUSTERED,
    /* SOCIOS = a cargo de los de socios_gasto_lineas; COMUN = con la regla. */
    modo                VARCHAR(8) NOT NULL,
    /* NULL = lo pago el negocio. Un socio = lo pago de su bolsa: aportacion. */
    pagado_por_socio_id INT NULL,
    CONSTRAINT FK_socios_gasto_expense FOREIGN KEY (expense_id) REFERENCES dbo.expenses (id),
    CONSTRAINT FK_socios_gasto_pagado FOREIGN KEY (pagado_por_socio_id) REFERENCES dbo.socios (id),
    CONSTRAINT CK_socios_gasto_modo CHECK (modo IN ('SOCIOS', 'COMUN'))
);
GO

IF OBJECT_ID(N'dbo.socios_gasto_lineas', N'U') IS NULL
CREATE TABLE dbo.socios_gasto_lineas (
    expense_id  INT NOT NULL,
    socio_id    INT NOT NULL,
    pct         DECIMAL(7, 4) NOT NULL,
    CONSTRAINT PK_socios_gasto_lineas PRIMARY KEY CLUSTERED (expense_id, socio_id),
    CONSTRAINT FK_socios_gasto_lineas_gasto FOREIGN KEY (expense_id) REFERENCES dbo.socios_gasto (expense_id) ON DELETE CASCADE,
    CONSTRAINT FK_socios_gasto_lineas_socio FOREIGN KEY (socio_id) REFERENCES dbo.socios (id),
    CONSTRAINT CK_socios_gasto_lineas_pct CHECK (pct > 0 AND pct <= 100)
);
GO

IF OBJECT_ID(N'dbo.socios_compra', N'U') IS NULL
CREATE TABLE dbo.socios_compra (
    purchase_id         INT NOT NULL CONSTRAINT PK_socios_compra PRIMARY KEY CLUSTERED,
    pagado_por_socio_id INT NOT NULL,
    CONSTRAINT FK_socios_compra_purchase FOREIGN KEY (purchase_id) REFERENCES dbo.purchase (id),
    CONSTRAINT FK_socios_compra_socio FOREIGN KEY (pagado_por_socio_id) REFERENCES dbo.socios (id)
);
GO

IF OBJECT_ID(N'dbo.socios_liquidaciones', N'U') IS NULL
CREATE TABLE dbo.socios_liquidaciones (
    id          INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_socios_liquidaciones PRIMARY KEY CLUSTERED,
    desde       DATE NOT NULL,
    hasta       DATE NOT NULL,
    created_at  DATETIME2(0) NOT NULL CONSTRAINT DF_socios_liquidaciones_created DEFAULT (SYSDATETIME()),
    user_id     INT NULL,
    CONSTRAINT CK_socios_liquidaciones_rango CHECK (desde <= hasta)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_socios_liquidaciones_desde' AND object_id = OBJECT_ID(N'dbo.socios_liquidaciones'))
CREATE UNIQUE NONCLUSTERED INDEX UX_socios_liquidaciones_desde ON dbo.socios_liquidaciones (desde);
GO

IF OBJECT_ID(N'dbo.socios_liquidacion_lineas', N'U') IS NULL
CREATE TABLE dbo.socios_liquidacion_lineas (
    liquidacion_id INT NOT NULL,
    socio_id       INT NOT NULL,
    vendido        DECIMAL(14, 2) NOT NULL,
    costo          DECIMAL(14, 2) NOT NULL,
    ganancia       DECIMAL(14, 2) NOT NULL,
    gastos         DECIMAL(14, 2) NOT NULL,
    anticipos      DECIMAL(14, 2) NOT NULL,
    aportaciones   DECIMAL(14, 2) NOT NULL,
    retiros        DECIMAL(14, 2) NOT NULL,
    faltantes      DECIMAL(14, 2) NOT NULL,
    resultado      DECIMAL(14, 2) NOT NULL,
    saldo_inicial  DECIMAL(14, 2) NOT NULL,
    saldo_final    DECIMAL(14, 2) NOT NULL,
    CONSTRAINT PK_socios_liquidacion_lineas PRIMARY KEY CLUSTERED (liquidacion_id, socio_id),
    CONSTRAINT FK_socios_liq_lineas_liq FOREIGN KEY (liquidacion_id) REFERENCES dbo.socios_liquidaciones (id),
    CONSTRAINT FK_socios_liq_lineas_socio FOREIGN KEY (socio_id) REFERENCES dbo.socios (id)
);
GO

IF OBJECT_ID(N'dbo.socios_movimientos', N'U') IS NULL
CREATE TABLE dbo.socios_movimientos (
    id                INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_socios_movimientos PRIMARY KEY CLUSTERED,
    socio_id          INT NOT NULL,
    fecha             DATETIME2(0) NOT NULL CONSTRAINT DF_socios_movimientos_fecha DEFAULT (SYSDATETIME()),
    /* RETIRO: se llevo dinero. PAGO: el negocio le pago su saldo.
       APORTACION: metio dinero suyo al negocio. */
    tipo              VARCHAR(12) NOT NULL,
    monto             DECIMAL(12, 2) NOT NULL,
    metodo            VARCHAR(20) NOT NULL,
    register_id       INT NULL,
    cash_movement_id  INT NULL,
    nota              NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    user_id           INT NULL,
    CONSTRAINT FK_socios_movimientos_socio FOREIGN KEY (socio_id) REFERENCES dbo.socios (id),
    CONSTRAINT FK_socios_movimientos_cash FOREIGN KEY (cash_movement_id) REFERENCES dbo.cash_movements (id),
    CONSTRAINT CK_socios_movimientos_tipo CHECK (tipo IN ('RETIRO', 'PAGO', 'APORTACION')),
    CONSTRAINT CK_socios_movimientos_monto CHECK (monto > 0),
    CONSTRAINT CK_socios_movimientos_metodo CHECK (metodo IN ('EFECTIVO', 'TRANSFERENCIA', 'OTRO')),
    CONSTRAINT CK_socios_movimientos_cash CHECK (metodo <> 'EFECTIVO' OR cash_movement_id IS NOT NULL)
);
GO

/* --------------------------------------------------------- propinas */
IF OBJECT_ID(N'dbo.propinas_config', N'U') IS NULL
CREATE TABLE dbo.propinas_config (
    id            TINYINT NOT NULL CONSTRAINT PK_propinas_config PRIMARY KEY CLUSTERED
                          CONSTRAINT CK_propinas_config_id CHECK (id = 1),
    reparto       VARCHAR(8) NOT NULL CONSTRAINT DF_propinas_config_reparto DEFAULT ('HORAS'),
    sugeridas     VARCHAR(40) NOT NULL CONSTRAINT DF_propinas_config_sug DEFAULT ('10,15,20'),
    comision_pct  DECIMAL(5, 2) NOT NULL CONSTRAINT DF_propinas_config_com DEFAULT (0),
    /* Quien paga la comision de tarjeta sobre la propina. */
    comision_a    VARCHAR(8) NOT NULL CONSTRAINT DF_propinas_config_coma DEFAULT ('NEGOCIO'),
    updated_at    DATETIME2(0) NOT NULL CONSTRAINT DF_propinas_config_upd DEFAULT (SYSDATETIME()),
    updated_by    INT NULL,
    CONSTRAINT CK_propinas_config_reparto CHECK (reparto IN ('ATENDIO', 'HORAS', 'IGUALES')),
    CONSTRAINT CK_propinas_config_com CHECK (comision_pct >= 0 AND comision_pct <= 20),
    CONSTRAINT CK_propinas_config_coma CHECK (comision_a IN ('NEGOCIO', 'PROPINA'))
);
GO

IF OBJECT_ID(N'dbo.propinas_repartos', N'U') IS NULL
CREATE TABLE dbo.propinas_repartos (
    id           INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_propinas_repartos PRIMARY KEY CLUSTERED,
    register_id  INT NOT NULL,
    closure_id   INT NULL,
    desde        DATETIME2(0) NOT NULL,
    hasta        DATETIME2(0) NOT NULL,
    modo         VARCHAR(8) NOT NULL,
    total        DECIMAL(12, 2) NOT NULL,
    comision     DECIMAL(12, 2) NOT NULL,
    neto         DECIMAL(12, 2) NOT NULL,
    user_id      INT NULL,
    created_at   DATETIME2(0) NOT NULL CONSTRAINT DF_propinas_repartos_created DEFAULT (SYSDATETIME()),
    CONSTRAINT FK_propinas_repartos_register FOREIGN KEY (register_id) REFERENCES dbo.registers (id)
);
GO

IF OBJECT_ID(N'dbo.propinas', N'U') IS NULL
CREATE TABLE dbo.propinas (
    id                INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_propinas PRIMARY KEY CLUSTERED,
    sale_id           INT NOT NULL,
    monto             DECIMAL(10, 2) NOT NULL,
    metodo            VARCHAR(12) NOT NULL,
    /* Quien atendio: el usuario que cobro. */
    user_id           INT NOT NULL,
    register_id       INT NOT NULL,
    closure_id        INT NULL,
    fecha             DATETIME2(0) NOT NULL CONSTRAINT DF_propinas_fecha DEFAULT (SYSDATETIME()),
    cash_movement_id  INT NULL,
    reparto_id        INT NULL,
    CONSTRAINT FK_propinas_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id),
    CONSTRAINT FK_propinas_user FOREIGN KEY (user_id) REFERENCES dbo.users (id),
    CONSTRAINT FK_propinas_register FOREIGN KEY (register_id) REFERENCES dbo.registers (id),
    CONSTRAINT FK_propinas_cash FOREIGN KEY (cash_movement_id) REFERENCES dbo.cash_movements (id),
    CONSTRAINT FK_propinas_reparto FOREIGN KEY (reparto_id) REFERENCES dbo.propinas_repartos (id),
    CONSTRAINT CK_propinas_monto CHECK (monto > 0),
    CONSTRAINT CK_propinas_metodo CHECK (metodo IN ('EFECTIVO', 'TARJETA')),
    CONSTRAINT CK_propinas_cash CHECK (metodo <> 'EFECTIVO' OR cash_movement_id IS NOT NULL)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_propinas_sale' AND object_id = OBJECT_ID(N'dbo.propinas'))
CREATE UNIQUE NONCLUSTERED INDEX UX_propinas_sale ON dbo.propinas (sale_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_propinas_pendientes' AND object_id = OBJECT_ID(N'dbo.propinas'))
CREATE NONCLUSTERED INDEX IX_propinas_pendientes ON dbo.propinas (register_id, fecha) WHERE (reparto_id IS NULL);
GO

IF OBJECT_ID(N'dbo.propinas_reparto_lineas', N'U') IS NULL
CREATE TABLE dbo.propinas_reparto_lineas (
    reparto_id        INT NOT NULL,
    user_id           INT NOT NULL,
    horas             DECIMAL(9, 2) NULL,
    monto             DECIMAL(12, 2) NOT NULL,
    cash_movement_id  INT NULL,
    CONSTRAINT PK_propinas_reparto_lineas PRIMARY KEY CLUSTERED (reparto_id, user_id),
    CONSTRAINT FK_propinas_reparto_lineas_reparto FOREIGN KEY (reparto_id) REFERENCES dbo.propinas_repartos (id),
    CONSTRAINT FK_propinas_reparto_lineas_user FOREIGN KEY (user_id) REFERENCES dbo.users (id),
    CONSTRAINT FK_propinas_reparto_lineas_cash FOREIGN KEY (cash_movement_id) REFERENCES dbo.cash_movements (id)
);
GO

/* ------------------------------------------------- tipos de caja */
MERGE dbo.cash_movement_types AS t
USING (VALUES
    ('PARTNER_OUT', N'Retiro de socio',        'RETIROS',  72),
    ('PARTNER_IN',  N'Aportacion de socio',    'ENTRADAS', 52),
    ('TIP',         N'Propina en efectivo',    'ENTRADAS', 54),
    ('TIP_PAYOUT',  N'Pago de propinas',       'RETIROS',  74)
) AS s (code, label, grupo, sort_order)
ON t.code = s.code
WHEN NOT MATCHED THEN
    INSERT (code, label, grupo, sort_order) VALUES (s.code, s.label, s.grupo, s.sort_order);
GO

/* ---------- sp_propina_registrar (SQL_STORED_PROCEDURE) ---------- */
/* sp_propina_registrar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================= sp_propina_registrar (0079) ======================
   La propina de una venta. La llama el canal de cobro justo despues de que
   la venta quedo registrada. Una por venta.

   No es venta: no toca sales ni sale_detail, no lleva IVA, no entra en
   utilidad ni en el reparto de socios.

   EFECTIVO  entra al cajon del turno abierto de la caja de la venta
             (movimiento TIP): el corte la espera.
   TARJETA   llega al banco: no toca el cajon hasta que se paga el reparto.

   Quien atendio es quien cobro la venta.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_propina_registrar
    @sale_id INT,
    @monto   DECIMAL(10, 2),
    @metodo  VARCHAR(12),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'propinas' AND enabled = 1)
        THROW 51000, N'Propinas no está activado.', 1;
    SET @metodo = UPPER(LTRIM(RTRIM(ISNULL(@metodo, ''))));
    IF @metodo NOT IN ('EFECTIVO', 'TARJETA') THROW 51000, N'La propina es en efectivo o con tarjeta.', 1;
    IF @monto IS NULL OR @monto <= 0 THROW 51000, N'La propina debe ser mayor a cero.', 1;

    DECLARE @register INT, @atendio INT, @total DECIMAL(10, 2);
    SELECT @register = register_id, @atendio = useer_id, @total = total FROM dbo.sales WHERE id = @sale_id;
    IF @atendio IS NULL THROW 51000, N'Esa venta no existe.', 1;
    IF @monto > ISNULL(@total, 0) THROW 51000, N'La propina no puede ser mayor que la cuenta.', 1;

    DECLARE @closure INT, @cash_id INT = NULL, @id INT;
    BEGIN TRAN;
        IF EXISTS (SELECT 1 FROM dbo.propinas WITH (UPDLOCK, HOLDLOCK) WHERE sale_id = @sale_id)
            THROW 51000, N'Esa venta ya tiene propina.', 1;

        SELECT TOP (1) @closure = id FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
         WHERE register_id = @register AND closed_at IS NULL
         ORDER BY opened_at DESC, id DESC;

        IF @metodo = 'EFECTIVO'
        BEGIN
            IF @closure IS NULL THROW 51000, N'No hay un turno abierto en esta caja para recibir la propina.', 1;
            INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES (GETDATE(), ISNULL(@user_id, @atendio), 'TIP', @sale_id, CONCAT(N'PROPINA VENTA ', @sale_id),
                    @monto, N'Propina en efectivo', @closure, @register);
            SET @cash_id = SCOPE_IDENTITY();
        END

        INSERT INTO dbo.propinas (sale_id, monto, metodo, user_id, register_id, closure_id, fecha, cash_movement_id)
        VALUES (@sale_id, @monto, @metodo, @atendio, @register, @closure, SYSDATETIME(), @cash_id);
        SET @id = SCOPE_IDENTITY();
    COMMIT;

    SELECT id, sale_id, monto, metodo, user_id, register_id, closure_id, fecha, cash_movement_id
      FROM dbo.propinas WHERE id = @id;
END
GO

/* ---------- sp_propinas_config_get (SQL_STORED_PROCEDURE) ---------- */
/* sp_propinas_config_get
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_propinas_config_get (0079) =====================
   La configuracion de Propinas y si esta encendido. Sin fila: nunca se
   activo.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_propinas_config_get
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.reparto, c.sugeridas, c.comision_pct, c.comision_a, c.updated_at,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'propinas' AND enabled = 1)
                     THEN 1 ELSE 0 END AS BIT) AS activo
      FROM dbo.propinas_config c WHERE c.id = 1;
END
GO

/* ---------- sp_propinas_config_guardar (SQL_STORED_PROCEDURE) ---------- */
/* sp_propinas_config_guardar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ==================== sp_propinas_config_guardar (0079) ===================
   Las respuestas de "Activar Propinas". @activar = 1 guarda Y enciende el
   modulo en la misma transaccion; @activar = 0 cambia un modulo encendido.

   @reparto      ATENDIO  a quien cobro la venta
                 HORAS    bote del turno por horas trabajadas (Asistencia)
                 IGUALES  bote del turno en partes iguales
   @sugeridas    los botones de %, p. ej. '10,15,20' (de 1 a 4, de 1 a 50)
   @comision_pct comision del banco sobre la propina con tarjeta (0 a 20)
   @comision_a   NEGOCIO la absorbe; PROPINA se descuenta de la propina
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_propinas_config_guardar
    @reparto      VARCHAR(8),
    @sugeridas    VARCHAR(40),
    @comision_pct DECIMAL(5, 2) = 0,
    @comision_a   VARCHAR(8) = 'NEGOCIO',
    @activar      BIT = 0,
    @user_id      INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @reparto = UPPER(LTRIM(RTRIM(ISNULL(@reparto, ''))));
    SET @comision_a = UPPER(LTRIM(RTRIM(ISNULL(@comision_a, 'NEGOCIO'))));
    IF @reparto NOT IN ('ATENDIO', 'HORAS', 'IGUALES') THROW 51000, N'Elige cómo se reparten las propinas.', 1;
    IF @comision_a NOT IN ('NEGOCIO', 'PROPINA') THROW 51000, N'Elige quién paga la comisión de tarjeta.', 1;
    IF @comision_pct IS NULL OR @comision_pct < 0 OR @comision_pct > 20 THROW 51000, N'La comisión va de 0 a 20 %.', 1;

    DECLARE @s TABLE (n INT);
    INSERT INTO @s (n) SELECT TRY_CAST(LTRIM(RTRIM(value)) AS INT) FROM STRING_SPLIT(ISNULL(@sugeridas, ''), ',')
     WHERE LTRIM(RTRIM(value)) <> '';
    IF NOT EXISTS (SELECT 1 FROM @s) OR (SELECT COUNT(*) FROM @s) > 4
       OR EXISTS (SELECT 1 FROM @s WHERE n IS NULL OR n < 1 OR n > 50)
        THROW 51000, N'Los porcentajes sugeridos son de 1 a 4 números entre 1 y 50.', 1;
    SET @sugeridas = (SELECT STRING_AGG(CAST(n AS VARCHAR(3)), ',') WITHIN GROUP (ORDER BY n) FROM (SELECT DISTINCT n FROM @s) x);

    IF ISNULL(@activar, 0) = 0
       AND NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'propinas' AND enabled = 1)
        THROW 51000, N'Propinas no está activado.', 1;

    BEGIN TRAN;
        MERGE dbo.propinas_config AS d
        USING (SELECT CAST(1 AS TINYINT) AS id) AS s ON d.id = s.id
        WHEN MATCHED THEN UPDATE SET reparto = @reparto, sugeridas = @sugeridas, comision_pct = @comision_pct,
             comision_a = @comision_a, updated_at = SYSDATETIME(), updated_by = @user_id
        WHEN NOT MATCHED THEN INSERT (id, reparto, sugeridas, comision_pct, comision_a, updated_at, updated_by)
             VALUES (1, @reparto, @sugeridas, @comision_pct, @comision_a, SYSDATETIME(), @user_id);

        IF @activar = 1
        BEGIN
            DECLARE @r TABLE (module_key NVARCHAR(40), enabled BIT, enabled_at DATETIME2(0), enabled_by INT, updated_at DATETIME2(0));
            INSERT INTO @r EXEC dbo.sp_set_business_module @module_key = N'propinas', @enabled = 1, @user_id = @user_id;
        END
    COMMIT;

    EXEC dbo.sp_propinas_config_get;
END
GO

/* ---------- sp_propinas_historial (SQL_STORED_PROCEDURE) ---------- */
/* sp_propinas_historial
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_propinas_historial (0079) ======================
   Las propinas de un rango de dias y como se repartieron.

   recordset 1  las propinas (con quien atendio y si ya se repartio)
   recordset 2  los repartos
   recordset 3  las lineas de esos repartos
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_propinas_historial
    @desde DATE,
    @hasta DATE,
    @register_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @fin DATETIME2(0) = DATEADD(DAY, 1, CAST(@hasta AS DATETIME2(0)));

    SELECT p.id, p.sale_id, p.monto, p.metodo, p.user_id, u.usuario, p.register_id, p.fecha, p.reparto_id
      FROM dbo.propinas p JOIN dbo.users u ON u.id = p.user_id
     WHERE p.fecha >= @desde AND p.fecha < @fin
       AND (@register_id IS NULL OR p.register_id = @register_id)
     ORDER BY p.fecha DESC;

    SELECT r.id, r.register_id, r.desde, r.hasta, r.modo, r.total, r.comision, r.neto, r.created_at, u.usuario
      FROM dbo.propinas_repartos r LEFT JOIN dbo.users u ON u.id = r.user_id
     WHERE r.created_at >= @desde AND r.created_at < @fin
       AND (@register_id IS NULL OR r.register_id = @register_id)
     ORDER BY r.created_at DESC;

    SELECT l.reparto_id, l.user_id, u.usuario, l.horas, l.monto
      FROM dbo.propinas_reparto_lineas l
      JOIN dbo.propinas_repartos r ON r.id = l.reparto_id
      JOIN dbo.users u ON u.id = l.user_id
     WHERE r.created_at >= @desde AND r.created_at < @fin
       AND (@register_id IS NULL OR r.register_id = @register_id)
     ORDER BY l.reparto_id DESC, l.monto DESC;
END
GO

/* ---------- sp_propinas_repartir (SQL_STORED_PROCEDURE) ---------- */
/* sp_propinas_repartir
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================= sp_propinas_repartir (0079) ======================
   Reparte las propinas pendientes de una caja entre el personal.

   @confirmar = 0  solo calcula: lo que le tocaria a cada quien.
   @confirmar = 1  lo paga: una salida del cajon (TIP_PAYOUT) por persona en
                   el turno abierto, y las propinas quedan repartidas.

   Ventana: de la primera propina pendiente a ahora.
   Comision: si la paga la propina, se le quita a la de tarjeta.
   Modo (propinas_config.reparto):
     ATENDIO  a cada quien lo que cobro (menos su comision);
     HORAS    el bote por horas trabajadas en la ventana (Asistencia);
     IGUALES  el bote en partes iguales entre quienes trabajaron.
   Sin jornadas en la ventana (Asistencia apagada, nadie checo), el bote va
   en partes iguales entre quienes cobraron propina.
   A centavos: lo que deja el redondeo se le suma al que mas recibe.

   recordset 1  el reparto (total, comision, neto, ventana, modo, id)
   recordset 2  una fila por persona (user_id, usuario, horas, monto)
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_propinas_repartir
    @register_id INT,
    @user_id     INT = NULL,
    @confirmar   BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'propinas' AND enabled = 1)
        THROW 51000, N'Propinas no está activado.', 1;
    DECLARE @modo VARCHAR(8), @pct DECIMAL(5, 2), @coma VARCHAR(8);
    SELECT @modo = reparto, @pct = comision_pct, @coma = comision_a FROM dbo.propinas_config WHERE id = 1;

    DECLARE @closure INT = NULL, @reparto INT = NULL;
    IF @confirmar = 1 BEGIN TRAN;

    CREATE TABLE #p (id INT PRIMARY KEY, monto DECIMAL(12, 2), comision DECIMAL(12, 4), user_id INT, fecha DATETIME2(0));
    IF @confirmar = 1
        INSERT INTO #p SELECT id, monto, CASE WHEN metodo = 'TARJETA' AND @coma = 'PROPINA' THEN monto * @pct / 100 ELSE 0 END, user_id, fecha
          FROM dbo.propinas WITH (UPDLOCK, HOLDLOCK) WHERE register_id = @register_id AND reparto_id IS NULL;
    ELSE
        INSERT INTO #p SELECT id, monto, CASE WHEN metodo = 'TARJETA' AND @coma = 'PROPINA' THEN monto * @pct / 100 ELSE 0 END, user_id, fecha
          FROM dbo.propinas WHERE register_id = @register_id AND reparto_id IS NULL;

    DECLARE @desde DATETIME2(0) = (SELECT MIN(fecha) FROM #p), @hasta DATETIME2(0) = SYSDATETIME();
    DECLARE @total DECIMAL(12, 2) = ISNULL((SELECT SUM(monto) FROM #p), 0);
    DECLARE @comision DECIMAL(12, 2) = ROUND(ISNULL((SELECT SUM(comision) FROM #p), 0), 2);
    DECLARE @neto DECIMAL(12, 2) = @total - @comision;

    CREATE TABLE #r (user_id INT PRIMARY KEY, horas DECIMAL(9, 2) NULL, w DECIMAL(18, 8) NOT NULL, monto DECIMAL(12, 2) NOT NULL DEFAULT 0);

    IF @total > 0
    BEGIN
        IF @modo = 'ATENDIO'
            INSERT INTO #r (user_id, horas, w)
            SELECT user_id, NULL, 0 FROM #p GROUP BY user_id;
        ELSE
        BEGIN
            /* Horas de cada quien dentro de la ventana. */
            INSERT INTO #r (user_id, horas, w)
            SELECT j.user_id,
                   CAST(SUM(DATEDIFF(MINUTE,
                        CASE WHEN j.entrada_en > @desde THEN j.entrada_en ELSE @desde END,
                        CASE WHEN ISNULL(j.salida_en, @hasta) < @hasta THEN ISNULL(j.salida_en, @hasta) ELSE @hasta END)) / 60.0 AS DECIMAL(9, 2)),
                   0
              FROM dbo.asistencia_jornadas j
             WHERE j.entrada_en < @hasta AND ISNULL(j.salida_en, @hasta) > @desde
             GROUP BY j.user_id
            HAVING SUM(DATEDIFF(MINUTE,
                        CASE WHEN j.entrada_en > @desde THEN j.entrada_en ELSE @desde END,
                        CASE WHEN ISNULL(j.salida_en, @hasta) < @hasta THEN ISNULL(j.salida_en, @hasta) ELSE @hasta END)) > 0;

            IF NOT EXISTS (SELECT 1 FROM #r)
                INSERT INTO #r (user_id, horas, w) SELECT DISTINCT user_id, NULL, 0 FROM #p;

            DECLARE @h DECIMAL(18, 4) = (SELECT SUM(horas) FROM #r);
            IF @modo = 'HORAS' AND ISNULL(@h, 0) > 0
                UPDATE #r SET w = horas / @h;
            ELSE
                UPDATE #r SET w = 1.0 / (SELECT COUNT(*) FROM #r);
        END

        IF @modo = 'ATENDIO'
            UPDATE r SET w = x.m / NULLIF(@neto, 0)
              FROM #r r JOIN (SELECT user_id, SUM(monto - comision) AS m FROM #p GROUP BY user_id) x ON x.user_id = r.user_id;

        UPDATE #r SET monto = ROUND(@neto * w, 2);
        ;WITH m AS (SELECT TOP (1) user_id FROM #r ORDER BY monto DESC, user_id)
        UPDATE r SET monto = r.monto + (@neto - (SELECT SUM(monto) FROM #r))
          FROM #r r JOIN m ON m.user_id = r.user_id;
        DELETE FROM #r WHERE monto <= 0;
    END

    IF @confirmar = 1
    BEGIN
        IF @total <= 0 THROW 51000, N'No hay propinas pendientes en esta caja.', 1;
        SELECT TOP (1) @closure = id FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
         WHERE register_id = @register_id AND closed_at IS NULL
         ORDER BY opened_at DESC, id DESC;
        IF @closure IS NULL THROW 51000, N'Abre el turno de esta caja para pagar las propinas.', 1;

        INSERT INTO dbo.propinas_repartos (register_id, closure_id, desde, hasta, modo, total, comision, neto, user_id)
        VALUES (@register_id, @closure, @desde, @hasta, @modo, @total, @comision, @neto, @user_id);
        SET @reparto = SCOPE_IDENTITY();

        INSERT INTO dbo.propinas_reparto_lineas (reparto_id, user_id, horas, monto)
        SELECT @reparto, user_id, horas, monto FROM #r;

        /* Una salida del cajon por persona, ligada a su linea. */
        DECLARE @u INT, @m DECIMAL(12, 2), @nombre NVARCHAR(50), @cash INT;
        DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT r.user_id, r.monto, u.usuario FROM #r r JOIN dbo.users u ON u.id = r.user_id;
        OPEN c;
        FETCH NEXT FROM c INTO @u, @m, @nombre;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES (GETDATE(), @user_id, 'TIP_PAYOUT', @reparto, CONCAT(N'PROPINAS ', @reparto), -@m,
                    LEFT(CONCAT(N'Propinas de ', @nombre), 200), @closure, @register_id);
            SET @cash = SCOPE_IDENTITY();
            UPDATE dbo.propinas_reparto_lineas SET cash_movement_id = @cash WHERE reparto_id = @reparto AND user_id = @u;
            FETCH NEXT FROM c INTO @u, @m, @nombre;
        END
        CLOSE c; DEALLOCATE c;

        UPDATE p SET reparto_id = @reparto FROM dbo.propinas p JOIN #p x ON x.id = p.id;
        COMMIT;
    END

    SELECT @reparto AS reparto_id, @register_id AS register_id, @modo AS modo, @desde AS desde, @hasta AS hasta,
           @total AS total, @comision AS comision, @neto AS neto, (SELECT COUNT(*) FROM #p) AS propinas;
    SELECT r.user_id, u.usuario, r.horas, r.monto
      FROM #r r JOIN dbo.users u ON u.id = r.user_id
     ORDER BY r.monto DESC, u.usuario;
END
GO

/* ---------- sp_socios_asignar (SQL_STORED_PROCEDURE) ---------- */
/* sp_socios_asignar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================== sp_socios_asignar (0079) ========================
   Reparte entre los socios cada renglon vendido (y devuelto) que todavia no
   tiene reparto. Lo que reparte queda CONGELADO en socios_reparto.

   La llama la caja despues de cada venta (@sale_id) y todo resumen antes de
   leer (@sale_id NULL = todo lo pendiente). Es idempotente: un renglon ya
   repartido no se vuelve a tocar.

   POR RENGLON (docs/socios.md 1.3)
     R      ingreso = cantidad x precio cobrado.
     C(s)   costo de los insumos del socio s que gasto el renglon: los
            movimientos de inventario de ESA linea, al costo que guardo la
            venta. Sin movimientos (venta esencial, producto sin
            inventario) el costo del renglon es del dueno del producto.
     V(s)   % del socio s como dueno del producto vendido.
     A(s)   C(s) / costo total; sin costo, V(s).
     k      pct_vende / 100 (A = 1, B = 0, C = lo elegido).
     G(s)   (R - costo total) x (k V(s) + (1 - k) A(s)).
     s recibe C(s) + G(s). La suma de todos es R, al centavo de centavo: lo
     que deja el redondeo se le suma al que mas recibe.

   DEVOLUCION: el reparto de los renglones de ese producto en la venta
   original, en negativo, en proporcion a lo devuelto.

   Solo cuenta lo vendido desde socios_config.inicio.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_asignar
    @sale_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
        RETURN;
    DECLARE @inicio DATE, @k DECIMAL(9, 6);
    SELECT @inicio = inicio, @k = pct_vende / 100.0 FROM dbo.socios_config WHERE id = 1;
    IF @inicio IS NULL RETURN;
    IF NOT EXISTS (SELECT 1 FROM dbo.socios WHERE activo = 1) RETURN;

    /* ---------------------------------------------------------- renglones */
    CREATE TABLE #l (
        detail_id   INT NOT NULL PRIMARY KEY,
        sale_id     INT NOT NULL,
        fecha       DATETIME2(0) NOT NULL,
        register_id INT NULL,
        product_id  INT NOT NULL,
        r           DECIMAL(18, 6) NOT NULL,
        line_cost   DECIMAL(18, 6) NOT NULL
    );
    INSERT INTO #l (detail_id, sale_id, fecha, register_id, product_id, r, line_cost)
    SELECT d.id, s.id, CAST(s.datee AS DATETIME2(0)), s.register_id, d.product_id,
           d.quantity * d.unitary_price, ISNULL(d.quantity * d.unit_cost, 0)
      FROM dbo.sale_detail d
      JOIN dbo.sales s ON s.id = d.sale_id
     WHERE s.datee >= @inicio
       AND (@sale_id IS NULL OR s.id = @sale_id)
       AND NOT EXISTS (SELECT 1 FROM dbo.socios_reparto x WHERE x.sale_detail_id = d.id);

    CREATE TABLE #duenos (product_id INT NOT NULL, socio_id INT NOT NULL, pct DECIMAL(9, 6) NOT NULL,
                          PRIMARY KEY (product_id, socio_id));

    CREATE TABLE #rep (
        detail_id INT NOT NULL,
        socio_id  INT NOT NULL,
        ingreso   DECIMAL(18, 6) NOT NULL,
        costo     DECIMAL(18, 6) NOT NULL,
        ganancia  DECIMAL(18, 6) NOT NULL,
        PRIMARY KEY (detail_id, socio_id)
    );

    IF EXISTS (SELECT 1 FROM #l)
    BEGIN
        EXEC dbo.sp_socios_llenar_duenos;

        /* Costo de cada socio por renglon. */
        CREATE TABLE #c (detail_id INT NOT NULL, socio_id INT NOT NULL, costo DECIMAL(18, 6) NOT NULL,
                         PRIMARY KEY (detail_id, socio_id));
        INSERT INTO #c (detail_id, socio_id, costo)
        SELECT m.sale_detail_id, o.socio_id, SUM(m.quantity * ISNULL(m.unit_cost, 0) * o.pct)
          FROM dbo.inventory_movements m
          JOIN #l l ON l.detail_id = m.sale_detail_id
          JOIN #duenos o ON o.product_id = m.product_id
         WHERE m.source IN ('SALE', 'RECIPE')
         GROUP BY m.sale_detail_id, o.socio_id;

        INSERT INTO #c (detail_id, socio_id, costo)
        SELECT l.detail_id, o.socio_id, l.line_cost * o.pct
          FROM #l l
          JOIN #duenos o ON o.product_id = l.product_id
         WHERE NOT EXISTS (SELECT 1 FROM dbo.inventory_movements m
                            WHERE m.sale_detail_id = l.detail_id AND m.source IN ('SALE', 'RECIPE'));

        /* Todos los socios que tocan el renglon: vende o aporta. */
        ;WITH socios_linea AS (
            SELECT l.detail_id, o.socio_id FROM #l l JOIN #duenos o ON o.product_id = l.product_id
            UNION
            SELECT detail_id, socio_id FROM #c
        ),
        tot AS (
            SELECT l.detail_id, l.r, ISNULL(SUM(c.costo), 0) AS ctot
              FROM #l l LEFT JOIN #c c ON c.detail_id = l.detail_id
             GROUP BY l.detail_id, l.r
        )
        INSERT INTO #rep (detail_id, socio_id, ingreso, costo, ganancia)
        SELECT x.detail_id, x.socio_id,
               t.r * ISNULL(v.pct, 0),
               ISNULL(c.costo, 0),
               (t.r - t.ctot) * (@k * ISNULL(v.pct, 0)
                   + (1 - @k) * CASE WHEN t.ctot > 0 THEN ISNULL(c.costo, 0) / t.ctot ELSE ISNULL(v.pct, 0) END)
          FROM socios_linea x
          JOIN tot t ON t.detail_id = x.detail_id
          JOIN #l l ON l.detail_id = x.detail_id
          LEFT JOIN #duenos v ON v.product_id = l.product_id AND v.socio_id = x.socio_id
          LEFT JOIN #c c ON c.detail_id = x.detail_id AND c.socio_id = x.socio_id;

        /* A cuatro decimales, y lo que deja el redondeo al que mas recibe. */
        UPDATE #rep SET ingreso = ROUND(ingreso, 4), costo = ROUND(costo, 4), ganancia = ROUND(ganancia, 4);
        ;WITH dif AS (
            SELECT l.detail_id, ROUND(l.r, 4) - SUM(p.costo + p.ganancia) AS d,
                   ROUND(l.r, 4) - SUM(p.ingreso) AS di
              FROM #l l JOIN #rep p ON p.detail_id = l.detail_id
             GROUP BY l.detail_id, l.r
        ),
        mayor AS (
            SELECT detail_id, socio_id,
                   ROW_NUMBER() OVER (PARTITION BY detail_id ORDER BY costo + ganancia DESC, socio_id) AS n
              FROM #rep
        )
        UPDATE p SET ganancia = p.ganancia + d.d,
                     ingreso = CASE WHEN p.ingreso <> 0 OR d.di <> 0 THEN p.ingreso + d.di ELSE p.ingreso END
          FROM #rep p
          JOIN mayor m ON m.detail_id = p.detail_id AND m.socio_id = p.socio_id AND m.n = 1
          JOIN dif d ON d.detail_id = p.detail_id
         WHERE d.d <> 0 OR d.di <> 0;
    END

    /* -------------------------------------------------------- devoluciones */
    CREATE TABLE #dv (
        refund_detail_id INT NOT NULL PRIMARY KEY,
        sale_id     INT NOT NULL,
        product_id  INT NOT NULL,
        fecha       DATETIME2(0) NOT NULL,
        register_id INT NULL,
        monto       DECIMAL(18, 6) NOT NULL
    );
    INSERT INTO #dv (refund_detail_id, sale_id, product_id, fecha, register_id, monto)
    SELECT rd.id, r.sale_id, rd.product_id, r.datee, r.register_id,
           ISNULL(rd.commercial_amount, rd.quantity * rd.unitary_price)
      FROM dbo.sale_refund_detail rd
      JOIN dbo.sale_refunds r ON r.id = rd.refund_id
      JOIN dbo.sales s ON s.id = r.sale_id
     WHERE s.datee >= @inicio
       AND (@sale_id IS NULL OR r.sale_id = @sale_id)
       AND NOT EXISTS (SELECT 1 FROM dbo.socios_reparto x WHERE x.refund_detail_id = rd.id);

    CREATE TABLE #rdv (
        refund_detail_id INT NOT NULL,
        socio_id  INT NOT NULL,
        ingreso   DECIMAL(18, 6) NOT NULL,
        costo     DECIMAL(18, 6) NOT NULL,
        ganancia  DECIMAL(18, 6) NOT NULL,
        PRIMARY KEY (refund_detail_id, socio_id)
    );

    IF EXISTS (SELECT 1 FROM #dv)
    BEGIN
        /* Lo que ya estaba repartido de ese producto en la venta original
           (lo congelado y lo que se acaba de repartir arriba). */
        ;WITH orig AS (
            SELECT d.sale_id, d.product_id, x.socio_id, x.ingreso, x.costo, x.ganancia
              FROM dbo.socios_reparto x JOIN dbo.sale_detail d ON d.id = x.sale_detail_id
             WHERE x.origen = 'VENTA'
            UNION ALL
            SELECT l.sale_id, l.product_id, p.socio_id, p.ingreso, p.costo, p.ganancia
              FROM #rep p JOIN #l l ON l.detail_id = p.detail_id
        ),
        base AS (
            SELECT sale_id, product_id, SUM(costo + ganancia) AS r FROM orig GROUP BY sale_id, product_id
        )
        INSERT INTO #rdv (refund_detail_id, socio_id, ingreso, costo, ganancia)
        SELECT v.refund_detail_id, o.socio_id,
               -ROUND(SUM(o.ingreso) * v.monto / b.r, 4),
               -ROUND(SUM(o.costo) * v.monto / b.r, 4),
               -ROUND(SUM(o.ganancia) * v.monto / b.r, 4)
          FROM #dv v
          JOIN base b ON b.sale_id = v.sale_id AND b.product_id = v.product_id AND b.r > 0
          JOIN orig o ON o.sale_id = v.sale_id AND o.product_id = v.product_id
         GROUP BY v.refund_detail_id, o.socio_id, v.monto, b.r;

        ;WITH dif AS (
            SELECT v.refund_detail_id, -ROUND(v.monto, 4) - SUM(p.costo + p.ganancia) AS d
              FROM #dv v JOIN #rdv p ON p.refund_detail_id = v.refund_detail_id
             GROUP BY v.refund_detail_id, v.monto
        ),
        mayor AS (
            SELECT refund_detail_id, socio_id,
                   ROW_NUMBER() OVER (PARTITION BY refund_detail_id ORDER BY costo + ganancia, socio_id) AS n
              FROM #rdv
        )
        UPDATE p SET ganancia = p.ganancia + d.d
          FROM #rdv p
          JOIN mayor m ON m.refund_detail_id = p.refund_detail_id AND m.socio_id = p.socio_id AND m.n = 1
          JOIN dif d ON d.refund_detail_id = p.refund_detail_id
         WHERE d.d <> 0;
    END

    IF NOT EXISTS (SELECT 1 FROM #rep) AND NOT EXISTS (SELECT 1 FROM #rdv) RETURN;

    BEGIN TRAN;
        INSERT INTO dbo.socios_reparto (origen, sale_id, sale_detail_id, socio_id, fecha, register_id, ingreso, costo, ganancia)
        SELECT 'VENTA', l.sale_id, p.detail_id, p.socio_id, l.fecha, l.register_id, p.ingreso, p.costo, p.ganancia
          FROM #rep p JOIN #l l ON l.detail_id = p.detail_id
         WHERE NOT EXISTS (SELECT 1 FROM dbo.socios_reparto x WITH (UPDLOCK, HOLDLOCK)
                            WHERE x.sale_detail_id = p.detail_id);

        INSERT INTO dbo.socios_reparto (origen, sale_id, refund_detail_id, socio_id, fecha, register_id, ingreso, costo, ganancia)
        SELECT 'DEVOLUCION', v.sale_id, p.refund_detail_id, p.socio_id, v.fecha, v.register_id, p.ingreso, p.costo, p.ganancia
          FROM #rdv p JOIN #dv v ON v.refund_detail_id = p.refund_detail_id
         WHERE NOT EXISTS (SELECT 1 FROM dbo.socios_reparto x WITH (UPDLOCK, HOLDLOCK)
                            WHERE x.refund_detail_id = p.refund_detail_id);
    COMMIT;
END
GO

/* ---------- sp_socios_calcular (SQL_STORED_PROCEDURE) ---------- */
/* sp_socios_calcular
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================== sp_socios_calcular (0079) =======================
   Los numeros de cada socio en un periodo [@desde, @hasta] (fechas
   incluidas). Llena la tabla temporal #res que CREA QUIEN LLAMA
   (sp_socios_resumen, sp_socios_liquidar):

       CREATE TABLE #res (socio_id INT PRIMARY KEY, vendido, costo, ganancia,
                          gastos, anticipos, aportaciones, retiros, faltantes
                          DECIMAL(18, 6) NOT NULL DEFAULT 0);

   vendido       lo que vendio como dueno del producto (informativo)
   costo         el costo de sus insumos que se vendieron: se le devuelve
   ganancia      su parte de la ganancia
   gastos        su parte de los gastos (de el, divididos o comunes)
   anticipos     lo suyo que se compro con dinero del negocio
   aportaciones  gastos que pago de su bolsa y dinero que metio
   retiros       lo que se llevo (retiros y pagos de saldo)
   faltantes     su parte del faltante (o sobrante, en negativo) de los cortes

   resultado = costo + ganancia - gastos - anticipos + aportaciones
               - retiros - faltantes

   Lo vendido se lee de socios_reparto (congelado). Los gastos COMUNES se
   reparten con la regla de HOY sobre el periodo: por eso una liquidacion se
   cierra y ya no cambia.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_calcular
    @desde DATE,
    @hasta DATE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @inicio DATE, @gasto_regla VARCHAR(8), @faltante_regla VARCHAR(8);
    SELECT @inicio = inicio, @gasto_regla = gasto_regla, @faltante_regla = faltante_regla
      FROM dbo.socios_config WHERE id = 1;
    IF @inicio IS NULL RETURN;
    IF @desde < @inicio SET @desde = @inicio;
    DECLARE @fin DATETIME2(0) = DATEADD(DAY, 1, CAST(@hasta AS DATETIME2(0)));
    DECLARE @ini DATETIME2(0) = CAST(@desde AS DATETIME2(0));

    EXEC dbo.sp_socios_asignar;

    /* Todo socio activo sale, aunque no tenga movimientos; uno inactivo solo
       si tiene algo en el periodo. */
    INSERT INTO #res (socio_id) SELECT id FROM dbo.socios WHERE activo = 1;

    DECLARE @n INT = (SELECT COUNT(*) FROM dbo.socios WHERE activo = 1);

    /* --------------------------------------------------------- vendido */
    ;WITH v AS (
        SELECT socio_id, SUM(ingreso) AS ingreso, SUM(costo) AS costo, SUM(ganancia) AS ganancia
          FROM dbo.socios_reparto WHERE fecha >= @ini AND fecha < @fin
         GROUP BY socio_id
    )
    MERGE #res AS d USING v ON d.socio_id = v.socio_id
    WHEN MATCHED THEN UPDATE SET vendido = v.ingreso, costo = v.costo, ganancia = v.ganancia
    WHEN NOT MATCHED THEN INSERT (socio_id, vendido, costo, ganancia) VALUES (v.socio_id, v.ingreso, v.costo, v.ganancia);

    /* Pesos para lo que se reparte "por ventas": lo que vendio cada uno en el
       periodo. Sin ventas, partes iguales. */
    CREATE TABLE #peso (socio_id INT PRIMARY KEY, w DECIMAL(18, 8) NOT NULL);
    DECLARE @vt DECIMAL(18, 6) = (SELECT SUM(vendido) FROM #res WHERE vendido > 0);
    IF ISNULL(@vt, 0) > 0
        INSERT INTO #peso SELECT socio_id, vendido / @vt FROM #res WHERE vendido > 0;
    ELSE
        INSERT INTO #peso SELECT id, 1.0 / @n FROM dbo.socios WHERE activo = 1;

    /* Pesos de los gastos comunes. */
    CREATE TABLE #pg (socio_id INT PRIMARY KEY, w DECIMAL(18, 8) NOT NULL);
    IF @gasto_regla = 'VENTAS'
        INSERT INTO #pg SELECT socio_id, w FROM #peso;
    ELSE IF @gasto_regla = 'FIJO' AND (SELECT SUM(pct_fijo) FROM dbo.socios WHERE activo = 1) > 0
        INSERT INTO #pg SELECT id, pct_fijo / (SELECT SUM(pct_fijo) FROM dbo.socios WHERE activo = 1)
          FROM dbo.socios WHERE activo = 1 AND ISNULL(pct_fijo, 0) > 0;
    ELSE
        INSERT INTO #pg SELECT id, 1.0 / @n FROM dbo.socios WHERE activo = 1;

    /* ---------------------------------------------------------- gastos */
    ;WITH g AS (
        SELECT e.id, e.amount, sg.modo, sg.pagado_por_socio_id
          FROM dbo.expenses e
          LEFT JOIN dbo.socios_gasto sg ON sg.expense_id = e.id
         WHERE e.voided_at IS NULL AND e.expense_date >= @desde AND e.expense_date <= @hasta
    ),
    partes AS (
        SELECT l.socio_id, g.amount * l.pct / 100.0 AS m
          FROM g JOIN dbo.socios_gasto_lineas l ON l.expense_id = g.id
         WHERE g.modo = 'SOCIOS'
        UNION ALL
        SELECT p.socio_id, g.amount * p.w
          FROM g CROSS JOIN #pg p
         WHERE ISNULL(g.modo, 'COMUN') = 'COMUN'
    ),
    t AS (SELECT socio_id, SUM(m) AS m FROM partes GROUP BY socio_id)
    MERGE #res AS d USING t ON d.socio_id = t.socio_id
    WHEN MATCHED THEN UPDATE SET gastos = t.m
    WHEN NOT MATCHED THEN INSERT (socio_id, gastos) VALUES (t.socio_id, t.m);

    /* ------------------------------------------------------- anticipos
       Lo que pago el negocio de cada compra (no la que pago un socio de su
       bolsa): lo de contado en la fecha de la compra y cada abono en su
       fecha. Se reparte por renglon segun el dueno de cada producto. */
    CREATE TABLE #duenos (product_id INT NOT NULL, socio_id INT NOT NULL, pct DECIMAL(9, 6) NOT NULL,
                          PRIMARY KEY (product_id, socio_id));
    EXEC dbo.sp_socios_llenar_duenos;

    ;WITH compras AS (
        SELECT p.id, ISNULL(p.total, 0) AS total
          FROM dbo.purchase p
         WHERE NOT EXISTS (SELECT 1 FROM dbo.socios_compra c WHERE c.purchase_id = p.id)
    ),
    pagado AS (
        /* De contado: total - saldo - abonos. */
        SELECT c.id AS purchase_id,
               c.total - ISNULL(p.balance, 0) - ISNULL((SELECT SUM(sp.amount) FROM dbo.supplier_payments sp WHERE sp.purchase_id = c.id), 0) AS m
          FROM compras c JOIN dbo.purchase p ON p.id = c.id
         WHERE p.datee >= @ini AND p.datee < @fin
        UNION ALL
        SELECT sp.purchase_id, sp.amount
          FROM dbo.supplier_payments sp
          JOIN compras c ON c.id = sp.purchase_id
         WHERE sp.datee >= @ini AND sp.datee < @fin
    ),
    renglones AS (
        SELECT d.puchase_id AS purchase_id, d.product_id, d.quantity * d.unitary_price AS sub,
               SUM(d.quantity * d.unitary_price) OVER (PARTITION BY d.puchase_id) AS tot
          FROM dbo.purchase_detail d
         WHERE d.puchase_id IN (SELECT purchase_id FROM pagado)
    ),
    partes AS (
        SELECT o.socio_id, pg.m * r.sub / r.tot * o.pct AS m
          FROM pagado pg
          JOIN renglones r ON r.purchase_id = pg.purchase_id AND r.tot > 0
          JOIN #duenos o ON o.product_id = r.product_id
         WHERE pg.m > 0
    ),
    t AS (SELECT socio_id, SUM(m) AS m FROM partes GROUP BY socio_id)
    MERGE #res AS d USING t ON d.socio_id = t.socio_id
    WHEN MATCHED THEN UPDATE SET anticipos = t.m
    WHEN NOT MATCHED THEN INSERT (socio_id, anticipos) VALUES (t.socio_id, t.m);

    /* ----------------------------------- aportaciones y retiros */
    ;WITH a AS (
        SELECT sg.pagado_por_socio_id AS socio_id, e.amount AS ap, CAST(0 AS DECIMAL(18, 6)) AS re
          FROM dbo.expenses e JOIN dbo.socios_gasto sg ON sg.expense_id = e.id
         WHERE sg.pagado_por_socio_id IS NOT NULL AND e.voided_at IS NULL
           AND e.expense_date >= @desde AND e.expense_date <= @hasta
        UNION ALL
        SELECT socio_id, CASE WHEN tipo = 'APORTACION' THEN monto ELSE 0 END,
                         CASE WHEN tipo IN ('RETIRO', 'PAGO') THEN monto ELSE 0 END
          FROM dbo.socios_movimientos WHERE fecha >= @ini AND fecha < @fin
    ),
    t AS (SELECT socio_id, SUM(ap) AS ap, SUM(re) AS re FROM a GROUP BY socio_id)
    MERGE #res AS d USING t ON d.socio_id = t.socio_id
    WHEN MATCHED THEN UPDATE SET aportaciones = t.ap, retiros = t.re
    WHEN NOT MATCHED THEN INSERT (socio_id, aportaciones, retiros) VALUES (t.socio_id, t.ap, t.re);

    /* ------------------------------------------------------ faltantes
       difference = entregado - esperado: negativo es faltante. Por corte,
       en proporcion a lo que vendio cada socio EN ESE corte, o iguales. */
    ;WITH cortes AS (
        SELECT id, -difference AS falta FROM dbo.cash_closures
         WHERE closed_at >= @ini AND closed_at < @fin AND difference <> 0
    ),
    vend AS (
        SELECT s.closure_id, x.socio_id, SUM(x.ingreso) AS v
          FROM dbo.socios_reparto x JOIN dbo.sales s ON s.id = x.sale_id
         WHERE x.origen = 'VENTA' AND s.closure_id IN (SELECT id FROM cortes)
         GROUP BY s.closure_id, x.socio_id
    ),
    vt AS (SELECT closure_id, SUM(v) AS v FROM vend GROUP BY closure_id HAVING SUM(v) > 0),
    partes AS (
        SELECT v.socio_id, c.falta * v.v / t.v AS m
          FROM cortes c JOIN vt t ON t.closure_id = c.id JOIN vend v ON v.closure_id = c.id
         WHERE @faltante_regla = 'VENTAS'
        UNION ALL
        SELECT s.id, c.falta / @n
          FROM cortes c CROSS JOIN dbo.socios s
         WHERE s.activo = 1 AND (@faltante_regla = 'IGUALES' OR NOT EXISTS (SELECT 1 FROM vt WHERE vt.closure_id = c.id))
    ),
    t AS (SELECT socio_id, SUM(m) AS m FROM partes GROUP BY socio_id)
    MERGE #res AS d USING t ON d.socio_id = t.socio_id
    WHEN MATCHED THEN UPDATE SET faltantes = t.m
    WHEN NOT MATCHED THEN INSERT (socio_id, faltantes) VALUES (t.socio_id, t.m);
END
GO

/* ---------- sp_socios_compra_guardar (SQL_STORED_PROCEDURE) ---------- */
/* sp_socios_compra_guardar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_socios_compra_guardar (0079) ====================
   Quien pago una compra. Lo llama el canal de compras justo despues de
   registrarla.

   @pagado_por NULL = el negocio (cajon, banco): lo comprado es anticipo del
               dueno de cada producto.
               Un socio = de su bolsa: no hay anticipo; al venderse,
               recupera su costo.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_compra_guardar
    @purchase_id INT,
    @pagado_por  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
        THROW 51000, N'Socios no está activado.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.purchase WHERE id = @purchase_id) THROW 51000, N'Esa compra no existe.', 1;
    IF @pagado_por IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.socios WHERE id = @pagado_por AND activo = 1)
        THROW 51000, N'Ese socio no está activo.', 1;
    /* Una compra que salio del cajon no la pago nadie de su bolsa. */
    IF @pagado_por IS NOT NULL AND EXISTS (
        SELECT 1 FROM dbo.supplier_payments sp
         WHERE sp.purchase_id = @purchase_id AND sp.cash_movement_id IS NOT NULL)
        THROW 51000, N'Esa compra se pagó con efectivo del cajón: la pagó el negocio.', 1;

    BEGIN TRAN;
        DELETE FROM dbo.socios_compra WHERE purchase_id = @purchase_id;
        IF @pagado_por IS NOT NULL
            INSERT INTO dbo.socios_compra (purchase_id, pagado_por_socio_id) VALUES (@purchase_id, @pagado_por);
    COMMIT;

    SELECT @purchase_id AS purchase_id, @pagado_por AS pagado_por_socio_id;
END
GO

/* ---------- sp_socios_config_get (SQL_STORED_PROCEDURE) ---------- */
/* sp_socios_config_get
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================= sp_socios_config_get (0079) ======================
   Todo lo que el asistente y la pantalla de Socios necesitan para pintarse.

   recordset 1  la configuracion (vacia si nunca se activo) y si esta encendido
   recordset 2  los socios
   recordset 3  las categorias, con su dueno (una fila por categoria y socio;
                sin dueno: socio_id NULL)
   recordset 4  los productos con dueno propio (distinto de su categoria)
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_config_get
AS
BEGIN
    SET NOCOUNT ON;

    SELECT c.regla, c.pct_vende, c.gasto_regla, c.faltante_regla, c.sin_dueno_socio_id,
           c.liquidacion, c.dia_cierre, c.inicio, c.updated_at,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
                     THEN 1 ELSE 0 END AS BIT) AS activo,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.socios_liquidaciones) THEN 1 ELSE 0 END AS BIT) AS hay_liquidaciones
      FROM dbo.socios_config c WHERE c.id = 1;

    SELECT s.id, s.nombre, s.user_id, u.usuario, s.pct_fijo, s.activo, s.orden
      FROM dbo.socios s LEFT JOIN dbo.users u ON u.id = s.user_id
     ORDER BY s.activo DESC, s.orden, s.id;

    SELECT k.id AS categoria_id, k.namee AS categoria, d.socio_id, d.pct,
           (SELECT COUNT(*) FROM dbo.products p WHERE p.category_id = k.id AND ISNULL(p.active, 1) = 1) AS productos
      FROM dbo.CAT_categories k
      LEFT JOIN dbo.socios_duenos d ON d.entidad = 'CATEGORIA' AND d.entidad_id = k.id
     ORDER BY k.namee, d.socio_id;

    SELECT p.id AS product_id, p.nombre, p.category_id, d.socio_id, d.pct
      FROM dbo.socios_duenos d JOIN dbo.products p ON p.id = d.entidad_id
     WHERE d.entidad = 'PRODUCTO'
     ORDER BY p.nombre, d.socio_id;
END
GO

/* ---------- sp_socios_config_guardar (SQL_STORED_PROCEDURE) ---------- */
/* sp_socios_config_guardar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_socios_config_guardar (0079) ====================
   Las respuestas del asistente de Socios. @activar = 1 es la primera vez,
   desde Aplicaciones: guarda todo Y enciende el modulo en la MISMA
   transaccion. Con @activar = 0 cambia la configuracion de un modulo ya
   encendido. Un cambio aplica desde ese momento: lo ya repartido esta
   congelado.

   @json:
   {
     "regla": "A" | "B" | "C",  "pctVende": 30,
     "gastoRegla": "IGUALES" | "FIJO" | "VENTAS",
     "faltanteRegla": "VENTAS" | "IGUALES",
     "sinDueno": "<clave de socio>" | null,
     "liquidacion": "SEMANAL" | "MENSUAL",  "diaCierre": 7,
     "inicio": "2026-11-09",
     "socios": [ { "clave": "a", "id": 3, "nombre": "David", "userId": 2,
                   "pctFijo": 50, "activo": true }, ... ],
     "categorias": [ { "categoriaId": 4, "duenos": [ { "socio": "a", "pct": 100 } ] } ]
   }

   socios: los que vienen con id se actualizan; sin id se crean. Uno que no
   viene no se toca. Desactivar un socio le quita lo que era suyo (vuelve a
   "sin dueno"); su historia se queda.
   categorias: REEMPLAZA el dueno de todas las categorias. Una categoria que
   no viene queda sin dueno.

   Reglas: de 2 a 10 socios activos, nombres distintos, un usuario no es dos
   socios, cada categoria suma 100 %, y con gastos FIJO los % suman 100.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_config_guardar
    @json    NVARCHAR(MAX),
    @activar BIT = 0,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF ISJSON(@json) <> 1 THROW 51000, N'Configuración inválida.', 1;
    IF ISNULL(@activar, 0) = 0
       AND NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
        THROW 51000, N'Socios no está activado.', 1;

    DECLARE @regla CHAR(1) = UPPER(JSON_VALUE(@json, '$.regla')),
            @pct DECIMAL(5, 2) = TRY_CAST(JSON_VALUE(@json, '$.pctVende') AS DECIMAL(5, 2)),
            @gasto VARCHAR(8) = UPPER(JSON_VALUE(@json, '$.gastoRegla')),
            @falt VARCHAR(8) = UPPER(JSON_VALUE(@json, '$.faltanteRegla')),
            @sin NVARCHAR(40) = JSON_VALUE(@json, '$.sinDueno'),
            @liq VARCHAR(8) = UPPER(JSON_VALUE(@json, '$.liquidacion')),
            @dia TINYINT = TRY_CAST(JSON_VALUE(@json, '$.diaCierre') AS TINYINT),
            @inicio DATE = TRY_CAST(JSON_VALUE(@json, '$.inicio') AS DATE);

    IF @regla NOT IN ('A', 'B', 'C') THROW 51000, N'Elige cómo se reparte la ganancia.', 1;
    SET @pct = CASE @regla WHEN 'A' THEN 100 WHEN 'B' THEN 0 ELSE @pct END;
    IF @pct IS NULL OR @pct < 0 OR @pct > 100 THROW 51000, N'El porcentaje de quien vende va de 0 a 100.', 1;
    IF @gasto NOT IN ('IGUALES', 'FIJO', 'VENTAS') THROW 51000, N'Elige cómo se reparten los gastos comunes.', 1;
    IF ISNULL(@falt, '') NOT IN ('IGUALES', 'VENTAS') THROW 51000, N'Elige cómo se reparten los faltantes del corte.', 1;
    IF ISNULL(@liq, '') NOT IN ('SEMANAL', 'MENSUAL') THROW 51000, N'Elige cada cuánto se liquida.', 1;
    IF @liq = 'SEMANAL' AND (@dia IS NULL OR @dia NOT BETWEEN 1 AND 7) THROW 51000, N'Elige el día en que cierra la semana.', 1;
    IF @liq = 'MENSUAL' SET @dia = NULL;
    IF @inicio IS NULL THROW 51000, N'Indica desde cuándo se llevan las cuentas.', 1;

    CREATE TABLE #s (
        clave   NVARCHAR(40) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY,
        id      INT NULL,
        nombre  NVARCHAR(80) COLLATE DATABASE_DEFAULT NOT NULL,
        user_id INT NULL,
        pct     DECIMAL(7, 4) NULL,
        activo  BIT NOT NULL,
        orden   INT NOT NULL
    );
    INSERT INTO #s (clave, id, nombre, user_id, pct, activo, orden)
    SELECT LTRIM(RTRIM(j.clave)), j.id, LTRIM(RTRIM(j.nombre)), j.userId, j.pctFijo,
           ISNULL(j.activo, 1), ROW_NUMBER() OVER (ORDER BY (SELECT 1))
      FROM OPENJSON(@json, '$.socios') WITH (
             clave NVARCHAR(40), id INT, nombre NVARCHAR(80), userId INT,
             pctFijo DECIMAL(7, 4), activo BIT) j;

    IF EXISTS (SELECT 1 FROM #s WHERE LEN(nombre) = 0) THROW 51000, N'Cada socio necesita un nombre.', 1;
    IF EXISTS (SELECT nombre FROM #s GROUP BY nombre HAVING COUNT(*) > 1) THROW 51000, N'Dos socios no pueden llamarse igual.', 1;
    IF EXISTS (SELECT 1 FROM #s s JOIN dbo.socios x ON x.nombre = s.nombre
                WHERE ISNULL(s.id, 0) <> x.id AND NOT EXISTS (SELECT 1 FROM #s o WHERE o.id = x.id))
        THROW 51000, N'Ya hay un socio con ese nombre.', 1;
    IF EXISTS (SELECT user_id FROM #s WHERE user_id IS NOT NULL GROUP BY user_id HAVING COUNT(*) > 1)
        THROW 51000, N'Un usuario no puede ser dos socios.', 1;
    IF EXISTS (SELECT 1 FROM #s s WHERE s.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.users u WHERE u.id = s.user_id))
        THROW 51000, N'Ese usuario no existe.', 1;
    IF EXISTS (SELECT 1 FROM #s s WHERE s.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.socios x WHERE x.id = s.id))
        THROW 51000, N'Ese socio no existe.', 1;

    /* Los activos al final: los de la tabla que no vienen siguen como estan. */
    DECLARE @activos INT =
        (SELECT COUNT(*) FROM #s WHERE activo = 1)
      + (SELECT COUNT(*) FROM dbo.socios x WHERE x.activo = 1 AND NOT EXISTS (SELECT 1 FROM #s s WHERE s.id = x.id));
    IF @activos < 2 THROW 51000, N'Hacen falta al menos 2 socios.', 1;
    IF @activos > 10 THROW 51000, N'Son 10 socios como máximo.', 1;
    IF @gasto = 'FIJO' AND ABS(ISNULL((SELECT SUM(pct) FROM #s WHERE activo = 1), 0)
                              + ISNULL((SELECT SUM(x.pct_fijo) FROM dbo.socios x WHERE x.activo = 1
                                         AND NOT EXISTS (SELECT 1 FROM #s s WHERE s.id = x.id)), 0) - 100) > 0.01
        THROW 51000, N'Con gastos en porcentaje fijo, los porcentajes de los socios deben sumar 100.', 1;

    CREATE TABLE #c (categoria_id INT NOT NULL, clave NVARCHAR(40) COLLATE DATABASE_DEFAULT NOT NULL, pct DECIMAL(7, 4) NOT NULL,
                     PRIMARY KEY (categoria_id, clave));
    INSERT INTO #c (categoria_id, clave, pct)
    SELECT c.categoriaId, LTRIM(RTRIM(d.socio)), SUM(d.pct)
      FROM OPENJSON(@json, '$.categorias') WITH (categoriaId INT, duenos NVARCHAR(MAX) AS JSON) c
     CROSS APPLY OPENJSON(c.duenos) WITH (socio NVARCHAR(40), pct DECIMAL(7, 4)) d
     WHERE d.pct > 0
     GROUP BY c.categoriaId, LTRIM(RTRIM(d.socio));
    IF EXISTS (SELECT 1 FROM #c c WHERE NOT EXISTS (SELECT 1 FROM #s s WHERE s.clave = c.clave AND s.activo = 1))
        THROW 51000, N'Una categoría es de un socio que no está en la lista.', 1;
    IF EXISTS (SELECT 1 FROM #c c WHERE NOT EXISTS (SELECT 1 FROM dbo.CAT_categories k WHERE k.id = c.categoria_id))
        THROW 51000, N'Esa categoría no existe.', 1;
    IF EXISTS (SELECT categoria_id FROM #c GROUP BY categoria_id HAVING ABS(SUM(pct) - 100) > 0.01)
        THROW 51000, N'Lo de cada categoría debe sumar 100 %.', 1;
    IF @sin IS NOT NULL AND NOT EXISTS (SELECT 1 FROM #s WHERE clave = @sin AND activo = 1)
        THROW 51000, N'El socio de los productos sin dueño no está en la lista.', 1;

    BEGIN TRAN;
        UPDATE x SET nombre = s.nombre, user_id = s.user_id, pct_fijo = s.pct, activo = s.activo, orden = s.orden
          FROM dbo.socios x JOIN #s s ON s.id = x.id;
        INSERT INTO dbo.socios (nombre, user_id, pct_fijo, activo, orden)
        SELECT nombre, user_id, pct, activo, orden FROM #s WHERE id IS NULL;
        UPDATE s SET id = x.id FROM #s s JOIN dbo.socios x ON x.nombre = s.nombre WHERE s.id IS NULL;

        /* Lo del socio que se desactiva vuelve a "sin dueno". */
        DELETE d FROM dbo.socios_duenos d JOIN dbo.socios x ON x.id = d.socio_id WHERE x.activo = 0;

        DELETE FROM dbo.socios_duenos WHERE entidad = 'CATEGORIA';
        INSERT INTO dbo.socios_duenos (entidad, entidad_id, socio_id, pct)
        SELECT 'CATEGORIA', c.categoria_id, s.id, c.pct FROM #c c JOIN #s s ON s.clave = c.clave;

        DECLARE @sin_id INT = (SELECT id FROM #s WHERE clave = @sin);

        MERGE dbo.socios_config AS d
        USING (SELECT CAST(1 AS TINYINT) AS id) AS s ON d.id = s.id
        WHEN MATCHED THEN UPDATE SET
            regla = @regla, pct_vende = @pct, gasto_regla = @gasto, faltante_regla = @falt,
            sin_dueno_socio_id = @sin_id, liquidacion = @liq, dia_cierre = @dia,
            /* El inicio no se mueve despues de una liquidacion: cambiaria lo cerrado. */
            inicio = CASE WHEN EXISTS (SELECT 1 FROM dbo.socios_liquidaciones) THEN d.inicio ELSE @inicio END,
            updated_at = SYSDATETIME(), updated_by = @user_id
        WHEN NOT MATCHED THEN INSERT
            (id, regla, pct_vende, gasto_regla, faltante_regla, sin_dueno_socio_id, liquidacion, dia_cierre,
             inicio, updated_at, updated_by)
            VALUES (1, @regla, @pct, @gasto, @falt, @sin_id, @liq, @dia, @inicio, SYSDATETIME(), @user_id);

        IF @activar = 1
        BEGIN
            DECLARE @r TABLE (module_key NVARCHAR(40), enabled BIT, enabled_at DATETIME2(0), enabled_by INT, updated_at DATETIME2(0));
            INSERT INTO @r EXEC dbo.sp_set_business_module @module_key = N'socios', @enabled = 1, @user_id = @user_id;
        END
    COMMIT;

    EXEC dbo.sp_socios_config_get;
END
GO

/* ---------- sp_socios_ejemplo (SQL_STORED_PROCEDURE) ---------- */
/* sp_socios_ejemplo
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ========================= sp_socios_ejemplo (0079) =======================
   Un producto REAL del negocio para el ejemplo del asistente: su precio y
   el costo de cada insumo de su receta, con la categoria de cada uno. El
   asistente calcula A, B y C con los duenos que se estan eligiendo (aun sin
   guardar), asi que aqui no se resuelve ningun dueno.

   Sin @product_id elige uno: el vendible con receta que mas se ha vendido;
   si no hay, el que mas se ha vendido.

   recordset 1  el producto (id, nombre, precio, categoria)
   recordset 2  lo que gasta UNA unidad: insumo, categoria y costo
   recordset 3  hasta 30 productos para cambiar de ejemplo
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_ejemplo
    @product_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @product_id IS NULL
        SELECT TOP (1) @product_id = p.id
          FROM dbo.products p
          LEFT JOIN (SELECT product_id, SUM(quantity) AS q FROM dbo.sale_detail GROUP BY product_id) v
                 ON v.product_id = p.id
         WHERE p.sellable = 1 AND ISNULL(p.active, 1) = 1 AND p.price > 0
         ORDER BY CASE WHEN p.inventory_mode = 'RECIPE'
                        AND EXISTS (SELECT 1 FROM dbo.recipes r WHERE r.product_id = p.id AND r.active = 1) THEN 0 ELSE 1 END,
                  ISNULL(v.q, 0) DESC, p.id;

    SELECT p.id, p.nombre, p.price AS precio, p.category_id, k.namee AS categoria, p.inventory_mode
      FROM dbo.products p LEFT JOIN dbo.CAT_categories k ON k.id = p.category_id
     WHERE p.id = @product_id;

    DECLARE @receta INT = (SELECT TOP (1) id FROM dbo.recipes
                            WHERE product_id = @product_id AND variant_option_id IS NULL AND active = 1);
    IF @receta IS NOT NULL
        SELECT i.id AS product_id, i.nombre, i.category_id, k.namee AS categoria,
               CAST(rl.qty_base * (1 + rl.waste_pct / 100.0) * ISNULL(i.cost, 0) AS DECIMAL(14, 4)) AS costo
          FROM dbo.recipe_lines rl
          JOIN dbo.products i ON i.id = rl.ingredient_product_id
          LEFT JOIN dbo.CAT_categories k ON k.id = i.category_id
         WHERE rl.recipe_id = @receta
         ORDER BY rl.sort_order, rl.id;
    ELSE
        SELECT p.id AS product_id, p.nombre, p.category_id, k.namee AS categoria,
               CAST(ISNULL(p.cost, 0) AS DECIMAL(14, 4)) AS costo
          FROM dbo.products p LEFT JOIN dbo.CAT_categories k ON k.id = p.category_id
         WHERE p.id = @product_id;

    SELECT TOP (30) p.id, p.nombre, p.price AS precio
      FROM dbo.products p
      LEFT JOIN (SELECT product_id, SUM(quantity) AS q FROM dbo.sale_detail GROUP BY product_id) v
             ON v.product_id = p.id
     WHERE p.sellable = 1 AND ISNULL(p.active, 1) = 1 AND p.price > 0
     ORDER BY ISNULL(v.q, 0) DESC, p.nombre;
END
GO

/* ---------- sp_socios_gasto_guardar (SQL_STORED_PROCEDURE) ---------- */
/* sp_socios_gasto_guardar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_socios_gasto_guardar (0079) =====================
   A cargo de quien es un gasto y quien lo pago. Lo llama el canal de gastos
   justo despues de registrarlo.

   @modo       COMUN  = con la regla del negocio (iguales, % fijo, ventas).
               SOCIOS = de los de @lineas: '[{"socioId":1,"pct":60}, ...]'
                        que suman 100 (uno solo al 100 % = gasto de un socio).
   @pagado_por NULL = lo pago el negocio. Un socio = lo pago de su bolsa:
               se le abona como aportacion. Un gasto en EFECTIVO salio del
               cajon: lo pago el negocio.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_gasto_guardar
    @expense_id INT,
    @modo       VARCHAR(8),
    @lineas     NVARCHAR(MAX) = NULL,
    @pagado_por INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
        THROW 51000, N'Socios no está activado.', 1;
    DECLARE @metodo VARCHAR(20) = (SELECT payment_method FROM dbo.expenses WHERE id = @expense_id);
    IF @metodo IS NULL THROW 51000, N'Ese gasto no existe.', 1;
    SET @modo = UPPER(ISNULL(@modo, 'COMUN'));
    IF @modo NOT IN ('COMUN', 'SOCIOS') THROW 51000, N'Indica a cargo de quién es el gasto.', 1;
    IF @pagado_por IS NOT NULL AND @metodo = 'EFECTIVO'
        THROW 51000, N'Un gasto en efectivo salió del cajón: lo pagó el negocio.', 1;
    IF @pagado_por IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.socios WHERE id = @pagado_por AND activo = 1)
        THROW 51000, N'Ese socio no está activo.', 1;

    DECLARE @l TABLE (socio_id INT PRIMARY KEY, pct DECIMAL(7, 4));
    IF @modo = 'SOCIOS'
    BEGIN
        IF ISJSON(ISNULL(@lineas, '')) <> 1 THROW 51000, N'Indica de qué socios es el gasto.', 1;
        INSERT INTO @l (socio_id, pct)
        SELECT socioId, SUM(pct) FROM OPENJSON(@lineas) WITH (socioId INT, pct DECIMAL(7, 4))
         WHERE pct > 0 GROUP BY socioId;
        IF NOT EXISTS (SELECT 1 FROM @l) THROW 51000, N'Indica de qué socios es el gasto.', 1;
        IF EXISTS (SELECT 1 FROM @l l WHERE NOT EXISTS (SELECT 1 FROM dbo.socios s WHERE s.id = l.socio_id AND s.activo = 1))
            THROW 51000, N'Ese socio no está activo.', 1;
        IF ABS((SELECT SUM(pct) FROM @l) - 100) > 0.01 THROW 51000, N'El gasto debe repartirse al 100 %.', 1;
    END

    BEGIN TRAN;
        DELETE FROM dbo.socios_gasto WHERE expense_id = @expense_id;
        INSERT INTO dbo.socios_gasto (expense_id, modo, pagado_por_socio_id) VALUES (@expense_id, @modo, @pagado_por);
        INSERT INTO dbo.socios_gasto_lineas (expense_id, socio_id, pct) SELECT @expense_id, socio_id, pct FROM @l;
    COMMIT;

    SELECT g.expense_id, g.modo, g.pagado_por_socio_id, l.socio_id, l.pct
      FROM dbo.socios_gasto g LEFT JOIN dbo.socios_gasto_lineas l ON l.expense_id = g.expense_id
     WHERE g.expense_id = @expense_id;
END
GO

/* ---------- sp_socios_liquidacion (SQL_STORED_PROCEDURE) ---------- */
/* sp_socios_liquidacion
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_socios_liquidacion (0079) ======================
   Una liquidacion (@id) o la lista de todas (@id NULL, la mas nueva
   primero).
     @id:   recordset 1 = la liquidacion; recordset 2 = sus lineas.
     NULL:  una fila por liquidacion con sus totales.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_liquidacion
    @id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @id IS NULL
    BEGIN
        SELECT q.id, q.desde, q.hasta, q.created_at, u.usuario AS usuario,
               SUM(l.resultado) AS resultado, SUM(l.saldo_final) AS saldo_final
          FROM dbo.socios_liquidaciones q
          LEFT JOIN dbo.socios_liquidacion_lineas l ON l.liquidacion_id = q.id
          LEFT JOIN dbo.users u ON u.id = q.user_id
         GROUP BY q.id, q.desde, q.hasta, q.created_at, u.usuario
         ORDER BY q.hasta DESC;
        RETURN;
    END

    SELECT q.id, q.desde, q.hasta, q.created_at, u.usuario AS usuario
      FROM dbo.socios_liquidaciones q
      LEFT JOIN dbo.users u ON u.id = q.user_id
     WHERE q.id = @id;

    SELECT l.socio_id, s.nombre, l.vendido, l.costo, l.ganancia, l.gastos, l.anticipos,
           l.aportaciones, l.retiros, l.faltantes, l.resultado, l.saldo_inicial, l.saldo_final
      FROM dbo.socios_liquidacion_lineas l
      JOIN dbo.socios s ON s.id = l.socio_id
     WHERE l.liquidacion_id = @id
     ORDER BY s.orden, s.id;
END
GO

/* ---------- sp_socios_liquidar (SQL_STORED_PROCEDURE) ---------- */
/* sp_socios_liquidar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================== sp_socios_liquidar (0079) =======================
   Cierra el periodo que sigue a la ultima liquidacion (o al inicio) hasta
   @hasta. Una liquidacion cerrada ya no cambia: lo vendido estaba congelado
   y los gastos, anticipos y faltantes quedan escritos aqui.

   Los periodos no se enciman ni dejan huecos: siempre empieza al dia
   siguiente de la anterior. No se cierra un periodo que incluya hoy: el dia
   todavia no termina.

   Devuelve la liquidacion y sus lineas (sp_socios_liquidacion).
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_liquidar
    @hasta   DATE,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
        THROW 51000, N'Socios no está activado.', 1;
    IF @hasta IS NULL THROW 51000, N'Indica hasta qué día se liquida.', 1;
    IF @hasta >= CAST(GETDATE() AS DATE)
        THROW 51000, N'Solo se liquidan días que ya terminaron.', 1;

    /* El reparto de lo vendido, antes de abrir la transaccion. */
    EXEC dbo.sp_socios_asignar;

    DECLARE @id INT;
    BEGIN TRAN;
        DECLARE @ultima DATE = (SELECT MAX(hasta) FROM dbo.socios_liquidaciones WITH (UPDLOCK, HOLDLOCK));
        DECLARE @desde DATE = COALESCE(DATEADD(DAY, 1, @ultima), (SELECT inicio FROM dbo.socios_config WHERE id = 1));
        IF @hasta < @desde
            THROW 51000, N'Ese periodo ya está liquidado.', 1;

        CREATE TABLE #res (
            socio_id     INT NOT NULL PRIMARY KEY,
            vendido      DECIMAL(18, 6) NOT NULL DEFAULT 0,
            costo        DECIMAL(18, 6) NOT NULL DEFAULT 0,
            ganancia     DECIMAL(18, 6) NOT NULL DEFAULT 0,
            gastos       DECIMAL(18, 6) NOT NULL DEFAULT 0,
            anticipos    DECIMAL(18, 6) NOT NULL DEFAULT 0,
            aportaciones DECIMAL(18, 6) NOT NULL DEFAULT 0,
            retiros      DECIMAL(18, 6) NOT NULL DEFAULT 0,
            faltantes    DECIMAL(18, 6) NOT NULL DEFAULT 0
        );
        EXEC dbo.sp_socios_calcular @desde = @desde, @hasta = @hasta;

        DECLARE @previa INT = (SELECT TOP (1) id FROM dbo.socios_liquidaciones ORDER BY hasta DESC);

        /* Socios de la liquidacion anterior que hoy no tienen nada: su saldo
           sigue viajando. */
        INSERT INTO #res (socio_id)
        SELECT l.socio_id FROM dbo.socios_liquidacion_lineas l
         WHERE l.liquidacion_id = @previa AND l.saldo_final <> 0
           AND NOT EXISTS (SELECT 1 FROM #res r WHERE r.socio_id = l.socio_id);

        INSERT INTO dbo.socios_liquidaciones (desde, hasta, user_id) VALUES (@desde, @hasta, @user_id);
        SET @id = SCOPE_IDENTITY();

        INSERT INTO dbo.socios_liquidacion_lineas
            (liquidacion_id, socio_id, vendido, costo, ganancia, gastos, anticipos, aportaciones,
             retiros, faltantes, resultado, saldo_inicial, saldo_final)
        SELECT @id, r.socio_id,
               ROUND(r.vendido, 2), ROUND(r.costo, 2), ROUND(r.ganancia, 2), ROUND(r.gastos, 2),
               ROUND(r.anticipos, 2), ROUND(r.aportaciones, 2), ROUND(r.retiros, 2), ROUND(r.faltantes, 2),
               x.resultado, ISNULL(l.saldo_final, 0), ISNULL(l.saldo_final, 0) + x.resultado
          FROM #res r
          CROSS APPLY (SELECT CAST(ROUND(r.costo + r.ganancia - r.gastos - r.anticipos + r.aportaciones
                                         - r.retiros - r.faltantes, 2) AS DECIMAL(14, 2)) AS resultado) x
          LEFT JOIN dbo.socios_liquidacion_lineas l ON l.liquidacion_id = @previa AND l.socio_id = r.socio_id;
    COMMIT;

    EXEC dbo.sp_socios_liquidacion @id = @id;
END
GO

/* ---------- sp_socios_llenar_duenos (SQL_STORED_PROCEDURE) ---------- */
/* sp_socios_llenar_duenos
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_socios_llenar_duenos (0079) =====================
   De quien es cada producto, ya resuelto. Llena la tabla temporal #duenos
   que CREA QUIEN LLAMA:

       CREATE TABLE #duenos (product_id INT NOT NULL, socio_id INT NOT NULL,
                             pct DECIMAL(9, 6) NOT NULL,
                             PRIMARY KEY (product_id, socio_id));

   Una sola regla para todos (reparto de ventas, anticipos, el ejemplo del
   asistente):
     1. lo del PRODUCTO, si tiene;
     2. si no, lo de su CATEGORIA;
     3. si no, el socio "sin dueno" de la configuracion;
     4. si no hay, partes iguales entre los socios activos.
   pct es fraccion (0..1) y por producto suma 1.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_llenar_duenos
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @sin_dueno INT = (SELECT sin_dueno_socio_id FROM dbo.socios_config WHERE id = 1);
    DECLARE @activos INT = (SELECT COUNT(*) FROM dbo.socios WHERE activo = 1);
    IF @activos = 0 RETURN;

    INSERT INTO #duenos (product_id, socio_id, pct)
    SELECT d.entidad_id, d.socio_id, CAST(d.pct / 100.0 AS DECIMAL(9, 6))
      FROM dbo.socios_duenos d
      JOIN dbo.socios s ON s.id = d.socio_id AND s.activo = 1
      JOIN dbo.products p ON p.id = d.entidad_id
     WHERE d.entidad = 'PRODUCTO';

    INSERT INTO #duenos (product_id, socio_id, pct)
    SELECT p.id, d.socio_id, CAST(d.pct / 100.0 AS DECIMAL(9, 6))
      FROM dbo.products p
      JOIN dbo.socios_duenos d ON d.entidad = 'CATEGORIA' AND d.entidad_id = p.category_id
      JOIN dbo.socios s ON s.id = d.socio_id AND s.activo = 1
     WHERE NOT EXISTS (SELECT 1 FROM #duenos x WHERE x.product_id = p.id);

    IF @sin_dueno IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.socios WHERE id = @sin_dueno AND activo = 1)
        INSERT INTO #duenos (product_id, socio_id, pct)
        SELECT p.id, @sin_dueno, 1
          FROM dbo.products p
         WHERE NOT EXISTS (SELECT 1 FROM #duenos x WHERE x.product_id = p.id);
    ELSE
        INSERT INTO #duenos (product_id, socio_id, pct)
        SELECT p.id, s.id, CAST(1.0 / @activos AS DECIMAL(9, 6))
          FROM dbo.products p
         CROSS JOIN dbo.socios s
         WHERE s.activo = 1
           AND NOT EXISTS (SELECT 1 FROM #duenos x WHERE x.product_id = p.id);
END
GO

/* ---------- sp_socios_movimiento (SQL_STORED_PROCEDURE) ---------- */
/* sp_socios_movimiento
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================= sp_socios_movimiento (0079) ======================
   Dinero que un socio se lleva o mete.

   RETIRO      se llevo dinero del negocio a cuenta de lo suyo.
   PAGO        el negocio le paga su saldo (despues de liquidar).
   APORTACION  metio dinero suyo al negocio.

   En EFECTIVO pasa por el cajon del turno abierto de la caja: un retiro o
   pago es salida (PARTNER_OUT) y una aportacion es entrada (PARTNER_IN), y
   el corte los cuenta. Por transferencia u otro no toca la caja.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_movimiento
    @socio_id    INT,
    @tipo        VARCHAR(12),
    @monto       DECIMAL(12, 2),
    @metodo      VARCHAR(20),
    @register_id INT = NULL,
    @nota        NVARCHAR(255) = NULL,
    @user_id     INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
        THROW 51000, N'Socios no está activado.', 1;
    SET @tipo = UPPER(LTRIM(RTRIM(ISNULL(@tipo, ''))));
    SET @metodo = UPPER(LTRIM(RTRIM(ISNULL(@metodo, ''))));
    IF @tipo NOT IN ('RETIRO', 'PAGO', 'APORTACION') THROW 51000, N'Movimiento no válido.', 1;
    IF @metodo NOT IN ('EFECTIVO', 'TRANSFERENCIA', 'OTRO') THROW 51000, N'Método no válido.', 1;
    IF @monto IS NULL OR @monto <= 0 THROW 51000, N'El monto debe ser mayor a cero.', 1;
    DECLARE @nombre NVARCHAR(80) = (SELECT nombre FROM dbo.socios WHERE id = @socio_id);
    IF @nombre IS NULL THROW 51000, N'Ese socio no existe.', 1;

    DECLARE @cash_id INT = NULL, @closure INT = NULL, @id INT;
    BEGIN TRAN;
        IF @metodo = 'EFECTIVO'
        BEGIN
            /* Una instalacion de una sola caja sin configurar: esa. */
            IF @register_id IS NULL AND (SELECT COUNT(*) FROM dbo.registers WHERE is_active = 1) = 1
                SELECT @register_id = id FROM dbo.registers WHERE is_active = 1;
            IF @register_id IS NULL THROW 51000, N'Indica la caja.', 1;
            SELECT TOP (1) @closure = id FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
             WHERE register_id = @register_id AND closed_at IS NULL
             ORDER BY opened_at DESC, id DESC;
            IF @closure IS NULL THROW 51000, N'No hay un turno abierto en esta caja para mover efectivo.', 1;

            INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES (GETDATE(), @user_id,
                    CASE WHEN @tipo = 'APORTACION' THEN 'PARTNER_IN' ELSE 'PARTNER_OUT' END,
                    @socio_id, LEFT(CONCAT(N'SOCIO ', @nombre), 100),
                    CASE WHEN @tipo = 'APORTACION' THEN @monto ELSE -@monto END,
                    LEFT(ISNULL(NULLIF(LTRIM(RTRIM(@nota)), N''),
                         CONCAT(CASE @tipo WHEN 'APORTACION' THEN N'Aportación de ' WHEN 'PAGO' THEN N'Pago a ' ELSE N'Retiro de ' END, @nombre)), 200),
                    @closure, @register_id);
            SET @cash_id = SCOPE_IDENTITY();
        END

        INSERT INTO dbo.socios_movimientos (socio_id, fecha, tipo, monto, metodo, register_id, cash_movement_id, nota, user_id)
        VALUES (@socio_id, SYSDATETIME(), @tipo, @monto, @metodo,
                CASE WHEN @metodo = 'EFECTIVO' THEN @register_id END, @cash_id, NULLIF(LTRIM(RTRIM(@nota)), N''), @user_id);
        SET @id = SCOPE_IDENTITY();
    COMMIT;

    SELECT m.id, m.socio_id, s.nombre, m.fecha, m.tipo, m.monto, m.metodo, m.register_id, m.cash_movement_id, m.nota
      FROM dbo.socios_movimientos m JOIN dbo.socios s ON s.id = m.socio_id
     WHERE m.id = @id;
END
GO

/* ---------- sp_socios_movimientos (SQL_STORED_PROCEDURE) ---------- */
/* sp_socios_movimientos
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_socios_movimientos (0079) ======================
   El historial de dinero de los socios en un rango: retiros, pagos y
   aportaciones, y los gastos que un socio pago de su bolsa. Lo mas nuevo
   primero.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_movimientos
    @desde DATE,
    @hasta DATE
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @fin DATETIME2(0) = DATEADD(DAY, 1, CAST(@hasta AS DATETIME2(0)));

    SELECT 'MOVIMIENTO' AS origen, m.id, m.socio_id, s.nombre, m.fecha, m.tipo, m.monto, m.metodo,
           m.nota, u.usuario
      FROM dbo.socios_movimientos m
      JOIN dbo.socios s ON s.id = m.socio_id
      LEFT JOIN dbo.users u ON u.id = m.user_id
     WHERE m.fecha >= @desde AND m.fecha < @fin
    UNION ALL
    SELECT 'GASTO', e.id, g.pagado_por_socio_id, s.nombre, CAST(e.expense_date AS DATETIME2(0)),
           'APORTACION', e.amount, e.payment_method,
           CONCAT(N'Pagó el gasto: ', c.name, CASE WHEN e.note IS NULL THEN N'' ELSE CONCAT(N' · ', e.note) END),
           u.usuario
      FROM dbo.expenses e
      JOIN dbo.socios_gasto g ON g.expense_id = e.id
      JOIN dbo.socios s ON s.id = g.pagado_por_socio_id
      JOIN dbo.expense_categories c ON c.id = e.category_id
      LEFT JOIN dbo.users u ON u.id = e.user_id
     WHERE e.voided_at IS NULL AND e.expense_date >= @desde AND e.expense_date <= @hasta
     ORDER BY fecha DESC, id DESC;
END
GO

/* ---------- sp_socios_por_corte (SQL_STORED_PROCEDURE) ---------- */
/* sp_socios_por_corte
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================= sp_socios_por_corte (0079) =======================
   El conteo de cada caja: lo que le toca a cada socio de lo vendido en un
   corte (@closure_id), o en los cortes de un rango de dias.

   Una fila por corte y socio. Un turno abierto tambien sale: es el conteo
   de lo que va del dia.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_por_corte
    @closure_id INT = NULL,
    @desde      DATE = NULL,
    @hasta      DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @closure_id IS NULL AND (@desde IS NULL OR @hasta IS NULL)
        THROW 51000, N'Indica el corte o el rango de días.', 1;

    EXEC dbo.sp_socios_asignar;

    SELECT c.id AS closure_id, c.register_id, r.name AS caja, c.opened_at, c.closed_at,
           x.socio_id, s.nombre,
           CAST(ROUND(SUM(x.ingreso), 2) AS DECIMAL(14, 2))  AS vendido,
           CAST(ROUND(SUM(x.costo), 2) AS DECIMAL(14, 2))    AS costo,
           CAST(ROUND(SUM(x.ganancia), 2) AS DECIMAL(14, 2)) AS ganancia,
           CAST(ROUND(SUM(x.total), 2) AS DECIMAL(14, 2))    AS le_toca
      FROM dbo.socios_reparto x
      JOIN dbo.sales v ON v.id = x.sale_id
      JOIN dbo.cash_closures c ON c.id = v.closure_id
      LEFT JOIN dbo.registers r ON r.id = c.register_id
      JOIN dbo.socios s ON s.id = x.socio_id
     WHERE (@closure_id IS NOT NULL AND c.id = @closure_id)
        OR (@closure_id IS NULL AND c.opened_at >= @desde
            AND c.opened_at < DATEADD(DAY, 1, CAST(@hasta AS DATETIME2(0))))
     GROUP BY c.id, c.register_id, r.name, c.opened_at, c.closed_at, x.socio_id, s.nombre, s.orden
     ORDER BY c.opened_at DESC, s.orden, x.socio_id;
END
GO

/* ---------- sp_socios_producto_dueno (SQL_STORED_PROCEDURE) ---------- */
/* sp_socios_producto_dueno
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_socios_producto_dueno (0079) ====================
   De quien es UN producto (el campo "Pertenece a" del formulario).

   @duenos = '[{"socioId":1,"pct":100}]'. Vacio o NULL: el producto vuelve a
   ser de quien sea su categoria. Debe sumar 100 %.

   Siempre devuelve el dueno RESUELTO del producto (producto, categoria o
   sin dueno) y de donde sale, para que el formulario lo ensene.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_producto_dueno
    @product_id INT,
    @duenos     NVARCHAR(MAX) = NULL,
    @guardar    BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id) THROW 51000, N'Ese producto no existe.', 1;

    IF @guardar = 1
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
            THROW 51000, N'Socios no está activado.', 1;
        IF @duenos IS NOT NULL AND ISJSON(@duenos) <> 1 THROW 51000, N'Dueños inválidos.', 1;

        DECLARE @d TABLE (socio_id INT PRIMARY KEY, pct DECIMAL(7, 4));
        INSERT INTO @d (socio_id, pct)
        SELECT socioId, SUM(pct) FROM OPENJSON(ISNULL(@duenos, '[]')) WITH (socioId INT, pct DECIMAL(7, 4))
         WHERE pct > 0 GROUP BY socioId;
        IF EXISTS (SELECT 1 FROM @d d WHERE NOT EXISTS (SELECT 1 FROM dbo.socios s WHERE s.id = d.socio_id AND s.activo = 1))
            THROW 51000, N'Ese socio no está activo.', 1;
        IF EXISTS (SELECT 1 FROM @d) AND ABS((SELECT SUM(pct) FROM @d) - 100) > 0.01
            THROW 51000, N'Lo del producto debe sumar 100 %.', 1;

        BEGIN TRAN;
            DELETE FROM dbo.socios_duenos WHERE entidad = 'PRODUCTO' AND entidad_id = @product_id;
            INSERT INTO dbo.socios_duenos (entidad, entidad_id, socio_id, pct)
            SELECT 'PRODUCTO', @product_id, socio_id, pct FROM @d;
        COMMIT;
    END

    CREATE TABLE #duenos (product_id INT NOT NULL, socio_id INT NOT NULL, pct DECIMAL(9, 6) NOT NULL,
                          PRIMARY KEY (product_id, socio_id));
    EXEC dbo.sp_socios_llenar_duenos;

    SELECT o.socio_id, s.nombre, CAST(ROUND(o.pct * 100, 2) AS DECIMAL(7, 2)) AS pct,
           CASE WHEN EXISTS (SELECT 1 FROM dbo.socios_duenos WHERE entidad = 'PRODUCTO' AND entidad_id = @product_id) THEN 'PRODUCTO'
                WHEN EXISTS (SELECT 1 FROM dbo.socios_duenos d JOIN dbo.products p ON p.id = @product_id
                              WHERE d.entidad = 'CATEGORIA' AND d.entidad_id = p.category_id) THEN 'CATEGORIA'
                ELSE 'SIN_DUENO' END AS origen
      FROM #duenos o JOIN dbo.socios s ON s.id = o.socio_id
     WHERE o.product_id = @product_id
     ORDER BY s.orden, s.id;
END
GO

/* ---------- sp_socios_resumen (SQL_STORED_PROCEDURE) ---------- */
/* sp_socios_resumen
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================== sp_socios_resumen (0079) ========================
   Lo de cada socio en un periodo, sin cerrar nada. Sin fechas: el periodo
   abierto (desde el dia siguiente a la ultima liquidacion, o desde el
   inicio, hasta hoy).

   saldo_inicial es el saldo con el que cerro la ultima liquidacion anterior
   al periodo; saldo_final = saldo_inicial + resultado. Positivo: el negocio
   le debe. Negativo: el le debe al negocio.

   Recordset: una fila por socio, a centavos.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_resumen
    @desde DATE = NULL,
    @hasta DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.socios_config WHERE id = 1)
        THROW 51000, N'Socios no está configurado.', 1;

    DECLARE @ultima_hasta DATE = (SELECT MAX(hasta) FROM dbo.socios_liquidaciones);
    IF @desde IS NULL
        SET @desde = COALESCE(DATEADD(DAY, 1, @ultima_hasta), (SELECT inicio FROM dbo.socios_config WHERE id = 1));
    IF @hasta IS NULL SET @hasta = CAST(GETDATE() AS DATE);
    IF @hasta < @desde SET @hasta = @desde;

    CREATE TABLE #res (
        socio_id     INT NOT NULL PRIMARY KEY,
        vendido      DECIMAL(18, 6) NOT NULL DEFAULT 0,
        costo        DECIMAL(18, 6) NOT NULL DEFAULT 0,
        ganancia     DECIMAL(18, 6) NOT NULL DEFAULT 0,
        gastos       DECIMAL(18, 6) NOT NULL DEFAULT 0,
        anticipos    DECIMAL(18, 6) NOT NULL DEFAULT 0,
        aportaciones DECIMAL(18, 6) NOT NULL DEFAULT 0,
        retiros      DECIMAL(18, 6) NOT NULL DEFAULT 0,
        faltantes    DECIMAL(18, 6) NOT NULL DEFAULT 0
    );
    EXEC dbo.sp_socios_calcular @desde = @desde, @hasta = @hasta;

    /* El saldo con que cerro la liquidacion anterior a este periodo. */
    DECLARE @previa INT = (SELECT TOP (1) id FROM dbo.socios_liquidaciones WHERE hasta < @desde ORDER BY hasta DESC);
    INSERT INTO #res (socio_id)
    SELECT l.socio_id FROM dbo.socios_liquidacion_lineas l
     WHERE l.liquidacion_id = @previa AND l.saldo_final <> 0
       AND NOT EXISTS (SELECT 1 FROM #res r WHERE r.socio_id = l.socio_id);

    SELECT r.socio_id, s.nombre, s.activo, s.user_id,
           @desde AS desde, @hasta AS hasta,
           CAST(ROUND(r.vendido, 2) AS DECIMAL(14, 2))      AS vendido,
           CAST(ROUND(r.costo, 2) AS DECIMAL(14, 2))        AS costo,
           CAST(ROUND(r.ganancia, 2) AS DECIMAL(14, 2))     AS ganancia,
           CAST(ROUND(r.gastos, 2) AS DECIMAL(14, 2))       AS gastos,
           CAST(ROUND(r.anticipos, 2) AS DECIMAL(14, 2))    AS anticipos,
           CAST(ROUND(r.aportaciones, 2) AS DECIMAL(14, 2)) AS aportaciones,
           CAST(ROUND(r.retiros, 2) AS DECIMAL(14, 2))      AS retiros,
           CAST(ROUND(r.faltantes, 2) AS DECIMAL(14, 2))    AS faltantes,
           x.resultado,
           CAST(ISNULL(l.saldo_final, 0) AS DECIMAL(14, 2)) AS saldo_inicial,
           CAST(ISNULL(l.saldo_final, 0) + x.resultado AS DECIMAL(14, 2)) AS saldo_final
      FROM #res r
      JOIN dbo.socios s ON s.id = r.socio_id
      CROSS APPLY (SELECT CAST(ROUND(r.costo + r.ganancia - r.gastos - r.anticipos + r.aportaciones
                                     - r.retiros - r.faltantes, 2) AS DECIMAL(14, 2)) AS resultado) x
      LEFT JOIN dbo.socios_liquidacion_lineas l ON l.liquidacion_id = @previa AND l.socio_id = r.socio_id
     ORDER BY s.orden, s.id;
END
GO
