/* sp_set_professional_schedule
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El horario semanal de una persona, completo.
 *
 * Mismo criterio que la matriz de servicios: la pantalla es una semana y el
 * usuario piensa en la semana entera, no en franjas sueltas.
 *
 * Se permiten VARIAS franjas por dia -manana y tarde, con la comida en medio-
 * porque es como trabaja media Mexico, y un solo rango obligaria a decir que
 * el taller abre a las nueve y cierra a las siete sin parar.
 *
 * `weekday` va de 1 a 7 con 1 = domingo, igual que DATEPART(WEEKDAY). Usar la
 * misma numeracion que el motor evita una conversion en cada consulta de la
 * Agenda, y esa conversion es donde se cuelan los errores de un dia entero.
 */
CREATE OR ALTER PROCEDURE dbo.sp_set_professional_schedule
    @professional_id INT,
    @franjas_json    NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.professionals WHERE id = @professional_id)
    BEGIN
        RAISERROR('Ese profesional no existe.', 16, 1);
        RETURN;
    END

    DECLARE @entrada TABLE (weekday TINYINT, starts_at TIME(0), ends_at TIME(0));

    INSERT INTO @entrada (weekday, starts_at, ends_at)
    SELECT j.weekday, j.starts_at, j.ends_at
      FROM OPENJSON(ISNULL(@franjas_json, '[]'))
           WITH (weekday TINYINT '$.weekday',
                 starts_at TIME(0) '$.startsAt',
                 ends_at TIME(0) '$.endsAt') j
     WHERE j.weekday IS NOT NULL AND j.starts_at IS NOT NULL AND j.ends_at IS NOT NULL;

    IF EXISTS (SELECT 1 FROM @entrada WHERE weekday < 1 OR weekday > 7)
    BEGIN
        RAISERROR('El dia de la semana va de 1 (domingo) a 7 (sabado).', 16, 1);
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM @entrada WHERE ends_at <= starts_at)
    BEGIN
        RAISERROR('Una franja tiene que terminar despues de empezar.', 16, 1);
        RETURN;
    END

    /* Dos franjas del mismo dia que se pisan describen un horario que nadie
       puede cumplir, y la disponibilidad las contaria dos veces. */
    IF EXISTS (SELECT 1
                 FROM @entrada a
                 JOIN @entrada b ON a.weekday = b.weekday
                                AND a.starts_at < b.ends_at
                                AND b.starts_at < a.ends_at
                                AND (a.starts_at <> b.starts_at OR a.ends_at <> b.ends_at))
    BEGIN
        RAISERROR('Hay franjas del mismo dia que se enciman.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    DELETE FROM dbo.professional_schedules WHERE professional_id = @professional_id;

    INSERT INTO dbo.professional_schedules (professional_id, weekday, starts_at, ends_at, active)
    SELECT @professional_id, weekday, starts_at, ends_at, 1 FROM @entrada;

    COMMIT TRAN;

    SELECT id, professional_id, weekday, starts_at, ends_at, active
      FROM dbo.professional_schedules
     WHERE professional_id = @professional_id
     ORDER BY weekday, starts_at;
END
GO
