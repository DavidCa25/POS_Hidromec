/* stock_transfers
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.stock_transfers', 'U') IS NULL
BEGIN
CREATE TABLE dbo.stock_transfers (
    id INT IDENTITY(1, 1) NOT NULL,
    uuid UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_stock_transfers_uuid DEFAULT (newid()),
    kind VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    status VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    event_location_uuid UNIQUEIDENTIFIER NOT NULL,
    event_name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    note NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    created_by INT NOT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_stock_transfers_created_at DEFAULT (sysdatetime()),
    created_machine_name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    received_by INT NULL,
    received_at DATETIME2(0) NULL,
    cancelled_at DATETIME2(0) NULL,
    manifest_signature NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NULL,
    rv TIMESTAMP NOT NULL,
    CONSTRAINT PK_stock_transfers PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_stock_transfers_kind', 'C') IS NULL
ALTER TABLE dbo.stock_transfers WITH CHECK ADD CONSTRAINT CK_stock_transfers_kind CHECK ([kind]='RETURN_IN' OR [kind]='OUT' OR [kind]='BRANCH_OUT' OR [kind]='BRANCH_IN');

IF OBJECT_ID(N'dbo.CK_stock_transfers_status', 'C') IS NULL
ALTER TABLE dbo.stock_transfers WITH CHECK ADD CONSTRAINT CK_stock_transfers_status CHECK ([status]='CANCELLED' OR [status]='RECEIVED' OR [status]='SENT');

IF OBJECT_ID(N'dbo.FK_stock_transfers_created_by', 'F') IS NULL
ALTER TABLE dbo.stock_transfers WITH CHECK ADD CONSTRAINT FK_stock_transfers_created_by FOREIGN KEY (created_by) REFERENCES dbo.users (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_stock_transfers_rv' AND object_id = OBJECT_ID(N'dbo.stock_transfers'))
CREATE NONCLUSTERED INDEX IX_stock_transfers_rv ON dbo.stock_transfers (rv);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_stock_transfers_uuid' AND object_id = OBJECT_ID(N'dbo.stock_transfers'))
CREATE UNIQUE NONCLUSTERED INDEX UX_stock_transfers_uuid ON dbo.stock_transfers (uuid);
