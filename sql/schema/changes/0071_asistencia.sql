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
