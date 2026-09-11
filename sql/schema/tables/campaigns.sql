/* campaigns
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.campaigns', 'U') IS NULL
BEGIN
CREATE TABLE dbo.campaigns (
    id INT IDENTITY(1, 1) NOT NULL,
    name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    description NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    outcome NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    reward_definition_id INT NULL,
    coupon_definition_id INT NULL,
    dynamic_definition_id INT NULL,
    raffle_id INT NULL,
    quantity INT NOT NULL CONSTRAINT DF_campaigns_quantity DEFAULT ((1)),
    per_amount DECIMAL(12, 2) NULL,
    min_total DECIMAL(12, 2) NULL,
    product_id INT NULL,
    requires_customer BIT NOT NULL CONSTRAINT DF_campaigns_requires_customer DEFAULT ((0)),
    first_purchase_only BIT NOT NULL CONSTRAINT DF_campaigns_first_purchase_only DEFAULT ((0)),
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

IF OBJECT_ID(N'dbo.CK_campaigns_outcome', 'C') IS NULL
ALTER TABLE dbo.campaigns WITH CHECK ADD CONSTRAINT CK_campaigns_outcome CHECK ([outcome]='RAFFLE_ENTRY' OR [outcome]='DYNAMIC' OR [outcome]='COUPON' OR [outcome]='REWARD');
