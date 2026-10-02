/* sync_outbox
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.sync_outbox', 'U') IS NULL
BEGIN
CREATE TABLE dbo.sync_outbox (
    id BIGINT IDENTITY(1, 1) NOT NULL,
    event_uuid UNIQUEIDENTIFIER NOT NULL,
    event_type VARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL,
    aggregate_type VARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL,
    aggregate_uuid UNIQUEIDENTIFIER NOT NULL,
    aggregate_version BIGINT NOT NULL,
    occurred_at DATETIMEOFFSET(0) NOT NULL,
    payload_version SMALLINT NOT NULL CONSTRAINT DF_sync_outbox_pv DEFAULT ((1)),
    payload NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NOT NULL,
    status VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_sync_outbox_status DEFAULT ('PENDING'),
    attempts INT NOT NULL CONSTRAINT DF_sync_outbox_attempts DEFAULT ((0)),
    last_error NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_sync_outbox_created DEFAULT (sysutcdatetime()),
    sent_at DATETIME2(3) NULL,
    CONSTRAINT PK_sync_outbox PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UX_sync_outbox_event UNIQUE NONCLUSTERED (event_uuid)
);
END;

IF OBJECT_ID(N'dbo.CK_sync_outbox_status', 'C') IS NULL
ALTER TABLE dbo.sync_outbox WITH CHECK ADD CONSTRAINT CK_sync_outbox_status CHECK ([status]='REJECTED' OR [status]='SENT' OR [status]='PENDING');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sync_outbox_aggregate' AND object_id = OBJECT_ID(N'dbo.sync_outbox'))
CREATE NONCLUSTERED INDEX IX_sync_outbox_aggregate ON dbo.sync_outbox (aggregate_uuid, aggregate_version);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sync_outbox_status' AND object_id = OBJECT_ID(N'dbo.sync_outbox'))
CREATE NONCLUSTERED INDEX IX_sync_outbox_status ON dbo.sync_outbox (status, id);
