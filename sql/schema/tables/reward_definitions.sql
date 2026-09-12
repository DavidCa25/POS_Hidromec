/* reward_definitions
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.reward_definitions', 'U') IS NULL
BEGIN
CREATE TABLE dbo.reward_definitions (
    id INT IDENTITY(1, 1) NOT NULL,
    name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    kind NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    product_id INT NULL,
    amount DECIMAL(12, 2) NULL,
    discount_pct DECIMAL(5, 2) NULL,
    notes NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL,
    valid_days INT NULL,
    uses_allowed INT NOT NULL CONSTRAINT DF_reward_definitions_uses DEFAULT ((1)),
    active BIT NOT NULL CONSTRAINT DF_reward_definitions_active DEFAULT ((1)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_reward_definitions_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_reward_definitions PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_reward_definitions_kind', 'C') IS NULL
ALTER TABLE dbo.reward_definitions WITH CHECK ADD CONSTRAINT CK_reward_definitions_kind CHECK ([kind]='CUSTOM' OR [kind]='UPGRADE' OR [kind]='PERCENT' OR [kind]='AMOUNT' OR [kind]='FREE_PRODUCT');
