/* ============================================================
   0071 — asistencia

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0071_asistencia.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0071_asistencia.sql ========== */
/* ============================================================
   0071 — Asistencia (esquema)

   Entradas, descansos y salidas de quien trabaja en la caja, para saber las
   horas trabajadas y las horas extra. NO es nomina: no calcula pagos.

   Es una aplicacion: solo existe para el negocio que la activa desde
   Aplicaciones (`business_modules.module_key = 'asistencia'`). Al activarla
   se contestan unas preguntas de si y no, y esas son las reglas.

   asistencia_reglas       las respuestas, una sola fila (id = 1). Nace al
                           activar, no con la base: una base sin la
                           aplicacion no tiene reglas.
   asistencia_horarios     el horario de cada persona por dia de la semana
                           (1 = lunes ... 7 = domingo). Un dia sin fila es su
                           descanso. La salida puede caer al dia siguiente.
   asistencia_jornadas     una entrada y su salida. `dia` es el dia de la
                           ENTRADA: una jornada que cruza la medianoche es del
                           dia en que empezo.
   asistencia_descansos    los descansos de una jornada.
   asistencia_correcciones lo que un encargado cambio, con motivo. Nadie
                           corrige sus propias horas.

   RELOJ: hora de pared del servidor (SYSDATETIME), la misma politica que
   ventas, cortes y fidelizacion. La hora la pone SQL, nunca la caja.

   Aditiva: nada existente cambia.
   ============================================================ */
IF OBJECT_ID(N'dbo.asistencia_reglas', N'U') IS NULL
CREATE TABLE dbo.asistencia_reglas (
    id                 TINYINT  NOT NULL CONSTRAINT PK_asistencia_reglas PRIMARY KEY CLUSTERED
                                CONSTRAINT CK_asistencia_reglas_id CHECK (id = 1),
    cuenta_extra       BIT      NOT NULL CONSTRAINT DF_asistencia_reglas_extra DEFAULT (1),
    tolerancia_min     SMALLINT NOT NULL CONSTRAINT DF_asistencia_reglas_tol DEFAULT (10),
    descanso_pagado    BIT      NOT NULL CONSTRAINT DF_asistencia_reglas_desc DEFAULT (0),
    dia_libre_extra    BIT      NOT NULL CONSTRAINT DF_asistencia_reglas_libre DEFAULT (1),
    marca_retardos     BIT      NOT NULL CONSTRAINT DF_asistencia_reglas_ret DEFAULT (1),
    entrada_para_vender BIT     NOT NULL CONSTRAINT DF_asistencia_reglas_vender DEFAULT (0),
    updated_at         DATETIME2(0) NOT NULL CONSTRAINT DF_asistencia_reglas_upd DEFAULT (SYSDATETIME()),
    updated_by         INT NULL,
    CONSTRAINT CK_asistencia_reglas_tol CHECK (tolerancia_min BETWEEN 0 AND 120)
);
GO

IF OBJECT_ID(N'dbo.asistencia_horarios', N'U') IS NULL
CREATE TABLE dbo.asistencia_horarios (
    user_id       INT      NOT NULL,
    weekday       TINYINT  NOT NULL,
    entrada       TIME(0)  NOT NULL,
    salida        TIME(0)  NOT NULL,
    descanso_min  SMALLINT NOT NULL CONSTRAINT DF_asistencia_horarios_desc DEFAULT (0),
    updated_at    DATETIME2(0) NOT NULL CONSTRAINT DF_asistencia_horarios_upd DEFAULT (SYSDATETIME()),
    updated_by    INT NULL,
    CONSTRAINT PK_asistencia_horarios PRIMARY KEY CLUSTERED (user_id, weekday),
    CONSTRAINT FK_asistencia_horarios_user FOREIGN KEY (user_id) REFERENCES dbo.users (id),
    CONSTRAINT CK_asistencia_horarios_weekday CHECK (weekday BETWEEN 1 AND 7),
    CONSTRAINT CK_asistencia_horarios_rango CHECK (entrada <> salida),
    CONSTRAINT CK_asistencia_horarios_desc CHECK (descanso_min BETWEEN 0 AND 240)
);
GO

