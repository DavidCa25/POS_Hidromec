/* ============================================================
   0061 — Corte de caja por correo (esquema)

   cash_closure_email_jobs    Un renglón por corte que se intentó enviar.
                              Es la BANDERA: un corte con status ENVIADO no
                              se vuelve a mandar, ni solo ni en lote. Un corte
                              sin renglón nunca se intentó (cortes anteriores
                              a esta versión: "sin enviar").

   El correo lo arma y lo manda la nube (función corte-email) a los dueños
   del negocio en Owner. Aquí solo vive el estado del envío de cada corte.
   `id` es la llave de idempotencia con la nube: reintentar el mismo corte
   nunca produce dos correos.

   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF OBJECT_ID(N'dbo.cash_closure_email_jobs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.cash_closure_email_jobs (
        closure_id      INT              NOT NULL,
        id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_cash_closure_email_jobs_id DEFAULT (NEWID()),
        status          NVARCHAR(12)     COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_cash_closure_email_jobs_status DEFAULT (N'PENDIENTE'),
        attempts        INT              NOT NULL CONSTRAINT DF_cash_closure_email_jobs_attempts DEFAULT (0),
        recipients      INT              NULL,
        last_error      NVARCHAR(300)    COLLATE Modern_Spanish_CI_AS NULL,
        requested_by    INT              NULL,
        created_at      DATETIME2(0)     NOT NULL CONSTRAINT DF_cash_closure_email_jobs_created_at DEFAULT (SYSDATETIME()),
        last_attempt_at DATETIME2(0)     NULL,
        sent_at         DATETIME2(0)     NULL,
        CONSTRAINT PK_cash_closure_email_jobs PRIMARY KEY CLUSTERED (closure_id),
        CONSTRAINT UQ_cash_closure_email_jobs_id UNIQUE NONCLUSTERED (id),
        CONSTRAINT FK_cash_closure_email_jobs_closure FOREIGN KEY (closure_id) REFERENCES dbo.cash_closures (id),
        CONSTRAINT CK_cash_closure_email_jobs_status CHECK (status IN (N'PENDIENTE', N'ENVIANDO', N'ENVIADO', N'ERROR'))
    );
END;
GO
