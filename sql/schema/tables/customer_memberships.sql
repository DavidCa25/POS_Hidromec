/* customer_memberships
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.customer_memberships', 'U') IS NULL
BEGIN
CREATE TABLE dbo.customer_memberships (
    id INT IDENTITY(1, 1) NOT NULL,
    uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_customer_memberships_uuid DEFAULT (newid()),
    customer_id INT NOT NULL,
    plan_id INT NOT NULL,
    status NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_customer_memberships_status DEFAULT (N'ACTIVE'),
    paid_until DATE NULL,
    origin NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_customer_memberships_origin DEFAULT (N'LOCAL'),
    created_by INT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_customer_memberships_created DEFAULT (sysdatetime()),
    cancelled_at DATETIME2(0) NULL,
    cancelled_by INT NULL,
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_customer_memberships_updated DEFAULT (sysdatetime()),
    row_version TIMESTAMP NOT NULL,
    CONSTRAINT PK_customer_memberships PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UX_customer_memberships_cliente_plan UNIQUE NONCLUSTERED (customer_id, plan_id),
    CONSTRAINT UX_customer_memberships_uuid UNIQUE NONCLUSTERED (uuid)
);
END;

IF OBJECT_ID(N'dbo.CK_customer_memberships_origin', 'C') IS NULL
ALTER TABLE dbo.customer_memberships WITH CHECK ADD CONSTRAINT CK_customer_memberships_origin CHECK ([origin]=N'REMOTE' OR [origin]=N'LOCAL');

IF OBJECT_ID(N'dbo.CK_customer_memberships_status', 'C') IS NULL
ALTER TABLE dbo.customer_memberships WITH CHECK ADD CONSTRAINT CK_customer_memberships_status CHECK ([status]=N'CANCELLED' OR [status]=N'ACTIVE');

IF OBJECT_ID(N'dbo.FK_customer_memberships_customer', 'F') IS NULL
ALTER TABLE dbo.customer_memberships WITH CHECK ADD CONSTRAINT FK_customer_memberships_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers (id);

IF OBJECT_ID(N'dbo.FK_customer_memberships_plan', 'F') IS NULL
ALTER TABLE dbo.customer_memberships WITH CHECK ADD CONSTRAINT FK_customer_memberships_plan FOREIGN KEY (plan_id) REFERENCES dbo.membership_plans (id);
