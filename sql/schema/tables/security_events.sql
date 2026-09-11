/* security_events
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.security_events', 'U') IS NULL
BEGIN
CREATE TABLE dbo.security_events (
    id INT IDENTITY(1, 1) NOT NULL,
    datee DATETIME NOT NULL DEFAULT (getdate()),
    user_id INT NULL,
    authorized_by INT NULL,
    register_id INT NULL,
    event_type NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NOT NULL,
    amount DECIMAL(18, 2) NULL,
    detail NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    sale_id INT NULL,
    PRIMARY KEY CLUSTERED (id)
);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_secev_type_date' AND object_id = OBJECT_ID(N'dbo.security_events'))
CREATE NONCLUSTERED INDEX IX_secev_type_date ON dbo.security_events (event_type, datee);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_secev_user_date' AND object_id = OBJECT_ID(N'dbo.security_events'))
CREATE NONCLUSTERED INDEX IX_secev_user_date ON dbo.security_events (user_id, datee);
