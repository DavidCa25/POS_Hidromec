/* sp_get_professional_schedule
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El horario semanal y las ausencias de una persona, o de todas.
 *
 * Dos conjuntos porque son dos cosas distintas: el horario se repite cada
 * semana y las ausencias tienen fecha. Devolverlas mezcladas obligaria a quien
 * las reciba a separarlas otra vez.
 *
 * Las ausencias viejas no se traen: una pantalla de horarios con las
 * vacaciones del ano pasado es una pantalla que nadie lee.
 */
CREATE OR ALTER PROCEDURE dbo.sp_get_professional_schedule
    @professional_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT s.id, s.professional_id, p.full_name, s.weekday, s.starts_at, s.ends_at, s.active
      FROM dbo.professional_schedules s
      JOIN dbo.professionals p ON p.id = s.professional_id
     WHERE (@professional_id IS NULL OR s.professional_id = @professional_id)
     ORDER BY p.full_name, s.weekday, s.starts_at;

    SELECT t.id, t.professional_id, p.full_name, t.starts_at, t.ends_at, t.reason
      FROM dbo.professional_time_off t
      JOIN dbo.professionals p ON p.id = t.professional_id
     WHERE (@professional_id IS NULL OR t.professional_id = @professional_id)
       AND t.ends_at >= DATEADD(DAY, -30, SYSDATETIME())
     ORDER BY t.starts_at;
END
GO
