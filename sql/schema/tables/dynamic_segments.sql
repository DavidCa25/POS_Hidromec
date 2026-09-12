/* dynamic_segments
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.dynamic_segments', 'U') IS NULL
BEGIN
CREATE TABLE dbo.dynamic_segments (
    id INT IDENTITY(1, 1) NOT NULL,
    definition_id INT NOT NULL,
    sort_order INT NOT NULL CONSTRAINT DF_dynamic_segments_orden DEFAULT ((0)),
    label NVARCHAR(60) COLLATE Modern_Spanish_CI_AS NOT NULL,
    outcome NVARCHAR(16) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_dynamic_segments_outcome DEFAULT ('NONE'),
    reward_definition_id INT NULL,
    raffle_id INT NULL,
    quantity INT NOT NULL CONSTRAINT DF_dynamic_segments_cantidad DEFAULT ((1)),
    weight INT NOT NULL CONSTRAINT DF_dynamic_segments_peso DEFAULT ((1)),
    active BIT NOT NULL CONSTRAINT DF_dynamic_segments_active DEFAULT ((1)),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_dynamic_segments_created_at DEFAULT (sysutcdatetime()),
    CONSTRAINT PK_dynamic_segments PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_dynamic_segments_outcome', 'C') IS NULL
ALTER TABLE dbo.dynamic_segments WITH CHECK ADD CONSTRAINT CK_dynamic_segments_outcome CHECK ([outcome]='NONE' OR [outcome]='REWARD' OR [outcome]='RAFFLE_ENTRY');

IF OBJECT_ID(N'dbo.CK_dynamic_segments_peso', 'C') IS NULL
ALTER TABLE dbo.dynamic_segments WITH CHECK ADD CONSTRAINT CK_dynamic_segments_peso CHECK ([weight]>=(0) AND [quantity]>=(1));

IF OBJECT_ID(N'dbo.FK_dynamic_segments_definition', 'F') IS NULL
ALTER TABLE dbo.dynamic_segments WITH CHECK ADD CONSTRAINT FK_dynamic_segments_definition FOREIGN KEY (definition_id) REFERENCES dbo.dynamic_definitions (id);

IF OBJECT_ID(N'dbo.FK_dynamic_segments_raffle', 'F') IS NULL
ALTER TABLE dbo.dynamic_segments WITH CHECK ADD CONSTRAINT FK_dynamic_segments_raffle FOREIGN KEY (raffle_id) REFERENCES dbo.raffle_definitions (id);

IF OBJECT_ID(N'dbo.FK_dynamic_segments_reward', 'F') IS NULL
ALTER TABLE dbo.dynamic_segments WITH CHECK ADD CONSTRAINT FK_dynamic_segments_reward FOREIGN KEY (reward_definition_id) REFERENCES dbo.reward_definitions (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_dynamic_segments_definition' AND object_id = OBJECT_ID(N'dbo.dynamic_segments'))
CREATE NONCLUSTERED INDEX IX_dynamic_segments_definition ON dbo.dynamic_segments (definition_id, sort_order);
