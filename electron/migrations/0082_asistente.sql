/* ============================================================
   0082 — asistente

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0082_asistente.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0082_asistente.sql ========== */
/* ============================================================
   0082 — Wybix, asistente operativo (esquema)

   docs/arquitectura/asistente-operativo.md

   asistente_hallazgos  lo que encontraron las reglas. Una fila por CLAVE
                        (regla + entidad + periodo): la misma situación se
                        actualiza, no se repite. Se resuelve sola cuando la
                        regla deja de encontrarla.
   asistente_descartes  «ya lo sé» / «no me interesa»: por hallazgo (clave)
                        o por regla completa, para siempre o hasta una fecha.
                        Es la defensa contra el ruido.
   asistente_planes     lo que Wybix propuso hacer, ANTES de hacerlo: vista
                        previa, quién confirmó y cómo terminó. Un plan se
                        ejecuta una sola vez.
   asistente_bitacora   el rastro de todo lo anterior.
   asistente_mensajes   la conversación del chat, por persona.
   asistente_frases     lo que la gente escribió y el intent que confirmó:
                        con eso se entrena el clasificador del intérprete.
   asistente_config     reglas apagadas y umbrales propios del negocio.
   asistente_alias      el idioma del negocio: «la roja» = Coca 600. Enseñados
                        («a la coca dile la roja») o aprendidos al elegir una
                        opción. Un texto apunta a un producto o una persona.

   Aditiva: nada existente cambia.
   ============================================================ */

