/* dynamic_definitions
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.dynamic_definitions', 'U') IS NULL
BEGIN
CREATE TABLE dbo.dynamic_definitions (
    id INT IDENTITY(1, 1) NOT NULL,
    name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    type NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL,
    description NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    target_value DECIMAL(12, 4) NULL,
    tolerance DECIMAL(12, 4) NULL,
    attempts_allowed INT NOT NULL CONSTRAINT DF_dynamic_definitions_attempts DEFAULT ((1)),
    reward_definition_id INT NULL,
    active BIT NOT NULL CONSTRAINT DF_dynamic_definitions_active DEFAULT ((1)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_dynamic_definitions_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_dynamic_definitions PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_dynamic_definitions_type', 'C') IS NULL
ALTER TABLE dbo.dynamic_definitions WITH CHECK ADD CONSTRAINT CK_dynamic_definitions_type CHECK ([type]='RANDOM_REVEAL' OR [type]='SCRATCH' OR [type]='PICK_ONE' OR [type]='WHEEL' OR [type]='TIMING');
