/* sp_asistencia_jornadas
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ==================== sp_asistencia_jornadas (0071) ====================
   Las jornadas de UNA persona en un rango, con sus descansos y las
   correcciones que se les hicieron. Es el detalle que se abre al tocar una
   fila de la tabla, desde donde un encargado corrige.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_asistencia_jornadas
    @persona_id INT,
    @desde      DATE,
    @hasta      DATE
AS
BEGIN
    SET NOCOUNT ON;
    IF @desde IS NULL OR @hasta IS NULL OR @hasta < @desde
        THROW 51000, N'Indica un rango de fechas válido.', 1;

    SELECT j.id, j.user_id, j.dia, j.entrada_en, j.salida_en, j.estado, j.corregida, j.register_id
      FROM dbo.asistencia_jornadas j
     WHERE j.user_id = @persona_id AND j.dia BETWEEN @desde AND @hasta
     ORDER BY j.entrada_en DESC;

    SELECT d.id, d.jornada_id, d.inicio_en, d.fin_en
      FROM dbo.asistencia_descansos d
      JOIN dbo.asistencia_jornadas j ON j.id = d.jornada_id
     WHERE j.user_id = @persona_id AND j.dia BETWEEN @desde AND @hasta
     ORDER BY d.inicio_en;

    SELECT c.id, c.jornada_id, c.entrada_antes, c.salida_antes, c.entrada_nueva, c.salida_nueva,
           c.motivo, c.corregida_por, u.usuario AS corregida_por_nombre, c.corregida_en
      FROM dbo.asistencia_correcciones c
      JOIN dbo.asistencia_jornadas j ON j.id = c.jornada_id
      LEFT JOIN dbo.users u ON u.id = c.corregida_por
     WHERE j.user_id = @persona_id AND j.dia BETWEEN @desde AND @hasta
     ORDER BY c.corregida_en DESC;
END
GO
