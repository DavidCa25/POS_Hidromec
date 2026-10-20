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
