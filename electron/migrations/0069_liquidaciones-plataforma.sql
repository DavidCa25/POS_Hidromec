/* ============================================================
   0069 — liquidaciones plataforma

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0069_liquidaciones-plataforma.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0069_liquidaciones-plataforma.sql ========== */
/* ============================================================
   0069 — Liquidaciones de plataforma (esquema)

   El problema: un pedido de Uber Eats, Didi Food o Rappi entra a la caja
   como forma de pago PLATAFORMA por el monto del ticket, pero la plataforma
   deposita menos. Descuenta su comision, las promociones que paga el
   negocio, retenciones de ISR e IVA y reembolsos. Nada de eso se registraba
   y el estado de resultados mostraba mas utilidad de la real.

   Trato contable (acordado con el negocio; el contador decide lo fiscal):
     · ticket                       = venta
     · promociones del negocio      = descuento a la venta
     · comision / tasa de servicio  = gasto (su IVA es acreditable)
     · retenciones ISR / IVA        = impuesto acreditable, NO gasto
     · reembolsos y otros ajustes   = devolucion / ajuste a la venta
     · deposito                     = cobro de lo que debia la plataforma

   platform_channels               que canal comercial es de que plataforma.
                                   No vive en la politica comercial: esa se
                                   publica al dominio movil byte por byte.
   platform_settlements            una liquidacion: plataforma, periodo,
                                   desglose y deposito.
   platform_settlement_orders      los pedidos que reporta la plataforma y la
                                   venta de la caja con la que se emparejaron.
   platform_settlement_allocations el desglose repartido entre las ventas,
                                   en proporcion al ticket, al confirmar: asi
                                   cae en el dia y el canal de cada venta.
   expense_categories.kind         + 'PLATAFORMA' (solo el sistema la usa).
   expenses.platform_settlement_id el egreso de comision sale de una
                                   liquidacion y solo ella lo cancela.

   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF OBJECT_ID(N'dbo.platform_channels', N'U') IS NULL
CREATE TABLE dbo.platform_channels (
    channel_id  NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NOT NULL,
    platform    VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    updated_at  DATETIME2(0) NOT NULL CONSTRAINT DF_platform_channels_updated DEFAULT (SYSDATETIME()),
    updated_by  INT NULL,
    CONSTRAINT PK_platform_channels PRIMARY KEY CLUSTERED (channel_id),
    CONSTRAINT CK_platform_channels_platform CHECK (platform IN ('UBER_EATS', 'DIDI_FOOD', 'RAPPI')),
    CONSTRAINT CK_platform_channels_local CHECK (channel_id <> N'LOCAL')
);
GO
IF OBJECT_ID(N'dbo.platform_settlements', N'U') IS NULL
CREATE TABLE dbo.platform_settlements (
    id                 INT IDENTITY(1, 1) NOT NULL,
    platform           VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    period_from        DATE NOT NULL,
    period_to          DATE NOT NULL,
    /* BORRADOR: se puede cambiar. CONFIRMADA: ya cuenta en resultados.
       CANCELADA: no cuenta; queda quien, cuando y por que. */
    status             VARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_platform_settlements_status DEFAULT ('BORRADOR'),
    source_file        NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    /* Todo con IVA, como lo enseña la plataforma, y en positivo: lo que
       descuenta. `other_adjustments` lleva signo (negativo = la plataforma
       pago de mas). */
    gross_sales        DECIMAL(14, 2) NOT NULL CONSTRAINT DF_platform_settlements_gross DEFAULT (0),
    marketing          DECIMAL(14, 2) NOT NULL CONSTRAINT DF_platform_settlements_marketing DEFAULT (0),
    service_fees       DECIMAL(14, 2) NOT NULL CONSTRAINT DF_platform_settlements_fees DEFAULT (0),
    refunds            DECIMAL(14, 2) NOT NULL CONSTRAINT DF_platform_settlements_refunds DEFAULT (0),
    isr_withheld       DECIMAL(14, 2) NOT NULL CONSTRAINT DF_platform_settlements_isr DEFAULT (0),
    iva_withheld       DECIMAL(14, 2) NOT NULL CONSTRAINT DF_platform_settlements_iva DEFAULT (0),
    other_adjustments  DECIMAL(14, 2) NOT NULL CONSTRAINT DF_platform_settlements_other DEFAULT (0),
    iva_rate           DECIMAL(5, 4) NOT NULL CONSTRAINT DF_platform_settlements_rate DEFAULT (0.16),
    deposit_expected   AS (CAST(gross_sales - marketing - service_fees - refunds - isr_withheld - iva_withheld - other_adjustments AS DECIMAL(14, 2))) PERSISTED,
    deposit_real       DECIMAL(14, 2) NULL,
    deposit_date       DATE NULL,
    note               NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    expense_id         INT NULL,
    created_by         INT NOT NULL,
    created_at         DATETIME2(0) NOT NULL CONSTRAINT DF_platform_settlements_created DEFAULT (SYSDATETIME()),
    updated_at         DATETIME2(0) NULL,
    confirmed_by       INT NULL,
    confirmed_at       DATETIME2(0) NULL,
    voided_by          INT NULL,
    voided_at          DATETIME2(0) NULL,
    void_reason        NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_platform_settlements PRIMARY KEY CLUSTERED (id),
    CONSTRAINT FK_platform_settlements_created FOREIGN KEY (created_by) REFERENCES dbo.users (id),
    CONSTRAINT FK_platform_settlements_expense FOREIGN KEY (expense_id) REFERENCES dbo.expenses (id),
    CONSTRAINT CK_platform_settlements_platform CHECK (platform IN ('UBER_EATS', 'DIDI_FOOD', 'RAPPI')),
    CONSTRAINT CK_platform_settlements_status CHECK (status IN ('BORRADOR', 'CONFIRMADA', 'CANCELADA')),
    CONSTRAINT CK_platform_settlements_period CHECK (period_from <= period_to),
    CONSTRAINT CK_platform_settlements_amounts CHECK (gross_sales >= 0 AND marketing >= 0 AND service_fees >= 0
        AND refunds >= 0 AND isr_withheld >= 0 AND iva_withheld >= 0),
    CONSTRAINT CK_platform_settlements_rate CHECK (iva_rate >= 0 AND iva_rate < 1),
    CONSTRAINT CK_platform_settlements_deposit CHECK (deposit_real IS NULL OR deposit_date IS NOT NULL),
    CONSTRAINT CK_platform_settlements_void CHECK ((status = 'CANCELADA' AND voided_at IS NOT NULL AND voided_by IS NOT NULL)
        OR (status <> 'CANCELADA' AND voided_at IS NULL)),
    CONSTRAINT CK_platform_settlements_confirmed CHECK (status = 'BORRADOR' OR confirmed_at IS NOT NULL OR status = 'CANCELADA')
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_platform_settlements_period' AND object_id = OBJECT_ID(N'dbo.platform_settlements'))
    CREATE NONCLUSTERED INDEX IX_platform_settlements_period ON dbo.platform_settlements (platform, period_from, period_to) INCLUDE (status);
GO
IF OBJECT_ID(N'dbo.platform_settlement_orders', N'U') IS NULL
CREATE TABLE dbo.platform_settlement_orders (
    id                INT IDENTITY(1, 1) NOT NULL,
    settlement_id     INT NOT NULL,
    line_no           INT NOT NULL,
    platform_order_id NVARCHAR(100) COLLATE Modern_Spanish_CI_AS NULL,
    order_at          DATETIME2(0) NULL,
    customer          NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    fulfillment       NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL,
    platform_status   NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL,
    /* Lo que el cliente pago por el pedido (con IVA): lo que la caja deberia
       tener. Si el archivo trae base e impuesto, sales_total = su suma. */
    sales_base        DECIMAL(14, 2) NULL,
    tax               DECIMAL(14, 2) NULL,
    sales_total       DECIMAL(14, 2) NOT NULL,
    net_amount        DECIMAL(14, 2) NULL,
    cancelled         BIT NOT NULL CONSTRAINT DF_platform_settlement_orders_cancelled DEFAULT (0),
    sale_id           INT NULL,
    /* REFERENCIA: por el numero de pedido capturado en la caja.
       IMPORTE: mismo dia (o el de junto) y mismo importe. MANUAL: a mano. */
    match_kind        VARCHAR(10) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_platform_settlement_orders PRIMARY KEY CLUSTERED (id),
    CONSTRAINT FK_platform_settlement_orders_settlement FOREIGN KEY (settlement_id) REFERENCES dbo.platform_settlements (id),
    CONSTRAINT FK_platform_settlement_orders_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id),
    CONSTRAINT CK_platform_settlement_orders_match CHECK ((sale_id IS NULL AND match_kind IS NULL)
        OR (sale_id IS NOT NULL AND match_kind IN ('REFERENCIA', 'IMPORTE', 'MANUAL')))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_platform_settlement_orders_settlement' AND object_id = OBJECT_ID(N'dbo.platform_settlement_orders'))
    CREATE NONCLUSTERED INDEX IX_platform_settlement_orders_settlement ON dbo.platform_settlement_orders (settlement_id, line_no);
GO
/* Una venta se empareja con un solo pedido dentro de la misma liquidacion. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_platform_settlement_orders_sale' AND object_id = OBJECT_ID(N'dbo.platform_settlement_orders'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_platform_settlement_orders_sale ON dbo.platform_settlement_orders (settlement_id, sale_id) WHERE sale_id IS NOT NULL;
GO
IF OBJECT_ID(N'dbo.platform_settlement_allocations', N'U') IS NULL
CREATE TABLE dbo.platform_settlement_allocations (
    id               INT IDENTITY(1, 1) NOT NULL,
    settlement_id    INT NOT NULL,
    /* NULL: la plataforma reporto un periodo sin ninguna venta en la caja;
       el desglose cae entero en el ultimo dia del periodo. */
    sale_id          INT NULL,
    channel_id       NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,
    alloc_date       DATE NOT NULL,
    /* Sin IVA (lo que toca la utilidad) y su IVA, por separado. */
    discount_base    DECIMAL(18, 6) NOT NULL,
    discount_iva     DECIMAL(18, 6) NOT NULL,
    refund_base      DECIMAL(18, 6) NOT NULL,
    refund_iva       DECIMAL(18, 6) NOT NULL,
    fee_base         DECIMAL(18, 6) NOT NULL,
    fee_iva          DECIMAL(18, 6) NOT NULL,
    withheld         DECIMAL(18, 6) NOT NULL,
    CONSTRAINT PK_platform_settlement_allocations PRIMARY KEY CLUSTERED (id),
    CONSTRAINT FK_platform_settlement_allocations_settlement FOREIGN KEY (settlement_id) REFERENCES dbo.platform_settlements (id),
    CONSTRAINT FK_platform_settlement_allocations_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_platform_settlement_allocations_date' AND object_id = OBJECT_ID(N'dbo.platform_settlement_allocations'))
    CREATE NONCLUSTERED INDEX IX_platform_settlement_allocations_date ON dbo.platform_settlement_allocations (alloc_date)
        INCLUDE (settlement_id, channel_id, discount_base, discount_iva, refund_base, refund_iva, fee_base, fee_iva, withheld);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_platform_settlement_allocations_sale' AND object_id = OBJECT_ID(N'dbo.platform_settlement_allocations'))
    CREATE NONCLUSTERED INDEX IX_platform_settlement_allocations_sale ON dbo.platform_settlement_allocations (sale_id) INCLUDE (settlement_id) WHERE sale_id IS NOT NULL;
GO

/* ------------------------- egresos: el concepto de plataforma */
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_expense_categories_kind'
            AND definition NOT LIKE N'%PLATAFORMA%')
    ALTER TABLE dbo.expense_categories DROP CONSTRAINT CK_expense_categories_kind;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_expense_categories_kind')
    ALTER TABLE dbo.expense_categories WITH CHECK ADD CONSTRAINT CK_expense_categories_kind
        CHECK (kind IN ('GENERAL', 'PERSONAL', 'PLATAFORMA'));
GO
/* El nombre puede chocar con un concepto que el negocio ya creo a mano: en
   ese caso se le da otro nombre al del sistema, nunca se toma el suyo. */
IF NOT EXISTS (SELECT 1 FROM dbo.expense_categories WHERE kind = 'PLATAFORMA')
    INSERT INTO dbo.expense_categories (name, kind, is_system, sort_order)
    VALUES (CASE WHEN EXISTS (SELECT 1 FROM dbo.expense_categories WHERE name = N'Comisiones de plataforma')
                 THEN N'Comisiones de plataforma (Wybix)' ELSE N'Comisiones de plataforma' END,
            'PLATAFORMA', 1, 15);
GO
IF COL_LENGTH(N'dbo.expenses', N'platform_settlement_id') IS NULL
    ALTER TABLE dbo.expenses ADD platform_settlement_id INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_expenses_platform_settlement')
    ALTER TABLE dbo.expenses WITH CHECK ADD CONSTRAINT FK_expenses_platform_settlement
        FOREIGN KEY (platform_settlement_id) REFERENCES dbo.platform_settlements (id);
GO