IF OBJECT_ID(N'dbo.asistencia_jornadas', N'U') IS NULL
CREATE TABLE dbo.asistencia_jornadas (
    id           INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_asistencia_jornadas PRIMARY KEY CLUSTERED,
    user_id      INT          NOT NULL,
    dia          DATE         NOT NULL,
    entrada_en   DATETIME2(0) NOT NULL,
    salida_en    DATETIME2(0) NULL,
    /* ABIERTA: trabajando. CERRADA: con salida. SIN_SALIDA: empezo otra
       jornada sin cerrar esta; cuenta 0 horas hasta que se corrija. */
    estado       VARCHAR(12)  NOT NULL CONSTRAINT DF_asistencia_jornadas_estado DEFAULT ('ABIERTA'),
    register_id  INT          NULL,
    corregida    BIT          NOT NULL CONSTRAINT DF_asistencia_jornadas_corr DEFAULT (0),
    created_at   DATETIME2(0) NOT NULL CONSTRAINT DF_asistencia_jornadas_created DEFAULT (SYSDATETIME()),
    CONSTRAINT FK_asistencia_jornadas_user FOREIGN KEY (user_id) REFERENCES dbo.users (id),
    CONSTRAINT CK_asistencia_jornadas_estado CHECK (estado IN ('ABIERTA', 'CERRADA', 'SIN_SALIDA')),
    CONSTRAINT CK_asistencia_jornadas_rango CHECK (salida_en IS NULL OR salida_en >= entrada_en)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_asistencia_jornadas_user_dia' AND object_id = OBJECT_ID(N'dbo.asistencia_jornadas'))
CREATE NONCLUSTERED INDEX IX_asistencia_jornadas_user_dia ON dbo.asistencia_jornadas (user_id, dia);
GO
/* Una sola jornada abierta por persona: dos cajas no pueden abrirle dos. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_asistencia_jornadas_abierta' AND object_id = OBJECT_ID(N'dbo.asistencia_jornadas'))
CREATE UNIQUE NONCLUSTERED INDEX UX_asistencia_jornadas_abierta ON dbo.asistencia_jornadas (user_id) WHERE estado = 'ABIERTA';
GO

IF OBJECT_ID(N'dbo.asistencia_descansos', N'U') IS NULL
CREATE TABLE dbo.asistencia_descansos (
    id          INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_asistencia_descansos PRIMARY KEY CLUSTERED,
    jornada_id  INT          NOT NULL,
    inicio_en   DATETIME2(0) NOT NULL,
    fin_en      DATETIME2(0) NULL,
    CONSTRAINT FK_asistencia_descansos_jornada FOREIGN KEY (jornada_id) REFERENCES dbo.asistencia_jornadas (id),
    CONSTRAINT CK_asistencia_descansos_rango CHECK (fin_en IS NULL OR fin_en >= inicio_en)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_asistencia_descansos_jornada' AND object_id = OBJECT_ID(N'dbo.asistencia_descansos'))
CREATE NONCLUSTERED INDEX IX_asistencia_descansos_jornada ON dbo.asistencia_descansos (jornada_id);
GO

IF OBJECT_ID(N'dbo.asistencia_correcciones', N'U') IS NULL
CREATE TABLE dbo.asistencia_correcciones (
    id            INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_asistencia_correcciones PRIMARY KEY CLUSTERED,
    jornada_id    INT            NOT NULL,
    entrada_antes DATETIME2(0)   NULL,
    salida_antes  DATETIME2(0)   NULL,
    entrada_nueva DATETIME2(0)   NOT NULL,
    salida_nueva  DATETIME2(0)   NULL,
    motivo        NVARCHAR(255)  COLLATE Modern_Spanish_CI_AS NOT NULL,
    corregida_por INT            NOT NULL,
    corregida_en  DATETIME2(0)   NOT NULL CONSTRAINT DF_asistencia_correcciones_en DEFAULT (SYSDATETIME()),
    CONSTRAINT FK_asistencia_correcciones_jornada FOREIGN KEY (jornada_id) REFERENCES dbo.asistencia_jornadas (id),
    CONSTRAINT FK_asistencia_correcciones_user FOREIGN KEY (corregida_por) REFERENCES dbo.users (id)
);
GO

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
            THROW 51000, N'Una jornada no puede pasar de 24 horas.', 1;
        IF @entrada > SYSDATETIME() OR @salida > SYSDATETIME()
            THROW 51000, N'No se pueden registrar horas en el futuro.', 1;
        IF EXISTS (SELECT 1 FROM dbo.asistencia_jornadas o
                    WHERE o.user_id = @persona_id AND (@jornada_id IS NULL OR o.id <> @jornada_id)
                      AND o.estado <> 'SIN_SALIDA'
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

/* ---------- sp_asistencia_horario_get (SQL_STORED_PROCEDURE) ---------- */
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

/* ---------- sp_asistencia_horario_guardar (SQL_STORED_PROCEDURE) ---------- */
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

/* ---------- sp_asistencia_reglas_get (SQL_STORED_PROCEDURE) ---------- */
/* sp_asistencia_reglas_get
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ==================== sp_asistencia_reglas_get (0071) ====================
   Las reglas de Asistencia y si el modulo esta encendido. Sin fila: el
   negocio nunca la activo.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_asistencia_reglas_get
AS
BEGIN
    SET NOCOUNT ON;
    SELECT r.cuenta_extra, r.tolerancia_min, r.descanso_pagado, r.dia_libre_extra,
           r.marca_retardos, r.entrada_para_vender, r.updated_at, r.updated_by,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.business_modules
                                   WHERE module_key = N'asistencia' AND enabled = 1)
                     THEN 1 ELSE 0 END AS BIT) AS activa
      FROM dbo.asistencia_reglas r
     WHERE r.id = 1;
END
GO

/* ---------- sp_asistencia_reglas_guardar (SQL_STORED_PROCEDURE) ---------- */
/* sp_asistencia_reglas_guardar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================== sp_asistencia_reglas_guardar (0071) ==================
   Las respuestas de "Activar Asistencia", que son las reglas del negocio.

   @activar = 1 es la primera vez, desde Aplicaciones: guarda las reglas Y
   enciende el modulo en la MISMA transaccion. Una decision, una escritura:
   no puede quedar el modulo encendido sin reglas ni reglas de un modulo
   apagado. Con @activar = 0 solo cambia las reglas de un modulo encendido.

   La tolerancia es una pregunta de si y no: si = 10 minutos, no = 0.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_asistencia_reglas_guardar
    @cuenta_extra        BIT,
    @tolerancia          BIT,
    @descanso_pagado     BIT,
    @dia_libre_extra     BIT,
    @marca_retardos      BIT,
    @entrada_para_vender BIT,
    @activar             BIT = 0,
    @user_id             INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @cuenta_extra IS NULL OR @tolerancia IS NULL OR @descanso_pagado IS NULL
       OR @dia_libre_extra IS NULL OR @marca_retardos IS NULL OR @entrada_para_vender IS NULL
        THROW 51000, N'Contesta todas las preguntas.', 1;

    IF ISNULL(@activar, 0) = 0
       AND NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'asistencia' AND enabled = 1)
        THROW 51000, N'Asistencia no está activada.', 1;

    BEGIN TRAN;
        MERGE dbo.asistencia_reglas AS d
        USING (SELECT CAST(1 AS TINYINT) AS id) AS s ON d.id = s.id
        WHEN MATCHED THEN UPDATE SET
            cuenta_extra = @cuenta_extra,
            tolerancia_min = CASE WHEN @tolerancia = 1 THEN 10 ELSE 0 END,
            descanso_pagado = @descanso_pagado,
            dia_libre_extra = @dia_libre_extra,
            marca_retardos = @marca_retardos,
            entrada_para_vender = @entrada_para_vender,
            updated_at = SYSDATETIME(),
            updated_by = @user_id
        WHEN NOT MATCHED THEN INSERT
            (id, cuenta_extra, tolerancia_min, descanso_pagado, dia_libre_extra, marca_retardos,
             entrada_para_vender, updated_at, updated_by)
            VALUES (1, @cuenta_extra, CASE WHEN @tolerancia = 1 THEN 10 ELSE 0 END, @descanso_pagado,
                    @dia_libre_extra, @marca_retardos, @entrada_para_vender, SYSDATETIME(), @user_id);

        IF @activar = 1
        BEGIN
            DECLARE @r TABLE (module_key NVARCHAR(40), enabled BIT, enabled_at DATETIME2(0), enabled_by INT, updated_at DATETIME2(0));
            INSERT INTO @r EXEC dbo.sp_set_business_module @module_key = N'asistencia', @enabled = 1, @user_id = @user_id;
        END
    COMMIT;

    EXEC dbo.sp_asistencia_reglas_get;
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