IF OBJECT_ID(N'dbo.asistente_hallazgos', N'U') IS NULL
CREATE TABLE dbo.asistente_hallazgos (
    id              INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_asistente_hallazgos PRIMARY KEY CLUSTERED,
    clave           NVARCHAR(200)  NOT NULL,
    regla           VARCHAR(80)    NOT NULL,
    version         INT            NOT NULL,
    dominio         VARCHAR(20)    NOT NULL,
    severidad       VARCHAR(12)    NOT NULL,
    prioridad       INT            NOT NULL,
    titulo          NVARCHAR(200)  NOT NULL,
    detalle         NVARCHAR(600)  NOT NULL,
    evidencia       NVARCHAR(MAX)  NULL,
    acciones        NVARCHAR(MAX)  NULL,
    entidad_tipo    VARCHAR(30)    NULL,
    entidad_id      NVARCHAR(80)   NULL,
    entidad_nombre  NVARCHAR(200)  NULL,
    ruta            NVARCHAR(200)  NULL,
    ver_permiso     VARCHAR(40)    NULL,
    estado          VARCHAR(12)    NOT NULL CONSTRAINT DF_asistente_hallazgos_estado DEFAULT ('abierto'),
    pospuesto_hasta DATETIME2(0)   NULL,
    detectado_en    DATETIME2(0)   NOT NULL CONSTRAINT DF_asistente_hallazgos_detectado DEFAULT (SYSDATETIME()),
    actualizado_en  DATETIME2(0)   NOT NULL CONSTRAINT DF_asistente_hallazgos_actualizado DEFAULT (SYSDATETIME()),
    resuelto_en     DATETIME2(0)   NULL,
    visto_por       INT            NULL,
    visto_en        DATETIME2(0)   NULL,
    CONSTRAINT UX_asistente_hallazgos_clave UNIQUE (clave),
    CONSTRAINT CK_asistente_hallazgos_estado CHECK (estado IN ('abierto', 'visto', 'pospuesto', 'descartado', 'resuelto')),
    CONSTRAINT CK_asistente_hallazgos_severidad CHECK (severidad IN ('info', 'aviso', 'importante', 'critico'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_asistente_hallazgos_estado' AND object_id = OBJECT_ID(N'dbo.asistente_hallazgos'))
CREATE INDEX IX_asistente_hallazgos_estado ON dbo.asistente_hallazgos (estado, prioridad DESC) INCLUDE (regla, dominio);
GO

IF OBJECT_ID(N'dbo.asistente_descartes', N'U') IS NULL
CREATE TABLE dbo.asistente_descartes (
    id         INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_asistente_descartes PRIMARY KEY CLUSTERED,
    alcance    VARCHAR(10)    NOT NULL,
    valor      NVARCHAR(200)  NOT NULL,
    user_id    INT            NULL,
    motivo     NVARCHAR(200)  NULL,
    hasta      DATETIME2(0)   NULL,
    creado_en  DATETIME2(0)   NOT NULL CONSTRAINT DF_asistente_descartes_creado DEFAULT (SYSDATETIME()),
    CONSTRAINT CK_asistente_descartes_alcance CHECK (alcance IN ('clave', 'regla'))
);
GO

IF OBJECT_ID(N'dbo.asistente_planes', N'U') IS NULL
CREATE TABLE dbo.asistente_planes (
    id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_asistente_planes PRIMARY KEY CLUSTERED,
    intent        VARCHAR(60)    NOT NULL,
    nivel         VARCHAR(12)    NOT NULL,
    titulo        NVARCHAR(200)  NOT NULL,
    vista         NVARCHAR(MAX)  NULL,
    ejecutar      NVARCHAR(MAX)  NULL,
    origen        VARCHAR(12)    NOT NULL,
    texto         NVARCHAR(400)  NULL,
    hallazgo_id   INT            NULL,
    user_id       INT            NULL,
    estado        VARCHAR(12)    NOT NULL CONSTRAINT DF_asistente_planes_estado DEFAULT ('borrador'),
    creado_en     DATETIME2(0)   NOT NULL CONSTRAINT DF_asistente_planes_creado DEFAULT (SYSDATETIME()),
    caduca_en     DATETIME2(0)   NOT NULL,
    cerrado_en    DATETIME2(0)   NULL,
    resultado     NVARCHAR(MAX)  NULL,
    CONSTRAINT CK_asistente_planes_estado CHECK (estado IN ('borrador', 'ejecutado', 'fallido', 'cancelado', 'caducado')),
    CONSTRAINT CK_asistente_planes_origen CHECK (origen IN ('comando', 'hallazgo'))
);
GO

IF OBJECT_ID(N'dbo.asistente_bitacora', N'U') IS NULL
CREATE TABLE dbo.asistente_bitacora (
    id           BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_asistente_bitacora PRIMARY KEY CLUSTERED,
    evento       VARCHAR(30)    NOT NULL,
    user_id      INT            NULL,
    plan_id      UNIQUEIDENTIFIER NULL,
    hallazgo_id  INT            NULL,
    detalle      NVARCHAR(600)  NULL,
    en           DATETIME2(0)   NOT NULL CONSTRAINT DF_asistente_bitacora_en DEFAULT (SYSDATETIME())
);
GO

IF OBJECT_ID(N'dbo.asistente_mensajes', N'U') IS NULL
CREATE TABLE dbo.asistente_mensajes (
    id       BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_asistente_mensajes PRIMARY KEY CLUSTERED,
    user_id  INT            NOT NULL,
    autor    VARCHAR(10)    NOT NULL,
    texto    NVARCHAR(1000) NOT NULL,
    payload  NVARCHAR(MAX)  NULL,
    en       DATETIME2(0)   NOT NULL CONSTRAINT DF_asistente_mensajes_en DEFAULT (SYSDATETIME()),
    CONSTRAINT CK_asistente_mensajes_autor CHECK (autor IN ('wybix', 'persona'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_asistente_mensajes_user' AND object_id = OBJECT_ID(N'dbo.asistente_mensajes'))
CREATE INDEX IX_asistente_mensajes_user ON dbo.asistente_mensajes (user_id, id DESC);
GO

IF OBJECT_ID(N'dbo.asistente_frases', N'U') IS NULL
CREATE TABLE dbo.asistente_frases (
    id          INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_asistente_frases PRIMARY KEY CLUSTERED,
    texto       NVARCHAR(400)  NOT NULL,
    intent      VARCHAR(60)    NOT NULL,
    confirmado  BIT            NOT NULL CONSTRAINT DF_asistente_frases_confirmado DEFAULT ((1)),
    user_id     INT            NULL,
    en          DATETIME2(0)   NOT NULL CONSTRAINT DF_asistente_frases_en DEFAULT (SYSDATETIME())
);
GO

IF OBJECT_ID(N'dbo.asistente_alias', N'U') IS NULL
CREATE TABLE dbo.asistente_alias (
    id      INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_asistente_alias PRIMARY KEY CLUSTERED,
    alias   NVARCHAR(60)   NOT NULL,
    tipo    VARCHAR(12)    NOT NULL,
    ref_id  INT            NOT NULL,
    origen  VARCHAR(12)    NOT NULL CONSTRAINT DF_asistente_alias_origen DEFAULT ('ensenado'),
    user_id INT            NULL,
    en      DATETIME2(0)   NOT NULL CONSTRAINT DF_asistente_alias_en DEFAULT (SYSDATETIME()),
    CONSTRAINT UX_asistente_alias_alias UNIQUE (alias),
    CONSTRAINT CK_asistente_alias_tipo CHECK (tipo IN ('producto', 'cliente', 'proveedor', 'profesional')),
    CONSTRAINT CK_asistente_alias_origen CHECK (origen IN ('ensenado', 'aprendido'))
);
GO

IF OBJECT_ID(N'dbo.asistente_config', N'U') IS NULL
CREATE TABLE dbo.asistente_config (
    regla           VARCHAR(80)    NOT NULL CONSTRAINT PK_asistente_config PRIMARY KEY CLUSTERED,
    activa          BIT            NOT NULL CONSTRAINT DF_asistente_config_activa DEFAULT ((1)),
    umbrales        NVARCHAR(MAX)  NULL,
    actualizado_en  DATETIME2(0)   NOT NULL CONSTRAINT DF_asistente_config_actualizado DEFAULT (SYSDATETIME()),
    user_id         INT            NULL
);
GO
