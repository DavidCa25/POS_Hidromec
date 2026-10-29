/* loyalty_stamp_cards
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.loyalty_stamp_cards', 'U') IS NULL
BEGIN
CREATE TABLE dbo.loyalty_stamp_cards (
    id INT IDENTITY(1, 1) NOT NULL,
    uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_loyalty_stamp_cards_uuid DEFAULT (newid()),
    name NVARCHAR(80) COLLATE Modern_Spanish_CI_AS NOT NULL,
    stamps_required INT NOT NULL,
    reward_product_id INT NULL,
    active BIT NOT NULL CONSTRAINT DF_loyalty_stamp_cards_active DEFAULT ((1)),
    origin NVARCHAR(10) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_loyalty_stamp_cards_origin DEFAULT (N'LOCAL'),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_loyalty_stamp_cards_created DEFAULT (sysdatetime()),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_loyalty_stamp_cards_updated DEFAULT (sysdatetime()),
    row_version TIMESTAMP NOT NULL,
    CONSTRAINT PK_loyalty_stamp_cards PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UX_loyalty_stamp_cards_uuid UNIQUE NONCLUSTERED (uuid)
);
END;

IF OBJECT_ID(N'dbo.CK_loyalty_stamp_cards_origin', 'C') IS NULL
ALTER TABLE dbo.loyalty_stamp_cards WITH CHECK ADD CONSTRAINT CK_loyalty_stamp_cards_origin CHECK ([origin]=N'REMOTE' OR [origin]=N'LOCAL');

IF OBJECT_ID(N'dbo.CK_loyalty_stamp_cards_required', 'C') IS NULL
ALTER TABLE dbo.loyalty_stamp_cards WITH CHECK ADD CONSTRAINT CK_loyalty_stamp_cards_required CHECK ([stamps_required]>=(2) AND [stamps_required]<=(100));

IF OBJECT_ID(N'dbo.FK_loyalty_stamp_cards_reward', 'F') IS NULL
ALTER TABLE dbo.loyalty_stamp_cards WITH CHECK ADD CONSTRAINT FK_loyalty_stamp_cards_reward FOREIGN KEY (reward_product_id) REFERENCES dbo.products (id);
