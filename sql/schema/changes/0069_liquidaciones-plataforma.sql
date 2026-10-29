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
