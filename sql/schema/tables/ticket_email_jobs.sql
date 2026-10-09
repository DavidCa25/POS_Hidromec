/* ticket_email_jobs
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.ticket_email_jobs', 'U') IS NULL
BEGIN
CREATE TABLE dbo.ticket_email_jobs (
    id UNIQUEIDENTIFIER NOT NULL,
    sale_id INT NOT NULL,
    recipient NVARCHAR(254) COLLATE Modern_Spanish_CI_AS NOT NULL,
    pdf VARBINARY(MAX) NOT NULL,
    created_at DATETIME2(7) NOT NULL DEFAULT (sysutcdatetime()),
    sent_at DATETIME2(7) NULL,
    PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UQ_ticket_email_destination UNIQUE NONCLUSTERED (sale_id, recipient)
);
END;

ALTER TABLE dbo.ticket_email_jobs WITH CHECK ADD FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);
