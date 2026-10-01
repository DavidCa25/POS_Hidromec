/* service_order_events
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.service_order_events', 'U') IS NULL
BEGIN
CREATE TABLE dbo.service_order_events (
    id INT IDENTITY(1, 1) NOT NULL,
    order_id INT NOT NULL,
    happened_at DATETIME2(0) NOT NULL CONSTRAINT DF_soevents_at DEFAULT (sysdatetime()),
    event_type NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL,
    from_status NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    to_status NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    quote_version INT NULL,
    amount DECIMAL(14, 2) NULL,
    detail NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    user_id INT NULL,
    CONSTRAINT PK_service_order_events PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_soevents_order', 'F') IS NULL
ALTER TABLE dbo.service_order_events WITH CHECK ADD CONSTRAINT FK_soevents_order FOREIGN KEY (order_id) REFERENCES dbo.service_orders (id);

IF OBJECT_ID(N'dbo.FK_soevents_user', 'F') IS NULL
ALTER TABLE dbo.service_order_events WITH CHECK ADD CONSTRAINT FK_soevents_user FOREIGN KEY (user_id) REFERENCES dbo.users (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_soevents_order' AND object_id = OBJECT_ID(N'dbo.service_order_events'))
CREATE NONCLUSTERED INDEX IX_soevents_order ON dbo.service_order_events (order_id, happened_at);
