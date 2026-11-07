/* ============================================================
   0072 — asistencia olvido de salida

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   NO toca tablas ni datos. Solo objetos programables.
   ============================================================ */

/* ---------- sp_asistencia_corregir (SQL_STORED_PROCEDURE) ---------- */
/* sp_asistencia_corregir
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ==================== sp_asistencia_corregir (0071) ====================
   Un encargado corrige una jornada (la salida que se olvido, una entrada mal
   marcada) o registra una que no se marco (@jornada_id NULL).

   Reglas:
     · motivo obligatorio, y queda en asistencia_correcciones con lo que
       habia antes y quien lo cambio;
     · nadie corrige sus propias horas;
     · la jornada no puede pasar de 24 horas ni encimarse con otra de la
       misma persona;
     · con salida queda CERRADA. Sin salida solo se puede corregir la
       entrada de una jornada que sigue ABIERTA.
   El permiso (ASISTENCIA_GESTIONAR) lo exige el proceso principal.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_asistencia_corregir
    @jornada_id INT = NULL,
    @persona_id INT = NULL,
    @entrada    DATETIME2(0),
    @salida     DATETIME2(0) = NULL,
    @motivo     NVARCHAR(255),
    @user_id    INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'asistencia' AND enabled = 1)
        THROW 51000, N'Asistencia no está activada.', 1;
    SET @motivo = NULLIF(LTRIM(RTRIM(@motivo)), N'');
    IF @motivo IS NULL OR LEN(@motivo) < 3
        THROW 51000, N'Escribe el motivo de la corrección.', 1;
    IF @user_id IS NULL
        THROW 51000, N'Falta quién corrige.', 1;
    IF @entrada IS NULL
        THROW 51000, N'Indica la hora de entrada.', 1;

    DECLARE @estado VARCHAR(12), @e_antes DATETIME2(0), @s_antes DATETIME2(0);

    BEGIN TRAN;
        IF @jornada_id IS NOT NULL
        BEGIN
            SELECT @persona_id = user_id, @estado = estado, @e_antes = entrada_en, @s_antes = salida_en
              FROM dbo.asistencia_jornadas WITH (UPDLOCK, HOLDLOCK) WHERE id = @jornada_id;
            IF @estado IS NULL THROW 51000, N'Esa jornada no existe.', 1;
            /* Un olvido sigue ABIERTA hasta la siguiente entrada: necesita salida. */
            IF @estado = 'ABIERTA' AND CAST(@e_antes AS DATE) < CAST(SYSDATETIME() AS DATE)
               AND DATEDIFF(MINUTE, @e_antes, SYSDATETIME()) > 840
                SET @estado = 'SIN_SALIDA';
        END
        ELSE IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @persona_id)
            THROW 51000, N'Esa persona no existe.', 1;

        IF @persona_id = @user_id
            THROW 51000, N'Nadie corrige sus propias horas: pídeselo a un encargado.', 1;
        IF @salida IS NULL AND (@jornada_id IS NULL OR @estado <> 'ABIERTA')
            THROW 51000, N'Indica la hora de salida.', 1;
        IF @salida IS NOT NULL AND @salida <= @entrada
            THROW 51000, N'La salida tiene que ser después de la entrada.', 1;
        IF DATEDIFF(MINUTE, @entrada, ISNULL(@salida, SYSDATETIME())) > 24 * 60
            THROW 51000, N'Una jornada no puede pasar de 24 horas: revisa la fecha de salida.', 1;
        IF @entrada > SYSDATETIME() OR @salida > SYSDATETIME()
            THROW 51000, N'No se pueden registrar horas en el futuro.', 1;
        IF EXISTS (SELECT 1 FROM dbo.asistencia_jornadas o
                    WHERE o.user_id = @persona_id AND (@jornada_id IS NULL OR o.id <> @jornada_id)
                      AND o.estado <> 'SIN_SALIDA'
                      AND NOT (o.estado = 'ABIERTA' AND o.dia < CAST(SYSDATETIME() AS DATE)
                               AND DATEDIFF(MINUTE, o.entrada_en, SYSDATETIME()) > 840)
                      AND o.entrada_en < ISNULL(@salida, SYSDATETIME())
                      AND ISNULL(o.salida_en, SYSDATETIME()) > @entrada)
            THROW 51000, N'Se encima con otra jornada de esa persona.', 1;

        IF @jornada_id IS NULL
        BEGIN
            INSERT INTO dbo.asistencia_jornadas (user_id, dia, entrada_en, salida_en, estado, corregida)
            VALUES (@persona_id, CAST(@entrada AS DATE), @entrada, @salida, 'CERRADA', 1);
            SET @jornada_id = SCOPE_IDENTITY();
        END
        ELSE
            UPDATE dbo.asistencia_jornadas
               SET entrada_en = @entrada, dia = CAST(@entrada AS DATE), salida_en = @salida,
                   estado = CASE WHEN @salida IS NULL THEN estado ELSE 'CERRADA' END,
                   corregida = 1
             WHERE id = @jornada_id;

        /* Un descanso que quedo abierto se cierra con la jornada. */
        IF @salida IS NOT NULL
            UPDATE dbo.asistencia_descansos
               SET fin_en = CASE WHEN inicio_en > @salida THEN inicio_en ELSE @salida END
             WHERE jornada_id = @jornada_id AND fin_en IS NULL;

        INSERT INTO dbo.asistencia_correcciones
            (jornada_id, entrada_antes, salida_antes, entrada_nueva, salida_nueva, motivo, corregida_por)
        VALUES (@jornada_id, @e_antes, @s_antes, @entrada, @salida, @motivo, @user_id);
    COMMIT;

    SELECT @jornada_id AS jornada_id;
