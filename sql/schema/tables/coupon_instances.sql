/* coupon_instances
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
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

IF OBJECT_ID(N'dbo.FK_coupon_instances_definition', 'F') IS NULL
ALTER TABLE dbo.coupon_instances WITH CHECK ADD CONSTRAINT FK_coupon_instances_definition FOREIGN KEY (definition_id) REFERENCES dbo.coupon_definitions (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_coupon_instances_code' AND object_id = OBJECT_ID(N'dbo.coupon_instances'))
CREATE UNIQUE NONCLUSTERED INDEX UX_coupon_instances_code ON dbo.coupon_instances (code);
