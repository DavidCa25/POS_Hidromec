/* cash_closure_email_jobs
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.cash_closure_email_jobs', 'U') IS NULL
BEGIN
CREATE TABLE dbo.cash_closure_email_jobs (
    closure_id INT NOT NULL,
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_cash_closure_email_jobs_id DEFAULT (newid()),
    status NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_cash_closure_email_jobs_status DEFAULT (N'PENDIENTE'),
    attempts INT NOT NULL CONSTRAINT DF_cash_closure_email_jobs_attempts DEFAULT ((0)),
    recipients INT NULL,
    last_error NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL,
    requested_by INT NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_cash_closure_email_jobs_created_at DEFAULT (sysdatetime()),
    last_attempt_at DATETIME2(0) NULL,
    sent_at DATETIME2(0) NULL,
    CONSTRAINT PK_cash_closure_email_jobs PRIMARY KEY CLUSTERED (closure_id),
    CONSTRAINT UQ_cash_closure_email_jobs_id UNIQUE NONCLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_cash_closure_email_jobs_closure', 'F') IS NULL
ALTER TABLE dbo.cash_closure_email_jobs WITH CHECK ADD CONSTRAINT FK_cash_closure_email_jobs_closure FOREIGN KEY (closure_id) REFERENCES dbo.cash_closures (id);

IF OBJECT_ID(N'dbo.CK_cash_closure_email_jobs_status', 'C') IS NULL
ALTER TABLE dbo.cash_closure_email_jobs WITH CHECK ADD CONSTRAINT CK_cash_closure_email_jobs_status CHECK ([status]=N'ERROR' OR [status]=N'ENVIADO' OR [status]=N'ENVIANDO' OR [status]=N'PENDIENTE');
