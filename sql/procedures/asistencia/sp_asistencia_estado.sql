/* sp_asistencia_estado
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_asistencia_estado (0071) =====================
   Como esta una persona ahora: sin entrada, trabajando o en descanso, y que
   puede marcar. Es lo que pinta el dialogo "Checar" de la caja: solo ofrece
   las acciones que tocan, asi que el orden de las marcas no depende de que
   la persona lo recuerde.

   Dia de la semana: 1 = lunes ... 7 = domingo, contado desde el 1900-01-01
   (lunes) para no depender de SET DATEFIRST.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_asistencia_estado
    @user_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ahora DATETIME2(0) = SYSDATETIME();
    DECLARE @hoy DATE = CAST(@ahora AS DATE);
    DECLARE @wd TINYINT = (DATEDIFF(DAY, '19000101', @hoy) % 7) + 1;

    DECLARE @jid INT, @entrada DATETIME2(0), @desc_inicio DATETIME2(0);
    SELECT @jid = j.id, @entrada = j.entrada_en
      FROM dbo.asistencia_jornadas j
     WHERE j.user_id = @user_id AND j.estado = 'ABIERTA';
    IF @jid IS NOT NULL
        SELECT @desc_inicio = d.inicio_en FROM dbo.asistencia_descansos d
         WHERE d.jornada_id = @jid AND d.fin_en IS NULL;

    DECLARE @pagado BIT = ISNULL((SELECT descanso_pagado FROM dbo.asistencia_reglas WHERE id = 1), 0);
    DECLARE @descanso_min INT = 0;
    IF @jid IS NOT NULL
        SELECT @descanso_min = ISNULL(SUM(DATEDIFF(MINUTE, d.inicio_en, ISNULL(d.fin_en, @ahora))), 0)
          FROM dbo.asistencia_descansos d WHERE d.jornada_id = @jid;

    SELECT @user_id AS user_id,
           u.usuario,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'asistencia' AND enabled = 1)
                     THEN 1 ELSE 0 END AS BIT) AS activa,
           ISNULL(r.entrada_para_vender, 0) AS entrada_para_vender,
           @ahora AS ahora,
           @jid AS jornada_id,
           @entrada AS entrada_en,
           CAST(CASE WHEN @desc_inicio IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS en_descanso,
           @desc_inicio AS descanso_desde,
           CASE WHEN @jid IS NULL THEN 0
                ELSE DATEDIFF(MINUTE, @entrada, @ahora) - CASE WHEN @pagado = 1 THEN 0 ELSE @descanso_min END
           END AS trabajado_min,
           @descanso_min AS descanso_min,
           CONVERT(CHAR(5), h.entrada, 108) AS horario_entrada,
           CONVERT(CHAR(5), h.salida, 108) AS horario_salida,
           h.descanso_min AS horario_descanso_min,
           CAST(CASE WHEN @jid IS NULL THEN 1 ELSE 0 END AS BIT) AS puede_entrada,
           CAST(CASE WHEN @jid IS NOT NULL AND @desc_inicio IS NULL THEN 1 ELSE 0 END AS BIT) AS puede_descanso,
           CAST(CASE WHEN @desc_inicio IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS puede_fin_descanso,
           CAST(CASE WHEN @jid IS NOT NULL AND @desc_inicio IS NULL THEN 1 ELSE 0 END AS BIT) AS puede_salida
      FROM dbo.users u
      LEFT JOIN dbo.asistencia_reglas r ON r.id = 1
      LEFT JOIN dbo.asistencia_horarios h ON h.user_id = u.id AND h.weekday = @wd
     WHERE u.id = @user_id;
END
GO
