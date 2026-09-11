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
