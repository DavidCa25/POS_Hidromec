/* raffle_entries
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.raffle_entries', 'U') IS NULL
BEGIN
CREATE TABLE dbo.raffle_entries (
    id INT IDENTITY(1, 1) NOT NULL,
    raffle_id INT NOT NULL,
    entry_number INT NOT NULL,
    customer_id INT NULL,
    sale_id INT NULL,
    register_id INT NULL,
    machine_id NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,
    campaign_id INT NULL,
    status NVARCHAR(8) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_raffle_entries_status DEFAULT ('VALID'),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_raffle_entries_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_raffle_entries PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_raffle_entries_raffle', 'F') IS NULL
ALTER TABLE dbo.raffle_entries WITH CHECK ADD CONSTRAINT FK_raffle_entries_raffle FOREIGN KEY (raffle_id) REFERENCES dbo.raffle_definitions (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_raffle_entries_sale' AND object_id = OBJECT_ID(N'dbo.raffle_entries'))
CREATE NONCLUSTERED INDEX IX_raffle_entries_sale ON dbo.raffle_entries (sale_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_raffle_entries_numero' AND object_id = OBJECT_ID(N'dbo.raffle_entries'))
CREATE UNIQUE NONCLUSTERED INDEX UX_raffle_entries_numero ON dbo.raffle_entries (raffle_id, entry_number);
