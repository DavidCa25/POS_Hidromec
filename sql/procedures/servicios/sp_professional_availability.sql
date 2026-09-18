/* sp_professional_availability
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Los huecos libres de un dia, por persona.
 *
 * ES LO QUE SE PREGUNTA POR TELEFONO
 * ----------------------------------
 * "¿Para cuando me puede dar?" La respuesta util no es la agenda entera: son
 * las horas concretas en las que cabe ESE servicio. Por eso recibe la duracion
 * -o el servicio, de donde se saca- y devuelve huecos de ese tamano, no
 * intervalos genericos que luego alguien tenga que trocear a ojo.
 *
 * SE PARTE DEL HORARIO Y SE RESTA LO OCUPADO
 * ------------------------------------------
 * Del horario semanal se quitan las ausencias y las citas en pie. Lo que
 * queda, troceado cada `@paso` minutos, es lo que se puede ofrecer.
 *
 * Sin horario declarado no se devuelve nada, y eso es correcto: un negocio que
 * no dijo cuando trabaja no puede recibir una respuesta inventada. La pantalla
 * lo dice y ofrece declararlo.
 */
CREATE OR ALTER PROCEDURE dbo.sp_professional_availability
    @fecha              DATE,
    @professional_id    INT = NULL,
    @service_product_id INT = NULL,
    @duracion_minutos   INT = NULL,
    @paso_minutos       INT = 15
AS
BEGIN
    SET NOCOUNT ON;

    IF @fecha IS NULL
    BEGIN
        RAISERROR('Hace falta la fecha.', 16, 1);
        RETURN;
    END

    SET @paso_minutos = CASE WHEN ISNULL(@paso_minutos, 0) <= 0 THEN 15 ELSE @paso_minutos END;

    DECLARE @duracion INT = ISNULL(
        @duracion_minutos,
        ISNULL((SELECT duration_minutes FROM dbo.services WHERE product_id = @service_product_id), 30));

    DECLARE @dia TINYINT = DATEPART(WEEKDAY, @fecha);
    DECLARE @inicio DATETIME2(0) = CONVERT(DATETIME2(0), @fecha);
    DECLARE @fin DATETIME2(0) = DATEADD(DAY, 1, @inicio);

    /* Quien entra en la respuesta: quien trabaja ese dia y, si se pidio un
       servicio, quien lo hace. Sin matriz para ese servicio, lo hace
       cualquiera. */
    DECLARE @gente TABLE (professional_id INT PRIMARY KEY);
    INSERT INTO @gente (professional_id)
    SELECT p.id
      FROM dbo.professionals p
     WHERE p.active = 1
       AND (@professional_id IS NULL OR p.id = @professional_id)
       AND (@service_product_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM dbo.service_professionals sp
                            WHERE sp.service_product_id = @service_product_id)
            OR EXISTS (SELECT 1 FROM dbo.service_professionals sp
                        WHERE sp.service_product_id = @service_product_id
                          AND sp.professional_id = p.id));

    /* Todos los comienzos posibles del dia, cada `@paso` minutos. La tabla de
       numeros se construye al vuelo: son 96 filas para un paso de 15 minutos
       y no merece una tabla permanente. */
    WITH pasos AS (
        SELECT 0 AS n
        UNION ALL
        SELECT n + 1 FROM pasos WHERE n + 1 < (1440 / @paso_minutos)
    ),
    candidatos AS (
        SELECT g.professional_id,
               DATEADD(MINUTE, p.n * @paso_minutos, @inicio) AS desde,
               DATEADD(MINUTE, p.n * @paso_minutos + @duracion, @inicio) AS hasta
          FROM @gente g
         CROSS JOIN pasos p
    )
    SELECT c.professional_id,
           pr.full_name AS professional_name,
           pr.color AS professional_color,
           c.desde AS starts_at,
           c.hasta AS ends_at
      FROM candidatos c
      JOIN dbo.professionals pr ON pr.id = c.professional_id
     WHERE c.hasta <= @fin
       /* Dentro de una franja de su horario, entera. */
       AND EXISTS (SELECT 1 FROM dbo.professional_schedules s
                    WHERE s.professional_id = c.professional_id
                      AND s.active = 1
                      AND s.weekday = @dia
                      AND s.starts_at <= CONVERT(TIME(0), c.desde)
                      AND s.ends_at   >= CONVERT(TIME(0), c.hasta))
       /* Ni en una ausencia. */
       AND NOT EXISTS (SELECT 1 FROM dbo.professional_time_off t
                        WHERE t.professional_id = c.professional_id
                          AND t.starts_at < c.hasta AND c.desde < t.ends_at)
       /* Ni encima de una cita en pie. */
       AND NOT EXISTS (SELECT 1 FROM dbo.appointments a
                        WHERE a.professional_id = c.professional_id
                          AND a.status IN ('AGENDADA', 'CONFIRMADA')
                          AND a.starts_at < c.hasta AND c.desde < a.ends_at)
     ORDER BY pr.full_name, c.desde
     OPTION (MAXRECURSION 200);
END
GO
