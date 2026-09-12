/* raffle_winners
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.raffle_winners', 'U') IS NULL
BEGIN
CREATE TABLE dbo.raffle_winners (
    id INT IDENTITY(1, 1) NOT NULL,
    draw_id INT NOT NULL,
    entry_id INT NOT NULL,
    position INT NOT NULL,
    status NVARCHAR(14) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_raffle_winners_status DEFAULT ('WINNER'),
    delivered_at DATETIME2(0) NULL,
    delivered_by_user_id INT NULL,
    notes NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_raffle_winners PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_raffle_winners_draw', 'F') IS NULL
ALTER TABLE dbo.raffle_winners WITH CHECK ADD CONSTRAINT FK_raffle_winners_draw FOREIGN KEY (draw_id) REFERENCES dbo.raffle_draws (id);

IF OBJECT_ID(N'dbo.FK_raffle_winners_entry', 'F') IS NULL
ALTER TABLE dbo.raffle_winners WITH CHECK ADD CONSTRAINT FK_raffle_winners_entry FOREIGN KEY (entry_id) REFERENCES dbo.raffle_entries (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_raffle_winners_posicion' AND object_id = OBJECT_ID(N'dbo.raffle_winners'))
CREATE UNIQUE NONCLUSTERED INDEX UX_raffle_winners_posicion ON dbo.raffle_winners (draw_id, position);