END
GO

/* ---------- sp_asistencia_estado (SQL_STORED_PROCEDURE) ---------- */
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

   OLVIDO DE SALIDA (0072): una jornada ABIERTA de un dia anterior con mas de
   14 horas ya no es «trabajando»: es un olvido. Se ofrece la entrada de hoy
   y se dice que dia quedo sin salida. Un turno nocturno de 22:00 a 06:00 no
   llega a 14 horas y sigue ofreciendo su salida. La misma regla vive en
   sp_asistencia_marcar, _resumen, _jornadas y _corregir.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_asistencia_estado
    @user_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ahora DATETIME2(0) = SYSDATETIME();
    DECLARE @hoy DATE = CAST(@ahora AS DATE);
    DECLARE @wd TINYINT = (DATEDIFF(DAY, '19000101', @hoy) % 7) + 1;

    DECLARE @jid INT, @entrada DATETIME2(0), @desc_inicio DATETIME2(0), @jdia DATE;
    DECLARE @olvido_dia DATE = NULL, @olvido_entrada DATETIME2(0) = NULL;
    SELECT @jid = j.id, @entrada = j.entrada_en, @jdia = j.dia
      FROM dbo.asistencia_jornadas j
     WHERE j.user_id = @user_id AND j.estado = 'ABIERTA';
    IF @jid IS NOT NULL AND @jdia < @hoy AND DATEDIFF(MINUTE, @entrada, @ahora) > 840
    BEGIN
        SELECT @olvido_dia = @jdia, @olvido_entrada = @entrada, @jid = NULL, @entrada = NULL;
    END
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
           @olvido_dia AS olvido_dia,
           @olvido_entrada AS olvido_entrada,
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

