/* reward_instances
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.reward_instances', 'U') IS NULL
BEGIN
CREATE TABLE dbo.reward_instances (
    id INT IDENTITY(1, 1) NOT NULL,
    definition_id INT NOT NULL,
    campaign_id INT NULL,
    customer_id INT NULL,
    code NVARCHAR(24) COLLATE Modern_Spanish_CI_AS NOT NULL,
    sale_id INT NULL,
    register_id INT NULL,
    machine_id NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,
    status NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_reward_instances_status DEFAULT ('ISSUED'),
    uses_allowed INT NOT NULL CONSTRAINT DF_reward_instances_uses_allowed DEFAULT ((1)),
    uses_count INT NOT NULL CONSTRAINT DF_reward_instances_uses_count DEFAULT ((0)),
    issued_at DATETIME2(0) NOT NULL CONSTRAINT DF_reward_instances_issued_at DEFAULT (sysutcdatetime()),
    expires_at DATETIME2(0) NULL,
    CONSTRAINT PK_reward_instances PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_reward_instances_definition', 'F') IS NULL
ALTER TABLE dbo.reward_instances WITH CHECK ADD CONSTRAINT FK_reward_instances_definition FOREIGN KEY (definition_id) REFERENCES dbo.reward_definitions (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_reward_instances_customer' AND object_id = OBJECT_ID(N'dbo.reward_instances'))
CREATE NONCLUSTERED INDEX IX_reward_instances_customer ON dbo.reward_instances (customer_id, status) INCLUDE (expires_at);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_reward_instances_code' AND object_id = OBJECT_ID(N'dbo.reward_instances'))
CREATE UNIQUE NONCLUSTERED INDEX UX_reward_instances_code ON dbo.reward_instances (code);
