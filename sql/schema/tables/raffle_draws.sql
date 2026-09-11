/* raffle_draws
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.raffle_draws', 'U') IS NULL
BEGIN
CREATE TABLE dbo.raffle_draws (
    id INT IDENTITY(1, 1) NOT NULL,
    raffle_id INT NOT NULL,
    entries_count INT NOT NULL,
    max_entry_id INT NOT NULL,
    drawn_at DATETIME2(0) NOT NULL CONSTRAINT DF_raffle_draws_drawn_at DEFAULT (sysutcdatetime()),
    drawn_by_user_id INT NULL,
    register_id INT NULL,
    machine_id NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NULL,
    algorithm NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_raffle_draws_algorithm DEFAULT ('CRYPTO_UNIFORM'),
    algorithm_version INT NOT NULL CONSTRAINT DF_raffle_draws_algorithm_version DEFAULT ((1)),
    seed NVARCHAR(128) COLLATE Modern_Spanish_CI_AS NULL,
    status NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_raffle_draws_status DEFAULT ('DONE'),
    CONSTRAINT PK_raffle_draws PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_raffle_draws_raffle', 'F') IS NULL
ALTER TABLE dbo.raffle_draws WITH CHECK ADD CONSTRAINT FK_raffle_draws_raffle FOREIGN KEY (raffle_id) REFERENCES dbo.raffle_definitions (id);
