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
