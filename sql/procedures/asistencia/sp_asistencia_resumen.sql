/* sp_asistencia_resumen
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ==================== sp_asistencia_resumen (0071) ====================
   Horas trabajadas, extra y retardos por persona y dia, entre @desde y
   @hasta. Es la tabla de la pantalla Asistencia y lo que se exporta.

   Las reglas son las respuestas al activar (asistencia_reglas):

     TRABAJADO  entrada -> salida, menos los descansos si el descanso no se
                paga. Un descanso se recorta a su jornada. Una jornada
                abierta cuenta hasta ahora; una SIN_SALIDA cuenta 0.
     EXTRA      depende SOLO de la hora de salida: lo que pasa de la salida
                del horario de ese dia, si pasa de la tolerancia (si pasa,
                cuenta entero). Con varias jornadas el mismo dia, la ultima
                salida. Sin horario asignado no hay extra. En su dia de
                descanso, todo lo trabajado si la regla lo dice.
     RETARDO    la primera entrada despues de la del horario, con la misma
                tolerancia.

   Devuelve: 1) persona-dia, 2) las personas, 3) los horarios.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_asistencia_resumen
    @desde      DATE,
    @hasta      DATE,
    @persona_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @desde IS NULL OR @hasta IS NULL OR @hasta < @desde
        THROW 51000, N'Indica un rango de fechas válido.', 1;
    IF DATEDIFF(DAY, @desde, @hasta) > 62
        THROW 51000, N'El rango no puede pasar de dos meses.', 1;

    DECLARE @ahora DATETIME2(0) = SYSDATETIME();
    DECLARE @extra BIT = 0, @tol INT = 0, @pagado BIT = 0, @libre BIT = 0, @retardos BIT = 0;
    SELECT @extra = cuenta_extra, @tol = tolerancia_min, @pagado = descanso_pagado,
           @libre = dia_libre_extra, @retardos = marca_retardos
      FROM dbo.asistencia_reglas WHERE id = 1;

    ;WITH j AS (
        SELECT j.id, j.user_id, j.dia, j.entrada_en, j.salida_en, j.estado, j.corregida,
               CASE j.estado WHEN 'CERRADA' THEN j.salida_en WHEN 'ABIERTA' THEN @ahora END AS fin
          FROM dbo.asistencia_jornadas j
         WHERE j.dia BETWEEN @desde AND @hasta
           AND (@persona_id IS NULL OR j.user_id = @persona_id)
    ), jm AS (
        SELECT j.*,
               ISNULL((SELECT SUM(CASE WHEN x.fin_d > x.ini_d THEN DATEDIFF(MINUTE, x.ini_d, x.fin_d) ELSE 0 END)
                         FROM dbo.asistencia_descansos d
                        CROSS APPLY (SELECT CASE WHEN d.inicio_en < j.entrada_en THEN j.entrada_en ELSE d.inicio_en END AS ini_d,
                                            CASE WHEN ISNULL(d.fin_en, j.fin) > j.fin THEN j.fin ELSE ISNULL(d.fin_en, j.fin) END AS fin_d) x
                        WHERE d.jornada_id = j.id AND j.fin IS NOT NULL), 0) AS descanso_min
          FROM j
    ), jt AS (
        SELECT jm.*,
               CASE WHEN jm.fin IS NULL THEN 0
                    ELSE DATEDIFF(MINUTE, jm.entrada_en, jm.fin) - CASE WHEN @pagado = 1 THEN 0 ELSE jm.descanso_min END
               END AS trabajado_min
          FROM jm
    ), dia AS (
        SELECT user_id, dia,
               MIN(entrada_en) AS entrada,
               MAX(salida_en) AS salida,
               SUM(CASE WHEN trabajado_min > 0 THEN trabajado_min ELSE 0 END) AS trabajado_min,
               SUM(descanso_min) AS descanso_min,
               MAX(CASE WHEN estado = 'ABIERTA' THEN 1 ELSE 0 END) AS abierta,
               MAX(CASE WHEN estado = 'SIN_SALIDA' THEN 1 ELSE 0 END) AS revisar,
               MAX(CAST(corregida AS INT)) AS corregida,
               COUNT(*) AS jornadas
          FROM jt GROUP BY user_id, dia
    ), conh AS (
        SELECT d.*,
               CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.asistencia_horarios x WHERE x.user_id = d.user_id) THEN 1 ELSE 0 END AS BIT) AS tiene_horario,
               h.user_id AS h_user,
               DATEADD(SECOND, DATEDIFF(SECOND, CAST('00:00' AS TIME(0)), h.entrada), CAST(d.dia AS DATETIME2(0))) AS prog_entrada,
               DATEADD(DAY, CASE WHEN h.salida <= h.entrada THEN 1 ELSE 0 END,
                   DATEADD(SECOND, DATEDIFF(SECOND, CAST('00:00' AS TIME(0)), h.salida), CAST(d.dia AS DATETIME2(0)))) AS prog_salida
          FROM dia d
          LEFT JOIN dbo.asistencia_horarios h
                 ON h.user_id = d.user_id AND h.weekday = (DATEDIFF(DAY, '19000101', d.dia) % 7) + 1
    )
    SELECT c.user_id, c.dia, c.entrada, c.salida, c.trabajado_min, c.descanso_min,
           CAST(c.abierta AS BIT) AS abierta, CAST(c.revisar AS BIT) AS revisar,
           CAST(c.corregida AS BIT) AS corregida, c.jornadas, c.tiene_horario,
           CAST(CASE WHEN c.tiene_horario = 1 AND c.h_user IS NULL THEN 1 ELSE 0 END AS BIT) AS dia_libre,
           CASE
             WHEN @extra = 0 OR c.tiene_horario = 0 THEN 0
             WHEN c.h_user IS NULL THEN CASE WHEN @libre = 1 THEN c.trabajado_min ELSE 0 END
             WHEN c.abierta = 1 OR c.salida IS NULL THEN 0
             WHEN DATEDIFF(MINUTE, c.prog_salida, c.salida) > @tol THEN DATEDIFF(MINUTE, c.prog_salida, c.salida)
             ELSE 0
           END AS extra_min,
           CASE
             WHEN @retardos = 1 AND c.h_user IS NOT NULL AND DATEDIFF(MINUTE, c.prog_entrada, c.entrada) > @tol
               THEN DATEDIFF(MINUTE, c.prog_entrada, c.entrada)
             ELSE 0
           END AS retardo_min
      FROM conh c
     ORDER BY c.user_id, c.dia;

    /* Las personas: las activas y las que trabajaron en el rango aunque hoy
       esten dadas de baja (sus horas siguen siendo suyas). */
    SELECT u.id AS user_id, u.usuario, u.rol, CAST(ISNULL(u.active, 1) AS BIT) AS active
      FROM dbo.users u
     WHERE (@persona_id IS NULL OR u.id = @persona_id)
       AND (ISNULL(u.active, 1) = 1
            OR EXISTS (SELECT 1 FROM dbo.asistencia_jornadas j
                        WHERE j.user_id = u.id AND j.dia BETWEEN @desde AND @hasta))
     ORDER BY u.usuario;

    SELECT h.user_id, h.weekday,
           CONVERT(CHAR(5), h.entrada, 108) AS entrada,
           CONVERT(CHAR(5), h.salida, 108) AS salida,
           h.descanso_min
      FROM dbo.asistencia_horarios h
     WHERE @persona_id IS NULL OR h.user_id = @persona_id
     ORDER BY h.user_id, h.weekday;
END
GO
