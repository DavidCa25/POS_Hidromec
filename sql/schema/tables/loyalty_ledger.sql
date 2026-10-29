/* loyalty_ledger
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.loyalty_ledger', 'U') IS NULL
BEGIN
CREATE TABLE dbo.loyalty_ledger (
    id INT IDENTITY(1, 1) NOT NULL,
    uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_loyalty_ledger_uuid DEFAULT (newid()),
    customer_id INT NOT NULL,
    program NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    card_id INT NULL,
    delta INT NOT NULL,
    kind NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL,
    reason NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NULL,
    sale_id INT NULL,
    sale_detail_id INT NULL,
    refund_id INT NULL,
    reward_definition_id INT NULL,
    amount DECIMAL(12, 2) NULL,
    user_id INT NULL,
    note NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    origin NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_loyalty_ledger_origin DEFAULT (N'LOCAL'),
    location_name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_loyalty_ledger_created DEFAULT (sysdatetime()),
    row_version TIMESTAMP NOT NULL,
    CONSTRAINT PK_loyalty_ledger PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UX_loyalty_ledger_uuid UNIQUE NONCLUSTERED (uuid)
);
END;

IF OBJECT_ID(N'dbo.CK_loyalty_ledger_card', 'C') IS NULL
ALTER TABLE dbo.loyalty_ledger WITH CHECK ADD CONSTRAINT CK_loyalty_ledger_card CHECK ([program]=N'STAMPS' AND [card_id] IS NOT NULL OR [program]=N'POINTS' AND [card_id] IS NULL);

IF OBJECT_ID(N'dbo.CK_loyalty_ledger_delta', 'C') IS NULL
ALTER TABLE dbo.loyalty_ledger WITH CHECK ADD CONSTRAINT CK_loyalty_ledger_delta CHECK ([delta]<>(0));

IF OBJECT_ID(N'dbo.CK_loyalty_ledger_kind', 'C') IS NULL
ALTER TABLE dbo.loyalty_ledger WITH CHECK ADD CONSTRAINT CK_loyalty_ledger_kind CHECK ([kind]=N'ADJUST' OR [kind]=N'EXPIRE' OR [kind]=N'REVERSE' OR [kind]=N'REDEEM' OR [kind]=N'EARN');

IF OBJECT_ID(N'dbo.CK_loyalty_ledger_origin', 'C') IS NULL
ALTER TABLE dbo.loyalty_ledger WITH CHECK ADD CONSTRAINT CK_loyalty_ledger_origin CHECK ([origin]=N'REMOTE' OR [origin]=N'LOCAL');

IF OBJECT_ID(N'dbo.CK_loyalty_ledger_program', 'C') IS NULL
ALTER TABLE dbo.loyalty_ledger WITH CHECK ADD CONSTRAINT CK_loyalty_ledger_program CHECK ([program]=N'STAMPS' OR [program]=N'POINTS');

IF OBJECT_ID(N'dbo.FK_loyalty_ledger_card', 'F') IS NULL
ALTER TABLE dbo.loyalty_ledger WITH CHECK ADD CONSTRAINT FK_loyalty_ledger_card FOREIGN KEY (card_id) REFERENCES dbo.loyalty_stamp_cards (id);

IF OBJECT_ID(N'dbo.FK_loyalty_ledger_customer', 'F') IS NULL
ALTER TABLE dbo.loyalty_ledger WITH CHECK ADD CONSTRAINT FK_loyalty_ledger_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_loyalty_ledger_customer' AND object_id = OBJECT_ID(N'dbo.loyalty_ledger'))
CREATE NONCLUSTERED INDEX IX_loyalty_ledger_customer ON dbo.loyalty_ledger (customer_id, program, card_id) INCLUDE (created_at, delta, kind);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_loyalty_ledger_sale' AND object_id = OBJECT_ID(N'dbo.loyalty_ledger'))
CREATE NONCLUSTERED INDEX IX_loyalty_ledger_sale ON dbo.loyalty_ledger (sale_id) INCLUDE (card_id, delta, kind, program, reason) WHERE ([sale_id] IS NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_loyalty_ledger_earn' AND object_id = OBJECT_ID(N'dbo.loyalty_ledger'))
CREATE UNIQUE NONCLUSTERED INDEX UX_loyalty_ledger_earn ON dbo.loyalty_ledger (sale_id, program, card_id, reason) WHERE ([kind]=N'EARN' AND [origin]=N'LOCAL' AND [sale_id] IS NOT NULL);