/* ---------- sp_asistencia_jornadas (SQL_STORED_PROCEDURE) ---------- */
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

    /* Mismo criterio que sp_asistencia_resumen: el detalle dice lo mismo que la tabla. */
    DECLARE @ahora DATETIME2(0) = SYSDATETIME();
    SELECT j.id, j.user_id, j.dia, j.entrada_en, j.salida_en,
           CASE WHEN j.estado = 'ABIERTA' AND j.dia < CAST(@ahora AS DATE) AND DATEDIFF(MINUTE, j.entrada_en, @ahora) > 840 THEN 'SIN_SALIDA'
                WHEN j.estado = 'CERRADA' AND j.corregida = 0 AND DATEDIFF(MINUTE, j.entrada_en, j.salida_en) > 960 THEN 'SIN_SALIDA'
                ELSE j.estado END AS estado,
           j.corregida, j.register_id
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

/* ---------- sp_asistencia_marcar (SQL_STORED_PROCEDURE) ---------- */
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
   anterior con mas de 14 horas, esa queda SIN_SALIDA (0 horas, "Revisar") y
   empieza la nueva. No se adivina a que hora salio: lo corrige un encargado.
   Esa jornada ya no admite descanso ni salida: una salida cerrada al dia
   siguiente eran 24 horas falsas (0072). Un turno nocturno no llega a 14.

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
    DECLARE @jid INT, @jdia DATE, @desc INT, @jentrada DATETIME2(0), @olvido BIT = 0;

    BEGIN TRAN;
        SELECT @jid = id, @jdia = dia, @jentrada = entrada_en
          FROM dbo.asistencia_jornadas WITH (UPDLOCK, HOLDLOCK)
         WHERE user_id = @user_id AND estado = 'ABIERTA';
        IF @jid IS NOT NULL AND @jdia < CAST(@ahora AS DATE) AND DATEDIFF(MINUTE, @jentrada, @ahora) > 840
            SET @olvido = 1;
        IF @jid IS NOT NULL
            SELECT @desc = id FROM dbo.asistencia_descansos WITH (UPDLOCK)
             WHERE jornada_id = @jid AND fin_en IS NULL;

        IF @tipo = 'ENTRADA'
        BEGIN
            IF @jid IS NOT NULL AND @olvido = 0
                THROW 51000, N'Ya registraste tu entrada.', 1;
            IF @jid IS NOT NULL
                UPDATE dbo.asistencia_jornadas SET estado = 'SIN_SALIDA' WHERE id = @jid;
            INSERT INTO dbo.asistencia_jornadas (user_id, dia, entrada_en, estado, register_id)
            VALUES (@user_id, CAST(@ahora AS DATE), @ahora, 'ABIERTA', @register_id);
        END
        ELSE IF @olvido = 1
            THROW 51000, N'Tu jornada anterior quedó sin salida: registra tu entrada de hoy.', 1;
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

/* ---------- sp_asistencia_resumen (SQL_STORED_PROCEDURE) ---------- */
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
     REVISAR    (0072) lo que no se puede creer: sin salida, una jornada abierta
                de un dia anterior con mas de 14 horas, o una cerrada de mas
                de 16 sin corregir. Cuenta 0 horas y 0 extra hasta que un
                encargado la corrija: nunca llega inflada al contador.
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
        SELECT j.id, j.user_id, j.dia, j.entrada_en, j.salida_en, e.estado, j.corregida,
               CASE e.estado WHEN 'CERRADA' THEN j.salida_en WHEN 'ABIERTA' THEN @ahora END AS fin
          FROM dbo.asistencia_jornadas j
         CROSS APPLY (SELECT CASE
             WHEN j.estado = 'ABIERTA' AND j.dia < CAST(@ahora AS DATE) AND DATEDIFF(MINUTE, j.entrada_en, @ahora) > 840 THEN 'SIN_SALIDA'
             WHEN j.estado = 'CERRADA' AND j.corregida = 0 AND DATEDIFF(MINUTE, j.entrada_en, j.salida_en) > 960 THEN 'SIN_SALIDA'
             ELSE j.estado END AS estado) e
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
               MAX(CASE WHEN estado = 'CERRADA' THEN salida_en END) AS salida,
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
             WHEN @extra = 0 OR c.tiene_horario = 0 OR c.revisar = 1 THEN 0
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
