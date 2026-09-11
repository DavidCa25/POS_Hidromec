/* raffle_definitions
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.raffle_definitions', 'U') IS NULL
BEGIN
CREATE TABLE dbo.raffle_definitions (
    id INT IDENTITY(1, 1) NOT NULL,
    name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NOT NULL,
    description NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    prize NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    starts_at DATETIME2(0) NULL,
    ends_at DATETIME2(0) NULL,
    status NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_raffle_definitions_status DEFAULT ('DRAFT'),
    winners_count INT NOT NULL CONSTRAINT DF_raffle_definitions_winners DEFAULT ((1)),
    code_prefix NVARCHAR(8) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_raffle_definitions_prefix DEFAULT ('RF'),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_raffle_definitions_created_at DEFAULT (sysutcdatetime()),
    closed_at DATETIME2(0) NULL,
    closed_entries_count INT NULL,
    closed_max_entry_id INT NULL,
    CONSTRAINT PK_raffle_definitions PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_raffle_definitions_status', 'C') IS NULL
ALTER TABLE dbo.raffle_definitions WITH CHECK ADD CONSTRAINT CK_raffle_definitions_status CHECK ([status]='DRAWN' OR [status]='CLOSED' OR [status]='OPEN' OR [status]='DRAFT');
