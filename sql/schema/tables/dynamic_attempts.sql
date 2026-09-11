/* dynamic_attempts
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.dynamic_attempts', 'U') IS NULL
BEGIN
CREATE TABLE dbo.dynamic_attempts (
    id INT IDENTITY(1, 1) NOT NULL,
    definition_id INT NOT NULL,
    campaign_id INT NULL,
    customer_id INT NULL,
    token NVARCHAR(32) COLLATE Modern_Spanish_CI_AS NOT NULL,
    sale_id INT NULL,
    register_id INT NULL,
    machine_id NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,
    status NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_dynamic_attempts_status DEFAULT ('PENDING'),
    input_value DECIMAL(12, 4) NULL,
    result NVARCHAR(8) COLLATE Modern_Spanish_CI_AS NULL,
    reward_instance_id INT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_dynamic_attempts_created_at DEFAULT (sysutcdatetime()),
    played_at DATETIME2(0) NULL,
    expires_at DATETIME2(0) NULL,
    CONSTRAINT PK_dynamic_attempts PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_dynamic_attempts_definition', 'F') IS NULL
ALTER TABLE dbo.dynamic_attempts WITH CHECK ADD CONSTRAINT FK_dynamic_attempts_definition FOREIGN KEY (definition_id) REFERENCES dbo.dynamic_definitions (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_dynamic_attempts_token' AND object_id = OBJECT_ID(N'dbo.dynamic_attempts'))
CREATE UNIQUE NONCLUSTERED INDEX UX_dynamic_attempts_token ON dbo.dynamic_attempts (token);
