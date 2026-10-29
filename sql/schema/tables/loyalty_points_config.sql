/* loyalty_points_config
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.loyalty_points_config', 'U') IS NULL
BEGIN
CREATE TABLE dbo.loyalty_points_config (
    id TINYINT NOT NULL CONSTRAINT DF_loyalty_points_config_id DEFAULT ((1)),
    enabled BIT NOT NULL CONSTRAINT DF_loyalty_points_config_enabled DEFAULT ((0)),
    per_amount DECIMAL(12, 2) NULL,
    points_per INT NOT NULL CONSTRAINT DF_loyalty_points_config_points DEFAULT ((1)),
    visit_points INT NOT NULL CONSTRAINT DF_loyalty_points_config_visit DEFAULT ((0)),
    expiry_months INT NULL,
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_loyalty_points_config_updated DEFAULT (sysdatetime()),
    origin NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_loyalty_points_config_origin DEFAULT (N'LOCAL'),
    row_version TIMESTAMP NOT NULL,
    CONSTRAINT PK_loyalty_points_config PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_loyalty_points_config_amount', 'C') IS NULL
ALTER TABLE dbo.loyalty_points_config WITH CHECK ADD CONSTRAINT CK_loyalty_points_config_amount CHECK ([per_amount] IS NULL OR [per_amount]>(0));

IF OBJECT_ID(N'dbo.CK_loyalty_points_config_expiry', 'C') IS NULL
ALTER TABLE dbo.loyalty_points_config WITH CHECK ADD CONSTRAINT CK_loyalty_points_config_expiry CHECK ([expiry_months] IS NULL OR [expiry_months]>=(1) AND [expiry_months]<=(120));

IF OBJECT_ID(N'dbo.CK_loyalty_points_config_id', 'C') IS NULL
ALTER TABLE dbo.loyalty_points_config WITH CHECK ADD CONSTRAINT CK_loyalty_points_config_id CHECK ([id]=(1));

IF OBJECT_ID(N'dbo.CK_loyalty_points_config_origin', 'C') IS NULL
ALTER TABLE dbo.loyalty_points_config WITH CHECK ADD CONSTRAINT CK_loyalty_points_config_origin CHECK ([origin]=N'REMOTE' OR [origin]=N'LOCAL');

IF OBJECT_ID(N'dbo.CK_loyalty_points_config_points', 'C') IS NULL
ALTER TABLE dbo.loyalty_points_config WITH CHECK ADD CONSTRAINT CK_loyalty_points_config_points CHECK ([points_per]>=(1) AND [points_per]<=(10000));

IF OBJECT_ID(N'dbo.CK_loyalty_points_config_visit', 'C') IS NULL
ALTER TABLE dbo.loyalty_points_config WITH CHECK ADD CONSTRAINT CK_loyalty_points_config_visit CHECK ([visit_points]>=(0) AND [visit_points]<=(10000));
