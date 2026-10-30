/* membership_plans
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.membership_plans', 'U') IS NULL
BEGIN
CREATE TABLE dbo.membership_plans (
    id INT IDENTITY(1, 1) NOT NULL,
    uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_membership_plans_uuid DEFAULT (newid()),
    name NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    sale_product_id INT NULL,
    period_days INT NOT NULL CONSTRAINT DF_membership_plans_period DEFAULT ((30)),
    daily_limit INT NOT NULL CONSTRAINT DF_membership_plans_daily DEFAULT ((1)),
    grace_days INT NOT NULL CONSTRAINT DF_membership_plans_grace DEFAULT ((0)),
    active BIT NOT NULL CONSTRAINT DF_membership_plans_active DEFAULT ((1)),
    origin NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_membership_plans_origin DEFAULT (N'LOCAL'),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_membership_plans_created DEFAULT (sysdatetime()),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_membership_plans_updated DEFAULT (sysdatetime()),
    row_version TIMESTAMP NOT NULL,
    CONSTRAINT PK_membership_plans PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UX_membership_plans_uuid UNIQUE NONCLUSTERED (uuid)
);
END;

IF OBJECT_ID(N'dbo.CK_membership_plans_daily', 'C') IS NULL
ALTER TABLE dbo.membership_plans WITH CHECK ADD CONSTRAINT CK_membership_plans_daily CHECK ([daily_limit]>=(1) AND [daily_limit]<=(20));

IF OBJECT_ID(N'dbo.CK_membership_plans_grace', 'C') IS NULL
ALTER TABLE dbo.membership_plans WITH CHECK ADD CONSTRAINT CK_membership_plans_grace CHECK ([grace_days]>=(0) AND [grace_days]<=(30));

IF OBJECT_ID(N'dbo.CK_membership_plans_origin', 'C') IS NULL
ALTER TABLE dbo.membership_plans WITH CHECK ADD CONSTRAINT CK_membership_plans_origin CHECK ([origin]=N'REMOTE' OR [origin]=N'LOCAL');

IF OBJECT_ID(N'dbo.CK_membership_plans_period', 'C') IS NULL
ALTER TABLE dbo.membership_plans WITH CHECK ADD CONSTRAINT CK_membership_plans_period CHECK ([period_days]>=(1) AND [period_days]<=(366));

IF OBJECT_ID(N'dbo.FK_membership_plans_product', 'F') IS NULL
ALTER TABLE dbo.membership_plans WITH CHECK ADD CONSTRAINT FK_membership_plans_product FOREIGN KEY (sale_product_id) REFERENCES dbo.products (id);