/* ---------- sp_cloud_daily_profit (SQL_STORED_PROCEDURE) ---------- */
/* sp_cloud_daily_profit
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_cloud_daily_profit
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);

    /* 0062: la misma utilidad que Estadísticas y el Estado de resultados.
       Antes restaba `products.last_cost`, columna que no existe, a un precio
       con IVA. Ahora: venta SIN IVA menos el costo congelado del renglón. */
    DECLARE @base DECIMAL(18, 4), @costo DECIMAL(18, 4);
    SELECT @base = ISNULL(SUM(x.base), 0), @costo = ISNULL(SUM(x.costo), 0)
    FROM dbo.sales s
    JOIN dbo.sale_detail sd ON sd.sale_id = s.id
    JOIN dbo.products p ON p.id = sd.product_id
    CROSS APPLY (SELECT
        CASE WHEN ISNULL(sd.tax_object, '02') = '02'
             THEN sd.subtotal / (1 + ISNULL(sd.tax_rate, ISNULL(p.tasa_iva, 0)))
             ELSE sd.subtotal END AS base,
        sd.quantity * COALESCE(sd.unit_cost, p.cost, 0) AS costo) x
    WHERE s.datee >= @hoy
      AND s.datee <  DATEADD(DAY, 1, @hoy);

    /* 0069: lo que las plataformas descuentan (promociones, reembolsos y
       comisión, sin IVA).
         · confirmado: de liquidaciones ya confirmadas, repartido en hoy;
         · estimado: las ventas de hoy pagadas en plataforma que ninguna
           liquidación tiene aún, al porcentaje de la ÚLTIMA liquidación
           confirmada de esa plataforma. Sin liquidación previa no se estima.
       Las retenciones no son gasto: no se restan. */
    DECLARE @confirmado DECIMAL(18, 4) = ISNULL((
        SELECT SUM(a.discount_base + a.refund_base + a.fee_base)
          FROM dbo.platform_settlement_allocations a
          JOIN dbo.platform_settlements t ON t.id = a.settlement_id AND t.status = 'CONFIRMADA'
         WHERE a.alloc_date = @hoy), 0);

    DECLARE @estimado DECIMAL(18, 4) = ISNULL((
        SELECT SUM(CAST(ISNULL(sp.amount, s.total) AS DECIMAL(18, 4)) * r.tasa)
          FROM dbo.sales s
          JOIN dbo.platform_channels pc ON pc.channel_id = JSON_VALUE(s.commercial_snapshot, '$.channel')
          LEFT JOIN dbo.sale_payments sp ON sp.sale_id = s.id AND sp.payment_method = 'PLATAFORMA'
          CROSS APPLY (SELECT TOP (1)
                    (t.marketing / (1 + t.iva_rate) + t.refunds / (1 + t.iva_rate) + t.other_adjustments
                     + t.service_fees / (1 + t.iva_rate)) / t.gross_sales AS tasa
                 FROM dbo.platform_settlements t
                WHERE t.platform = pc.platform AND t.status = 'CONFIRMADA' AND t.gross_sales > 0
                ORDER BY t.period_to DESC, t.id DESC) r
         WHERE s.datee >= @hoy AND s.datee < DATEADD(DAY, 1, @hoy)
           AND (sp.id IS NOT NULL OR (s.payment_method = 'PLATAFORMA' AND NOT EXISTS (SELECT 1 FROM dbo.sale_payments x WHERE x.sale_id = s.id)))
           AND NOT EXISTS (SELECT 1 FROM dbo.platform_settlement_allocations a
                             JOIN dbo.platform_settlements t ON t.id = a.settlement_id AND t.status = 'CONFIRMADA'
                            WHERE a.sale_id = s.id)), 0);

    SELECT
        CAST(@base - @costo - @confirmado - @estimado AS DECIMAL(18, 4)) AS utilidad,
        -- Venta sin IVA: base del margen %
        @base AS venta_bruta,
        CAST(@confirmado AS DECIMAL(18, 2)) AS plataformas_confirmado,
        CAST(@estimado AS DECIMAL(18, 2)) AS plataformas_estimado;
END
GO

/* ---------- sp_expense_category_list (SQL_STORED_PROCEDURE) ---------- */
/* sp_expense_category_list
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Conceptos de egreso, en el orden que el negocio eligio. Con
   @include_inactive = 0 (lo que usa quien registra un egreso) solo salen los
   activos; la pantalla de administracion pide todos.
   0069: el concepto PLATAFORMA no se ofrece para registrar a mano: sus
   egresos salen de una liquidacion de plataforma. */
CREATE OR ALTER PROCEDURE dbo.sp_expense_category_list
    @include_inactive BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        c.id, c.name, c.kind, c.is_system, c.active, c.sort_order,
        (SELECT COUNT(*) FROM dbo.expenses e WHERE e.category_id = c.id AND e.voided_at IS NULL) AS usos
    FROM dbo.expense_categories c
    WHERE @include_inactive = 1 OR (c.active = 1 AND c.kind <> 'PLATAFORMA')
    ORDER BY c.sort_order, c.name;
END
GO

/* ---------- sp_get_profit_overview (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_profit_overview
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Utilidad por día (pestaña "Caja y utilidad" de Estadísticas).
-- Utilidad = (precio cobrado SIN IVA) - (costo del renglón).
-- 0062: el costo es el CONGELADO al vender (sale_detail.unit_cost), no el
-- costo de hoy: cambiar un costo ya no reescribe la utilidad de días pasados.
-- La tasa de IVA también es la congelada del renglón. Los renglones viejos
-- sin costo o sin tasa usan los del producto (misma regla que
-- sp_income_statement).
-- 0069: menos lo que las plataformas descontaron (promociones, reembolsos y
-- comision sin IVA) de las liquidaciones confirmadas, en el dia de la venta.
CREATE OR ALTER PROCEDURE dbo.sp_get_profit_overview
    @from_date DATE = NULL,
    @to_date   DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @from_date IS NULL SET @from_date = DATEADD(DAY, -6, CAST(GETDATE() AS DATE));
    IF @to_date   IS NULL SET @to_date   = CAST(GETDATE() AS DATE);

    ;WITH v AS (
    SELECT
        CAST(s.datee AS DATE) AS datee,
        SUM(
            CASE WHEN ISNULL(sd.tax_object, '02') = '02'
                 THEN sd.subtotal / (1 + ISNULL(sd.tax_rate, ISNULL(p.tasa_iva, 0)))
                 ELSE sd.subtotal END
          - sd.quantity * COALESCE(sd.unit_cost, p.cost, 0)
        ) AS profit
    FROM dbo.sales s
    INNER JOIN dbo.sale_detail sd ON sd.sale_id = s.id
    INNER JOIN dbo.products p     ON p.id = sd.product_id
    WHERE s.datee >= @from_date
      AND s.datee <  DATEADD(DAY, 1, @to_date)
    GROUP BY CAST(s.datee AS DATE)),
    pa AS (
    SELECT a.alloc_date, SUM(a.discount_base + a.refund_base + a.fee_base) AS descontado
      FROM dbo.platform_settlement_allocations a
      JOIN dbo.platform_settlements t ON t.id = a.settlement_id AND t.status = 'CONFIRMADA'
     WHERE a.alloc_date BETWEEN @from_date AND @to_date
     GROUP BY a.alloc_date)
    SELECT v.datee, CAST(v.profit - ISNULL(pa.descontado, 0) AS DECIMAL(18, 4)) AS profit
      FROM v LEFT JOIN pa ON pa.alloc_date = v.datee
     ORDER BY v.datee;
END;
GO

/* ---------- sp_get_weekly_profit (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_weekly_profit
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <06-12-2025>
-- Description:	<Obtener una utilidad por semana>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_weekly_profit
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @from DATE = DATEADD(DAY, -6, CAST(GETDATE() AS DATE));
    DECLARE @to   DATE = DATEADD(DAY,  1, CAST(GETDATE() AS DATE));

    ;WITH daily AS (
        SELECT
            CAST(s.datee AS DATE)                           AS sale_date,
            /* 0062: venta sin IVA y costo CONGELADO del renglón (antes: venta con
               IVA contra el costo de hoy del producto). */
            SUM(CASE WHEN ISNULL(d.tax_object, '02') = '02'
                     THEN d.subtotal / (1 + ISNULL(d.tax_rate, ISNULL(p.tasa_iva, 0)))
                     ELSE d.subtotal END)                  AS total_sales,
            SUM(d.quantity * COALESCE(d.unit_cost, p.cost, 0)) AS total_cost
        FROM sales        AS s
        JOIN sale_detail  AS d ON d.sale_id   = s.id
        JOIN products     AS p ON p.id        = d.product_id
        WHERE s.datee >= @from
          AND s.datee <  @to
        GROUP BY CAST(s.datee AS DATE)
    )
    /* 0069: lo que las plataformas descontaron (promociones y reembolsos
       bajan la venta; la comision sin IVA, la utilidad), de las liquidaciones
       confirmadas, en el dia de la venta. */
    , pa AS (
        SELECT a.alloc_date, SUM(a.discount_base + a.refund_base) AS descuento, SUM(a.fee_base) AS comision
          FROM dbo.platform_settlement_allocations a
          JOIN dbo.platform_settlements t ON t.id = a.settlement_id AND t.status = 'CONFIRMADA'
         WHERE a.alloc_date >= @from AND a.alloc_date < @to
         GROUP BY a.alloc_date
    )
    SELECT
        d.sale_date,
        d.total_sales - ISNULL(pa.descuento, 0) AS total_sales,
        d.total_cost,
        (d.total_sales - ISNULL(pa.descuento, 0) - d.total_cost - ISNULL(pa.comision, 0)) AS profit
    FROM daily d
    LEFT JOIN pa ON pa.alloc_date = d.sale_date
    ORDER BY d.sale_date;
END;
GO

