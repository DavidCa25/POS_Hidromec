SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================= sp_cash_closure_email_job (0061) =================
   El estado del correo de UN corte. Es la bandera que impide mandarlo dos
   veces.

     @accion = 'RESERVAR'  Antes de llamar a la nube. Devuelve `resultado`:
                 RESERVADO   adelante: el renglón queda ENVIANDO.
                 YA_ENVIADO  ya salió; no se manda otra vez.
                 OCUPADO     otro envío del mismo corte está en curso
                             (menos de 2 minutos): no se duplica.
     @accion = 'ENVIADO'   La nube confirmó. Guarda cuántos destinatarios.
     @accion = 'ERROR'     No salió. Se puede reintentar.

   Solo cortes CERRADOS: un turno abierto todavía no tiene corte.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_cash_closure_email_job
    @closure_id INT,
    @accion     VARCHAR(10),
    @user_id    INT = NULL,
    @recipients INT = NULL,
    @error      NVARCHAR(300) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @accion NOT IN ('RESERVAR', 'ENVIADO', 'ERROR')
        THROW 51000, 'Accion de correo no valida.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.cash_closures WHERE id = @closure_id AND closed_at IS NOT NULL)
        THROW 51000, 'Ese corte no existe o sigue abierto.', 1;

    DECLARE @resultado VARCHAR(12) = @accion;

    BEGIN TRAN;
    IF @accion = 'RESERVAR'
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.cash_closure_email_jobs WITH (UPDLOCK, HOLDLOCK) WHERE closure_id = @closure_id)
            INSERT dbo.cash_closure_email_jobs (closure_id, requested_by) VALUES (@closure_id, @user_id);

        DECLARE @status NVARCHAR(12), @ultimo DATETIME2(0);
        SELECT @status = status, @ultimo = last_attempt_at
          FROM dbo.cash_closure_email_jobs WITH (UPDLOCK) WHERE closure_id = @closure_id;

        IF @status = N'ENVIADO'
            SET @resultado = 'YA_ENVIADO';
        ELSE IF @status = N'ENVIANDO' AND @ultimo > DATEADD(MINUTE, -2, SYSDATETIME())
            SET @resultado = 'OCUPADO';
        ELSE
        BEGIN
            UPDATE dbo.cash_closure_email_jobs
               SET status = N'ENVIANDO', attempts = attempts + 1, last_attempt_at = SYSDATETIME(),
                   requested_by = ISNULL(@user_id, requested_by)
             WHERE closure_id = @closure_id;
            SET @resultado = 'RESERVADO';
        END
    END
    ELSE IF @accion = 'ENVIADO'
        UPDATE dbo.cash_closure_email_jobs
           SET status = N'ENVIADO', sent_at = SYSDATETIME(), recipients = @recipients, last_error = NULL
         WHERE closure_id = @closure_id;
    ELSE
        UPDATE dbo.cash_closure_email_jobs
           SET status = N'ERROR', last_error = LEFT(@error, 300)
         WHERE closure_id = @closure_id AND status <> N'ENVIADO';
    COMMIT TRAN;

    SELECT j.closure_id, j.id, j.status, j.attempts, j.recipients, j.last_error, j.sent_at, @resultado AS resultado
      FROM dbo.cash_closure_email_jobs j WHERE j.closure_id = @closure_id;
END;
GO
