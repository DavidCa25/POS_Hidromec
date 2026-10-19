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
