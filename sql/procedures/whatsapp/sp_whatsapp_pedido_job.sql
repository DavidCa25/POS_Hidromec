/* sp_whatsapp_pedido_job
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================= sp_whatsapp_pedido_job (0068) =================
   El estado del aviso «pedido listo» de UNA cuenta. Es la bandera que
   impide mandarlo dos veces (igual que sp_cash_closure_email_job).

     @accion = 'RESERVAR'  Antes de llamar a la nube. `resultado`:
                 RESERVADO   adelante: el renglón queda ENVIANDO.
                 YA          ENVIADO u OMITIDO: no se intenta otra vez.
                 OCUPADO     otro envío del mismo pedido en curso (< 2 min).
     @accion = 'ENVIADO'   La nube lo aceptó (lo encoló o ya lo tenía).
     @accion = 'OMITIDO'   La nube dijo que no sale (@code: DESACTIVADO,
                           OPT_OUT, TEL_INVALIDO). No se reintenta.
     @accion = 'ERROR'     No hubo respuesta clara. Se reintenta.
   ================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_whatsapp_pedido_job
    @cuenta_id INT,
    @accion    VARCHAR(10),
    @code      NVARCHAR(20) = NULL,
    @error     NVARCHAR(300) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @accion NOT IN ('RESERVAR', 'ENVIADO', 'OMITIDO', 'ERROR')
        THROW 51000, 'Accion de aviso no valida.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.hosp_cuentas WHERE id = @cuenta_id)
        THROW 51000, 'Esa cuenta no existe.', 1;

    DECLARE @resultado VARCHAR(10) = @accion;
    DECLARE @status NVARCHAR(12), @ultimo DATETIME2(0);

    BEGIN TRAN;
    IF @accion = 'RESERVAR'
    BEGIN
        SELECT @status = status, @ultimo = last_attempt_at
          FROM dbo.whatsapp_pedido_avisos WITH (UPDLOCK, HOLDLOCK) WHERE cuenta_id = @cuenta_id;

        IF @status IS NULL
        BEGIN
            INSERT dbo.whatsapp_pedido_avisos (cuenta_id, status, attempts, last_attempt_at)
            VALUES (@cuenta_id, N'ENVIANDO', 1, SYSDATETIME());
            SET @resultado = 'RESERVADO';
        END
        ELSE IF @status IN (N'ENVIADO', N'OMITIDO')
            SET @resultado = 'YA';
        ELSE IF @status = N'ENVIANDO' AND @ultimo > DATEADD(MINUTE, -2, SYSDATETIME())
            SET @resultado = 'OCUPADO';
        ELSE
        BEGIN
            UPDATE dbo.whatsapp_pedido_avisos
               SET status = N'ENVIANDO', attempts = attempts + 1, last_attempt_at = SYSDATETIME()
             WHERE cuenta_id = @cuenta_id;
            SET @resultado = 'RESERVADO';
        END
    END
    ELSE IF @accion = 'ENVIADO'
        UPDATE dbo.whatsapp_pedido_avisos
           SET status = N'ENVIADO', code = LEFT(@code, 20), sent_at = SYSDATETIME(), last_error = NULL
         WHERE cuenta_id = @cuenta_id;
    ELSE IF @accion = 'OMITIDO'
        UPDATE dbo.whatsapp_pedido_avisos
           SET status = N'OMITIDO', code = LEFT(@code, 20), last_error = LEFT(@error, 300)
         WHERE cuenta_id = @cuenta_id AND status <> N'ENVIADO';
    ELSE
        UPDATE dbo.whatsapp_pedido_avisos
           SET status = N'ERROR', code = LEFT(@code, 20), last_error = LEFT(@error, 300)
         WHERE cuenta_id = @cuenta_id AND status NOT IN (N'ENVIADO', N'OMITIDO');
    COMMIT TRAN;

    SELECT a.cuenta_id, a.id, a.status, a.code, a.attempts, a.last_error, a.sent_at, @resultado AS resultado
      FROM dbo.whatsapp_pedido_avisos a WHERE a.cuenta_id = @cuenta_id;
END;
GO