/* ---------- sp_income_statement (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_income_statement (0062) =====================
   ESTADO DE RESULTADOS de un periodo: cuánto ganó de verdad el negocio.

       Ventas netas (sin IVA, menos devoluciones)
     − Costo de lo vendido (el costo CONGELADO de cada renglón al venderse)
     = Utilidad bruta
     − Mermas de producto terminado (lo que se tiró)
     − Faltantes de inventario por conteo (valuados al costo actual)
     − Egresos (renta, luz, servicios...) y pagos al personal
     − Comisiones de plataforma, sin IVA (0069)
     = Utilidad de operación

   0069 · Liquidaciones de plataforma. Lo que Uber Eats, Didi o Rappi
   descuentan del depósito entra por las liquidaciones CONFIRMADAS, repartido
   entre sus ventas (platform_settlement_allocations), en el día de la venta:
     · promociones pagadas por el negocio y reembolsos: bajan la venta neta
       (y su IVA baja el IVA trasladado);
     · comisión / tasa de servicio: gasto, sin IVA (el IVA es acreditable);
     · retenciones ISR / IVA: se informan, NO son gasto.
   El egreso de comisión que crea la liquidación (concepto PLATAFORMA) no se
   suma con los demás egresos: ya está en el reparto, contaría doble.

   Lo que NO es gasto aquí, a propósito:
     · Las COMPRAS: son inventario. Se vuelven costo cuando se venden.
     · Los pagos a proveedores: pagan esas compras.
     · La merma DE PRODUCCIÓN: ya está dentro del costo de cada pieza buena
       (sp_production_finish reparte el costo de la tanda entre las buenas).
   Las ventas a crédito cuentan el día que se venden, no el día que se cobran.

   Precio con IVA: sale_detail guarda el precio cobrado (con IVA si el
   producto es objeto '02'). La base sin IVA se saca con la tasa congelada
   del renglón; los renglones viejos sin tasa usan la del producto.
   Costo: sale_detail.unit_cost (congelado al vender). Los renglones viejos
   sin costo usan el costo actual del producto y se cuentan aparte para que
   el dueño sepa cuánto de la utilidad es estimado.

     1  resumen          periodo pedido y periodo anterior del mismo largo
     2  egresos          por concepto (GENERAL / PERSONAL)
     3  categorías       ventas, costo, utilidad y margen por categoría
     4  días             serie diaria (ventas netas, costo, gastos, utilidad)
     5  productos        los 15 que más utilidad dejaron
     6  productos        los que se vendieron por debajo del costo
     7  canales          venta neta, costo, plataforma y utilidad por canal
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_income_statement
    @desde DATE = NULL,
    @hasta DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @hasta IS NULL SET @hasta = CAST(GETDATE() AS DATE);
    IF @desde IS NULL SET @desde = DATEFROMPARTS(YEAR(@hasta), MONTH(@hasta), 1);
    IF @desde > @hasta THROW 51000, 'La fecha inicial no puede ser posterior a la final.', 1;
    IF DATEDIFF(DAY, @desde, @hasta) > 366 THROW 51000, 'El periodo maximo es de un ano.', 1;

    DECLARE @dias INT = DATEDIFF(DAY, @desde, @hasta) + 1;
    DECLARE @ant_desde DATE = DATEADD(DAY, -@dias, @desde), @ant_hasta DATE = DATEADD(DAY, -1, @desde);

    /* --------- Renglones vendidos de los DOS periodos, ya con base y costo -------- */
    SELECT CAST(s.datee AS DATE) AS dia,
           CASE WHEN s.datee >= @desde THEN 1 ELSE 0 END AS actual,
           s.id AS sale_id, d.product_id, d.quantity,
           CAST(d.subtotal AS DECIMAL(14, 4)) AS cobrado,
           CAST(CASE WHEN ISNULL(d.tax_object, '02') = '02'
                     THEN d.subtotal / (1 + ISNULL(d.tax_rate, ISNULL(p.tasa_iva, 0)))
                     ELSE d.subtotal END AS DECIMAL(14, 4)) AS base,
           CAST(d.quantity * COALESCE(d.unit_cost, p.cost, 0) AS DECIMAL(14, 4)) AS costo,
           CASE WHEN d.unit_cost IS NULL THEN 1 ELSE 0 END AS costo_estimado,
           TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(s.commercial_snapshot, '$.discount')) AS descuento_venta,
           ISNULL(JSON_VALUE(s.commercial_snapshot, '$.channel'), N'LOCAL') AS canal,
           JSON_VALUE(s.commercial_snapshot, '$.channelName') AS canal_nombre
      INTO #v
      FROM dbo.sales s
      JOIN dbo.sale_detail d ON d.sale_id = s.id
      JOIN dbo.products p ON p.id = d.product_id
     WHERE s.datee >= @ant_desde AND s.datee < DATEADD(DAY, 1, @hasta);

    /* --------- Devoluciones (por la fecha en que se devolvió) -------- */
    CREATE TABLE #r (dia DATE NOT NULL, actual BIT NOT NULL, cobrado DECIMAL(14, 4) NOT NULL,
                     base DECIMAL(14, 4) NOT NULL, costo DECIMAL(14, 4) NOT NULL, product_id INT NULL, quantity DECIMAL(12, 2) NULL,
                     canal NVARCHAR(64) COLLATE DATABASE_DEFAULT NULL);
    INSERT INTO #r (dia, actual, cobrado, base, costo, product_id, quantity, canal)
    SELECT CAST(f.datee AS DATE) AS dia,
           CASE WHEN f.datee >= @desde THEN 1 ELSE 0 END AS actual,
           CAST(COALESCE(rd.commercial_amount, rd.quantity * rd.unitary_price) AS DECIMAL(14, 4)) AS cobrado,
           CAST(COALESCE(rd.commercial_amount, rd.quantity * rd.unitary_price)
                / CASE WHEN ISNULL(o.tax_object, '02') = '02' THEN 1 + ISNULL(o.tax_rate, ISNULL(p.tasa_iva, 0)) ELSE 1 END AS DECIMAL(14, 4)) AS base,
           CAST(rd.quantity * COALESCE(o.unit_cost, p.cost, 0) AS DECIMAL(14, 4)) AS costo,
           rd.product_id, rd.quantity,
           ISNULL(JSON_VALUE(vs.commercial_snapshot, '$.channel'), N'LOCAL')
      FROM dbo.sale_refunds f
      JOIN dbo.sale_refund_detail rd ON rd.refund_id = f.id
      LEFT JOIN dbo.sales vs ON vs.id = f.sale_id
      JOIN dbo.products p ON p.id = rd.product_id
      OUTER APPLY (SELECT TOP 1 d.unit_cost, d.tax_rate, d.tax_object
                     FROM dbo.sale_detail d WHERE d.sale_id = f.sale_id AND d.product_id = rd.product_id
                    ORDER BY d.id) o
     WHERE f.datee >= @ant_desde AND f.datee < DATEADD(DAY, 1, @hasta);

    /* Devoluciones sin detalle por producto (las muy viejas): solo importe. */
    INSERT INTO #r (dia, actual, cobrado, base, costo, product_id, quantity, canal)
    SELECT CAST(f.datee AS DATE), CASE WHEN f.datee >= @desde THEN 1 ELSE 0 END,
           f.refund_total, f.refund_total / 1.16, 0, NULL, NULL,
           ISNULL(JSON_VALUE(vs.commercial_snapshot, '$.channel'), N'LOCAL')
      FROM dbo.sale_refunds f
      LEFT JOIN dbo.sales vs ON vs.id = f.sale_id
     WHERE f.datee >= @ant_desde AND f.datee < DATEADD(DAY, 1, @hasta)
       AND NOT EXISTS (SELECT 1 FROM dbo.sale_refund_detail rd WHERE rd.refund_id = f.id);

    /* --------- Mermas de producto terminado -------- */
    SELECT w.waste_date AS dia, CASE WHEN w.waste_date >= @desde THEN 1 ELSE 0 END AS actual,
           CAST(w.qty * COALESCE(w.unit_cost, p.cost, 0) AS DECIMAL(14, 4)) AS costo
      INTO #w
      FROM dbo.production_waste w
      JOIN dbo.products p ON p.id = w.product_id
     WHERE w.waste_date BETWEEN @ant_desde AND @hasta;

    /* --------- Ajustes por conteo físico (faltante +, sobrante -) -------- */
    SELECT CAST(m.datee AS DATE) AS dia, CASE WHEN m.datee >= @desde THEN 1 ELSE 0 END AS actual,
           CAST(CASE WHEN m.typee = 'salida' THEN 1 ELSE -1 END * m.quantity * COALESCE(m.unit_cost, p.cost, 0) AS DECIMAL(14, 4)) AS costo
      INTO #a
      FROM dbo.inventory_movements m
      JOIN dbo.products p ON p.id = m.product_id
     WHERE m.reference = 'CONTEO'
       AND m.datee >= @ant_desde AND m.datee < DATEADD(DAY, 1, @hasta);

    /* --------- Plataformas: el reparto de las liquidaciones confirmadas (0069) -------- */
    SELECT a.alloc_date AS dia, CASE WHEN a.alloc_date >= @desde THEN 1 ELSE 0 END AS actual,
           ISNULL(a.channel_id, N'LOCAL') AS canal, a.sale_id,
           a.discount_base + a.refund_base AS descuento_base,
           a.discount_iva + a.refund_iva AS descuento_iva,
           a.fee_base, a.fee_iva, a.withheld
      INTO #pa
      FROM dbo.platform_settlement_allocations a
      JOIN dbo.platform_settlements t ON t.id = a.settlement_id AND t.status = 'CONFIRMADA'
     WHERE a.alloc_date BETWEEN @ant_desde AND @hasta;

    /* --------- Egresos (no cancelados) -------- */
    SELECT e.expense_date AS dia, CASE WHEN e.expense_date >= @desde THEN 1 ELSE 0 END AS actual,
           ISNULL(c.kind, 'GENERAL') AS kind, ISNULL(c.name, N'Sin concepto') AS concepto, e.amount
      INTO #e
      FROM dbo.expenses e
      LEFT JOIN dbo.expense_categories c ON c.id = e.category_id
     WHERE e.voided_at IS NULL
       AND ISNULL(c.kind, 'GENERAL') <> 'PLATAFORMA'
       AND e.expense_date BETWEEN @ant_desde AND @hasta;

    /* =============================== 1 resumen =============================== */
    ;WITH per AS (SELECT 1 AS actual UNION ALL SELECT 0),
    x AS (
        SELECT per.actual,
               (SELECT ISNULL(SUM(cobrado), 0) FROM #v WHERE actual = per.actual) AS ventas_cobradas,
               (SELECT COUNT(DISTINCT sale_id) FROM #v WHERE actual = per.actual) AS tickets,
               (SELECT ISNULL(SUM(d), 0) FROM (SELECT MAX(descuento_venta) d FROM #v WHERE actual = per.actual GROUP BY sale_id) q) AS descuentos,
               (SELECT ISNULL(SUM(base), 0) FROM #v WHERE actual = per.actual) AS ventas_base,
               (SELECT ISNULL(SUM(cobrado), 0) FROM #r WHERE actual = per.actual) AS devoluciones_cobradas,
               (SELECT ISNULL(SUM(base), 0) FROM #r WHERE actual = per.actual) AS devoluciones_base,
               (SELECT ISNULL(SUM(costo), 0) FROM #v WHERE actual = per.actual) AS costo_vendido,
               (SELECT ISNULL(SUM(costo), 0) FROM #r WHERE actual = per.actual) AS costo_devuelto,
               (SELECT COUNT(*) FROM #v WHERE actual = per.actual AND costo_estimado = 1) AS renglones_costo_estimado,
               (SELECT ISNULL(SUM(base), 0) FROM #v WHERE actual = per.actual AND (costo_estimado = 1 OR costo = 0)) AS ventas_sin_costo_congelado,
               (SELECT ISNULL(SUM(costo), 0) FROM #w WHERE actual = per.actual) AS mermas,
               (SELECT ISNULL(SUM(costo), 0) FROM #a WHERE actual = per.actual) AS ajustes_inventario,
               (SELECT ISNULL(SUM(amount), 0) FROM #e WHERE actual = per.actual AND kind <> 'PERSONAL') AS egresos_generales,
               (SELECT ISNULL(SUM(amount), 0) FROM #e WHERE actual = per.actual AND kind = 'PERSONAL') AS pagos_personal,
               (SELECT ISNULL(SUM(descuento_base), 0) FROM #pa WHERE actual = per.actual) AS plat_desc_base,
               (SELECT ISNULL(SUM(descuento_iva), 0) FROM #pa WHERE actual = per.actual) AS plat_desc_iva,
               (SELECT ISNULL(SUM(fee_base), 0) FROM #pa WHERE actual = per.actual) AS plat_comision,
               (SELECT ISNULL(SUM(fee_iva), 0) FROM #pa WHERE actual = per.actual) AS plat_comision_iva,
               (SELECT ISNULL(SUM(withheld), 0) FROM #pa WHERE actual = per.actual) AS plat_retenciones
          FROM per)
    SELECT CASE WHEN actual = 1 THEN 'ACTUAL' ELSE 'ANTERIOR' END AS periodo,
           CASE WHEN actual = 1 THEN @desde ELSE @ant_desde END AS desde,
           CASE WHEN actual = 1 THEN @hasta ELSE @ant_hasta END AS hasta,
           tickets, descuentos,
           ventas_cobradas, devoluciones_cobradas,
           CAST((ventas_cobradas - devoluciones_cobradas) - (ventas_base - devoluciones_base) - plat_desc_iva AS DECIMAL(14, 2)) AS iva_trasladado,
           CAST(plat_desc_base AS DECIMAL(14, 2)) AS descuentos_plataforma,
           CAST(ventas_base - devoluciones_base - plat_desc_base AS DECIMAL(14, 2)) AS ventas_netas,
           CAST(costo_vendido - costo_devuelto AS DECIMAL(14, 2)) AS costo_ventas,
           CAST((ventas_base - devoluciones_base - plat_desc_base) - (costo_vendido - costo_devuelto) AS DECIMAL(14, 2)) AS utilidad_bruta,
           CAST(mermas AS DECIMAL(14, 2)) AS mermas,
           CAST(ajustes_inventario AS DECIMAL(14, 2)) AS ajustes_inventario,
           CAST(egresos_generales AS DECIMAL(14, 2)) AS egresos_generales,
           CAST(pagos_personal AS DECIMAL(14, 2)) AS pagos_personal,
           CAST(plat_comision AS DECIMAL(14, 2)) AS comisiones_plataforma,
           CAST(plat_comision_iva AS DECIMAL(14, 2)) AS iva_comisiones_plataforma,
           CAST(plat_retenciones AS DECIMAL(14, 2)) AS retenciones_plataforma,
           CAST((ventas_base - devoluciones_base - plat_desc_base) - (costo_vendido - costo_devuelto)
                - mermas - ajustes_inventario - egresos_generales - pagos_personal - plat_comision AS DECIMAL(14, 2)) AS utilidad_operacion,
           renglones_costo_estimado,
           CAST(ventas_sin_costo_congelado AS DECIMAL(14, 2)) AS ventas_sin_costo
      FROM x
     ORDER BY actual DESC;

    /* =============================== 2 egresos =============================== */
    SELECT kind, concepto, CAST(SUM(amount) AS DECIMAL(14, 2)) AS total, COUNT(*) AS movimientos,
           CAST(ISNULL((SELECT SUM(a.amount) FROM #e a WHERE a.actual = 0 AND a.kind = e.kind AND a.concepto = e.concepto), 0) AS DECIMAL(14, 2)) AS total_anterior
      FROM #e e
     WHERE actual = 1
     GROUP BY kind, concepto
     ORDER BY SUM(amount) DESC;

    /* ============================== 3 categorías ============================= */
    /* 0069: lo que la plataforma descontó de una venta se reparte entre sus
       renglones según su venta sin IVA: la promoción baja la venta neta de
       la categoría y la comisión baja su utilidad. */
    ;WITH vp AS (
        SELECT v.product_id, v.base, v.costo,
               CASE WHEN SUM(v.base) OVER (PARTITION BY v.sale_id) <> 0
                    THEN v.base / SUM(v.base) OVER (PARTITION BY v.sale_id) ELSE 0 END AS parte,
               ps.descuento, ps.comision
          FROM #v v
          LEFT JOIN (SELECT sale_id, SUM(descuento_base) AS descuento, SUM(fee_base) AS comision
                       FROM #pa WHERE sale_id IS NOT NULL GROUP BY sale_id) ps ON ps.sale_id = v.sale_id
         WHERE v.actual = 1),
    vc AS (
        SELECT product_id, base - ISNULL(descuento, 0) * parte AS neto, costo, ISNULL(comision, 0) * parte AS comision FROM vp)
    SELECT ISNULL(c.namee, N'Sin categoría') AS categoria,
           CAST(SUM(v.neto) AS DECIMAL(14, 2)) AS ventas_netas,
           CAST(SUM(v.costo) AS DECIMAL(14, 2)) AS costo,
           CAST(SUM(v.comision) AS DECIMAL(14, 2)) AS comisiones_plataforma,
           CAST(SUM(v.neto - v.costo - v.comision) AS DECIMAL(14, 2)) AS utilidad,
           CAST(CASE WHEN SUM(v.neto) > 0 THEN 100 * SUM(v.neto - v.costo - v.comision) / SUM(v.neto) END AS DECIMAL(7, 2)) AS margen
      FROM vc v
      JOIN dbo.products p ON p.id = v.product_id
      LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
     GROUP BY c.namee
     ORDER BY SUM(v.neto - v.costo - v.comision) DESC;

    /* ================================ 4 días ================================= */
    ;WITH n AS (SELECT TOP (@dias) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS i FROM sys.all_objects),
    f AS (SELECT DATEADD(DAY, i, @desde) AS dia FROM n)
    SELECT f.dia,
           CAST(ISNULL(v.base, 0) - ISNULL(r.base, 0) - ISNULL(pa.descuento, 0) AS DECIMAL(14, 2)) AS ventas_netas,
           CAST(ISNULL(v.costo, 0) - ISNULL(r.costo, 0) AS DECIMAL(14, 2)) AS costo_ventas,
           CAST(ISNULL(w.costo, 0) + ISNULL(a.costo, 0) + ISNULL(e.total, 0) + ISNULL(pa.comision, 0) AS DECIMAL(14, 2)) AS gastos,
           CAST(ISNULL(v.base, 0) - ISNULL(r.base, 0) - ISNULL(pa.descuento, 0) - ISNULL(v.costo, 0) + ISNULL(r.costo, 0)
                - ISNULL(w.costo, 0) - ISNULL(a.costo, 0) - ISNULL(e.total, 0) - ISNULL(pa.comision, 0) AS DECIMAL(14, 2)) AS utilidad
      FROM f
      LEFT JOIN (SELECT dia, SUM(base) base, SUM(costo) costo FROM #v WHERE actual = 1 GROUP BY dia) v ON v.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(base) base, SUM(costo) costo FROM #r WHERE actual = 1 GROUP BY dia) r ON r.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(costo) costo FROM #w WHERE actual = 1 GROUP BY dia) w ON w.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(costo) costo FROM #a WHERE actual = 1 GROUP BY dia) a ON a.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(amount) total FROM #e WHERE actual = 1 GROUP BY dia) e ON e.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(descuento_base) descuento, SUM(fee_base) comision FROM #pa WHERE actual = 1 GROUP BY dia) pa ON pa.dia = f.dia
     ORDER BY f.dia;

    /* ============================== 5-6 productos ============================ */
    SELECT p.id, p.nombre AS producto, CAST(SUM(v.quantity) AS DECIMAL(14, 2)) AS cantidad,
           CAST(SUM(v.base) AS DECIMAL(14, 2)) AS ventas_netas, CAST(SUM(v.costo) AS DECIMAL(14, 2)) AS costo,
           CAST(SUM(v.base - v.costo) AS DECIMAL(14, 2)) AS utilidad,
           CAST(CASE WHEN SUM(v.base) > 0 THEN 100 * SUM(v.base - v.costo) / SUM(v.base) END AS DECIMAL(7, 2)) AS margen,
           MAX(v.costo_estimado) AS costo_estimado
      INTO #p
      FROM #v v JOIN dbo.products p ON p.id = v.product_id
     WHERE v.actual = 1
     GROUP BY p.id, p.nombre;

    SELECT TOP (15) * FROM #p ORDER BY utilidad DESC, producto;
    SELECT TOP (15) * FROM #p WHERE utilidad < 0 ORDER BY utilidad ASC, producto;

    /* ============================== 7 canales (0069) ========================== */
    /* El nombre: el de la política vigente; si el canal ya no existe, el que
       quedó en la venta. La plataforma, la que tenga ligada hoy. */
    SELECT c.id, c.name INTO #cn FROM dbo.commercial_policy p
     CROSS APPLY OPENJSON(p.payload, '$.channels') WITH (id NVARCHAR(64), name NVARCHAR(120)) c
     WHERE p.id = 1;
    ;WITH canales AS (
        SELECT canal FROM #v WHERE actual = 1 UNION SELECT canal FROM #r WHERE actual = 1
        UNION SELECT canal FROM #pa WHERE actual = 1),
    x AS (
        SELECT k.canal,
               (SELECT COUNT(DISTINCT sale_id) FROM #v WHERE actual = 1 AND canal = k.canal) AS tickets,
               (SELECT ISNULL(SUM(base), 0) FROM #v WHERE actual = 1 AND canal = k.canal) AS vb,
               (SELECT ISNULL(SUM(costo), 0) FROM #v WHERE actual = 1 AND canal = k.canal) AS vc,
               (SELECT ISNULL(SUM(base), 0) FROM #r WHERE actual = 1 AND canal = k.canal) AS rb,
               (SELECT ISNULL(SUM(costo), 0) FROM #r WHERE actual = 1 AND canal = k.canal) AS rc,
               (SELECT ISNULL(SUM(descuento_base), 0) FROM #pa WHERE actual = 1 AND canal = k.canal) AS pd,
               (SELECT ISNULL(SUM(fee_base), 0) FROM #pa WHERE actual = 1 AND canal = k.canal) AS pf,
               (SELECT ISNULL(SUM(withheld), 0) FROM #pa WHERE actual = 1 AND canal = k.canal) AS pr
          FROM canales k)
    SELECT x.canal,
           CASE WHEN x.canal = N'LOCAL' THEN N'Mostrador'
                ELSE COALESCE(n.name, (SELECT MAX(canal_nombre) FROM #v WHERE canal = x.canal), x.canal) END AS nombre,
           pc.platform AS plataforma,
           x.tickets,
           CAST(x.vb - x.rb AS DECIMAL(14, 2)) AS ventas,
           CAST(x.pd AS DECIMAL(14, 2)) AS descuentos_plataforma,
           CAST(x.vb - x.rb - x.pd AS DECIMAL(14, 2)) AS ventas_netas,
           CAST(x.vc - x.rc AS DECIMAL(14, 2)) AS costo,
           CAST(x.pf AS DECIMAL(14, 2)) AS comisiones_plataforma,
           CAST(x.vb - x.rb - x.pd - (x.vc - x.rc) - x.pf AS DECIMAL(14, 2)) AS utilidad,
           CAST(CASE WHEN x.vb - x.rb - x.pd > 0 THEN 100 * (x.vb - x.rb - x.pd - (x.vc - x.rc) - x.pf) / (x.vb - x.rb - x.pd) END AS DECIMAL(7, 2)) AS margen,
           CAST(x.pr AS DECIMAL(14, 2)) AS retenciones_plataforma,
           /* Canal de plataforma con ventas y sin ninguna liquidación en el
              periodo: su utilidad todavía es la del ticket, no la real. */
           CAST(CASE WHEN pc.platform IS NOT NULL AND x.pd = 0 AND x.pf = 0 THEN 1 ELSE 0 END AS BIT) AS sin_liquidar
      FROM x
      LEFT JOIN #cn n ON n.id = x.canal
      LEFT JOIN dbo.platform_channels pc ON pc.channel_id = x.canal
     ORDER BY CASE WHEN x.canal = N'LOCAL' THEN 0 ELSE 1 END, x.vb - x.rb DESC;
END;
GO

/* ---------- sp_platform_channel_set (SQL_STORED_PROCEDURE) ---------- */
/* sp_platform_channel_set
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_platform_channel_set (0069) =====================
   Liga un canal de venta con su plataforma (UBER_EATS, DIDI_FOOD, RAPPI), o
   lo desliga con @platform = NULL. Mostrador nunca es una plataforma.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_channel_set
    @channel_id NVARCHAR(64),
    @platform   VARCHAR(12) = NULL,
    @user_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @channel_id = NULLIF(LTRIM(RTRIM(@channel_id)), N'');
    SET @platform = NULLIF(UPPER(LTRIM(RTRIM(@platform))), '');

    IF @channel_id IS NULL OR @channel_id = N'LOCAL'
        THROW 51000, 'Elige un canal de venta que no sea Mostrador.', 1;
    IF @platform IS NOT NULL AND @platform NOT IN ('UBER_EATS', 'DIDI_FOOD', 'RAPPI')
        THROW 51000, 'Plataforma no admitida.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.commercial_policy p
                    CROSS APPLY OPENJSON(p.payload, '$.channels') WITH (id NVARCHAR(64)) c
                    WHERE p.id = 1 AND c.id = @channel_id)
        THROW 51000, 'Ese canal de venta no existe.', 1;

    IF @platform IS NULL
        DELETE FROM dbo.platform_channels WHERE channel_id = @channel_id;
    ELSE IF EXISTS (SELECT 1 FROM dbo.platform_channels WHERE channel_id = @channel_id)
        UPDATE dbo.platform_channels SET platform = @platform, updated_at = SYSDATETIME(), updated_by = @user_id
         WHERE channel_id = @channel_id;
    ELSE
        INSERT INTO dbo.platform_channels (channel_id, platform, updated_by) VALUES (@channel_id, @platform, @user_id);

    SELECT @channel_id AS channel_id, @platform AS plataforma;
END
GO

/* ---------- sp_platform_channels_get (SQL_STORED_PROCEDURE) ---------- */
/* sp_platform_channels_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_platform_channels_get (0069) =====================
   Los canales de venta del negocio (los de la politica comercial, menos
   Mostrador) y la plataforma de entrega que cada uno representa, si ya se
   eligio. Trae tambien cuantas ventas pagadas en plataforma tuvo cada canal
   en los ultimos 90 dias, para que se note cual falta ligar.

     1  canales          channel_id, nombre, activo, plataforma, ventas_90d
     2  sin canal        ventas pagadas en plataforma sin canal de plataforma
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_channels_get
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @desde DATETIME2(0) = DATEADD(DAY, -90, CAST(GETDATE() AS DATE));

    ;WITH ventas AS (
        SELECT JSON_VALUE(s.commercial_snapshot, '$.channel') AS channel_id
          FROM dbo.sales s
         WHERE s.datee >= @desde
           AND (EXISTS (SELECT 1 FROM dbo.sale_payments p WHERE p.sale_id = s.id AND p.payment_method = 'PLATAFORMA')
                OR (s.payment_method = 'PLATAFORMA' AND NOT EXISTS (SELECT 1 FROM dbo.sale_payments p WHERE p.sale_id = s.id))))
    SELECT c.id AS channel_id, c.name AS nombre, c.active AS activo, pc.platform AS plataforma,
           (SELECT COUNT(*) FROM ventas v WHERE v.channel_id = c.id) AS ventas_90d
      FROM dbo.commercial_policy p
     CROSS APPLY OPENJSON(p.payload, '$.channels') WITH (id NVARCHAR(64), name NVARCHAR(120), active BIT) c
      LEFT JOIN dbo.platform_channels pc ON pc.channel_id = c.id
     WHERE p.id = 1 AND c.id <> N'LOCAL'
     ORDER BY CASE WHEN pc.platform IS NULL THEN 1 ELSE 0 END, c.name;

    SELECT COUNT(*) AS ventas, CAST(ISNULL(SUM(ISNULL(p.amount, s.total)), 0) AS DECIMAL(14, 2)) AS importe
      FROM dbo.sales s
      LEFT JOIN dbo.sale_payments p ON p.sale_id = s.id AND p.payment_method = 'PLATAFORMA'
      LEFT JOIN dbo.platform_channels pc ON pc.channel_id = JSON_VALUE(s.commercial_snapshot, '$.channel')
     WHERE s.datee >= @desde AND pc.channel_id IS NULL
       AND (p.id IS NOT NULL OR (s.payment_method = 'PLATAFORMA' AND NOT EXISTS (SELECT 1 FROM dbo.sale_payments x WHERE x.sale_id = s.id)));
END
GO

/* ---------- sp_platform_settlement_candidates (SQL_STORED_PROCEDURE) ---------- */
/* sp_platform_settlement_candidates
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================= sp_platform_settlement_candidates (0069) =================
   LA UNICA RESPUESTA a "que ventas de la caja pueden ser de esta
   liquidacion". La usan emparejar, consultar y confirmar; por eso llena la
   tabla #candidatas que crea quien la llama, en vez de devolver filas:

     CREATE TABLE #candidatas (sale_id INT PRIMARY KEY, datee DATETIME2(0),
        dia DATE, amount DECIMAL(14,2), reference NVARCHAR(100) COLLATE DATABASE_DEFAULT,
        nref NVARCHAR(100) COLLATE DATABASE_DEFAULT, channel_id NVARCHAR(64) COLLATE DATABASE_DEFAULT, channel_name NVARCHAR(120) COLLATE DATABASE_DEFAULT,
        mapped BIT, in_period BIT);

   COLLATE DATABASE_DEFAULT: una tabla # nace con la intercalacion de
   tempdb (la del servidor), que no siempre es la de la base.

   Una venta es candidata si:
     · se pago (toda o en parte) con PLATAFORMA; el importe es esa parte;
     · su canal es de ESTA plataforma (mapped = 1) o no es de ninguna
       (Mostrador o un canal sin ligar: la caja no supo de donde vino);
     · cae en el periodo, o a un dia de el (in_period = 0): un pedido de las
       23:58 puede entrar a la caja al dia siguiente;
     · no esta ya en otra liquidacion viva de cualquier plataforma.
   nref es la referencia normalizada (sin '#', espacios ni guiones, en
   mayusculas), la misma regla que se aplica al id del pedido.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_candidates
    @settlement_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @platform VARCHAR(12), @desde DATE, @hasta DATE;
    SELECT @platform = platform, @desde = period_from, @hasta = period_to
      FROM dbo.platform_settlements WHERE id = @settlement_id;
    IF @platform IS NULL RETURN;

    INSERT INTO #candidatas (sale_id, datee, dia, amount, reference, nref, channel_id, channel_name, mapped, in_period)
    SELECT s.id, s.datee, CAST(s.datee AS DATE),
           CAST(ISNULL(p.amount, s.total) AS DECIMAL(14, 2)),
           p.reference,
           NULLIF(UPPER(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(p.reference)), N'#', N''), N' ', N''), N'-', N'')), N''),
           JSON_VALUE(s.commercial_snapshot, '$.channel'),
           JSON_VALUE(s.commercial_snapshot, '$.channelName'),
           CASE WHEN pc.platform = @platform THEN 1 ELSE 0 END,
           CASE WHEN s.datee >= @desde AND s.datee < DATEADD(DAY, 1, @hasta) THEN 1 ELSE 0 END
      FROM dbo.sales s
      LEFT JOIN dbo.sale_payments p ON p.sale_id = s.id AND p.payment_method = 'PLATAFORMA'
      LEFT JOIN dbo.platform_channels pc ON pc.channel_id = JSON_VALUE(s.commercial_snapshot, '$.channel')
     WHERE s.datee >= DATEADD(DAY, -1, @desde) AND s.datee < DATEADD(DAY, 2, @hasta)
       AND (p.id IS NOT NULL
            OR (s.payment_method = 'PLATAFORMA' AND NOT EXISTS (SELECT 1 FROM dbo.sale_payments x WHERE x.sale_id = s.id)))
       AND (pc.platform IS NULL OR pc.platform = @platform)
       AND NOT EXISTS (SELECT 1 FROM dbo.platform_settlement_orders o
                         JOIN dbo.platform_settlements t ON t.id = o.settlement_id
                        WHERE o.sale_id = s.id AND t.id <> @settlement_id AND t.status <> 'CANCELADA')
       AND NOT EXISTS (SELECT 1 FROM dbo.platform_settlement_allocations a
                         JOIN dbo.platform_settlements t ON t.id = a.settlement_id
                        WHERE a.sale_id = s.id AND t.id <> @settlement_id AND t.status = 'CONFIRMADA');
END
GO

/* ---------- sp_platform_settlement_confirm (SQL_STORED_PROCEDURE) ---------- */
/* sp_platform_settlement_confirm
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================== sp_platform_settlement_confirm (0069) ==================
   Confirma una liquidacion: desde aqui cuenta en el estado de resultados.

   1  REPARTO. El desglose se reparte entre las ventas en proporcion a lo que
      cada una cobro en plataforma, y cae en el dia y el canal de cada venta:
        · las ventas emparejadas con un pedido; si no hay ninguna,
        · las ventas del periodo con canal de esta plataforma; si tampoco,
        · el ultimo dia del periodo, sin venta.
      Cada importe se separa en base y su IVA con la tasa de la liquidacion:
        promociones   -> discount_base / discount_iva   (descuento a la venta)
        reembolsos    -> refund_base / refund_iva       (ajuste a la venta)
        otros ajustes -> refund_base, tal cual         (sin IVA desglosado)
        comision      -> fee_base / fee_iva             (gasto / IVA acreditable)
        ISR + IVA ret -> withheld                       (acreditable, no gasto)
   2  EGRESO. La comision SIN IVA queda como egreso del concepto de
      plataforma, forma de pago OTRO (se desconto del deposito), fechado el
      ultimo dia del periodo y ligado a la liquidacion. Su IVA no es gasto.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_confirm
    @settlement_id INT,
    @user_id       INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @estado VARCHAR(10), @platform VARCHAR(12), @desde DATE, @hasta DATE, @rate DECIMAL(5, 4),
            @mkt DECIMAL(14, 2), @fee DECIMAL(14, 2), @ref DECIMAL(14, 2), @otro DECIMAL(14, 2), @ret DECIMAL(14, 2),
            @gross DECIMAL(14, 2);

    IF @user_id IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id)
        THROW 51000, 'Sesion no valida.', 1;

    CREATE TABLE #candidatas (sale_id INT PRIMARY KEY, datee DATETIME2(0), dia DATE, amount DECIMAL(14, 2),
        reference NVARCHAR(100) COLLATE DATABASE_DEFAULT, nref NVARCHAR(100) COLLATE DATABASE_DEFAULT, channel_id NVARCHAR(64) COLLATE DATABASE_DEFAULT, channel_name NVARCHAR(120) COLLATE DATABASE_DEFAULT,
        mapped BIT, in_period BIT);
    CREATE TABLE #b (sale_id INT NULL, channel_id NVARCHAR(64) COLLATE DATABASE_DEFAULT NULL, dia DATE NOT NULL, w DECIMAL(14, 2) NOT NULL);

    BEGIN TRAN;
    SELECT @estado = status, @platform = platform, @desde = period_from, @hasta = period_to, @rate = iva_rate,
           @mkt = marketing, @fee = service_fees, @ref = refunds, @otro = other_adjustments,
           @ret = isr_withheld + iva_withheld, @gross = gross_sales
      FROM dbo.platform_settlements WITH (UPDLOCK, HOLDLOCK) WHERE id = @settlement_id;
    IF @estado IS NULL THROW 51000, 'La liquidacion no existe.', 1;
    IF @estado <> 'BORRADOR' THROW 51000, 'Esta liquidacion ya no esta en borrador.', 1;
    IF @hasta > CAST(GETDATE() AS DATE)
        THROW 51000, 'El periodo todavia no termina: confirma la liquidacion cuando cierre.', 1;
    IF @gross = 0 AND @mkt = 0 AND @fee = 0 AND @ref = 0 AND @otro = 0 AND @ret = 0
        THROW 51000, 'Captura el desglose de la plataforma antes de confirmar.', 1;

    EXEC dbo.sp_platform_settlement_candidates @settlement_id = @settlement_id;

    /* Una emparejada que otra liquidacion tomo mientras tanto ya no cuenta. */
    INSERT INTO #b (sale_id, channel_id, dia, w)
    SELECT c.sale_id, c.channel_id, c.dia, c.amount
      FROM dbo.platform_settlement_orders o
      JOIN #candidatas c ON c.sale_id = o.sale_id
     WHERE o.settlement_id = @settlement_id AND o.cancelled = 0;
    IF NOT EXISTS (SELECT 1 FROM #b)
        INSERT INTO #b (sale_id, channel_id, dia, w)
        SELECT sale_id, channel_id, dia, amount FROM #candidatas WHERE mapped = 1 AND in_period = 1;
    IF NOT EXISTS (SELECT 1 FROM #b)
        INSERT INTO #b (sale_id, channel_id, dia, w)
        SELECT NULL, (SELECT TOP (1) channel_id FROM dbo.platform_channels WHERE platform = @platform ORDER BY channel_id), @hasta, 1;

    /* La proporcion va en FLOAT: en DECIMAL, SQL Server recorta la escala de
       cada cociente y con miles de pedidos el reparto dejaba de sumar el
       total. Lo guardado lleva seis decimales; la suma cuadra al centavo. */
    DECLARE @total FLOAT = (SELECT SUM(CAST(w AS FLOAT)) FROM #b);
    DECLARE @k FLOAT = 1 + CAST(@rate AS FLOAT);

    DELETE FROM dbo.platform_settlement_allocations WHERE settlement_id = @settlement_id;
    INSERT INTO dbo.platform_settlement_allocations (settlement_id, sale_id, channel_id, alloc_date,
        discount_base, discount_iva, refund_base, refund_iva, fee_base, fee_iva, withheld)
    SELECT @settlement_id, b.sale_id, b.channel_id, b.dia,
           CAST(@mkt / @k * f.p AS DECIMAL(18, 6)), CAST((@mkt - @mkt / @k) * f.p AS DECIMAL(18, 6)),
           CAST((@ref / @k + @otro) * f.p AS DECIMAL(18, 6)), CAST((@ref - @ref / @k) * f.p AS DECIMAL(18, 6)),
           CAST(@fee / @k * f.p AS DECIMAL(18, 6)), CAST((@fee - @fee / @k) * f.p AS DECIMAL(18, 6)),
           CAST(@ret * f.p AS DECIMAL(18, 6))
      FROM #b b
     CROSS APPLY (SELECT CAST(b.w AS FLOAT) / @total AS p) f;

    /* ----------------------------------------------- el egreso de comision */
    DECLARE @expense_id INT = NULL, @fee_base DECIMAL(12, 2) = ROUND(@fee / @k, 2);
    IF @fee_base > 0
    BEGIN
        DECLARE @cat INT = (SELECT TOP (1) id FROM dbo.expense_categories WHERE kind = 'PLATAFORMA' ORDER BY id);
        IF @cat IS NULL THROW 51000, 'Falta el concepto de egreso de plataforma.', 1;
        DECLARE @nombre NVARCHAR(40) = CASE @platform WHEN 'UBER_EATS' THEN N'Uber Eats' WHEN 'DIDI_FOOD' THEN N'Didi Food' ELSE N'Rappi' END;
        INSERT INTO dbo.expenses (expense_date, category_id, amount, payment_method, note, user_id, beneficiary, platform_settlement_id)
        VALUES (@hasta, @cat, @fee_base, 'OTRO',
                LEFT(N'Liquidacion #' + CAST(@settlement_id AS NVARCHAR(12)) + N' ' + @nombre + N' del '
                     + CONVERT(NVARCHAR(10), @desde, 103) + N' al ' + CONVERT(NVARCHAR(10), @hasta, 103)
                     + N'. Comision sin IVA; el IVA es acreditable.', 255),
                @user_id, @nombre, @settlement_id);
        SET @expense_id = SCOPE_IDENTITY();
    END

    UPDATE dbo.platform_settlements
       SET status = 'CONFIRMADA', confirmed_by = @user_id, confirmed_at = SYSDATETIME(),
           expense_id = @expense_id, updated_at = SYSDATETIME()
     WHERE id = @settlement_id;
    COMMIT TRAN;

    SELECT @settlement_id AS id, @expense_id AS expense_id, (SELECT COUNT(*) FROM #b) AS ventas_repartidas;
END
GO

/* ---------- sp_platform_settlement_deposit (SQL_STORED_PROCEDURE) ---------- */
/* sp_platform_settlement_deposit
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================== sp_platform_settlement_deposit (0069) ==================
   Registra (o corrige) el deposito que de verdad llego de la plataforma.
   Es el cobro de lo que la plataforma debia: no es venta ni ingreso nuevo,
   asi que no toca resultados. @amount = NULL lo quita (aun no llega).
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_deposit
    @settlement_id INT,
    @amount        DECIMAL(14, 2) = NULL,
    @deposit_date  DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @estado VARCHAR(10) = (SELECT status FROM dbo.platform_settlements WHERE id = @settlement_id);
    IF @estado IS NULL THROW 51000, 'La liquidacion no existe.', 1;
    IF @estado = 'CANCELADA' THROW 51000, 'La liquidacion esta cancelada.', 1;
    IF @amount IS NOT NULL AND @deposit_date IS NULL SET @deposit_date = CAST(GETDATE() AS DATE);
    IF @deposit_date > CAST(GETDATE() AS DATE) THROW 51000, 'La fecha del deposito no puede ser futura.', 1;

    UPDATE dbo.platform_settlements
       SET deposit_real = @amount, deposit_date = CASE WHEN @amount IS NULL THEN NULL ELSE @deposit_date END,
           updated_at = SYSDATETIME()
     WHERE id = @settlement_id;
    SELECT id, deposit_expected, deposit_real, deposit_date,
           CAST(deposit_real - deposit_expected AS DECIMAL(14, 2)) AS deposit_difference
      FROM dbo.platform_settlements WHERE id = @settlement_id;
END
GO

/* ---------- sp_platform_settlement_get (SQL_STORED_PROCEDURE) ---------- */
/* sp_platform_settlement_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ==================== sp_platform_settlement_get (0069) ====================
   Una liquidacion y su conciliacion contra la caja.

     1  encabezado   desglose, deposito esperado y real, y los conteos
     2  pedidos      cada pedido de la plataforma con su venta, si la hay:
                       OK            emparejado y mismo importe
                       DIFERENCIA    emparejado, importe distinto
                       FALTA_EN_CAJA la plataforma lo cobro, la caja no lo tiene
                       CANCELADO     la plataforma lo cancelo
     3  sobrantes    ventas pagadas en plataforma, del periodo, que ningun
                     pedido reclamo (de esta plataforma o sin plataforma)
   En una liquidacion CONFIRMADA o CANCELADA no hay sobrantes: ya se cerro.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_get
    @settlement_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @estado VARCHAR(10) = (SELECT status FROM dbo.platform_settlements WHERE id = @settlement_id);
    IF @estado IS NULL THROW 51000, 'La liquidacion no existe.', 1;

    CREATE TABLE #candidatas (sale_id INT PRIMARY KEY, datee DATETIME2(0), dia DATE, amount DECIMAL(14, 2),
        reference NVARCHAR(100) COLLATE DATABASE_DEFAULT, nref NVARCHAR(100) COLLATE DATABASE_DEFAULT, channel_id NVARCHAR(64) COLLATE DATABASE_DEFAULT, channel_name NVARCHAR(120) COLLATE DATABASE_DEFAULT,
        mapped BIT, in_period BIT);
    IF @estado = 'BORRADOR'
        EXEC dbo.sp_platform_settlement_candidates @settlement_id = @settlement_id;

    /* Lo que la caja cobro en plataforma por cada venta emparejada. */
    SELECT o.id, o.line_no, o.platform_order_id, o.order_at, o.customer, o.fulfillment, o.platform_status,
           o.sales_base, o.tax, o.sales_total, o.net_amount, o.cancelled, o.sale_id, o.match_kind,
           s.datee AS sale_datee,
           CAST(ISNULL(p.amount, s.total) AS DECIMAL(14, 2)) AS caja_amount,
           p.reference AS caja_reference,
           JSON_VALUE(s.commercial_snapshot, '$.channelName') AS caja_channel,
           CASE WHEN o.cancelled = 1 THEN 'CANCELADO'
                WHEN o.sale_id IS NULL THEN 'FALTA_EN_CAJA'
                WHEN ISNULL(p.amount, s.total) = o.sales_total THEN 'OK'
                ELSE 'DIFERENCIA' END AS estado
      INTO #p
      FROM dbo.platform_settlement_orders o
      LEFT JOIN dbo.sales s ON s.id = o.sale_id
      LEFT JOIN dbo.sale_payments p ON p.sale_id = s.id AND p.payment_method = 'PLATAFORMA'
     WHERE o.settlement_id = @settlement_id;

    SELECT c.sale_id, c.datee, c.amount, c.reference, c.channel_name, c.mapped
      INTO #s
      FROM #candidatas c
     WHERE c.in_period = 1
       AND NOT EXISTS (SELECT 1 FROM #p p WHERE p.sale_id = c.sale_id);

    /* ================================ 1 encabezado */
    SELECT t.id, t.platform, t.period_from, t.period_to, t.status, t.source_file,
           t.gross_sales, t.marketing, t.service_fees, t.refunds, t.isr_withheld, t.iva_withheld,
           t.other_adjustments, t.iva_rate, t.deposit_expected, t.deposit_real, t.deposit_date,
           CAST(t.deposit_real - t.deposit_expected AS DECIMAL(14, 2)) AS deposit_difference,
           t.note, t.expense_id, t.created_at, uc.usuario AS created_by_name,
           t.confirmed_at, uf.usuario AS confirmed_by_name, t.voided_at, uv.usuario AS voided_by_name, t.void_reason,
           /* Lo que toca resultados, sin IVA, como se repartira al confirmar. */
           CAST(t.service_fees / (1 + t.iva_rate) AS DECIMAL(14, 2)) AS fee_base,
           CAST(t.service_fees - t.service_fees / (1 + t.iva_rate) AS DECIMAL(14, 2)) AS fee_iva,
           CAST(t.marketing / (1 + t.iva_rate) AS DECIMAL(14, 2)) AS marketing_base,
           CAST(t.refunds / (1 + t.iva_rate) + t.other_adjustments AS DECIMAL(14, 2)) AS refunds_base,
           (SELECT COUNT(*) FROM #p) AS pedidos,
           (SELECT COUNT(*) FROM #p WHERE estado = 'OK') AS pedidos_ok,
           (SELECT COUNT(*) FROM #p WHERE estado = 'DIFERENCIA') AS pedidos_diferencia,
           (SELECT COUNT(*) FROM #p WHERE estado = 'FALTA_EN_CAJA') AS pedidos_faltan,
           (SELECT COUNT(*) FROM #p WHERE estado = 'CANCELADO') AS pedidos_cancelados,
           (SELECT COUNT(*) FROM #s) AS caja_sobrantes,
           CAST((SELECT ISNULL(SUM(sales_total), 0) FROM #p WHERE cancelled = 0) AS DECIMAL(14, 2)) AS total_plataforma,
           CAST((SELECT ISNULL(SUM(caja_amount), 0) FROM #p WHERE sale_id IS NOT NULL) AS DECIMAL(14, 2)) AS total_caja_emparejado,
           CAST((SELECT ISNULL(SUM(sales_total), 0) FROM #p WHERE estado = 'FALTA_EN_CAJA') AS DECIMAL(14, 2)) AS total_faltan,
           CAST((SELECT ISNULL(SUM(amount), 0) FROM #s) AS DECIMAL(14, 2)) AS total_sobrantes
      FROM dbo.platform_settlements t
      LEFT JOIN dbo.users uc ON uc.id = t.created_by
      LEFT JOIN dbo.users uf ON uf.id = t.confirmed_by
      LEFT JOIN dbo.users uv ON uv.id = t.voided_by
     WHERE t.id = @settlement_id;

    /* ================================ 2 pedidos */
    SELECT id, line_no, platform_order_id, order_at, customer, fulfillment, platform_status,
           sales_base, tax, sales_total, net_amount, cancelled, sale_id, match_kind, sale_datee,
           caja_amount, caja_reference, caja_channel,
           CAST(CASE WHEN sale_id IS NULL THEN NULL ELSE caja_amount - sales_total END AS DECIMAL(14, 2)) AS diferencia,
           estado
      FROM #p
     ORDER BY CASE estado WHEN 'FALTA_EN_CAJA' THEN 0 WHEN 'DIFERENCIA' THEN 1 WHEN 'OK' THEN 2 ELSE 3 END, order_at, line_no;

    /* ================================ 3 sobrantes */
    SELECT sale_id, datee, amount, reference, channel_name, mapped FROM #s ORDER BY datee;
END
GO

/* ---------- sp_platform_settlement_link (SQL_STORED_PROCEDURE) ---------- */
/* sp_platform_settlement_link
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* =================== sp_platform_settlement_link (0069) ===================
   Empareja A MANO un pedido de la plataforma con una venta de la caja (la
   que la regla no pudo decidir), o lo suelta con @sale_id = NULL. Solo en
   BORRADOR, y solo con una venta candidata que nadie mas haya tomado.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_link
    @settlement_id INT,
    @order_line_id INT,
    @sale_id       INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.platform_settlements WHERE id = @settlement_id AND status = 'BORRADOR')
        THROW 51000, 'Solo se empareja una liquidacion en borrador.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.platform_settlement_orders WHERE id = @order_line_id AND settlement_id = @settlement_id)
        THROW 51000, 'Ese pedido no es de esta liquidacion.', 1;
    IF EXISTS (SELECT 1 FROM dbo.platform_settlement_orders WHERE id = @order_line_id AND cancelled = 1) AND @sale_id IS NOT NULL
        THROW 51000, 'La plataforma cancelo ese pedido: no lleva venta.', 1;

    IF @sale_id IS NOT NULL
    BEGIN
        CREATE TABLE #candidatas (sale_id INT PRIMARY KEY, datee DATETIME2(0), dia DATE, amount DECIMAL(14, 2),
            reference NVARCHAR(100) COLLATE DATABASE_DEFAULT, nref NVARCHAR(100) COLLATE DATABASE_DEFAULT, channel_id NVARCHAR(64) COLLATE DATABASE_DEFAULT, channel_name NVARCHAR(120) COLLATE DATABASE_DEFAULT,
            mapped BIT, in_period BIT);
        EXEC dbo.sp_platform_settlement_candidates @settlement_id = @settlement_id;
        IF NOT EXISTS (SELECT 1 FROM #candidatas WHERE sale_id = @sale_id)
            THROW 51000, 'Esa venta no se pago en plataforma en este periodo, o ya esta en otra liquidacion.', 1;
        IF EXISTS (SELECT 1 FROM dbo.platform_settlement_orders WHERE settlement_id = @settlement_id AND sale_id = @sale_id AND id <> @order_line_id)
            THROW 51000, 'Esa venta ya esta emparejada con otro pedido.', 1;
    END

    UPDATE dbo.platform_settlement_orders
       SET sale_id = @sale_id, match_kind = CASE WHEN @sale_id IS NULL THEN NULL ELSE 'MANUAL' END
     WHERE id = @order_line_id;
    UPDATE dbo.platform_settlements SET updated_at = SYSDATETIME() WHERE id = @settlement_id;
    SELECT @order_line_id AS id, @sale_id AS sale_id;
END
GO

/* ---------- sp_platform_settlement_list (SQL_STORED_PROCEDURE) ---------- */
/* sp_platform_settlement_list
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* =================== sp_platform_settlement_list (0069) ===================
   Las liquidaciones cuyo periodo toca [@desde, @hasta] y lo que las
   plataformas le deben al negocio HOY.

     1  liquidaciones   encabezado de cada una (sin las canceladas, salvo
                        @include_voided = 1)
     2  por cobrar      por plataforma:
                          sin_liquidar   ventas pagadas en plataforma de un
                                         canal de esa plataforma que ninguna
                                         liquidacion viva tiene (al ticket)
                          sin_deposito   confirmadas cuyo deposito no llega
                                         (al deposito esperado)
                          retenciones e IVA de comision del rango, de las
                          confirmadas: acreditables, no gasto
     3  sin plataforma  ventas pagadas en plataforma cuyo canal no esta
                        ligado a ninguna plataforma (del rango)
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_list
    @platform       VARCHAR(12) = NULL,
    @desde          DATE = NULL,
    @hasta          DATE = NULL,
    @include_voided BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF @hasta IS NULL SET @hasta = CAST(GETDATE() AS DATE);
    IF @desde IS NULL SET @desde = DATEADD(DAY, -90, @hasta);
    SET @platform = NULLIF(UPPER(LTRIM(RTRIM(@platform))), '');

    /* ================================ 1 liquidaciones */
    SELECT t.id, t.platform, t.period_from, t.period_to, t.status, t.source_file,
           t.gross_sales, t.marketing, t.service_fees, t.refunds, t.isr_withheld, t.iva_withheld, t.other_adjustments,
           t.deposit_expected, t.deposit_real, t.deposit_date,
           CAST(t.deposit_real - t.deposit_expected AS DECIMAL(14, 2)) AS deposit_difference,
           t.created_at, t.confirmed_at, t.voided_at, t.void_reason,
           (SELECT COUNT(*) FROM dbo.platform_settlement_orders o WHERE o.settlement_id = t.id) AS pedidos,
           (SELECT COUNT(*) FROM dbo.platform_settlement_orders o WHERE o.settlement_id = t.id AND o.sale_id IS NULL AND o.cancelled = 0) AS pedidos_faltan
      FROM dbo.platform_settlements t
     WHERE (@platform IS NULL OR t.platform = @platform)
       AND t.period_from <= @hasta AND t.period_to >= @desde
       AND (@include_voided = 1 OR t.status <> 'CANCELADA')
     ORDER BY t.period_to DESC, t.id DESC;

    /* ================================ 2 por cobrar */
    ;WITH plataformas AS (
        SELECT v.platform FROM (VALUES ('UBER_EATS'), ('DIDI_FOOD'), ('RAPPI')) v(platform)
         WHERE @platform IS NULL OR v.platform = @platform),
    pendientes AS (
        SELECT pc.platform, s.id, s.datee, CAST(ISNULL(p.amount, s.total) AS DECIMAL(14, 2)) AS amount
          FROM dbo.sales s
          JOIN dbo.platform_channels pc ON pc.channel_id = JSON_VALUE(s.commercial_snapshot, '$.channel')
          LEFT JOIN dbo.sale_payments p ON p.sale_id = s.id AND p.payment_method = 'PLATAFORMA'
         WHERE (p.id IS NOT NULL OR (s.payment_method = 'PLATAFORMA' AND NOT EXISTS (SELECT 1 FROM dbo.sale_payments x WHERE x.sale_id = s.id)))
           AND NOT EXISTS (SELECT 1 FROM dbo.platform_settlement_orders o JOIN dbo.platform_settlements t ON t.id = o.settlement_id
                            WHERE o.sale_id = s.id AND t.status <> 'CANCELADA')
           AND NOT EXISTS (SELECT 1 FROM dbo.platform_settlement_allocations a JOIN dbo.platform_settlements t ON t.id = a.settlement_id
                            WHERE a.sale_id = s.id AND t.status = 'CONFIRMADA'))
    SELECT pl.platform,
           (SELECT COUNT(*) FROM pendientes x WHERE x.platform = pl.platform) AS ventas_sin_liquidar,
           CAST((SELECT ISNULL(SUM(amount), 0) FROM pendientes x WHERE x.platform = pl.platform) AS DECIMAL(14, 2)) AS importe_sin_liquidar,
           (SELECT MIN(CAST(datee AS DATE)) FROM pendientes x WHERE x.platform = pl.platform) AS desde_sin_liquidar,
           (SELECT COUNT(*) FROM dbo.platform_settlements t WHERE t.platform = pl.platform AND t.status = 'CONFIRMADA' AND t.deposit_real IS NULL) AS liquidaciones_sin_deposito,
           CAST((SELECT ISNULL(SUM(deposit_expected), 0) FROM dbo.platform_settlements t
                  WHERE t.platform = pl.platform AND t.status = 'CONFIRMADA' AND t.deposit_real IS NULL) AS DECIMAL(14, 2)) AS importe_sin_deposito,
           CAST((SELECT ISNULL(SUM(isr_withheld), 0) FROM dbo.platform_settlements t
                  WHERE t.platform = pl.platform AND t.status = 'CONFIRMADA' AND t.period_to BETWEEN @desde AND @hasta) AS DECIMAL(14, 2)) AS isr_retenido,
           CAST((SELECT ISNULL(SUM(iva_withheld), 0) FROM dbo.platform_settlements t
                  WHERE t.platform = pl.platform AND t.status = 'CONFIRMADA' AND t.period_to BETWEEN @desde AND @hasta) AS DECIMAL(14, 2)) AS iva_retenido,
           CAST((SELECT ISNULL(SUM(service_fees - service_fees / (1 + iva_rate)), 0) FROM dbo.platform_settlements t
                  WHERE t.platform = pl.platform AND t.status = 'CONFIRMADA' AND t.period_to BETWEEN @desde AND @hasta) AS DECIMAL(14, 2)) AS iva_comision,
           (SELECT COUNT(*) FROM dbo.platform_channels c WHERE c.platform = pl.platform) AS canales
      FROM plataformas pl
     ORDER BY pl.platform DESC;

    /* ================================ 3 sin plataforma */
    SELECT COUNT(*) AS ventas, CAST(ISNULL(SUM(ISNULL(p.amount, s.total)), 0) AS DECIMAL(14, 2)) AS importe
      FROM dbo.sales s
      LEFT JOIN dbo.sale_payments p ON p.sale_id = s.id AND p.payment_method = 'PLATAFORMA'
      LEFT JOIN dbo.platform_channels pc ON pc.channel_id = JSON_VALUE(s.commercial_snapshot, '$.channel')
     WHERE s.datee >= @desde AND s.datee < DATEADD(DAY, 1, @hasta) AND pc.channel_id IS NULL
       AND (p.id IS NOT NULL OR (s.payment_method = 'PLATAFORMA' AND NOT EXISTS (SELECT 1 FROM dbo.sale_payments x WHERE x.sale_id = s.id)))
       AND NOT EXISTS (SELECT 1 FROM dbo.platform_settlement_orders o JOIN dbo.platform_settlements t ON t.id = o.settlement_id
                        WHERE o.sale_id = s.id AND t.status <> 'CANCELADA');
END
GO

/* ---------- sp_platform_settlement_match (SQL_STORED_PROCEDURE) ---------- */
/* sp_platform_settlement_match
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* =================== sp_platform_settlement_match (0069) ===================
   Empareja los pedidos que reporto la plataforma con las ventas de la caja.
   Solo en BORRADOR. Lo emparejado a mano (MANUAL) se respeta; lo demas se
   rehace desde cero cada vez, asi que llamarlo dos veces da lo mismo.

     1  REFERENCIA  el numero de pedido capturado en la caja es el id del
                    pedido o su principio (la tablet de la plataforma ensena
                    los primeros caracteres). Solo si es inequivoco en los dos
                    sentidos.
     2  IMPORTE     mismo dia y mismo importe. Pedidos y ventas iguales del
                    mismo dia se emparejan en orden: da igual cual con cual.
     3  IMPORTE     a un dia de distancia y mismo importe, solo si la pareja
                    es unica en los dos sentidos.
   Los pedidos cancelados por la plataforma no se emparejan.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_match
    @settlement_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.platform_settlements WHERE id = @settlement_id AND status = 'BORRADOR')
        THROW 51000, 'Solo se empareja una liquidacion en borrador.', 1;

    CREATE TABLE #candidatas (sale_id INT PRIMARY KEY, datee DATETIME2(0), dia DATE, amount DECIMAL(14, 2),
        reference NVARCHAR(100) COLLATE DATABASE_DEFAULT, nref NVARCHAR(100) COLLATE DATABASE_DEFAULT, channel_id NVARCHAR(64) COLLATE DATABASE_DEFAULT, channel_name NVARCHAR(120) COLLATE DATABASE_DEFAULT,
        mapped BIT, in_period BIT);
    EXEC dbo.sp_platform_settlement_candidates @settlement_id = @settlement_id;

    BEGIN TRAN;
    UPDATE dbo.platform_settlement_orders SET sale_id = NULL, match_kind = NULL
     WHERE settlement_id = @settlement_id AND match_kind <> 'MANUAL';
    /* Un MANUAL que ya no es candidata (otra liquidacion la tomo) se suelta. */
    UPDATE o SET sale_id = NULL, match_kind = NULL
      FROM dbo.platform_settlement_orders o
     WHERE o.settlement_id = @settlement_id AND o.match_kind = 'MANUAL'
       AND NOT EXISTS (SELECT 1 FROM #candidatas c WHERE c.sale_id = o.sale_id);
    DELETE c FROM #candidatas c
     WHERE EXISTS (SELECT 1 FROM dbo.platform_settlement_orders o WHERE o.settlement_id = @settlement_id AND o.sale_id = c.sale_id);

    /* ------------------------------------------------ 1 por referencia */
    ;WITH o AS (
        SELECT id, NULLIF(UPPER(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(platform_order_id)), N'#', N''), N' ', N''), N'-', N'')), N'') AS nid
          FROM dbo.platform_settlement_orders
         WHERE settlement_id = @settlement_id AND sale_id IS NULL AND cancelled = 0),
    par AS (
        SELECT o.id AS order_line, c.sale_id
          FROM o JOIN #candidatas c ON c.nref IS NOT NULL AND o.nid IS NOT NULL
           AND (c.nref = o.nid
                OR (LEN(c.nref) >= 4 AND LEFT(o.nid, LEN(c.nref)) = c.nref)
                OR (LEN(o.nid) >= 4 AND LEFT(c.nref, LEN(o.nid)) = o.nid))),
    unico AS (
        SELECT p.order_line, p.sale_id FROM par p
         WHERE (SELECT COUNT(*) FROM par x WHERE x.order_line = p.order_line) = 1
           AND (SELECT COUNT(*) FROM par x WHERE x.sale_id = p.sale_id) = 1)
    UPDATE t SET sale_id = u.sale_id, match_kind = 'REFERENCIA'
      FROM dbo.platform_settlement_orders t JOIN unico u ON u.order_line = t.id;
    DELETE c FROM #candidatas c
     WHERE EXISTS (SELECT 1 FROM dbo.platform_settlement_orders o WHERE o.settlement_id = @settlement_id AND o.sale_id = c.sale_id);

    /* ------------------------------------- 2 mismo dia, mismo importe */
    ;WITH o AS (
        SELECT id, CAST(order_at AS DATE) AS dia, sales_total,
               ROW_NUMBER() OVER (PARTITION BY CAST(order_at AS DATE), sales_total ORDER BY order_at, line_no) AS n
          FROM dbo.platform_settlement_orders
         WHERE settlement_id = @settlement_id AND sale_id IS NULL AND cancelled = 0 AND order_at IS NOT NULL),
    c AS (
        SELECT sale_id, dia, amount, ROW_NUMBER() OVER (PARTITION BY dia, amount ORDER BY datee, sale_id) AS n
          FROM #candidatas)
    UPDATE t SET sale_id = c.sale_id, match_kind = 'IMPORTE'
      FROM dbo.platform_settlement_orders t
      JOIN o ON o.id = t.id
      JOIN c ON c.dia = o.dia AND c.amount = o.sales_total AND c.n = o.n;
    DELETE c FROM #candidatas c
     WHERE EXISTS (SELECT 1 FROM dbo.platform_settlement_orders o WHERE o.settlement_id = @settlement_id AND o.sale_id = c.sale_id);

    /* --------------------------------- 3 un dia de distancia, unico */
    ;WITH par AS (
        SELECT t.id AS order_line, c.sale_id
          FROM dbo.platform_settlement_orders t
          JOIN #candidatas c ON c.amount = t.sales_total AND ABS(DATEDIFF(DAY, CAST(t.order_at AS DATE), c.dia)) = 1
         WHERE t.settlement_id = @settlement_id AND t.sale_id IS NULL AND t.cancelled = 0 AND t.order_at IS NOT NULL),
    unico AS (
        SELECT p.order_line, p.sale_id FROM par p
         WHERE (SELECT COUNT(*) FROM par x WHERE x.order_line = p.order_line) = 1
           AND (SELECT COUNT(*) FROM par x WHERE x.sale_id = p.sale_id) = 1)
    UPDATE t SET sale_id = u.sale_id, match_kind = 'IMPORTE'
      FROM dbo.platform_settlement_orders t JOIN unico u ON u.order_line = t.id;

    UPDATE dbo.platform_settlements SET updated_at = SYSDATETIME() WHERE id = @settlement_id;
    COMMIT TRAN;
END
GO

/* ---------- sp_platform_settlement_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_platform_settlement_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* =================== sp_platform_settlement_save (0069) ===================
   Crea o cambia una liquidacion en BORRADOR y vuelve a emparejar.

   Importes con IVA, tal como los ensena la plataforma, y en positivo (lo que
   descuenta). @other_adjustments lleva signo: negativo si la plataforma pago
   de mas. El deposito esperado lo calcula la tabla.

   @orders_json (opcional) reemplaza TODOS los pedidos. Un arreglo de
     { "id", "at", "customer", "fulfillment", "status",
       "base", "tax", "total", "net", "cancelled" }
   donde total = lo que pago el cliente con IVA. Si falta, total = base + tax.
   Sin @orders_json los pedidos se quedan como estaban.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_save
    @id                INT = NULL,
    @user_id           INT,
    @platform          VARCHAR(12),
    @period_from       DATE,
    @period_to         DATE,
    @source_file       NVARCHAR(200) = NULL,
    @gross_sales       DECIMAL(14, 2) = 0,
    @marketing         DECIMAL(14, 2) = 0,
    @service_fees      DECIMAL(14, 2) = 0,
    @refunds           DECIMAL(14, 2) = 0,
    @isr_withheld      DECIMAL(14, 2) = 0,
    @iva_withheld      DECIMAL(14, 2) = 0,
    @other_adjustments DECIMAL(14, 2) = 0,
    @iva_rate          DECIMAL(5, 4) = 0.16,
    @deposit_real      DECIMAL(14, 2) = NULL,
    @deposit_date      DATE = NULL,
    @note              NVARCHAR(255) = NULL,
    @orders_json       NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @platform = UPPER(LTRIM(RTRIM(ISNULL(@platform, ''))));
    SET @note = NULLIF(LTRIM(RTRIM(@note)), N'');
    SET @source_file = NULLIF(LTRIM(RTRIM(@source_file)), N'');

    IF @user_id IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id)
        THROW 51000, 'Sesion no valida.', 1;
    IF @platform NOT IN ('UBER_EATS', 'DIDI_FOOD', 'RAPPI')
        THROW 51000, 'Elige la plataforma.', 1;
    IF @period_from IS NULL OR @period_to IS NULL OR @period_from > @period_to
        THROW 51000, 'Indica un periodo valido.', 1;
    IF DATEDIFF(DAY, @period_from, @period_to) > 366
        THROW 51000, 'El periodo maximo de una liquidacion es de un ano.', 1;
    IF ISNULL(@gross_sales, 0) < 0 OR ISNULL(@marketing, 0) < 0 OR ISNULL(@service_fees, 0) < 0
       OR ISNULL(@refunds, 0) < 0 OR ISNULL(@isr_withheld, 0) < 0 OR ISNULL(@iva_withheld, 0) < 0
        THROW 51000, 'Captura los descuentos en positivo: lo que la plataforma desconto.', 1;
    IF @iva_rate IS NULL OR @iva_rate < 0 OR @iva_rate >= 1
        THROW 51000, 'Tasa de IVA no valida.', 1;
    IF @deposit_real IS NOT NULL AND @deposit_date IS NULL SET @deposit_date = @period_to;
    IF @deposit_real IS NULL SET @deposit_date = NULL;

    /* --------------------------------------------- pedidos del archivo */
    CREATE TABLE #o (line_no INT NOT NULL, platform_order_id NVARCHAR(100) COLLATE DATABASE_DEFAULT, order_at DATETIME2(0),
        customer NVARCHAR(120) COLLATE DATABASE_DEFAULT, fulfillment NVARCHAR(40) COLLATE DATABASE_DEFAULT, platform_status NVARCHAR(40) COLLATE DATABASE_DEFAULT,
        sales_base DECIMAL(14, 2), tax DECIMAL(14, 2), sales_total DECIMAL(14, 2), net_amount DECIMAL(14, 2), cancelled BIT);
    IF @orders_json IS NOT NULL
    BEGIN
        IF ISJSON(@orders_json) <> 1 OR LEFT(LTRIM(@orders_json), 1) <> '['
            THROW 51000, 'El archivo de pedidos no es valido.', 1;
        INSERT INTO #o
        SELECT CAST(j.[key] AS INT) + 1,
               NULLIF(LTRIM(RTRIM(LEFT(JSON_VALUE(j.value, '$.id'), 100))), N''),
               TRY_CONVERT(DATETIME2(0), JSON_VALUE(j.value, '$.at'), 126),
               NULLIF(LEFT(JSON_VALUE(j.value, '$.customer'), 120), N''),
               NULLIF(LEFT(JSON_VALUE(j.value, '$.fulfillment'), 40), N''),
               NULLIF(LEFT(JSON_VALUE(j.value, '$.status'), 40), N''),
               TRY_CONVERT(DECIMAL(14, 2), JSON_VALUE(j.value, '$.base')),
               TRY_CONVERT(DECIMAL(14, 2), JSON_VALUE(j.value, '$.tax')),
               COALESCE(TRY_CONVERT(DECIMAL(14, 2), JSON_VALUE(j.value, '$.total')),
                        TRY_CONVERT(DECIMAL(14, 2), JSON_VALUE(j.value, '$.base')) + ISNULL(TRY_CONVERT(DECIMAL(14, 2), JSON_VALUE(j.value, '$.tax')), 0)),
               TRY_CONVERT(DECIMAL(14, 2), JSON_VALUE(j.value, '$.net')),
               CASE WHEN JSON_VALUE(j.value, '$.cancelled') IN ('true', '1') THEN 1 ELSE 0 END
          FROM OPENJSON(@orders_json) j;
        IF (SELECT COUNT(*) FROM #o) > 20000
            THROW 51000, 'El archivo trae mas de 20,000 pedidos: divide el periodo.', 1;
        IF EXISTS (SELECT 1 FROM #o WHERE sales_total IS NULL)
            THROW 51000, 'Hay pedidos sin importe en el archivo.', 1;
        IF EXISTS (SELECT platform_order_id FROM #o WHERE platform_order_id IS NOT NULL GROUP BY platform_order_id HAVING COUNT(*) > 1)
            THROW 51000, 'El archivo repite un mismo pedido.', 1;
    END

    BEGIN TRAN;
    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.platform_settlements (platform, period_from, period_to, source_file, gross_sales, marketing,
            service_fees, refunds, isr_withheld, iva_withheld, other_adjustments, iva_rate, deposit_real, deposit_date, note, created_by)
        VALUES (@platform, @period_from, @period_to, @source_file, ISNULL(@gross_sales, 0), ISNULL(@marketing, 0),
            ISNULL(@service_fees, 0), ISNULL(@refunds, 0), ISNULL(@isr_withheld, 0), ISNULL(@iva_withheld, 0),
            ISNULL(@other_adjustments, 0), @iva_rate, @deposit_real, @deposit_date, @note, @user_id);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        DECLARE @estado VARCHAR(10);
        SELECT @estado = status FROM dbo.platform_settlements WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;
        IF @estado IS NULL THROW 51000, 'La liquidacion no existe.', 1;
        IF @estado <> 'BORRADOR' THROW 51000, 'Solo se cambia una liquidacion en borrador.', 1;
        UPDATE dbo.platform_settlements
           SET platform = @platform, period_from = @period_from, period_to = @period_to,
               source_file = CASE WHEN @orders_json IS NOT NULL THEN @source_file ELSE ISNULL(@source_file, source_file) END,
               gross_sales = ISNULL(@gross_sales, 0), marketing = ISNULL(@marketing, 0), service_fees = ISNULL(@service_fees, 0),
               refunds = ISNULL(@refunds, 0), isr_withheld = ISNULL(@isr_withheld, 0), iva_withheld = ISNULL(@iva_withheld, 0),
               other_adjustments = ISNULL(@other_adjustments, 0), iva_rate = @iva_rate,
               deposit_real = @deposit_real, deposit_date = @deposit_date, note = @note, updated_at = SYSDATETIME()
         WHERE id = @id;
    END

    IF @orders_json IS NOT NULL
    BEGIN
        DELETE FROM dbo.platform_settlement_orders WHERE settlement_id = @id;
        INSERT INTO dbo.platform_settlement_orders (settlement_id, line_no, platform_order_id, order_at, customer, fulfillment,
            platform_status, sales_base, tax, sales_total, net_amount, cancelled)
        SELECT @id, line_no, platform_order_id, order_at, customer, fulfillment, platform_status, sales_base, tax,
               sales_total, net_amount, cancelled
          FROM #o;
    END
    COMMIT TRAN;

    EXEC dbo.sp_platform_settlement_match @settlement_id = @id;
    SELECT @id AS id;
END
GO

/* ---------- sp_platform_settlement_void (SQL_STORED_PROCEDURE) ---------- */
/* sp_platform_settlement_void
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* =================== sp_platform_settlement_void (0069) ===================
   Cancela una liquidacion (borrador o confirmada). No borra: queda quien,
   cuando y por que; su reparto deja de contar y su egreso de comision se
   cancela con el mismo motivo. Sus ventas quedan libres para otra.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_platform_settlement_void
    @settlement_id INT,
    @user_id       INT,
    @reason        NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @reason = NULLIF(LTRIM(RTRIM(@reason)), N'');
    IF @reason IS NULL THROW 51000, 'Escribe por que se cancela la liquidacion.', 1;
    IF @user_id IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id)
        THROW 51000, 'Sesion no valida.', 1;

    BEGIN TRAN;
    DECLARE @estado VARCHAR(10), @expense INT;
    SELECT @estado = status, @expense = expense_id
      FROM dbo.platform_settlements WITH (UPDLOCK, HOLDLOCK) WHERE id = @settlement_id;
    IF @estado IS NULL THROW 51000, 'La liquidacion no existe.', 1;
    IF @estado = 'CANCELADA' THROW 51000, 'Esa liquidacion ya estaba cancelada.', 1;

    UPDATE dbo.expenses
       SET voided_at = SYSDATETIME(), voided_by = @user_id,
           void_reason = LEFT(N'Liquidacion cancelada: ' + @reason, 200)
     WHERE platform_settlement_id = @settlement_id AND voided_at IS NULL;
    UPDATE dbo.platform_settlements
       SET status = 'CANCELADA', voided_by = @user_id, voided_at = SYSDATETIME(), void_reason = @reason,
           updated_at = SYSDATETIME()
     WHERE id = @settlement_id;
    COMMIT TRAN;
    SELECT @settlement_id AS id, @expense AS expense_id;
END
GO

/* ---------- sp_register_expense (SQL_STORED_PROCEDURE) ---------- */
/* sp_register_expense
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   REGISTRAR UN EGRESO (y un PAGO AL PERSONAL, que es un egreso de concepto
   "Pago al personal" ligado a una persona).

   LA REGLA CENTRAL
     EFECTIVO   sale del cajon: exige turno abierto en ESA caja y deja un
                cash_movement negativo (typee EXPENSE) amarrado a ese turno.
                Todo en una transaccion: o quedan el egreso y la salida, o no
                queda nada. Baja el efectivo esperado del corte.
     otro medio (TRANSFERENCIA, TARJETA, OTRO) se registra el egreso y NO
                toca el cajon ni el corte.
   La tabla lo exige tambien (CK_expenses_cash): no se puede escribir un
   egreso en efectivo sin su salida del cajon.

   PAGO AL PERSONAL (concepto PERSONAL)
     Exige la persona (@staff_user_id, de `users`: la entidad del personal en
     Wybix) y el tipo de periodo:
       DIA     si no se dan fechas, el periodo es el dia del pago;
       SEMANA  si no se dan fechas, la semana (lunes a domingo) del pago;
       OTRO    las dos fechas son obligatorias.
     No es nomina: no hay percepciones, deducciones ni impuestos. Es dejar
     constancia de cuanto se le pago a quien y por que periodo.
   Un concepto que NO es de personal no admite persona ni periodo: un Uber no
   se le paga a un empleado del sistema.

   Un egreso en efectivo sale HOY del cajon, asi que su fecha es la de hoy.
   Uno por transferencia puede capturarse despues con la fecha que tuvo.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_register_expense
    @user_id         INT,
    @category_id     INT,
    @amount          DECIMAL(12,2),
    @payment_method  VARCHAR(20),
    @expense_date    DATE = NULL,
    @note            NVARCHAR(255) = NULL,
    @beneficiary     NVARCHAR(120) = NULL,
    @staff_user_id   INT = NULL,
    @period_kind     VARCHAR(10) = NULL,
    @period_from     DATE = NULL,
    @period_to       DATE = NULL,
    @register_id     INT = NULL,
    @machine_id      NVARCHAR(64) = NULL,
    @machine_name    NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @hoy DATE = CAST(SYSDATETIME() AS DATE);
    DECLARE @metodo VARCHAR(20) = UPPER(LTRIM(RTRIM(ISNULL(@payment_method, ''))));
    DECLARE @kind VARCHAR(10), @cat_name NVARCHAR(60), @cat_active BIT;
    DECLARE @caja INT = NULL, @closure_id INT = NULL, @cash_id INT = NULL, @expense_id INT;

    SET @note = NULLIF(LTRIM(RTRIM(@note)), N'');
    SET @beneficiary = NULLIF(LTRIM(RTRIM(@beneficiary)), N'');
    SET @period_kind = NULLIF(UPPER(LTRIM(RTRIM(@period_kind))), '');

    BEGIN TRY
        BEGIN TRAN;

        IF @amount IS NULL OR @amount <= 0
            RAISERROR('El monto del egreso debe ser mayor a cero.', 16, 1);
        IF @metodo NOT IN ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'OTRO')
            RAISERROR('Forma de pago no valida para un egreso.', 16, 1);

        SELECT @kind = kind, @cat_name = name, @cat_active = active
          FROM dbo.expense_categories WHERE id = @category_id;
        IF @kind IS NULL
            RAISERROR('El concepto de egreso no existe.', 16, 1);
        IF @cat_active = 0
            RAISERROR('Ese concepto esta desactivado. Activalo o elige otro.', 16, 1);
        /* 0069: la comision de una plataforma se registra al confirmar su
           liquidacion, repartida entre sus pedidos. A mano contaria doble. */
        IF @kind = 'PLATAFORMA'
            RAISERROR('Las comisiones de plataforma se registran desde Liquidaciones de plataforma.', 16, 1);

        IF @expense_date IS NULL SET @expense_date = @hoy;
        IF @metodo = 'EFECTIVO' AND @expense_date <> @hoy
            RAISERROR('Un egreso en efectivo sale hoy del cajon: su fecha es la de hoy. Si lo pagaste otro dia, registralo con la forma de pago que tuvo.', 16, 1);
        IF @expense_date > @hoy
            RAISERROR('La fecha del egreso no puede ser futura.', 16, 1);

        /* ---------------- pago al personal ---------------- */
        IF @kind = 'PERSONAL'
        BEGIN
            IF @staff_user_id IS NULL
                RAISERROR('Elige a quien se le paga.', 16, 1);
            IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @staff_user_id)
                RAISERROR('La persona elegida no existe.', 16, 1);
            IF @period_kind IS NULL OR @period_kind NOT IN ('DIA', 'SEMANA', 'OTRO')
                RAISERROR('Indica el periodo que se paga: dia, semana u otro.', 16, 1);

            IF @period_kind = 'DIA'
            BEGIN
                SET @period_from = ISNULL(@period_from, @expense_date);
                SET @period_to   = ISNULL(@period_to, @period_from);
            END
            ELSE IF @period_kind = 'SEMANA' AND (@period_from IS NULL OR @period_to IS NULL)
            BEGIN
                /* Lunes de la semana del pago, sin depender de DATEFIRST. */
                DECLARE @base DATE = ISNULL(@period_from, @expense_date);
                SET @period_from = DATEADD(DAY, -((DATEDIFF(DAY, '19000101', @base)) % 7), @base);
                SET @period_to   = DATEADD(DAY, 6, @period_from);
            END
            ELSE IF @period_kind = 'OTRO' AND (@period_from IS NULL OR @period_to IS NULL)
                RAISERROR('Para un periodo "otro" indica desde y hasta que fecha se paga.', 16, 1);

            IF @period_from > @period_to
                RAISERROR('El periodo pagado esta al reves: "desde" es posterior a "hasta".', 16, 1);
        END
        ELSE
        BEGIN
            IF @staff_user_id IS NOT NULL
                RAISERROR('Solo un pago al personal va ligado a una persona. Elige el concepto "pago al personal".', 16, 1);
            SELECT @period_kind = NULL, @period_from = NULL, @period_to = NULL;
        END

        /* ---------------- efectivo: sale del cajon ---------------- */
        IF @metodo = 'EFECTIVO'
        BEGIN
            EXEC dbo.sp_resolve_cash_register
                @register_id = @register_id, @machine_id = @machine_id,
                @machine_name = @machine_name, @user_id = @user_id, @resolved = @caja OUTPUT;
            IF @caja IS NULL
                RAISERROR('No se pudo determinar la caja de la que sale el efectivo. Abre el turno en esta caja e intenta de nuevo.', 16, 1);

            SELECT TOP (1) @closure_id = id
              FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
             WHERE register_id = @caja AND closed_at IS NULL
             ORDER BY opened_at DESC, id DESC;
            IF @closure_id IS NULL
                RAISERROR('Para pagar en efectivo hace falta un turno abierto en esta caja.', 16, 1);

            INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES (GETDATE(), @user_id, 'EXPENSE', NULL, LEFT(CONCAT(N'Egreso: ', @cat_name), 100),
                    -@amount, LEFT(@note, 200), @closure_id, @caja);
            SET @cash_id = SCOPE_IDENTITY();
        END
        ELSE
            /* Fuera del cajon la caja es solo informativa: se guarda si se dio. */
            SET @caja = @register_id;

        INSERT INTO dbo.expenses (
            expense_date, category_id, amount, payment_method, note, user_id,
            register_id, closure_id, cash_movement_id, beneficiary,
            staff_user_id, period_kind, period_from, period_to)
        VALUES (
            @expense_date, @category_id, @amount, @metodo, @note, @user_id,
            @caja, @closure_id, @cash_id, @beneficiary,
            @staff_user_id, @period_kind, @period_from, @period_to);
        SET @expense_id = SCOPE_IDENTITY();

        IF @cash_id IS NOT NULL
            UPDATE dbo.cash_movements SET reference_id = @expense_id WHERE id = @cash_id;

        COMMIT TRAN;

        SELECT @expense_id AS expense_id, @cash_id AS cash_movement_id,
               @closure_id AS closure_id, @caja AS register_id,
               @period_from AS period_from, @period_to AS period_to;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_void_expense (SQL_STORED_PROCEDURE) ---------- */
/* sp_void_expense
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   CANCELAR UN EGRESO capturado por error. No se borra: queda marcado con
   quien, cuando y por que, y deja de contar en los reportes.

   Si fue en EFECTIVO, el dinero salio del cajon de un turno. Se puede
   cancelar mientras ESE turno siga abierto: se devuelve al cajon con un
   movimiento EXPENSE positivo en el mismo turno, y el corte queda como si el
   egreso no hubiera existido. Si el turno ya se cerro, el corte ya se
   entrego y no se reescribe: se cancela un egreso de otro medio o se
   registra lo que corresponda en el turno actual.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_void_expense
    @expense_id INT,
    @user_id    INT,
    @reason     NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @reason = NULLIF(LTRIM(RTRIM(@reason)), N'');

    BEGIN TRY
        BEGIN TRAN;

        IF @reason IS NULL
            RAISERROR('Escribe por que se cancela el egreso.', 16, 1);

        DECLARE @metodo VARCHAR(20), @monto DECIMAL(12,2), @caja INT, @turno INT,
                @anulado DATETIME2(0), @cat NVARCHAR(60), @liquidacion INT;
        SELECT @metodo = e.payment_method, @monto = e.amount, @caja = e.register_id,
               @turno = e.closure_id, @anulado = e.voided_at, @cat = c.name,
               @liquidacion = e.platform_settlement_id
          FROM dbo.expenses e WITH (UPDLOCK, HOLDLOCK)
          JOIN dbo.expense_categories c ON c.id = e.category_id
         WHERE e.id = @expense_id;

        IF @metodo IS NULL
            RAISERROR('El egreso no existe.', 16, 1);
        IF @anulado IS NOT NULL
            RAISERROR('Ese egreso ya estaba cancelado.', 16, 1);
        /* 0069: lo cancela su liquidacion, que tambien quita su reparto. */
        IF @liquidacion IS NOT NULL
            RAISERROR('Este egreso sale de una liquidacion de plataforma: cancela la liquidacion.', 16, 1);

        DECLARE @devolucion INT = NULL;
        IF @metodo = 'EFECTIVO'
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
                            WHERE id = @turno AND closed_at IS NULL)
                RAISERROR('Ese egreso salio del cajon en un turno que ya se cerro. El corte ya se entrego y no se reescribe.', 16, 1);

            INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES (GETDATE(), @user_id, 'EXPENSE', @expense_id,
                    LEFT(CONCAT(N'Cancelacion egreso: ', @cat), 100), @monto, LEFT(@reason, 200), @turno, @caja);
            SET @devolucion = SCOPE_IDENTITY();
        END

        UPDATE dbo.expenses
           SET voided_at = SYSDATETIME(), voided_by = @user_id, void_reason = @reason,
               void_cash_movement_id = @devolucion
         WHERE id = @expense_id;

        COMMIT TRAN;
        SELECT @expense_id AS expense_id, @devolucion AS void_cash_movement_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
