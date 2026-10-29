/* sp_asistencia_horario_guardar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================= sp_asistencia_horario_guardar (0071) =================
   El horario semanal de una persona. Reemplaza el anterior entero: lo que se
   ve en pantalla es lo que queda. Un dia que no viene es su descanso.

   @dias: [{"weekday":1,"entrada":"08:00","salida":"16:00","descanso_min":30}, ...]
   (1 = lunes ... 7 = domingo). Una salida igual o antes que la entrada cae
   al dia siguiente: un turno de 22:00 a 06:00 es valido.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_asistencia_horario_guardar
    @persona_id INT,
    @dias       NVARCHAR(MAX),
    @user_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @persona_id)
        THROW 51000, N'Esa persona no existe.', 1;
    IF @dias IS NULL OR ISJSON(@dias) = 0
        THROW 51000, N'El horario no es válido.', 1;

    DECLARE @h TABLE (weekday TINYINT, entrada TIME(0), salida TIME(0), descanso_min SMALLINT);
    INSERT INTO @h (weekday, entrada, salida, descanso_min)
    SELECT j.weekday, TRY_CONVERT(TIME(0), j.entrada), TRY_CONVERT(TIME(0), j.salida), ISNULL(j.descanso_min, 0)
      FROM OPENJSON(@dias) WITH (weekday TINYINT, entrada VARCHAR(8), salida VARCHAR(8), descanso_min SMALLINT) j;

    IF EXISTS (SELECT 1 FROM @h WHERE weekday IS NULL OR weekday NOT BETWEEN 1 AND 7)
        THROW 51000, N'Día de la semana no válido.', 1;
    IF EXISTS (SELECT 1 FROM @h WHERE entrada IS NULL OR salida IS NULL)
        THROW 51000, N'Indica la hora de entrada y la de salida de cada día que trabaja.', 1;
    IF EXISTS (SELECT 1 FROM @h WHERE entrada = salida)
        THROW 51000, N'La entrada y la salida no pueden ser la misma hora.', 1;
    IF EXISTS (SELECT 1 FROM @h WHERE descanso_min NOT BETWEEN 0 AND 240)
        THROW 51000, N'El descanso va de 0 a 240 minutos.', 1;
    IF EXISTS (SELECT weekday FROM @h GROUP BY weekday HAVING COUNT(*) > 1)
        THROW 51000, N'Un día aparece dos veces.', 1;

    BEGIN TRAN;
        DELETE FROM dbo.asistencia_horarios WHERE user_id = @persona_id;
        INSERT INTO dbo.asistencia_horarios (user_id, weekday, entrada, salida, descanso_min, updated_at, updated_by)
        SELECT @persona_id, weekday, entrada, salida, descanso_min, SYSDATETIME(), @user_id FROM @h;
    COMMIT;

    EXEC dbo.sp_asistencia_horario_get @persona_id = @persona_id;
END
GO
