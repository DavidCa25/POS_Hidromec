/* sp_asistencia_horario_get
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* =================== sp_asistencia_horario_get (0071) ===================
   El horario de una persona, o el de todas con @persona_id NULL. Las horas
   salen como texto HH:mm: un TIME llega a JavaScript como fecha de 1970.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_asistencia_horario_get
    @persona_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT h.user_id, h.weekday,
           CONVERT(CHAR(5), h.entrada, 108) AS entrada,
           CONVERT(CHAR(5), h.salida, 108) AS salida,
           h.descanso_min
      FROM dbo.asistencia_horarios h
     WHERE @persona_id IS NULL OR h.user_id = @persona_id
     ORDER BY h.user_id, h.weekday;
END
GO
