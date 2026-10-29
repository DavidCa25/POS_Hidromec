/* sp_asistencia_marcar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_asistencia_marcar (0071) =====================
   Una marca de la persona con la sesion abierta: ENTRADA, INICIO_DESCANSO,
   FIN_DESCANSO o SALIDA. La hora la pone el servidor.

   La secuencia se valida AQUI, no en la pantalla: dos cajas pueden pulsar a
   la vez. Lo garantiza el candado sobre la jornada abierta y el indice unico
   UX_asistencia_jornadas_abierta (una sola abierta por persona).

   OLVIDO DE SALIDA: si al marcar ENTRADA hay una jornada abierta de un dia
   anterior, esa queda SIN_SALIDA (0 horas, "Revisar") y empieza la nueva. No
   se adivina a que hora salio: lo corrige un encargado.

   SALIDA en pleno descanso cierra el descanso a la misma hora.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_asistencia_marcar
    @user_id     INT,
    @tipo        VARCHAR(16),
    @register_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'asistencia' AND enabled = 1)
        THROW 51000, N'Asistencia no está activada.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @user_id AND ISNULL(active, 1) = 1)
        THROW 51000, N'Esa persona no existe o está dada de baja.', 1;
    SET @tipo = UPPER(LTRIM(RTRIM(@tipo)));
    IF @tipo NOT IN ('ENTRADA', 'INICIO_DESCANSO', 'FIN_DESCANSO', 'SALIDA')
        THROW 51000, N'Marca no válida.', 1;

    DECLARE @ahora DATETIME2(0) = SYSDATETIME();
    DECLARE @jid INT, @jdia DATE, @desc INT;

    BEGIN TRAN;
        SELECT @jid = id, @jdia = dia
          FROM dbo.asistencia_jornadas WITH (UPDLOCK, HOLDLOCK)
         WHERE user_id = @user_id AND estado = 'ABIERTA';
        IF @jid IS NOT NULL
            SELECT @desc = id FROM dbo.asistencia_descansos WITH (UPDLOCK)
             WHERE jornada_id = @jid AND fin_en IS NULL;

        IF @tipo = 'ENTRADA'
        BEGIN
            IF @jid IS NOT NULL AND @jdia = CAST(@ahora AS DATE)
                THROW 51000, N'Ya registraste tu entrada.', 1;
            IF @jid IS NOT NULL
                UPDATE dbo.asistencia_jornadas SET estado = 'SIN_SALIDA' WHERE id = @jid;
            INSERT INTO dbo.asistencia_jornadas (user_id, dia, entrada_en, estado, register_id)
            VALUES (@user_id, CAST(@ahora AS DATE), @ahora, 'ABIERTA', @register_id);
        END
        ELSE IF @tipo = 'INICIO_DESCANSO'
        BEGIN
            IF @jid IS NULL THROW 51000, N'Primero registra tu entrada.', 1;
            IF @desc IS NOT NULL THROW 51000, N'Ya estás en descanso.', 1;
            INSERT INTO dbo.asistencia_descansos (jornada_id, inicio_en) VALUES (@jid, @ahora);
        END
        ELSE IF @tipo = 'FIN_DESCANSO'
        BEGIN
            IF @desc IS NULL THROW 51000, N'No estás en descanso.', 1;
            UPDATE dbo.asistencia_descansos SET fin_en = @ahora WHERE id = @desc;
        END
        ELSE /* SALIDA */
        BEGIN
            IF @jid IS NULL THROW 51000, N'No tienes una entrada abierta.', 1;
            IF @desc IS NOT NULL
                UPDATE dbo.asistencia_descansos SET fin_en = @ahora WHERE id = @desc;
            UPDATE dbo.asistencia_jornadas SET salida_en = @ahora, estado = 'CERRADA' WHERE id = @jid;
        END
    COMMIT;

    EXEC dbo.sp_asistencia_estado @user_id = @user_id;
END
GO
