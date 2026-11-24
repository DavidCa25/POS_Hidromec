/* ============================================================
   0087 — salud

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0087_salud.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0087_salud.sql ========== */
/* ============================================================
   0087 — Giro Salud: farmacia, expediente clínico y dental.

   Investigación y decisiones: docs/giro-salud.md.

   LAS DECISIONES QUE EXPLICAN EL RESTO
   ------------------------------------
   1. EL PACIENTE ES EL CLIENTE. `salud_pacientes` extiende `customers`
      1 a 1. Cobrar una consulta, fiarle un plan dental o facturarle usa
      el cliente de siempre; lo clínico vive aparte y con otro permiso.

   2. LO FIRMADO NO SE TOCA. Un documento clínico FIRMADO no admite UPDATE
      ni DELETE: lo impide un trigger, no solo el procedimiento, para que
      ninguna herramienta lo salte. Corregir es una adenda con autor y
      fecha. La NOM-004 pide conservar el expediente; un sistema que deja
      reescribirlo no lo conserva.

   3. EL LOTE ES TRAZABILIDAD, NO OTRA EXISTENCIA. `products.stock` sigue
      siendo la existencia que mueven la venta y la compra. Los lotes dicen
      DE CUÁL salió cada pieza y cuándo caduca. Lo que el stock tenga de
      más sobre la suma de lotes es «sin lote» y se ve como tal, en vez de
      inventar un lote para cuadrar.

   4. LA BITÁCORA ES APPEND-ONLY. Quién abrió, firmó o imprimió qué
      expediente. Nada la actualiza ni la borra.

   5. NADA DE ESTO SUBE A LA NUBE. Ninguna de estas tablas entra en la
      sincronización: son datos sensibles (LFPDPPP 2025).

   Todo apagado mientras el módulo `salud` no se encienda. Idempotente.
   ============================================================ */

/* --------------------------------------------------------------- CONFIG */
IF OBJECT_ID(N'dbo.salud_config', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_config (
        id        TINYINT       NOT NULL CONSTRAINT PK_salud_config PRIMARY KEY,
        preset    NVARCHAR(40)  NOT NULL,
        farmacia  BIT           NOT NULL CONSTRAINT DF_salud_config_farmacia DEFAULT (0),
        clinica   BIT           NOT NULL CONSTRAINT DF_salud_config_clinica DEFAULT (0),
        dental    BIT           NOT NULL CONSTRAINT DF_salud_config_dental DEFAULT (0),
        estudios  BIT           NOT NULL CONSTRAINT DF_salud_config_estudios DEFAULT (0),
        set_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_salud_config_set DEFAULT (SYSDATETIME()),
        set_by    INT           NULL,
        CONSTRAINT CK_salud_config_uno CHECK (id = 1)
    );
END;
GO

/* Una base que ya tenía salud_config sin estudios (desarrollo). */
IF COL_LENGTH(N'dbo.salud_config', N'estudios') IS NULL
    ALTER TABLE dbo.salud_config ADD estudios BIT NOT NULL
        CONSTRAINT DF_salud_config_estudios DEFAULT (0) WITH VALUES;
GO

/* ============================================================== FARMACIA */

/* Ficha sanitaria del producto. 1 a 1 con `products`, como `services`. */
IF OBJECT_ID(N'dbo.salud_productos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_productos (
        product_id          INT            NOT NULL CONSTRAINT PK_salud_productos PRIMARY KEY,
        /* Art. 226 LGS. NULL = no es medicamento (higiene, curación). */
        fraccion            TINYINT        NULL,
        es_antibiotico      BIT            NOT NULL CONSTRAINT DF_salud_prod_atb DEFAULT (0),
        sustancia_activa    NVARCHAR(160)  NULL,
        presentacion        NVARCHAR(120)  NULL,
        registro_sanitario  NVARCHAR(40)   NULL,
        refrigeracion       BIT            NOT NULL CONSTRAINT DF_salud_prod_frio DEFAULT (0),
        precio_maximo       DECIMAL(10,2)  NULL,
        controla_lotes      BIT            NOT NULL CONSTRAINT DF_salud_prod_lotes DEFAULT (1),
        /* Derivado, persistido para poder indexarlo: lo pregunta cada venta. */
        requiere_receta     AS (CONVERT(BIT, CASE WHEN es_antibiotico = 1 OR fraccion BETWEEN 1 AND 4 THEN 1 ELSE 0 END)) PERSISTED,
        es_controlado       AS (CONVERT(BIT, CASE WHEN fraccion BETWEEN 1 AND 3 THEN 1 ELSE 0 END)) PERSISTED,
        updated_at          DATETIME2(0)   NOT NULL CONSTRAINT DF_salud_prod_upd DEFAULT (SYSDATETIME()),
        updated_by          INT            NULL,
        CONSTRAINT FK_salud_productos_product FOREIGN KEY (product_id) REFERENCES dbo.products(id),
        CONSTRAINT CK_salud_productos_fraccion CHECK (fraccion IS NULL OR fraccion BETWEEN 1 AND 6),
        CONSTRAINT CK_salud_productos_pmax CHECK (precio_maximo IS NULL OR precio_maximo >= 0)
    );
    CREATE INDEX IX_salud_productos_receta ON dbo.salud_productos (requiere_receta) INCLUDE (es_controlado, es_antibiotico);
    CREATE INDEX IX_salud_productos_sustancia ON dbo.salud_productos (sustancia_activa);
END;
GO

IF OBJECT_ID(N'dbo.salud_lotes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_lotes (
        id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_salud_lotes PRIMARY KEY,
        product_id  INT            NOT NULL,
        lote        NVARCHAR(40)   NOT NULL,
        caducidad   DATE           NOT NULL,
        cantidad    DECIMAL(12,3)  NOT NULL CONSTRAINT DF_salud_lotes_cant DEFAULT (0),
        costo       DECIMAL(14,4)  NULL,
        created_at  DATETIME2(0)   NOT NULL CONSTRAINT DF_salud_lotes_created DEFAULT (SYSDATETIME()),
        CONSTRAINT FK_salud_lotes_product FOREIGN KEY (product_id) REFERENCES dbo.products(id),
        CONSTRAINT UQ_salud_lotes UNIQUE (product_id, lote, caducidad),
        CONSTRAINT CK_salud_lotes_cant CHECK (cantidad >= 0)
    );
    /* FEFO: el que caduca primero sale primero. Este índice ES el orden. */
    CREATE INDEX IX_salud_lotes_fefo ON dbo.salud_lotes (product_id, caducidad, id) INCLUDE (cantidad) WHERE cantidad > 0;
    CREATE INDEX IX_salud_lotes_caducidad ON dbo.salud_lotes (caducidad) INCLUDE (product_id, cantidad) WHERE cantidad > 0;
END;
GO

IF OBJECT_ID(N'dbo.salud_lote_movimientos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_lote_movimientos (
        id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_salud_lote_mov PRIMARY KEY,
        product_id  INT            NOT NULL,
        /* NULL: salió sin lote asignado (el stock tenía más que los lotes). */
        lote_id     INT            NULL,
        tipo        NVARCHAR(10)   NOT NULL,
        cantidad    DECIMAL(12,3)  NOT NULL,
        sale_id     INT            NULL,
        receta_id   INT            NULL,
        user_id     INT            NULL,
        nota        NVARCHAR(200)  NULL,
        at          DATETIME2(0)   NOT NULL CONSTRAINT DF_salud_lote_mov_at DEFAULT (SYSDATETIME()),
        CONSTRAINT FK_salud_lote_mov_lote FOREIGN KEY (lote_id) REFERENCES dbo.salud_lotes(id),
        CONSTRAINT CK_salud_lote_mov_tipo CHECK (tipo IN (N'ENTRADA', N'SALIDA', N'AJUSTE', N'MERMA')),
        CONSTRAINT CK_salud_lote_mov_cant CHECK (cantidad > 0)
    );
    CREATE INDEX IX_salud_lote_mov_producto ON dbo.salud_lote_movimientos (product_id, at);
    CREATE INDEX IX_salud_lote_mov_venta ON dbo.salud_lote_movimientos (sale_id) WHERE sale_id IS NOT NULL;
END;
GO

/* La receta que respaldó una venta. Una por venta. */
IF OBJECT_ID(N'dbo.salud_recetas_surtidas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_recetas_surtidas (
        id                  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_salud_recetas_surtidas PRIMARY KEY,
        sale_id             INT            NOT NULL,
        medico              NVARCHAR(120)  NOT NULL,
        cedula              NVARCHAR(20)   NOT NULL,
        fecha_receta        DATE           NOT NULL,
        institucion         NVARCHAR(160)  NULL,
        paciente            NVARCHAR(120)  NULL,
        retenida            BIT            NOT NULL CONSTRAINT DF_salud_rs_ret DEFAULT (0),
        surtidos_restantes  TINYINT        NULL,
        user_id             INT            NULL,
        at                  DATETIME2(0)   NOT NULL CONSTRAINT DF_salud_rs_at DEFAULT (SYSDATETIME()),
        CONSTRAINT UQ_salud_recetas_surtidas_venta UNIQUE (sale_id),
        CONSTRAINT FK_salud_recetas_surtidas_venta FOREIGN KEY (sale_id) REFERENCES dbo.sales(id)
    );
    CREATE INDEX IX_salud_recetas_surtidas_at ON dbo.salud_recetas_surtidas (at);
END;
GO

IF OBJECT_ID(N'dbo.salud_temperaturas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_temperaturas (
        id       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_salud_temperaturas PRIMARY KEY,
        equipo   NVARCHAR(40)  NOT NULL,
        grados   DECIMAL(4,1)  NOT NULL,
        user_id  INT           NULL,
        at       DATETIME2(0)  NOT NULL CONSTRAINT DF_salud_temp_at DEFAULT (SYSDATETIME()),
        CONSTRAINT CK_salud_temperaturas CHECK (grados BETWEEN -40 AND 60)
    );
    CREATE INDEX IX_salud_temperaturas_at ON dbo.salud_temperaturas (at DESC);
END;
GO

/* ============================================================ EXPEDIENTE */

IF OBJECT_ID(N'dbo.salud_pacientes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_pacientes (
        customer_id          INT            NOT NULL CONSTRAINT PK_salud_pacientes PRIMARY KEY,
        curp                 NVARCHAR(18)   NULL,
        sexo                 CHAR(1)        NULL,
        tutor                NVARCHAR(120)  NULL,
        contacto_emergencia  NVARCHAR(160)  NULL,
        grupo_sanguineo      NVARCHAR(5)    NULL,
        alergias             NVARCHAR(600)  NULL,
        /* Heredofamiliares, patológicos, no patológicos, gineco-obstétricos. */
        antecedentes         NVARCHAR(MAX)  NULL,
        consentimiento_at    DATETIME2(0)   NULL,
        consentimiento_por   INT            NULL,
        created_at           DATETIME2(0)   NOT NULL CONSTRAINT DF_salud_pac_created DEFAULT (SYSDATETIME()),
        updated_at           DATETIME2(0)   NULL,
        version              ROWVERSION     NOT NULL,
        CONSTRAINT FK_salud_pacientes_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers(id),
        CONSTRAINT CK_salud_pacientes_sexo CHECK (sexo IS NULL OR sexo IN ('F', 'M', 'X')),
        CONSTRAINT CK_salud_pacientes_antecedentes CHECK (antecedentes IS NULL OR ISJSON(antecedentes) = 1)
    );
    CREATE UNIQUE INDEX UX_salud_pacientes_curp ON dbo.salud_pacientes (curp) WHERE curp IS NOT NULL;
END;
GO

IF OBJECT_ID(N'dbo.salud_documentos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_documentos (
        id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_salud_documentos PRIMARY KEY,
        paciente_id    INT            NOT NULL,
        tipo           NVARCHAR(20)   NOT NULL,
        titulo         NVARCHAR(160)  NULL,
        /* JSON del documento: SOAP, receta, consentimiento… */
        contenido      NVARCHAR(MAX)  NOT NULL,
        autor_id       INT            NOT NULL,
        cita_id        INT            NULL,
        orden_id       INT            NULL,
        estado         NVARCHAR(10)   NOT NULL CONSTRAINT DF_salud_doc_estado DEFAULT (N'BORRADOR'),
        firmado_at     DATETIME2(0)   NULL,
        firmado_por    INT            NULL,
        /* SHA-256 del contenido al firmar: permite demostrar que no cambió. */
        huella         VARBINARY(32)  NULL,
        created_at     DATETIME2(0)   NOT NULL CONSTRAINT DF_salud_doc_created DEFAULT (SYSDATETIME()),
        updated_at     DATETIME2(0)   NULL,
        CONSTRAINT FK_salud_documentos_paciente FOREIGN KEY (paciente_id) REFERENCES dbo.salud_pacientes(customer_id),
        CONSTRAINT CK_salud_documentos_tipo CHECK (tipo IN (N'HISTORIA', N'NOTA', N'RECETA', N'CONSENTIMIENTO', N'SOLICITUD', N'REFERENCIA')),
        CONSTRAINT CK_salud_documentos_estado CHECK (estado IN (N'BORRADOR', N'FIRMADO')),
        CONSTRAINT CK_salud_documentos_json CHECK (ISJSON(contenido) = 1),
        CONSTRAINT CK_salud_documentos_firma CHECK (estado = N'BORRADOR' OR (firmado_at IS NOT NULL AND firmado_por IS NOT NULL AND huella IS NOT NULL))
    );
    CREATE INDEX IX_salud_documentos_paciente ON dbo.salud_documentos (paciente_id, created_at DESC) INCLUDE (tipo, estado, titulo, autor_id);
END;
GO

/* QUIÉN FIRMA. La receta exige nombre, cédula profesional, institución que
   expidió el título y, si la hay, especialidad con su cédula. Viven aquí, una
   fila por usuario de Wybix que atiende pacientes. Al firmar se COPIAN al
   documento (`firmante`): si la cédula cambia mañana, la receta de hoy dice
   lo que decía. */
IF OBJECT_ID(N'dbo.salud_profesionales', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_profesionales (
        user_id             INT            NOT NULL CONSTRAINT PK_salud_profesionales PRIMARY KEY,
        nombre              NVARCHAR(160)  NOT NULL,
        cedula              NVARCHAR(20)   NOT NULL,
        institucion         NVARCHAR(160)  NULL,
        especialidad        NVARCHAR(120)  NULL,
        cedula_especialidad NVARCHAR(20)   NULL,
        updated_at          DATETIME2(0)   NOT NULL CONSTRAINT DF_salud_prof_updated DEFAULT (SYSDATETIME()),
        CONSTRAINT FK_salud_profesionales_user FOREIGN KEY (user_id) REFERENCES dbo.users (id),
        CONSTRAINT CK_salud_profesionales_cedula CHECK (LEN(cedula) BETWEEN 5 AND 20 AND cedula NOT LIKE N'%[^0-9A-Za-z-]%'),
        CONSTRAINT CK_salud_profesionales_esp CHECK (cedula_especialidad IS NULL OR especialidad IS NOT NULL)
    );
END;
GO

IF COL_LENGTH(N'dbo.salud_documentos', N'firmante') IS NULL
    ALTER TABLE dbo.salud_documentos ADD firmante NVARCHAR(MAX) NULL
        CONSTRAINT CK_salud_documentos_firmante CHECK (firmante IS NULL OR ISJSON(firmante) = 1);
GO

/* LO FIRMADO NO SE TOCA, tampoco por fuera de los procedimientos. */
CREATE OR ALTER TRIGGER dbo.TR_salud_documentos_inmutable
ON dbo.salud_documentos
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM deleted WHERE estado = N'FIRMADO')
    BEGIN
        RAISERROR('DOCUMENTO_FIRMADO: un documento firmado no se modifica ni se borra; agrega una adenda.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
END;
GO

IF OBJECT_ID(N'dbo.salud_adendas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_adendas (
        id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_salud_adendas PRIMARY KEY,
        documento_id  INT             NOT NULL,
        texto         NVARCHAR(2000)  NOT NULL,
        autor_id      INT             NOT NULL,
        at            DATETIME2(0)    NOT NULL CONSTRAINT DF_salud_adendas_at DEFAULT (SYSDATETIME()),
        CONSTRAINT FK_salud_adendas_doc FOREIGN KEY (documento_id) REFERENCES dbo.salud_documentos(id)
    );
    CREATE INDEX IX_salud_adendas_doc ON dbo.salud_adendas (documento_id);
END;
GO

IF OBJECT_ID(N'dbo.salud_diagnosticos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_diagnosticos (
        id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_salud_diagnosticos PRIMARY KEY,
        documento_id  INT            NOT NULL,
        cie10         NVARCHAR(10)   NULL,
        descripcion   NVARCHAR(250)  NOT NULL,
        principal     BIT            NOT NULL CONSTRAINT DF_salud_dx_principal DEFAULT (0),
        CONSTRAINT FK_salud_diagnosticos_doc FOREIGN KEY (documento_id) REFERENCES dbo.salud_documentos(id) ON DELETE CASCADE
    );
    CREATE INDEX IX_salud_diagnosticos_doc ON dbo.salud_diagnosticos (documento_id);
    CREATE INDEX IX_salud_diagnosticos_cie ON dbo.salud_diagnosticos (cie10) WHERE cie10 IS NOT NULL;
END;
GO

/* Los diagnósticos son parte del documento: firmado, tampoco cambian. */
CREATE OR ALTER TRIGGER dbo.TR_salud_diagnosticos_inmutable
ON dbo.salud_diagnosticos
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM inserted i JOIN dbo.salud_documentos d ON d.id = i.documento_id WHERE d.estado = N'FIRMADO')
       OR EXISTS (SELECT 1 FROM deleted x JOIN dbo.salud_documentos d ON d.id = x.documento_id WHERE d.estado = N'FIRMADO')
    BEGIN
        RAISERROR('DOCUMENTO_FIRMADO: los diagnósticos de un documento firmado no cambian.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
END;
GO

IF OBJECT_ID(N'dbo.salud_cie10', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_cie10 (
        codigo       NVARCHAR(10)   NOT NULL CONSTRAINT PK_salud_cie10 PRIMARY KEY,
        descripcion  NVARCHAR(250)  NOT NULL
    );
END;
GO

IF OBJECT_ID(N'dbo.salud_bitacora', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_bitacora (
        id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_salud_bitacora PRIMARY KEY,
        user_id       INT           NULL,
        paciente_id   INT           NULL,
        documento_id  INT           NULL,
        accion        NVARCHAR(20)  NOT NULL,
        at            DATETIME2(0)  NOT NULL CONSTRAINT DF_salud_bitacora_at DEFAULT (SYSDATETIME())
    );
    CREATE INDEX IX_salud_bitacora_paciente ON dbo.salud_bitacora (paciente_id, at DESC);
END;
GO

CREATE OR ALTER TRIGGER dbo.TR_salud_bitacora_append_only
ON dbo.salud_bitacora
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    RAISERROR('La bitácora del expediente no se modifica.', 16, 1);
    ROLLBACK TRANSACTION;
END;
GO

/* ======================================================= LABORATORIO E IMAGEN

   Un ESTUDIO es un servicio del catálogo (se cobra en la caja como cualquier
   orden de servicio) con su ficha aquí: si es de laboratorio o de imagen, la
   modalidad (rayos X, mastografía, ultrasonido…), la preparación del
   paciente y, para laboratorio, sus parámetros con unidades y valores de
   referencia.

   Una ORDEN de estudios es la solicitud de un paciente. Cada estudio de la
   orden avanza solo:  SOLICITADO -> TOMADO -> CAPTURADO -> VALIDADO.
   VALIDAR es firmar: lo hace un profesional con cédula, guarda su copia
   (firmante) y la huella SHA-256, y desde ahí el resultado no cambia. La
   orden queda LISTA cuando todos sus estudios están validados y ENTREGADA
   cuando el paciente se los lleva. */

IF OBJECT_ID(N'dbo.salud_estudios', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_estudios (
        product_id     INT            NOT NULL CONSTRAINT PK_salud_estudios PRIMARY KEY,
        tipo           NVARCHAR(10)   NOT NULL,
        modalidad      NVARCHAR(20)   NULL,
        preparacion    NVARCHAR(400)  NULL,
        muestra        NVARCHAR(60)   NULL,
        entrega_horas  INT            NULL,
        /* [{ clave, nombre, unidad, min, max, texto }] (laboratorio). */
        parametros     NVARCHAR(MAX)  NULL,
        updated_at     DATETIME2(0)   NOT NULL CONSTRAINT DF_salud_estudios_upd DEFAULT (SYSDATETIME()),
        CONSTRAINT FK_salud_estudios_producto FOREIGN KEY (product_id) REFERENCES dbo.products(id),
        CONSTRAINT CK_salud_estudios_tipo CHECK (tipo IN (N'LAB', N'IMAGEN')),
        CONSTRAINT CK_salud_estudios_modalidad CHECK (
            (tipo = N'LAB' AND modalidad IS NULL) OR
            (tipo = N'IMAGEN' AND modalidad IN (N'RX', N'MASTOGRAFIA', N'USG', N'TAC', N'RM', N'DENSITOMETRIA', N'OTRO'))),
        CONSTRAINT CK_salud_estudios_param CHECK (parametros IS NULL OR ISJSON(parametros) = 1),
        CONSTRAINT CK_salud_estudios_horas CHECK (entrega_horas IS NULL OR entrega_horas BETWEEN 0 AND 2160)
    );
END;
GO

IF OBJECT_ID(N'dbo.salud_estudio_ordenes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_estudio_ordenes (
        id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_salud_estudio_ordenes PRIMARY KEY,
        folio          AS ('EST-' + RIGHT('000000' + CONVERT(VARCHAR(7), id), 6)) PERSISTED,
        paciente_id    INT            NOT NULL,
        medico         NVARCHAR(160)  NULL,
        indicaciones   NVARCHAR(600)  NULL,
        estado         NVARCHAR(12)   NOT NULL CONSTRAINT DF_salud_eo_estado DEFAULT (N'ABIERTA'),
        /* La orden de servicio con la que se cobra. */
        orden_id       INT            NULL,
        created_by     INT            NULL,
        created_at     DATETIME2(0)   NOT NULL CONSTRAINT DF_salud_eo_created DEFAULT (SYSDATETIME()),
        entregado_at   DATETIME2(0)   NULL,
        entregado_por  INT            NULL,
        CONSTRAINT FK_salud_eo_paciente FOREIGN KEY (paciente_id) REFERENCES dbo.salud_pacientes(customer_id),
        CONSTRAINT CK_salud_eo_estado CHECK (estado IN (N'ABIERTA', N'LISTA', N'ENTREGADA', N'CANCELADA'))
    );
    CREATE INDEX IX_salud_eo_paciente ON dbo.salud_estudio_ordenes (paciente_id, created_at DESC);
    CREATE INDEX IX_salud_eo_estado ON dbo.salud_estudio_ordenes (estado, created_at) WHERE estado IN (N'ABIERTA', N'LISTA');
END;
GO

IF OBJECT_ID(N'dbo.salud_estudio_items', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_estudio_items (
        id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_salud_estudio_items PRIMARY KEY,
        orden_id       INT            NOT NULL,
        product_id     INT            NOT NULL,
        /* Copias: el catálogo puede cambiar; lo que se pidió, no. */
        nombre         NVARCHAR(100)  NOT NULL,
        tipo           NVARCHAR(10)   NOT NULL,
        modalidad      NVARCHAR(20)   NULL,
        parametros     NVARCHAR(MAX)  NULL,
        precio         DECIMAL(12,2)  NOT NULL,
        estado         NVARCHAR(12)   NOT NULL CONSTRAINT DF_salud_ei_estado DEFAULT (N'SOLICITADO'),
        tomado_at      DATETIME2(0)   NULL,
        tomado_por     INT            NULL,
        /* Laboratorio: [{ clave, valor, bandera }]; bandera A (alto), B (bajo) o null. */
        resultados     NVARCHAR(MAX)  NULL,
        /* Imagen: lo que se ve y lo que se concluye. */
        hallazgos      NVARCHAR(MAX)  NULL,
        conclusion     NVARCHAR(1000) NULL,
        /* Mastografía: BI-RADS 0 a 6. */
        birads         TINYINT        NULL,
        capturado_at   DATETIME2(0)   NULL,
        capturado_por  INT            NULL,
        validado_at    DATETIME2(0)   NULL,
        validado_por   INT            NULL,
        firmante       NVARCHAR(MAX)  NULL,
        huella         VARBINARY(32)  NULL,
        CONSTRAINT FK_salud_ei_orden FOREIGN KEY (orden_id) REFERENCES dbo.salud_estudio_ordenes(id),
        CONSTRAINT FK_salud_ei_estudio FOREIGN KEY (product_id) REFERENCES dbo.salud_estudios(product_id),
        CONSTRAINT CK_salud_ei_estado CHECK (estado IN (N'SOLICITADO', N'TOMADO', N'CAPTURADO', N'VALIDADO', N'CANCELADO')),
        CONSTRAINT CK_salud_ei_tipo CHECK (tipo IN (N'LAB', N'IMAGEN')),
        CONSTRAINT CK_salud_ei_json CHECK ((resultados IS NULL OR ISJSON(resultados) = 1)
                                           AND (parametros IS NULL OR ISJSON(parametros) = 1)
                                           AND (firmante IS NULL OR ISJSON(firmante) = 1)),
        CONSTRAINT CK_salud_ei_birads CHECK (birads IS NULL OR (birads BETWEEN 0 AND 6 AND modalidad = N'MASTOGRAFIA')),
        CONSTRAINT CK_salud_ei_validado CHECK (estado <> N'VALIDADO' OR (validado_at IS NOT NULL AND validado_por IS NOT NULL
                                                                     AND huella IS NOT NULL AND firmante IS NOT NULL))
    );
    CREATE INDEX IX_salud_ei_orden ON dbo.salud_estudio_items (orden_id);
END;
GO

/* LO VALIDADO NO SE TOCA, tampoco por fuera de los procedimientos. */
CREATE OR ALTER TRIGGER dbo.TR_salud_estudio_items_inmutable
ON dbo.salud_estudio_items
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM deleted WHERE estado = N'VALIDADO')
    BEGIN
        RAISERROR('ESTUDIO_VALIDADO: un resultado validado no cambia. Agrega una nota en el expediente.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
END;
GO

/* ================================================================ DENTAL */

/* Historial: cada marca es una fila. El estado actual es la última marca
   de cada diente y cara. Nunca se pisa lo de una visita anterior. */
IF OBJECT_ID(N'dbo.salud_odontograma', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_odontograma (
        id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_salud_odontograma PRIMARY KEY,
        paciente_id  INT            NOT NULL,
        diente       TINYINT        NOT NULL,
        cara         NVARCHAR(2)    NOT NULL,
        estado       NVARCHAR(20)   NOT NULL,
        nota         NVARCHAR(200)  NULL,
        user_id      INT            NULL,
        at           DATETIME2(0)   NOT NULL CONSTRAINT DF_salud_odo_at DEFAULT (SYSDATETIME()),
        CONSTRAINT FK_salud_odontograma_pac FOREIGN KEY (paciente_id) REFERENCES dbo.salud_pacientes(customer_id),
        /* FDI: permanentes 11-48, temporales 51-85. */
        CONSTRAINT CK_salud_odontograma_diente CHECK (
            (diente / 10 BETWEEN 1 AND 4 AND diente % 10 BETWEEN 1 AND 8)
         OR (diente / 10 BETWEEN 5 AND 8 AND diente % 10 BETWEEN 1 AND 5)),
        /* Oclusal, Mesial, Distal, Vestibular, Lingual/palatina, T = todo el diente. */
        CONSTRAINT CK_salud_odontograma_cara CHECK (cara IN (N'O', N'M', N'D', N'V', N'L', N'T')),
        CONSTRAINT CK_salud_odontograma_estado CHECK (estado IN (
            N'SANO', N'CARIES', N'OBTURADO', N'AUSENTE', N'CORONA', N'ENDODONCIA',
            N'EXTRACCION', N'IMPLANTE', N'FRACTURA', N'SELLADOR'))
    );
    CREATE INDEX IX_salud_odontograma_actual ON dbo.salud_odontograma (paciente_id, diente, cara, id DESC) INCLUDE (estado);
END;
GO

IF OBJECT_ID(N'dbo.salud_planes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_planes (
        id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_salud_planes PRIMARY KEY,
        paciente_id  INT            NOT NULL,
        titulo       NVARCHAR(120)  NOT NULL,
        estado       NVARCHAR(12)   NOT NULL CONSTRAINT DF_salud_planes_estado DEFAULT (N'PROPUESTO'),
        orden_id     INT            NULL,
        created_by   INT            NULL,
        created_at   DATETIME2(0)   NOT NULL CONSTRAINT DF_salud_planes_created DEFAULT (SYSDATETIME()),
        aceptado_at  DATETIME2(0)   NULL,
        CONSTRAINT FK_salud_planes_pac FOREIGN KEY (paciente_id) REFERENCES dbo.salud_pacientes(customer_id),
        CONSTRAINT CK_salud_planes_estado CHECK (estado IN (N'PROPUESTO', N'ACEPTADO', N'TERMINADO', N'CANCELADO'))
    );
    CREATE INDEX IX_salud_planes_paciente ON dbo.salud_planes (paciente_id, created_at DESC);
END;
GO

IF OBJECT_ID(N'dbo.salud_plan_items', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.salud_plan_items (
        id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_salud_plan_items PRIMARY KEY,
        plan_id         INT            NOT NULL,
        fase            TINYINT        NOT NULL CONSTRAINT DF_salud_plan_items_fase DEFAULT (1),
        diente          TINYINT        NULL,
        procedimiento   NVARCHAR(160)  NOT NULL,
        product_id      INT            NULL,
        precio          DECIMAL(10,2)  NOT NULL,
        estado          NVARCHAR(10)   NOT NULL CONSTRAINT DF_salud_plan_items_estado DEFAULT (N'PENDIENTE'),
        hecho_at        DATETIME2(0)   NULL,
        CONSTRAINT FK_salud_plan_items_plan FOREIGN KEY (plan_id) REFERENCES dbo.salud_planes(id) ON DELETE CASCADE,
        CONSTRAINT FK_salud_plan_items_product FOREIGN KEY (product_id) REFERENCES dbo.products(id),
        CONSTRAINT CK_salud_plan_items_estado CHECK (estado IN (N'PENDIENTE', N'HECHO')),
        CONSTRAINT CK_salud_plan_items_precio CHECK (precio >= 0)
    );
    CREATE INDEX IX_salud_plan_items_plan ON dbo.salud_plan_items (plan_id, fase);
END;
GO

/* ==================================================== CIE-10 (selección)
   Los diagnósticos más frecuentes en primer contacto y en odontología. El
   catálogo completo (DGIS) se importa aparte; mientras, el diagnóstico
   admite texto libre sin código. */
MERGE dbo.salud_cie10 AS d
USING (VALUES
  (N'A09',   N'Diarrea y gastroenteritis de presunto origen infeccioso'),
  (N'B34.9', N'Infección viral, no especificada'),
  (N'B35.1', N'Tiña de las uñas'),
  (N'B37.3', N'Candidiasis de la vulva y de la vagina'),
  (N'E03.9', N'Hipotiroidismo, no especificado'),
  (N'E10.9', N'Diabetes mellitus tipo 1, sin complicaciones'),
  (N'E11.9', N'Diabetes mellitus tipo 2, sin complicaciones'),
  (N'E66.9', N'Obesidad, no especificada'),
  (N'E78.5', N'Hiperlipidemia, no especificada'),
  (N'F32.9', N'Episodio depresivo, no especificado'),
  (N'F41.1', N'Trastorno de ansiedad generalizada'),
  (N'G43.9', N'Migraña, no especificada'),
  (N'G47.0', N'Trastornos del inicio y del mantenimiento del sueño'),
  (N'H10.9', N'Conjuntivitis, no especificada'),
  (N'H60.9', N'Otitis externa, sin otra especificación'),
  (N'H66.9', N'Otitis media, no especificada'),
  (N'I10',   N'Hipertensión esencial (primaria)'),
  (N'J00',   N'Rinofaringitis aguda (resfriado común)'),
  (N'J01.9', N'Sinusitis aguda, no especificada'),
  (N'J02.9', N'Faringitis aguda, no especificada'),
  (N'J03.9', N'Amigdalitis aguda, no especificada'),
  (N'J06.9', N'Infección aguda de las vías respiratorias superiores, no especificada'),
  (N'J11.1', N'Influenza con otras manifestaciones respiratorias, virus no identificado'),
  (N'J18.9', N'Neumonía, no especificada'),
  (N'J20.9', N'Bronquitis aguda, no especificada'),
  (N'J30.4', N'Rinitis alérgica, no especificada'),
  (N'J45.9', N'Asma, no especificada'),
  (N'K21.9', N'Enfermedad del reflujo gastroesofágico sin esofagitis'),
  (N'K29.7', N'Gastritis, no especificada'),
  (N'K30',   N'Dispepsia'),
  (N'K58.9', N'Síndrome del colon irritable sin diarrea'),
  (N'K59.0', N'Constipación'),
  (N'L20.9', N'Dermatitis atópica, no especificada'),
  (N'L30.9', N'Dermatitis, no especificada'),
  (N'L50.9', N'Urticaria, no especificada'),
  (N'L70.0', N'Acné vulgar'),
  (N'M25.5', N'Dolor en articulación'),
  (N'M54.2', N'Cervicalgia'),
  (N'M54.5', N'Lumbago no especificado'),
  (N'M79.1', N'Mialgia'),
  (N'N30.0', N'Cistitis aguda'),
  (N'N39.0', N'Infección de vías urinarias, sitio no especificado'),
  (N'N76.0', N'Vaginitis aguda'),
  (N'N94.6', N'Dismenorrea, no especificada'),
  (N'O80',   N'Parto único espontáneo'),
  (N'R05',   N'Tos'),
  (N'R10.4', N'Otros dolores abdominales y los no especificados'),
  (N'R11',   N'Náusea y vómito'),
  (N'R42',   N'Mareo y desvanecimiento'),
  (N'R50.9', N'Fiebre, no especificada'),
  (N'R51',   N'Cefalea'),
  (N'S93.4', N'Esguince y torcedura del tobillo'),
  (N'T78.4', N'Alergia no especificada'),
  (N'Z00.0', N'Examen médico general'),
  (N'Z00.1', N'Control de salud de rutina del niño'),
  (N'Z01.2', N'Examen odontológico'),
  (N'Z30.0', N'Consejo y asesoramiento general sobre la anticoncepción'),
  (N'Z34.9', N'Supervisión de embarazo normal, no especificado'),
  -- Odontología
  (N'K00.6', N'Alteraciones en la erupción dentaria'),
  (N'K01.1', N'Dientes impactados'),
  (N'K02.0', N'Caries limitada al esmalte'),
  (N'K02.1', N'Caries de la dentina'),
  (N'K02.2', N'Caries del cemento'),
  (N'K02.9', N'Caries dental, no especificada'),
  (N'K03.0', N'Atrición excesiva de los dientes'),
  (N'K03.6', N'Depósitos (acreciones) en los dientes'),
  (N'K04.0', N'Pulpitis'),
  (N'K04.1', N'Necrosis de la pulpa'),
  (N'K04.5', N'Periodontitis apical crónica'),
  (N'K04.7', N'Absceso periapical sin fístula'),
  (N'K05.0', N'Gingivitis aguda'),
  (N'K05.1', N'Gingivitis crónica'),
  (N'K05.3', N'Periodontitis crónica'),
  (N'K06.0', N'Retracción gingival'),
  (N'K07.4', N'Maloclusión de tipo no especificado'),
  (N'K08.1', N'Pérdida de dientes debida a accidente, extracción o enfermedad periodontal local'),
  (N'K08.8', N'Otras afecciones especificadas de los dientes y de sus estructuras de sostén'),
  (N'K12.0', N'Estomatitis aftosa recurrente'),
  (N'S02.5', N'Fractura de los dientes')
) AS s(codigo, descripcion)
   ON d.codigo = s.codigo
 WHEN MATCHED AND d.descripcion <> s.descripcion THEN UPDATE SET descripcion = s.descripcion
 WHEN NOT MATCHED THEN INSERT (codigo, descripcion) VALUES (s.codigo, s.descripcion);
GO

/* ---------- sp_salud_bitacora_list (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_bitacora_list
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Quién hizo qué con el expediente de un paciente, más reciente primero.
 * @registrar: anota una acción hecha fuera de SQL (IMPRIMIR, EXPORTAR)
 * antes de listar, para no necesitar otro viaje.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_bitacora_list]
    @customer_id  INT,
    @registrar    NVARCHAR(20) = NULL,
    @documento_id INT = NULL,
    @user_id      INT = NULL,
    @top          INT = 100
AS
BEGIN
    SET NOCOUNT ON;
    IF @top IS NULL OR @top NOT BETWEEN 1 AND 1000 SET @top = 100;
    SET @registrar = NULLIF(UPPER(LTRIM(RTRIM(@registrar))), N'');
    IF @registrar IS NOT NULL
    BEGIN
        IF @registrar NOT IN (N'IMPRIMIR', N'EXPORTAR')
        BEGIN RAISERROR('Acción de bitácora inválida.', 16, 1); RETURN; END
        INSERT INTO dbo.salud_bitacora (user_id, paciente_id, documento_id, accion)
        VALUES (@user_id, @customer_id, @documento_id, @registrar);
    END

    SELECT TOP (@top) b.id, b.accion, b.documento_id, b.at, u.usuario
      FROM dbo.salud_bitacora b
      LEFT JOIN dbo.users u ON u.id = b.user_id
     WHERE b.paciente_id = @customer_id
     ORDER BY b.at DESC, b.id DESC;
END
GO

/* ---------- sp_salud_cie10_buscar (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_cie10_buscar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Diagnósticos CIE-10 por código o por texto. Primero los que empiezan por
 * lo escrito, después los que lo contienen.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_cie10_buscar]
    @buscar NVARCHAR(100),
    @top    INT = 20
AS
BEGIN
    SET NOCOUNT ON;
    SET @buscar = NULLIF(LTRIM(RTRIM(@buscar)), N'');
    IF @buscar IS NULL RETURN;
    IF @top IS NULL OR @top NOT BETWEEN 1 AND 100 SET @top = 20;

    SELECT TOP (@top) codigo, descripcion
      FROM dbo.salud_cie10
     WHERE codigo LIKE @buscar + N'%' OR descripcion LIKE N'%' + @buscar + N'%'
     ORDER BY CASE WHEN codigo LIKE @buscar + N'%' THEN 0
                   WHEN descripcion LIKE @buscar + N'%' THEN 1 ELSE 2 END,
              codigo;
END
GO

/* ---------- sp_salud_config_get (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_config_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Qué partes del giro Salud usa este negocio. Sin fila: el módulo nunca se
 * configuró y no se inventa nada.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_config_get]
AS
BEGIN
    SET NOCOUNT ON;
    SELECT preset, farmacia, clinica, dental, estudios, set_at, set_by
      FROM dbo.salud_config
     WHERE id = 1;
END
GO

/* ---------- sp_salud_config_set (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_config_set
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Elegir el preset de Salud ENCIENDE el módulo `salud`, en la misma
 * transacción y por su propia puerta (sp_set_business_module).
 *
 * Que la clínica necesite además Servicios (agenda, profesionales, cobro de
 * órdenes) lo resuelve el proceso principal: sp_set_services_preset ya usa
 * INSERT…EXEC por dentro, y anidarlo aquí no compila.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_config_set]
    @preset   NVARCHAR(40),
    @farmacia BIT,
    @clinica  BIT,
    @dental   BIT,
    @estudios BIT = 0,
    @user_id  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @preset = UPPER(LTRIM(RTRIM(ISNULL(@preset, N''))));
    IF @preset = N''
    BEGIN
        RAISERROR('Falta el giro de Salud.', 16, 1);
        RETURN;
    END
    /* Dental es una forma de consultorio: sin expediente no hay odontograma. */
    IF ISNULL(@dental, 0) = 1 SET @clinica = 1;
    IF ISNULL(@farmacia, 0) = 0 AND ISNULL(@clinica, 0) = 0 AND ISNULL(@estudios, 0) = 0
    BEGIN
        RAISERROR('El giro de Salud necesita farmacia, consultorio o estudios.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    MERGE dbo.salud_config AS d
    USING (SELECT CAST(1 AS TINYINT) AS id) AS s ON d.id = s.id
     WHEN MATCHED THEN
          UPDATE SET preset = @preset, farmacia = ISNULL(@farmacia, 0), clinica = ISNULL(@clinica, 0),
                     dental = ISNULL(@dental, 0), estudios = ISNULL(@estudios, 0), set_at = SYSDATETIME(), set_by = @user_id
     WHEN NOT MATCHED THEN
          INSERT (id, preset, farmacia, clinica, dental, estudios, set_at, set_by)
          VALUES (1, @preset, ISNULL(@farmacia, 0), ISNULL(@clinica, 0), ISNULL(@dental, 0), ISNULL(@estudios, 0), SYSDATETIME(), @user_id);

    /* El resultado del módulo se recoge aparte: si saliera, el primer
       conjunto que recibe quien llama sería el del módulo y no el giro. */
    DECLARE @modulo TABLE (
        module_key NVARCHAR(40), enabled BIT, enabled_at DATETIME2(0),
        enabled_by INT, updated_at DATETIME2(0));
    INSERT INTO @modulo
    EXEC dbo.sp_set_business_module @module_key = N'salud', @enabled = 1, @user_id = @user_id;

    COMMIT;

    SELECT preset, farmacia, clinica, dental, estudios, set_at, set_by
      FROM dbo.salud_config WHERE id = 1;
END
GO

/* ---------- sp_salud_documento_adenda (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_documento_adenda
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* La única forma de corregir o completar un documento firmado: una nota
 * aparte, con su autor y su fecha, que no toca el original.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_documento_adenda]
    @documento_id INT,
    @texto        NVARCHAR(2000),
    @user_id      INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @texto = NULLIF(LTRIM(RTRIM(@texto)), N'');
    IF @texto IS NULL BEGIN RAISERROR('Escribe la adenda.', 16, 1); RETURN; END

    DECLARE @estado NVARCHAR(10), @pac INT;
    SELECT @estado = estado, @pac = paciente_id FROM dbo.salud_documentos WHERE id = @documento_id;
    IF @estado IS NULL BEGIN RAISERROR('El documento no existe.', 16, 1); RETURN; END
    IF @estado <> N'FIRMADO' BEGIN RAISERROR('Un borrador se corrige editándolo; la adenda es para documentos firmados.', 16, 1); RETURN; END

    BEGIN TRAN;
    INSERT INTO dbo.salud_adendas (documento_id, texto, autor_id) VALUES (@documento_id, @texto, @user_id);
    DECLARE @id INT = SCOPE_IDENTITY();
    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, documento_id, accion)
    VALUES (@user_id, @pac, @documento_id, N'ADENDA');
    COMMIT;

    SELECT @id AS id;
END
GO

/* ---------- sp_salud_documento_descartar (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_documento_descartar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Borra un BORRADOR que su autor ya no quiere. Lo firmado no se borra nunca
 * (y el trigger de la tabla lo impide aunque se intente por fuera).
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_documento_descartar]
    @id      INT,
    @user_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;
    DECLARE @estado NVARCHAR(10), @autor INT, @pac INT;
    SELECT @estado = estado, @autor = autor_id, @pac = paciente_id
      FROM dbo.salud_documentos WITH (UPDLOCK) WHERE id = @id;
    IF @estado IS NULL BEGIN ROLLBACK; RAISERROR('El documento no existe.', 16, 1); RETURN; END
    IF @estado = N'FIRMADO' BEGIN ROLLBACK; RAISERROR('DOCUMENTO_FIRMADO: un documento firmado no se borra.', 16, 1); RETURN; END
    IF @autor <> @user_id BEGIN ROLLBACK; RAISERROR('Solo quien escribió el borrador puede descartarlo.', 16, 1); RETURN; END

    DELETE FROM dbo.salud_documentos WHERE id = @id;
    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, documento_id, accion)
    VALUES (@user_id, @pac, NULL, N'DESCARTAR');
    COMMIT;

    SELECT @id AS id;
END
GO

/* ---------- sp_salud_documento_firmar (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_documento_firmar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Cierra un borrador. Desde aquí el documento no cambia: la huella SHA-256
 * de su contenido, de sus diagnósticos y de quién firma permite demostrarlo
 * después.
 *
 * Firma su autor, nadie más: firmar es responder por lo escrito.
 *
 * QUIÉN FIRMA queda COPIADO en el documento (`firmante`): nombre, cédula,
 * institución, especialidad y el establecimiento. Una receta sin cédula no
 * se firma (SIN_CEDULA); los demás documentos llevan la copia si existe.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_documento_firmar]
    @id      INT,
    @user_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;
    DECLARE @estado NVARCHAR(10), @autor INT, @pac INT, @contenido NVARCHAR(MAX), @tipo NVARCHAR(20);
    SELECT @estado = estado, @autor = autor_id, @pac = paciente_id, @contenido = contenido, @tipo = tipo
      FROM dbo.salud_documentos WITH (UPDLOCK) WHERE id = @id;
    IF @estado IS NULL BEGIN ROLLBACK; RAISERROR('El documento no existe.', 16, 1); RETURN; END
    IF @estado = N'FIRMADO' BEGIN ROLLBACK; RAISERROR('DOCUMENTO_FIRMADO: ya estaba firmado.', 16, 1); RETURN; END
    IF @autor <> @user_id BEGIN ROLLBACK; RAISERROR('Solo quien escribió el documento puede firmarlo.', 16, 1); RETURN; END

    DECLARE @firmante NVARCHAR(MAX) = (
        SELECT p.nombre, p.cedula, p.institucion, p.especialidad, p.cedula_especialidad,
               b.business_name AS establecimiento, b.address AS domicilio, b.phone AS telefono
          FROM dbo.salud_profesionales p
          OUTER APPLY (SELECT TOP 1 business_name, address, phone FROM dbo.business_config ORDER BY id) b
         WHERE p.user_id = @user_id
           FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
    IF @tipo = N'RECETA' AND @firmante IS NULL
    BEGIN
        ROLLBACK;
        RAISERROR('SIN_CEDULA: una receta lleva el nombre y la cédula profesional de quien la firma. Captúralos en «Mis datos de firma».', 16, 1);
        RETURN;
    END

    DECLARE @dx NVARCHAR(MAX) = (
        SELECT cie10, descripcion, principal FROM dbo.salud_diagnosticos
         WHERE documento_id = @id ORDER BY id FOR JSON PATH);
    DECLARE @firmado DATETIME2(0) = SYSDATETIME();
    DECLARE @huella VARBINARY(32) = HASHBYTES('SHA2_256',
        CONCAT(@contenido, N'|', ISNULL(@dx, N'[]'), N'|', @user_id, N'|', ISNULL(@firmante, N'{}'), N'|',
               CONVERT(NVARCHAR(30), @firmado, 126)));

    UPDATE dbo.salud_documentos
       SET estado = N'FIRMADO', firmado_at = @firmado, firmado_por = @user_id, huella = @huella, firmante = @firmante
     WHERE id = @id;

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, documento_id, accion)
    VALUES (@user_id, @pac, @id, N'FIRMAR');
    COMMIT;

    SELECT @id AS id, @firmado AS firmado_at, CONVERT(VARCHAR(66), @huella, 1) AS huella;
END
GO

/* ---------- sp_salud_documento_guardar (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_documento_guardar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Crea o actualiza un BORRADOR del expediente (historia, nota SOAP, receta,
 * consentimiento, solicitud, referencia) con sus diagnósticos.
 *
 * Solo su autor edita un borrador. Uno firmado no pasa de aquí, y si
 * alguien lo intentara por fuera, el trigger de la tabla lo rechaza.
 *
 * @diagnosticos: JSON [{ "cie10": "J02.9", "descripcion": "...", "principal": true }]
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_documento_guardar]
    @id           INT           = NULL,
    @paciente_id  INT,
    @tipo         NVARCHAR(20),
    @titulo       NVARCHAR(160) = NULL,
    @contenido    NVARCHAR(MAX),
    @diagnosticos NVARCHAR(MAX) = NULL,
    @cita_id      INT           = NULL,
    @orden_id     INT           = NULL,
    @user_id      INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @tipo = UPPER(LTRIM(RTRIM(ISNULL(@tipo, N''))));
    IF @user_id IS NULL BEGIN RAISERROR('Falta quién escribe el documento.', 16, 1); RETURN; END
    IF @tipo NOT IN (N'HISTORIA', N'NOTA', N'RECETA', N'CONSENTIMIENTO', N'SOLICITUD', N'REFERENCIA')
    BEGIN RAISERROR('Tipo de documento inválido.', 16, 1); RETURN; END
    IF @contenido IS NULL OR ISJSON(@contenido) <> 1
    BEGIN RAISERROR('El contenido del documento es inválido.', 16, 1); RETURN; END
    IF @diagnosticos IS NOT NULL AND ISJSON(@diagnosticos) <> 1
    BEGIN RAISERROR('Diagnósticos inválidos.', 16, 1); RETURN; END

    DECLARE @consent DATETIME2(0);
    SELECT @consent = consentimiento_at FROM dbo.salud_pacientes WHERE customer_id = @paciente_id;
    IF NOT EXISTS (SELECT 1 FROM dbo.salud_pacientes WHERE customer_id = @paciente_id)
    BEGIN RAISERROR('SIN_FICHA: primero da de alta la ficha del paciente.', 16, 1); RETURN; END
    IF @consent IS NULL
    BEGIN RAISERROR('SIN_CONSENTIMIENTO: el paciente no ha dado su consentimiento para el tratamiento de sus datos.', 16, 1); RETURN; END

    BEGIN TRAN;

    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.salud_documentos (paciente_id, tipo, titulo, contenido, autor_id, cita_id, orden_id)
        VALUES (@paciente_id, @tipo, NULLIF(LTRIM(RTRIM(@titulo)), N''), @contenido, @user_id, @cita_id, @orden_id);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        DECLARE @estado NVARCHAR(10), @autor INT, @pac INT;
        SELECT @estado = estado, @autor = autor_id, @pac = paciente_id
          FROM dbo.salud_documentos WITH (UPDLOCK) WHERE id = @id;
        IF @estado IS NULL OR @pac <> @paciente_id
        BEGIN ROLLBACK; RAISERROR('El documento no existe.', 16, 1); RETURN; END
        IF @estado = N'FIRMADO'
        BEGIN ROLLBACK; RAISERROR('DOCUMENTO_FIRMADO: un documento firmado no se modifica; agrega una adenda.', 16, 1); RETURN; END
        IF @autor <> @user_id
        BEGIN ROLLBACK; RAISERROR('Solo quien escribió el borrador puede cambiarlo.', 16, 1); RETURN; END

        UPDATE dbo.salud_documentos
           SET tipo = @tipo, titulo = NULLIF(LTRIM(RTRIM(@titulo)), N''), contenido = @contenido,
               cita_id = @cita_id, orden_id = @orden_id, updated_at = SYSDATETIME()
         WHERE id = @id;
        DELETE FROM dbo.salud_diagnosticos WHERE documento_id = @id;
    END

    IF @diagnosticos IS NOT NULL
        INSERT INTO dbo.salud_diagnosticos (documento_id, cie10, descripcion, principal)
        SELECT @id,
               NULLIF(UPPER(LTRIM(RTRIM(j.cie10))), N''),
               LEFT(LTRIM(RTRIM(j.descripcion)), 250),
               ISNULL(j.principal, 0)
          FROM OPENJSON(@diagnosticos)
               WITH (cie10 NVARCHAR(10) '$.cie10', descripcion NVARCHAR(400) '$.descripcion', principal BIT '$.principal') j
         WHERE NULLIF(LTRIM(RTRIM(j.descripcion)), N'') IS NOT NULL;

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, documento_id, accion)
    VALUES (@user_id, @paciente_id, @id, N'EDITAR');

    COMMIT;
    SELECT @id AS id;
END
GO

/* ---------- sp_salud_estudio_capturar (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_estudio_capturar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Captura (o corrige, mientras no se valide) el resultado de un estudio.
 *
 * Laboratorio: @resultados JSON [{ "clave": "GLU", "valor": "112" }]. Solo
 *   claves de los parámetros que se pidieron. La BANDERA la pone la base,
 *   no la pantalla: A si el valor numérico pasa del máximo de referencia, B
 *   si queda bajo el mínimo.
 * Imagen: @hallazgos y @conclusion; en mastografía, BI-RADS 0 a 6.
 *
 * Capturar un estudio que no se marcó como tomado lo da por tomado.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_capturar]
    @item_id    INT,
    @resultados NVARCHAR(MAX)  = NULL,
    @hallazgos  NVARCHAR(MAX)  = NULL,
    @conclusion NVARCHAR(1000) = NULL,
    @birads     TINYINT        = NULL,
    @user_id    INT            = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @hallazgos = NULLIF(LTRIM(RTRIM(@hallazgos)), N'');
    SET @conclusion = NULLIF(LTRIM(RTRIM(@conclusion)), N'');

    BEGIN TRAN;
    DECLARE @estado NVARCHAR(12), @tipo NVARCHAR(10), @modalidad NVARCHAR(20), @param NVARCHAR(MAX), @orden INT;
    SELECT @estado = estado, @tipo = tipo, @modalidad = modalidad, @param = parametros, @orden = orden_id
      FROM dbo.salud_estudio_items WITH (UPDLOCK) WHERE id = @item_id;
    IF @estado IS NULL BEGIN ROLLBACK; RAISERROR('El estudio no existe.', 16, 1); RETURN; END
    IF @estado IN (N'VALIDADO', N'CANCELADO')
    BEGIN ROLLBACK; RAISERROR('ESTUDIO_VALIDADO: este estudio ya está cerrado.', 16, 1); RETURN; END

    DECLARE @final NVARCHAR(MAX) = NULL;
    IF @tipo = N'LAB'
    BEGIN
        IF ISJSON(ISNULL(@resultados, N'')) = 0 BEGIN ROLLBACK; RAISERROR('Captura los resultados.', 16, 1); RETURN; END
        DECLARE @r TABLE (clave NVARCHAR(20), valor NVARCHAR(60));
        INSERT INTO @r
        SELECT LTRIM(RTRIM(clave)), NULLIF(LTRIM(RTRIM(valor)), N'')
          FROM OPENJSON(@resultados) WITH (clave NVARCHAR(40) '$.clave', valor NVARCHAR(100) '$.valor');
        IF EXISTS (SELECT 1 FROM @r r WHERE NOT EXISTS (
            SELECT 1 FROM OPENJSON(@param) WITH (clave NVARCHAR(20) '$.clave') p WHERE p.clave = r.clave))
        BEGIN ROLLBACK; RAISERROR('Un resultado no corresponde a ningún parámetro del estudio.', 16, 1); RETURN; END
        IF NOT EXISTS (SELECT 1 FROM @r WHERE valor IS NOT NULL)
        BEGIN ROLLBACK; RAISERROR('Captura al menos un resultado.', 16, 1); RETURN; END

        SET @final = (
            SELECT p.clave, r.valor,
                   CASE WHEN TRY_CONVERT(DECIMAL(18,4), r.valor) IS NULL THEN NULL
                        WHEN p.mx IS NOT NULL AND TRY_CONVERT(DECIMAL(18,4), r.valor) > p.mx THEN N'A'
                        WHEN p.mn IS NOT NULL AND TRY_CONVERT(DECIMAL(18,4), r.valor) < p.mn THEN N'B'
                   END AS bandera
              FROM OPENJSON(@param) WITH (clave NVARCHAR(20) '$.clave', mn DECIMAL(18,4) '$.min', mx DECIMAL(18,4) '$.max') p
              JOIN @r r ON r.clave = p.clave
             WHERE r.valor IS NOT NULL
               FOR JSON PATH, INCLUDE_NULL_VALUES);
        SET @hallazgos = NULL; SET @birads = NULL;
    END
    ELSE
    BEGIN
        IF @hallazgos IS NULL AND @conclusion IS NULL
        BEGIN ROLLBACK; RAISERROR('Escribe los hallazgos o la conclusión.', 16, 1); RETURN; END
        IF @modalidad <> N'MASTOGRAFIA' SET @birads = NULL;
        IF @modalidad = N'MASTOGRAFIA' AND @birads IS NULL
        BEGIN ROLLBACK; RAISERROR('La mastografía lleva su categoría BI-RADS (0 a 6).', 16, 1); RETURN; END
        IF @birads > 6 BEGIN ROLLBACK; RAISERROR('BI-RADS va de 0 a 6.', 16, 1); RETURN; END
    END

    UPDATE dbo.salud_estudio_items
       SET resultados = @final, hallazgos = @hallazgos, conclusion = @conclusion, birads = @birads,
           estado = N'CAPTURADO', capturado_at = SYSDATETIME(), capturado_por = @user_id,
           tomado_at = ISNULL(tomado_at, SYSDATETIME()), tomado_por = ISNULL(tomado_por, @user_id)
     WHERE id = @item_id;
    COMMIT;

    SELECT id, estado, resultados FROM dbo.salud_estudio_items WHERE id = @item_id;
END
GO

/* ---------- sp_salud_estudio_entregar (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_estudio_entregar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El paciente se lleva sus resultados. Solo una orden LISTA (todo validado)
 * se entrega; queda en la bitácora quién la entregó.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_entregar]
    @id      INT,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRAN;
    DECLARE @estado NVARCHAR(12), @pac INT;
    SELECT @estado = estado, @pac = paciente_id FROM dbo.salud_estudio_ordenes WITH (UPDLOCK) WHERE id = @id;
    IF @estado IS NULL BEGIN ROLLBACK; RAISERROR('La orden no existe.', 16, 1); RETURN; END
    IF @estado = N'ENTREGADA' BEGIN ROLLBACK; RAISERROR('Esta orden ya se entregó.', 16, 1); RETURN; END
    IF @estado <> N'LISTA' BEGIN ROLLBACK; RAISERROR('Faltan resultados por validar.', 16, 1); RETURN; END

    UPDATE dbo.salud_estudio_ordenes SET estado = N'ENTREGADA', entregado_at = SYSDATETIME(), entregado_por = @user_id WHERE id = @id;
    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion) VALUES (@user_id, @pac, N'ENTREGAR');
    COMMIT;
    SELECT id, folio, estado, entregado_at FROM dbo.salud_estudio_ordenes WHERE id = @id;
END
GO

/* ---------- sp_salud_estudio_estado (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_estudio_estado
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Marca un estudio como TOMADO (la muestra o la placa ya se hizo) o lo
 * CANCELA. Lo validado no se cancela. Si al cancelar los que quedan ya están
 * todos validados, la orden queda LISTA; si se cancelan todos, CANCELADA.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_estado]
    @item_id INT,
    @estado  NVARCHAR(12),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @estado = UPPER(LTRIM(RTRIM(ISNULL(@estado, N''))));
    IF @estado NOT IN (N'TOMADO', N'CANCELADO') BEGIN RAISERROR('Estado no válido.', 16, 1); RETURN; END

    BEGIN TRAN;
    DECLARE @actual NVARCHAR(12), @orden INT;
    SELECT @actual = estado, @orden = orden_id FROM dbo.salud_estudio_items WITH (UPDLOCK) WHERE id = @item_id;
    IF @actual IS NULL BEGIN ROLLBACK; RAISERROR('El estudio no existe.', 16, 1); RETURN; END
    IF @actual IN (N'VALIDADO', N'CANCELADO')
    BEGIN ROLLBACK; RAISERROR('ESTUDIO_VALIDADO: este estudio ya está cerrado.', 16, 1); RETURN; END
    IF @estado = N'TOMADO' AND @actual <> N'SOLICITADO'
    BEGIN ROLLBACK; RAISERROR('Este estudio ya se tomó.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.salud_estudio_ordenes WHERE id = @orden AND estado IN (N'ENTREGADA', N'CANCELADA'))
    BEGIN ROLLBACK; RAISERROR('La orden ya está cerrada.', 16, 1); RETURN; END

    UPDATE dbo.salud_estudio_items
       SET estado = @estado,
           tomado_at = CASE WHEN @estado = N'TOMADO' THEN SYSDATETIME() ELSE tomado_at END,
           tomado_por = CASE WHEN @estado = N'TOMADO' THEN @user_id ELSE tomado_por END
     WHERE id = @item_id;

    IF @estado = N'CANCELADO'
        UPDATE o SET estado = CASE
                WHEN NOT EXISTS (SELECT 1 FROM dbo.salud_estudio_items i WHERE i.orden_id = o.id AND i.estado <> N'CANCELADO') THEN N'CANCELADA'
                WHEN NOT EXISTS (SELECT 1 FROM dbo.salud_estudio_items i WHERE i.orden_id = o.id AND i.estado NOT IN (N'VALIDADO', N'CANCELADO')) THEN N'LISTA'
                ELSE o.estado END
          FROM dbo.salud_estudio_ordenes o WHERE o.id = @orden;
    COMMIT;

    SELECT i.id, i.estado, o.estado AS orden_estado
      FROM dbo.salud_estudio_items i JOIN dbo.salud_estudio_ordenes o ON o.id = i.orden_id
     WHERE i.id = @item_id;
END
GO

/* ---------- sp_salud_estudio_ficha_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_estudio_ficha_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* La ficha de un estudio del catálogo. El servicio (nombre, precio, IVA) lo
 * guarda sp_service_save en la misma transacción; aquí va lo clínico:
 * laboratorio o imagen, modalidad, preparación y los parámetros con sus
 * valores de referencia.
 *
 * @parametros: JSON [{ "clave": "GLU", "nombre": "Glucosa", "unidad": "mg/dL",
 *                      "min": 70, "max": 100, "texto": null }]
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_ficha_save]
    @product_id    INT,
    @tipo          NVARCHAR(10),
    @modalidad     NVARCHAR(20)  = NULL,
    @preparacion   NVARCHAR(400) = NULL,
    @muestra       NVARCHAR(60)  = NULL,
    @entrega_horas INT           = NULL,
    @parametros    NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @tipo = UPPER(LTRIM(RTRIM(ISNULL(@tipo, N''))));
    SET @modalidad = NULLIF(UPPER(LTRIM(RTRIM(@modalidad))), N'');
    SET @preparacion = NULLIF(LTRIM(RTRIM(@preparacion)), N'');
    SET @muestra = NULLIF(LTRIM(RTRIM(@muestra)), N'');

    IF NOT EXISTS (SELECT 1 FROM dbo.services WHERE product_id = @product_id)
    BEGIN RAISERROR('El estudio tiene que ser un servicio del catálogo.', 16, 1); RETURN; END
    IF @tipo NOT IN (N'LAB', N'IMAGEN')
    BEGIN RAISERROR('El estudio es de laboratorio o de imagen.', 16, 1); RETURN; END
    IF @tipo = N'LAB' SET @modalidad = NULL;
    IF @tipo = N'IMAGEN' AND ISNULL(@modalidad, N'') NOT IN (N'RX', N'MASTOGRAFIA', N'USG', N'TAC', N'RM', N'DENSITOMETRIA', N'OTRO')
    BEGIN RAISERROR('Elige la modalidad del estudio de imagen.', 16, 1); RETURN; END
    IF @tipo = N'IMAGEN' SET @parametros = NULL;

    IF @parametros IS NOT NULL
    BEGIN
        IF ISJSON(@parametros) = 0 BEGIN RAISERROR('Los parámetros no son válidos.', 16, 1); RETURN; END
        DECLARE @p TABLE (clave NVARCHAR(20), nombre NVARCHAR(100), unidad NVARCHAR(20), mn DECIMAL(18,4), mx DECIMAL(18,4), texto NVARCHAR(120));
        INSERT INTO @p
        SELECT NULLIF(LTRIM(RTRIM(clave)), N''), NULLIF(LTRIM(RTRIM(nombre)), N''), NULLIF(LTRIM(RTRIM(unidad)), N''),
               TRY_CONVERT(DECIMAL(18,4), mn), TRY_CONVERT(DECIMAL(18,4), mx), NULLIF(LTRIM(RTRIM(texto)), N'')
          FROM OPENJSON(@parametros)
          WITH (clave NVARCHAR(40) '$.clave', nombre NVARCHAR(200) '$.nombre', unidad NVARCHAR(40) '$.unidad',
                mn NVARCHAR(30) '$.min', mx NVARCHAR(30) '$.max', texto NVARCHAR(200) '$.texto');
        IF EXISTS (SELECT 1 FROM @p WHERE clave IS NULL OR nombre IS NULL)
        BEGIN RAISERROR('Cada parámetro necesita clave y nombre.', 16, 1); RETURN; END
        IF EXISTS (SELECT clave FROM @p GROUP BY clave HAVING COUNT(*) > 1)
        BEGIN RAISERROR('Hay dos parámetros con la misma clave.', 16, 1); RETURN; END
        IF EXISTS (SELECT 1 FROM @p WHERE mn IS NOT NULL AND mx IS NOT NULL AND mn > mx)
        BEGIN RAISERROR('El mínimo de referencia es mayor que el máximo.', 16, 1); RETURN; END
        /* Se guarda normalizado: lo que lee la captura es siempre lo mismo. */
        SET @parametros = (SELECT clave, nombre, unidad, mn AS [min], mx AS [max], texto FROM @p FOR JSON PATH, INCLUDE_NULL_VALUES);
    END
    IF @tipo = N'LAB' AND (@parametros IS NULL OR @parametros = N'[]')
    BEGIN RAISERROR('Un estudio de laboratorio necesita al menos un parámetro.', 16, 1); RETURN; END

    MERGE dbo.salud_estudios WITH (HOLDLOCK) AS t
    USING (SELECT @product_id AS product_id) AS s ON t.product_id = s.product_id
    WHEN MATCHED THEN UPDATE SET tipo = @tipo, modalidad = @modalidad, preparacion = @preparacion, muestra = @muestra,
         entrega_horas = @entrega_horas, parametros = @parametros, updated_at = SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT (product_id, tipo, modalidad, preparacion, muestra, entrega_horas, parametros)
         VALUES (@product_id, @tipo, @modalidad, @preparacion, @muestra, @entrega_horas, @parametros);

    SELECT @product_id AS product_id;
END
GO

/* ---------- sp_salud_estudio_orden_crear (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_estudio_orden_crear
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Abre la orden de estudios de un paciente. Cada estudio guarda la copia de
 * su nombre, precio y parámetros: si mañana cambia el catálogo, lo que se
 * pidió hoy no cambia. El cobro (la orden de servicio) lo enlaza quien llama,
 * en la misma transacción, con sp_salud_estudio_orden_vincular.
 *
 * @items: JSON [{ "productId": 12 }, ...]
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_orden_crear]
    @customer_id  INT,
    @items        NVARCHAR(MAX),
    @medico       NVARCHAR(160) = NULL,
    @indicaciones NVARCHAR(600) = NULL,
    @user_id      INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.salud_pacientes WHERE customer_id = @customer_id)
    BEGIN RAISERROR('SIN_FICHA: primero da de alta la ficha del paciente.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.salud_pacientes WHERE customer_id = @customer_id AND consentimiento_at IS NOT NULL)
    BEGIN RAISERROR('SIN_CONSENTIMIENTO: el paciente no ha dado su consentimiento.', 16, 1); RETURN; END
    IF ISJSON(@items) = 0 BEGIN RAISERROR('Elige al menos un estudio.', 16, 1); RETURN; END

    DECLARE @ids TABLE (n INT IDENTITY(1,1), product_id INT);
    INSERT INTO @ids (product_id)
    SELECT TRY_CONVERT(INT, productId) FROM OPENJSON(@items) WITH (productId NVARCHAR(12) '$.productId');
    IF NOT EXISTS (SELECT 1 FROM @ids) BEGIN RAISERROR('Elige al menos un estudio.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @ids i WHERE NOT EXISTS (
        SELECT 1 FROM dbo.salud_estudios e JOIN dbo.products p ON p.id = e.product_id
         WHERE e.product_id = i.product_id AND p.active = 1))
    BEGIN RAISERROR('Uno de los estudios ya no está en el catálogo.', 16, 1); RETURN; END

    BEGIN TRAN;
    INSERT INTO dbo.salud_estudio_ordenes (paciente_id, medico, indicaciones, created_by)
    VALUES (@customer_id, NULLIF(LTRIM(RTRIM(@medico)), N''), NULLIF(LTRIM(RTRIM(@indicaciones)), N''), @user_id);
    DECLARE @id INT = SCOPE_IDENTITY();

    INSERT INTO dbo.salud_estudio_items (orden_id, product_id, nombre, tipo, modalidad, parametros, precio)
    SELECT @id, e.product_id, p.nombre, e.tipo, e.modalidad, e.parametros, p.price
      FROM @ids i
      JOIN dbo.salud_estudios e ON e.product_id = i.product_id
      JOIN dbo.products p ON p.id = e.product_id
     ORDER BY i.n;

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion) VALUES (@user_id, @customer_id, N'ESTUDIO');
    COMMIT;

    SELECT o.id, o.folio FROM dbo.salud_estudio_ordenes o WHERE o.id = @id;
    SELECT i.id, i.product_id, i.nombre, i.precio FROM dbo.salud_estudio_items i WHERE i.orden_id = @id ORDER BY i.id;
END
GO

/* ---------- sp_salud_estudio_orden_vincular (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_estudio_orden_vincular
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Enlaza la orden de estudios con la orden de servicio con la que se cobra.
 * Una sola vez.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_orden_vincular]
    @id       INT,
    @orden_id INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.service_orders WHERE id = @orden_id)
    BEGIN RAISERROR('La orden de servicio no existe.', 16, 1); RETURN; END
    UPDATE dbo.salud_estudio_ordenes SET orden_id = @orden_id WHERE id = @id AND orden_id IS NULL;
    IF @@ROWCOUNT = 0 BEGIN RAISERROR('La orden de estudios no existe o ya tiene cobro.', 16, 1); RETURN; END
    SELECT @id AS id, @orden_id AS orden_id;
END
GO

/* ---------- sp_salud_estudio_ordenes (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_estudio_ordenes
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Las órdenes de estudios: la lista de trabajo (por estado) o las de un
 * paciente. Con @id devuelve UNA orden con sus estudios completos y lo anota
 * en la bitácora (abrir resultados es abrir el expediente).
 *
 * Conjuntos: 1) órdenes  2) estudios de esas órdenes.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_ordenes]
    @id          INT           = NULL,
    @customer_id INT           = NULL,
    @estado      NVARCHAR(12)  = NULL,
    @buscar      NVARCHAR(100) = NULL,
    @top         INT           = 100,
    @user_id     INT           = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @buscar = NULLIF(LTRIM(RTRIM(@buscar)), N'');
    SET @estado = NULLIF(UPPER(LTRIM(RTRIM(@estado))), N'');
    IF @top IS NULL OR @top NOT BETWEEN 1 AND 500 SET @top = 100;

    DECLARE @o TABLE (id INT PRIMARY KEY);
    INSERT INTO @o (id)
    SELECT TOP (@top) o.id
      FROM dbo.salud_estudio_ordenes o
      JOIN dbo.customers c ON c.id = o.paciente_id
     WHERE (@id IS NULL OR o.id = @id)
       AND (@customer_id IS NULL OR o.paciente_id = @customer_id)
       AND (@estado IS NULL OR o.estado = @estado)
       AND (@buscar IS NULL OR c.customerName LIKE N'%' + @buscar + N'%'
            OR o.folio LIKE N'%' + @buscar + N'%')
     ORDER BY o.created_at DESC, o.id DESC;

    IF @id IS NOT NULL AND EXISTS (SELECT 1 FROM @o)
        INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion)
        SELECT @user_id, paciente_id, N'VER' FROM dbo.salud_estudio_ordenes WHERE id = @id;

    SELECT o.id, o.folio, o.paciente_id, c.customerName AS paciente, c.birthdate AS fecha_nacimiento, p.sexo,
           o.medico, o.indicaciones, o.estado, o.orden_id, so.folio AS orden_folio, so.status AS orden_status,
           o.created_at, uc.usuario AS creado_por, o.entregado_at, ue.usuario AS entregado_por,
           (SELECT COUNT(*) FROM dbo.salud_estudio_items i WHERE i.orden_id = o.id AND i.estado <> N'CANCELADO') AS estudios,
           (SELECT COUNT(*) FROM dbo.salud_estudio_items i WHERE i.orden_id = o.id AND i.estado = N'VALIDADO') AS validados,
           (SELECT SUM(i.precio) FROM dbo.salud_estudio_items i WHERE i.orden_id = o.id AND i.estado <> N'CANCELADO') AS total
      FROM dbo.salud_estudio_ordenes o
      JOIN @o x ON x.id = o.id
      JOIN dbo.customers c ON c.id = o.paciente_id
      LEFT JOIN dbo.salud_pacientes p ON p.customer_id = o.paciente_id
      LEFT JOIN dbo.service_orders so ON so.id = o.orden_id
      LEFT JOIN dbo.users uc ON uc.id = o.created_by
      LEFT JOIN dbo.users ue ON ue.id = o.entregado_por
     ORDER BY o.created_at DESC, o.id DESC;

    SELECT i.id, i.orden_id, i.product_id, i.nombre, i.tipo, i.modalidad, i.precio, i.estado,
           i.tomado_at, i.capturado_at, uc.usuario AS capturado_por, i.validado_at, uv.usuario AS validado_por,
           CASE WHEN @id IS NOT NULL THEN i.parametros END AS parametros,
           CASE WHEN @id IS NOT NULL THEN i.resultados END AS resultados,
           CASE WHEN @id IS NOT NULL THEN i.hallazgos END AS hallazgos,
           CASE WHEN @id IS NOT NULL THEN i.conclusion END AS conclusion,
           i.birads,
           CASE WHEN @id IS NOT NULL THEN i.firmante END AS firmante,
           CONVERT(VARCHAR(66), i.huella, 1) AS huella
      FROM dbo.salud_estudio_items i
      JOIN @o x ON x.id = i.orden_id
      LEFT JOIN dbo.users uc ON uc.id = i.capturado_por
      LEFT JOIN dbo.users uv ON uv.id = i.validado_por
     ORDER BY i.orden_id, i.id;
END
GO

/* ---------- sp_salud_estudio_validar (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_estudio_validar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Firma el resultado. Lo hace un profesional con cédula (el químico o el
 * radiólogo responsable): su copia queda en `firmante` y la huella SHA-256
 * del resultado permite demostrar después que no cambió. Desde aquí el
 * estudio no se toca (TR_salud_estudio_items_inmutable).
 *
 * Cuando todos los estudios vivos de la orden están validados, la orden
 * queda LISTA para entregarse.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudio_validar]
    @item_id INT,
    @user_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;
    DECLARE @estado NVARCHAR(12), @orden INT, @pac INT, @res NVARCHAR(MAX), @hall NVARCHAR(MAX), @concl NVARCHAR(1000), @birads TINYINT;
    SELECT @estado = i.estado, @orden = i.orden_id, @pac = o.paciente_id,
           @res = i.resultados, @hall = i.hallazgos, @concl = i.conclusion, @birads = i.birads
      FROM dbo.salud_estudio_items i WITH (UPDLOCK)
      JOIN dbo.salud_estudio_ordenes o ON o.id = i.orden_id
     WHERE i.id = @item_id;
    IF @estado IS NULL BEGIN ROLLBACK; RAISERROR('El estudio no existe.', 16, 1); RETURN; END
    IF @estado = N'VALIDADO' BEGIN ROLLBACK; RAISERROR('ESTUDIO_VALIDADO: ya estaba validado.', 16, 1); RETURN; END
    IF @estado <> N'CAPTURADO' BEGIN ROLLBACK; RAISERROR('Primero captura el resultado.', 16, 1); RETURN; END

    DECLARE @firmante NVARCHAR(MAX) = (
        SELECT p.nombre, p.cedula, p.institucion, p.especialidad, p.cedula_especialidad,
               b.business_name AS establecimiento, b.address AS domicilio, b.phone AS telefono
          FROM dbo.salud_profesionales p
          OUTER APPLY (SELECT TOP 1 business_name, address, phone FROM dbo.business_config ORDER BY id) b
         WHERE p.user_id = @user_id
           FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
    IF @firmante IS NULL
    BEGIN
        ROLLBACK;
        RAISERROR('SIN_CEDULA: valida quien tiene cédula profesional. Captura la tuya en «Mis datos de firma».', 16, 1);
        RETURN;
    END

    DECLARE @at DATETIME2(0) = SYSDATETIME();
    DECLARE @huella VARBINARY(32) = HASHBYTES('SHA2_256', CONCAT(
        ISNULL(@res, N'[]'), N'|', ISNULL(@hall, N''), N'|', ISNULL(@concl, N''), N'|', ISNULL(CONVERT(NVARCHAR(3), @birads), N''),
        N'|', @user_id, N'|', @firmante, N'|', CONVERT(NVARCHAR(30), @at, 126)));

    UPDATE dbo.salud_estudio_items
       SET estado = N'VALIDADO', validado_at = @at, validado_por = @user_id, firmante = @firmante, huella = @huella
     WHERE id = @item_id;

    UPDATE dbo.salud_estudio_ordenes SET estado = N'LISTA'
     WHERE id = @orden AND estado = N'ABIERTA'
       AND NOT EXISTS (SELECT 1 FROM dbo.salud_estudio_items WHERE orden_id = @orden AND estado NOT IN (N'VALIDADO', N'CANCELADO'));

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion) VALUES (@user_id, @pac, N'VALIDAR');
    COMMIT;

    SELECT i.id, i.estado, i.validado_at, CONVERT(VARCHAR(66), i.huella, 1) AS huella, o.estado AS orden_estado
      FROM dbo.salud_estudio_items i JOIN dbo.salud_estudio_ordenes o ON o.id = i.orden_id
     WHERE i.id = @item_id;
END
GO

/* ---------- sp_salud_expediente_get (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_expediente_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El expediente de un paciente. Cada apertura queda en la bitácora: leer un
 * expediente es un acceso a datos sensibles, no una consulta cualquiera.
 *
 * Cuatro conjuntos, en este orden:
 *   1. ficha     cliente + datos clínicos + testigo de versión
 *   2. documentos los 200 más recientes (sin el contenido de los que no se
 *                 piden: la lista no necesita el JSON completo)
 *   3. diagnósticos de esos documentos
 *   4. adendas de esos documentos
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_expediente_get]
    @customer_id INT,
    @user_id     INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id)
    BEGIN RAISERROR('El paciente no existe.', 16, 1); RETURN; END

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion) VALUES (@user_id, @customer_id, N'VER');

    SELECT c.id AS customer_id, c.customerName AS nombre, COALESCE(c.mobile, c.phone) AS telefono,
           c.email, c.birthdate AS fecha_nacimiento,
           p.curp, p.sexo, p.tutor, p.contacto_emergencia, p.grupo_sanguineo, p.alergias, p.antecedentes,
           p.consentimiento_at, p.consentimiento_por,
           CAST(CASE WHEN p.customer_id IS NULL THEN 0 ELSE 1 END AS BIT) AS es_paciente,
           CONVERT(VARCHAR(18), p.version, 1) AS version
      FROM dbo.customers c
      LEFT JOIN dbo.salud_pacientes p ON p.customer_id = c.id
     WHERE c.id = @customer_id;

    DECLARE @docs TABLE (id INT PRIMARY KEY);
    INSERT INTO @docs (id)
    SELECT TOP (200) id FROM dbo.salud_documentos WHERE paciente_id = @customer_id ORDER BY created_at DESC, id DESC;

    SELECT d.id, d.tipo, d.titulo, d.contenido, d.estado, d.autor_id, ua.usuario AS autor,
           d.cita_id, d.orden_id, d.created_at, d.updated_at, d.firmado_at, uf.usuario AS firmado_por,
           CONVERT(VARCHAR(66), d.huella, 1) AS huella, d.firmante
      FROM dbo.salud_documentos d
      JOIN @docs x ON x.id = d.id
      LEFT JOIN dbo.users ua ON ua.id = d.autor_id
      LEFT JOIN dbo.users uf ON uf.id = d.firmado_por
     ORDER BY d.created_at DESC, d.id DESC;

    SELECT g.id, g.documento_id, g.cie10, g.descripcion, g.principal
      FROM dbo.salud_diagnosticos g JOIN @docs x ON x.id = g.documento_id
     ORDER BY g.documento_id, g.principal DESC, g.id;

    SELECT a.id, a.documento_id, a.texto, a.at, u.usuario AS autor
      FROM dbo.salud_adendas a JOIN @docs x ON x.id = a.documento_id
      LEFT JOIN dbo.users u ON u.id = a.autor_id
     ORDER BY a.documento_id, a.at;
END
GO

/* ---------- sp_salud_farmacia_resumen (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_farmacia_resumen
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Los números de la portada de Farmacia, en una sola consulta.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_farmacia_resumen]
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);
    SELECT
      (SELECT COUNT(*) FROM dbo.salud_lotes WHERE cantidad > 0 AND caducidad <= @hoy) AS lotes_caducados,
      (SELECT COUNT(*) FROM dbo.salud_lotes WHERE cantidad > 0 AND caducidad > @hoy AND caducidad <= DATEADD(DAY, 90, @hoy)) AS lotes_por_caducar,
      (SELECT COUNT(*) FROM dbo.salud_productos WHERE requiere_receta = 1) AS con_receta,
      (SELECT COUNT(*) FROM dbo.salud_recetas_surtidas WHERE at >= @hoy) AS recetas_hoy,
      (SELECT COUNT(*) FROM dbo.salud_temperaturas WHERE at >= @hoy) AS lecturas_hoy,
      (SELECT COUNT(*) FROM dbo.salud_productos s JOIN dbo.products p ON p.id = s.product_id
        WHERE s.precio_maximo IS NOT NULL AND p.price > s.precio_maximo AND p.active = 1) AS sobre_maximo;
END
GO

/* ---------- sp_salud_libro_control (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_libro_control
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Entradas y salidas de controlados (fracciones I a III) o de antibióticos,
 * con su lote, la receta que respaldó cada salida y el saldo corrido.
 *
 * Es el AUXILIAR para llenar el libro autorizado: no está confirmado que
 * COFEPRIS acepte el libro electrónico (docs/giro-salud.md §3.1).
 *
 * El saldo se calcula sobre TODA la historia del producto y después se
 * filtra el periodo: así la primera fila del periodo arranca con el saldo
 * que de verdad traía.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_libro_control]
    @desde DATE,
    @hasta DATE,
    @tipo  NVARCHAR(12) = N'CONTROLADOS'
AS
BEGIN
    SET NOCOUNT ON;
    IF @desde IS NULL OR @hasta IS NULL OR @hasta < @desde
    BEGIN RAISERROR('Periodo inválido.', 16, 1); RETURN; END
    SET @tipo = UPPER(ISNULL(@tipo, N'CONTROLADOS'));

    ;WITH movs AS (
        SELECT m.id, m.at, m.product_id, m.lote_id, m.tipo, m.cantidad, m.sale_id, m.receta_id, m.nota, m.user_id,
               SUM(CASE WHEN m.tipo IN (N'ENTRADA', N'AJUSTE') THEN m.cantidad ELSE -m.cantidad END)
                   OVER (PARTITION BY m.product_id ORDER BY m.at, m.id ROWS UNBOUNDED PRECEDING) AS saldo
          FROM dbo.salud_lote_movimientos m
          JOIN dbo.salud_productos s ON s.product_id = m.product_id
         WHERE (@tipo = N'CONTROLADOS' AND s.es_controlado = 1)
            OR (@tipo = N'ANTIBIOTICOS' AND s.es_antibiotico = 1)
    )
    SELECT v.id AS movimiento_id, v.at, v.product_id, p.nombre, sp.sustancia_activa, sp.fraccion,
           l.lote, l.caducidad, v.tipo,
           CASE WHEN v.tipo IN (N'ENTRADA', N'AJUSTE') THEN v.cantidad ELSE 0 END AS entrada,
           CASE WHEN v.tipo IN (N'SALIDA', N'MERMA') THEN v.cantidad ELSE 0 END AS salida,
           v.saldo, v.sale_id, r.medico, r.cedula, r.fecha_receta, r.retenida, v.nota,
           u.usuario
      FROM movs v
      JOIN dbo.products p ON p.id = v.product_id
      JOIN dbo.salud_productos sp ON sp.product_id = v.product_id
      LEFT JOIN dbo.salud_lotes l ON l.id = v.lote_id
      LEFT JOIN dbo.salud_recetas_surtidas r ON r.id = v.receta_id
      LEFT JOIN dbo.users u ON u.id = v.user_id
     WHERE v.at >= @desde AND v.at < DATEADD(DAY, 1, @hasta)
     ORDER BY p.nombre, v.at, v.id;
END
GO

/* ---------- sp_salud_lote_ajustar (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_lote_ajustar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Corrige cuánto queda de un lote (conteo, lote mal capturado, caducado
 * retirado). Deja el movimiento con signo: AJUSTE suma, MERMA resta, para
 * que el libro de control pueda llevar el saldo.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_lote_ajustar]
    @lote_id        INT,
    @cantidad_nueva DECIMAL(12,3),
    @nota           NVARCHAR(200),
    @user_id        INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @nota = NULLIF(LTRIM(RTRIM(@nota)), N'');
    IF @nota IS NULL
    BEGIN RAISERROR('Escribe el motivo del ajuste.', 16, 1); RETURN; END
    IF @cantidad_nueva IS NULL OR @cantidad_nueva < 0
    BEGIN RAISERROR('La cantidad no puede ser negativa.', 16, 1); RETURN; END

    BEGIN TRAN;
    DECLARE @actual DECIMAL(12,3), @product_id INT;
    SELECT @actual = cantidad, @product_id = product_id
      FROM dbo.salud_lotes WITH (UPDLOCK, HOLDLOCK) WHERE id = @lote_id;
    IF @product_id IS NULL
    BEGIN ROLLBACK; RAISERROR('El lote no existe.', 16, 1); RETURN; END

    IF @cantidad_nueva > @actual
    BEGIN
        DECLARE @stock DECIMAL(12,3) = (SELECT CAST(ISNULL(stock, 0) AS DECIMAL(12,3)) FROM dbo.products WHERE id = @product_id);
        DECLARE @otros DECIMAL(12,3) = (SELECT ISNULL(SUM(cantidad), 0) FROM dbo.salud_lotes WHERE product_id = @product_id AND id <> @lote_id);
        IF @otros + @cantidad_nueva > @stock
        BEGIN ROLLBACK; RAISERROR('LOTES_EXCEDEN_STOCK: los lotes no pueden sumar más que la existencia.', 16, 1); RETURN; END
    END

    IF @cantidad_nueva <> @actual
    BEGIN
        UPDATE dbo.salud_lotes SET cantidad = @cantidad_nueva WHERE id = @lote_id;
        INSERT INTO dbo.salud_lote_movimientos (product_id, lote_id, tipo, cantidad, user_id, nota)
        VALUES (@product_id, @lote_id,
                CASE WHEN @cantidad_nueva > @actual THEN N'AJUSTE' ELSE N'MERMA' END,
                ABS(@cantidad_nueva - @actual), @user_id, @nota);
    END
    COMMIT;

    SELECT id AS lote_id, product_id, lote, caducidad, cantidad FROM dbo.salud_lotes WHERE id = @lote_id;
END
GO

/* ---------- sp_salud_lote_entrada (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_lote_entrada
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Asigna lote y caducidad a existencia que YA entró (por compra o conteo).
 * No suma a products.stock: el lote es trazabilidad, no otra existencia.
 * Por eso los lotes no pueden sumar más que el stock.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_lote_entrada]
    @product_id INT,
    @lote       NVARCHAR(40),
    @caducidad  DATE,
    @cantidad   DECIMAL(12,3),
    @costo      DECIMAL(14,4) = NULL,
    @nota       NVARCHAR(200) = NULL,
    @user_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @lote = UPPER(LTRIM(RTRIM(ISNULL(@lote, N''))));
    IF @lote = N''
    BEGIN RAISERROR('Escribe el número de lote.', 16, 1); RETURN; END
    IF @caducidad IS NULL
    BEGIN RAISERROR('Escribe la fecha de caducidad.', 16, 1); RETURN; END
    IF @caducidad <= CAST(GETDATE() AS DATE)
    BEGIN RAISERROR('Ese lote ya está caducado: no se puede dar de alta para venta.', 16, 1); RETURN; END
    IF ISNULL(@cantidad, 0) <= 0
    BEGIN RAISERROR('La cantidad debe ser mayor a cero.', 16, 1); RETURN; END

    BEGIN TRAN;

    DECLARE @stock DECIMAL(12,3) = (SELECT CAST(ISNULL(stock, 0) AS DECIMAL(12,3))
                                      FROM dbo.products WITH (UPDLOCK, HOLDLOCK) WHERE id = @product_id);
    IF @stock IS NULL
    BEGIN ROLLBACK; RAISERROR('El producto no existe.', 16, 1); RETURN; END

    DECLARE @en_lotes DECIMAL(12,3) = (SELECT ISNULL(SUM(cantidad), 0)
                                         FROM dbo.salud_lotes WITH (UPDLOCK, HOLDLOCK) WHERE product_id = @product_id);
    IF @en_lotes + @cantidad > @stock
    BEGIN
        ROLLBACK;
        DECLARE @msg NVARCHAR(300) = CONCAT(
            N'LOTES_EXCEDEN_STOCK: la existencia es ', FORMAT(@stock, 'N0'), N' y ya hay ',
            FORMAT(@en_lotes, 'N0'), N' con lote. Registra primero la compra.');
        RAISERROR(@msg, 16, 1);
        RETURN;
    END

    /* Si el producto aún no tiene ficha, nace con control de lotes. */
    IF NOT EXISTS (SELECT 1 FROM dbo.salud_productos WHERE product_id = @product_id)
        INSERT INTO dbo.salud_productos (product_id, controla_lotes, updated_by) VALUES (@product_id, 1, @user_id);

    DECLARE @lote_id INT = (SELECT id FROM dbo.salud_lotes
                             WHERE product_id = @product_id AND lote = @lote AND caducidad = @caducidad);
    IF @lote_id IS NULL
    BEGIN
        INSERT INTO dbo.salud_lotes (product_id, lote, caducidad, cantidad, costo)
        VALUES (@product_id, @lote, @caducidad, @cantidad, @costo);
        SET @lote_id = SCOPE_IDENTITY();
    END
    ELSE
        UPDATE dbo.salud_lotes SET cantidad = cantidad + @cantidad, costo = ISNULL(@costo, costo)
         WHERE id = @lote_id;

    INSERT INTO dbo.salud_lote_movimientos (product_id, lote_id, tipo, cantidad, user_id, nota)
    VALUES (@product_id, @lote_id, N'ENTRADA', @cantidad, @user_id, NULLIF(LTRIM(RTRIM(@nota)), N''));

    COMMIT;

    SELECT id AS lote_id, product_id, lote, caducidad, cantidad FROM dbo.salud_lotes WHERE id = @lote_id;
END
GO

/* ---------- sp_salud_lotes_list (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_lotes_list
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Lotes con existencia. Con @dias: solo los que caducan dentro de ese plazo
 * (incluidos los ya caducados), ordenados por el que vence primero.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_lotes_list]
    @product_id INT = NULL,
    @dias       INT = NULL,
    @top        INT = 300
AS
BEGIN
    SET NOCOUNT ON;
    IF @top IS NULL OR @top NOT BETWEEN 1 AND 2000 SET @top = 300;
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);

    SELECT TOP (@top)
           l.id AS lote_id, l.product_id, p.nombre, p.part_number, l.lote, l.caducidad,
           l.cantidad, l.costo, DATEDIFF(DAY, @hoy, l.caducidad) AS dias_restantes,
           CAST(CASE WHEN l.caducidad <= @hoy THEN 1 ELSE 0 END AS BIT) AS caducado
      FROM dbo.salud_lotes l
      JOIN dbo.products p ON p.id = l.product_id
     WHERE l.cantidad > 0
       AND (@product_id IS NULL OR l.product_id = @product_id)
       AND (@dias IS NULL OR l.caducidad <= DATEADD(DAY, @dias, @hoy))
     ORDER BY l.caducidad, p.nombre, l.id;
END
GO

/* ---------- sp_salud_odontograma_get (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_odontograma_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El estado ACTUAL de cada diente y cara (la última marca) y, aparte, el
 * historial reciente. Lo actual sale del índice IX_salud_odontograma_actual
 * sin ordenar toda la historia.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_odontograma_get]
    @customer_id INT,
    @historial   INT = 100
AS
BEGIN
    SET NOCOUNT ON;
    IF @historial IS NULL OR @historial NOT BETWEEN 0 AND 1000 SET @historial = 100;

    ;WITH ult AS (
        SELECT o.diente, o.cara, o.estado, o.nota, o.at,
               ROW_NUMBER() OVER (PARTITION BY o.diente, o.cara ORDER BY o.id DESC) AS rn
          FROM dbo.salud_odontograma o
         WHERE o.paciente_id = @customer_id
    )
    SELECT diente, cara, estado, nota, at FROM ult WHERE rn = 1 AND estado <> N'SANO'
     ORDER BY diente, cara;

    SELECT TOP (@historial) o.id, o.diente, o.cara, o.estado, o.nota, o.at, u.usuario
      FROM dbo.salud_odontograma o
      LEFT JOIN dbo.users u ON u.id = o.user_id
     WHERE o.paciente_id = @customer_id
     ORDER BY o.id DESC;
END
GO

/* ---------- sp_salud_odontograma_marcar (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_odontograma_marcar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Agrega las marcas de una visita. Nunca reescribe las anteriores: el
 * odontograma de hoy se lee como la última marca de cada diente y cara.
 *
 * @marcas: JSON [{ "diente": 36, "cara": "O", "estado": "CARIES", "nota": "" }]
 * Marcar SANO es la forma de decir «ya se resolvió».
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_odontograma_marcar]
    @customer_id INT,
    @marcas      NVARCHAR(MAX),
    @user_id     INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @marcas IS NULL OR ISJSON(@marcas) <> 1
    BEGIN RAISERROR('Marcas inválidas.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.salud_pacientes WHERE customer_id = @customer_id AND consentimiento_at IS NOT NULL)
    BEGIN RAISERROR('SIN_CONSENTIMIENTO: el paciente no ha dado su consentimiento para el tratamiento de sus datos.', 16, 1); RETURN; END

    DECLARE @m TABLE (diente TINYINT, cara NVARCHAR(2), estado NVARCHAR(20), nota NVARCHAR(200));
    INSERT INTO @m (diente, cara, estado, nota)
    SELECT TRY_CAST(j.diente AS TINYINT), UPPER(LTRIM(RTRIM(j.cara))), UPPER(LTRIM(RTRIM(j.estado))),
           NULLIF(LTRIM(RTRIM(j.nota)), N'')
      FROM OPENJSON(@marcas)
           WITH (diente NVARCHAR(5) '$.diente', cara NVARCHAR(5) '$.cara',
                 estado NVARCHAR(30) '$.estado', nota NVARCHAR(200) '$.nota') j;

    IF NOT EXISTS (SELECT 1 FROM @m)
    BEGIN RAISERROR('No hay marcas que guardar.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @m WHERE diente IS NULL)
    BEGIN RAISERROR('Diente inválido.', 16, 1); RETURN; END

    BEGIN TRAN;
    /* Los CHECK de la tabla validan diente FDI, cara y estado: un valor raro
       revienta aquí con su nombre de restricción y no se guarda nada. */
    INSERT INTO dbo.salud_odontograma (paciente_id, diente, cara, estado, nota, user_id)
    SELECT @customer_id, diente, cara, estado, nota, @user_id FROM @m;
    DECLARE @guardadas INT = @@ROWCOUNT;

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion)
    VALUES (@user_id, @customer_id, N'ODONTOGRAMA');
    COMMIT;

    SELECT @guardadas AS guardadas;
END
GO

/* ---------- sp_salud_paciente_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_paciente_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Da de alta o actualiza la ficha clínica de un paciente.
 *
 * Sin @customer_id crea primero el CLIENTE por sp_create_customer, la misma
 * puerta que usa el resto de Wybix: el paciente es un cliente con ficha.
 *
 * EL CONSENTIMIENTO se guarda una vez, con fecha y quién lo recabó. Sin él
 * no se escribe nada clínico (LFPDPPP 2025: datos sensibles).
 *
 * @version: el testigo que la pantalla leyó. Si otro lo cambió mientras
 * tanto, no se pisa: CONFLICTO_DE_VERSION.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_paciente_save]
    @customer_id         INT            = NULL,
    @nombre              NVARCHAR(120),
    @telefono            NVARCHAR(30)   = NULL,
    @email               NVARCHAR(120)  = NULL,
    @fecha_nacimiento    DATE           = NULL,
    @curp                NVARCHAR(18)   = NULL,
    @sexo                CHAR(1)        = NULL,
    @tutor               NVARCHAR(120)  = NULL,
    @contacto_emergencia NVARCHAR(160)  = NULL,
    @grupo_sanguineo     NVARCHAR(5)    = NULL,
    @alergias            NVARCHAR(600)  = NULL,
    @antecedentes        NVARCHAR(MAX)  = NULL,
    @consentimiento      BIT            = 0,
    @version             BINARY(8)      = NULL,
    @user_id             INT            = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @nombre = NULLIF(LTRIM(RTRIM(@nombre)), N'');
    SET @curp = NULLIF(UPPER(LTRIM(RTRIM(@curp))), N'');
    SET @sexo = NULLIF(UPPER(LTRIM(RTRIM(@sexo))), '');
    SET @alergias = NULLIF(LTRIM(RTRIM(@alergias)), N'');
    IF @nombre IS NULL BEGIN RAISERROR('Escribe el nombre del paciente.', 16, 1); RETURN; END
    IF @curp IS NOT NULL AND (LEN(@curp) <> 18 OR @curp LIKE N'%[^A-Z0-9]%')
    BEGIN RAISERROR('La CURP tiene 18 letras y números.', 16, 1); RETURN; END
    IF @sexo IS NOT NULL AND @sexo NOT IN ('F', 'M', 'X')
    BEGIN RAISERROR('Sexo inválido.', 16, 1); RETURN; END
    IF @antecedentes IS NOT NULL AND ISJSON(@antecedentes) <> 1
    BEGIN RAISERROR('Antecedentes inválidos.', 16, 1); RETURN; END
    IF @fecha_nacimiento IS NOT NULL AND @fecha_nacimiento > CAST(GETDATE() AS DATE)
    BEGIN RAISERROR('La fecha de nacimiento no puede ser futura.', 16, 1); RETURN; END
    IF @curp IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.salud_pacientes WHERE curp = @curp AND customer_id <> ISNULL(@customer_id, -1))
    BEGIN RAISERROR('Ya hay otro paciente con esa CURP.', 16, 1); RETURN; END

    BEGIN TRAN;

    DECLARE @nuevo BIT = 0;
    IF @customer_id IS NULL
    BEGIN
        EXEC dbo.sp_create_customer @customerName = @nombre, @phone = @telefono, @mobile = @telefono,
             @email = @email, @birthdate = @fecha_nacimiento, @NewId = @customer_id OUTPUT;
        SET @nuevo = 1;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.customers WITH (UPDLOCK) WHERE id = @customer_id)
        BEGIN ROLLBACK; RAISERROR('El cliente no existe.', 16, 1); RETURN; END
        UPDATE dbo.customers
           SET customerName = @nombre,
               phone = COALESCE(@telefono, phone), mobile = COALESCE(@telefono, mobile),
               email = COALESCE(@email, email), birthdate = COALESCE(@fecha_nacimiento, birthdate),
               updated_at = SYSDATETIME()
         WHERE id = @customer_id;
    END

    IF EXISTS (SELECT 1 FROM dbo.salud_pacientes WITH (UPDLOCK) WHERE customer_id = @customer_id)
    BEGIN
        IF @version IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM dbo.salud_pacientes WHERE customer_id = @customer_id AND version = @version)
        BEGIN ROLLBACK; RAISERROR('CONFLICTO_DE_VERSION', 16, 1); RETURN; END

        UPDATE dbo.salud_pacientes
           SET curp = @curp, sexo = @sexo, tutor = NULLIF(LTRIM(RTRIM(@tutor)), N''),
               contacto_emergencia = NULLIF(LTRIM(RTRIM(@contacto_emergencia)), N''),
               grupo_sanguineo = NULLIF(LTRIM(RTRIM(@grupo_sanguineo)), N''),
               alergias = @alergias, antecedentes = @antecedentes,
               consentimiento_at = CASE WHEN consentimiento_at IS NULL AND @consentimiento = 1 THEN SYSDATETIME() ELSE consentimiento_at END,
               consentimiento_por = CASE WHEN consentimiento_at IS NULL AND @consentimiento = 1 THEN @user_id ELSE consentimiento_por END,
               updated_at = SYSDATETIME()
         WHERE customer_id = @customer_id;
    END
    ELSE
        INSERT INTO dbo.salud_pacientes
            (customer_id, curp, sexo, tutor, contacto_emergencia, grupo_sanguineo, alergias, antecedentes,
             consentimiento_at, consentimiento_por)
        VALUES (@customer_id, @curp, @sexo, NULLIF(LTRIM(RTRIM(@tutor)), N''),
                NULLIF(LTRIM(RTRIM(@contacto_emergencia)), N''), NULLIF(LTRIM(RTRIM(@grupo_sanguineo)), N''),
                @alergias, @antecedentes,
                CASE WHEN @consentimiento = 1 THEN SYSDATETIME() END,
                CASE WHEN @consentimiento = 1 THEN @user_id END);

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion)
    VALUES (@user_id, @customer_id, CASE WHEN @nuevo = 1 THEN N'ALTA' ELSE N'FICHA' END);

    COMMIT;

    SELECT @customer_id AS customer_id;
END
GO

/* ---------- sp_salud_pacientes_buscar (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_pacientes_buscar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Busca entre los clientes por nombre, teléfono o CURP. Devuelve si ya es
 * paciente (tiene ficha clínica) y su última atención, para que la
 * recepción encuentre a la persona sin abrir su expediente.
 *
 * No devuelve nada clínico salvo las alergias: son lo único que quien
 * recibe al paciente necesita ver antes que nada.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_pacientes_buscar]
    @buscar NVARCHAR(100) = NULL,
    @top    INT = 50
AS
BEGIN
    SET NOCOUNT ON;
    SET @buscar = NULLIF(LTRIM(RTRIM(@buscar)), N'');
    IF @top IS NULL OR @top NOT BETWEEN 1 AND 500 SET @top = 50;
    DECLARE @patron NVARCHAR(110) = N'%' + @buscar + N'%';

    SELECT TOP (@top)
           c.id AS customer_id, c.customerName AS nombre, COALESCE(c.mobile, c.phone) AS telefono,
           c.birthdate AS fecha_nacimiento, c.email,
           p.curp, p.sexo, p.alergias,
           CAST(CASE WHEN p.customer_id IS NULL THEN 0 ELSE 1 END AS BIT) AS es_paciente,
           CAST(CASE WHEN p.consentimiento_at IS NULL THEN 0 ELSE 1 END AS BIT) AS con_consentimiento,
           (SELECT MAX(d.created_at) FROM dbo.salud_documentos d WHERE d.paciente_id = c.id) AS ultima_atencion
      FROM dbo.customers c
      LEFT JOIN dbo.salud_pacientes p ON p.customer_id = c.id
     WHERE c.active = 1
       AND (@buscar IS NULL
            OR c.customerName LIKE @patron
            OR c.phone LIKE @patron OR c.mobile LIKE @patron
            OR p.curp = UPPER(@buscar))
     ORDER BY CASE WHEN p.customer_id IS NULL THEN 1 ELSE 0 END,
              (SELECT MAX(d.created_at) FROM dbo.salud_documentos d WHERE d.paciente_id = c.id) DESC,
              c.customerName;
END
GO

/* ---------- sp_salud_plan_estado (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_plan_estado
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Mueve un plan: ACEPTADO (con la orden de servicio que lo cobra),
 * CANCELADO o TERMINADO. Las transiciones válidas viven aquí:
 *   PROPUESTO -> ACEPTADO | CANCELADO
 *   ACEPTADO  -> TERMINADO | CANCELADO
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_plan_estado]
    @id       INT,
    @estado   NVARCHAR(12),
    @orden_id INT = NULL,
    @user_id  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @estado = UPPER(LTRIM(RTRIM(ISNULL(@estado, N''))));

    BEGIN TRAN;
    DECLARE @actual NVARCHAR(12), @pac INT;
    SELECT @actual = estado, @pac = paciente_id FROM dbo.salud_planes WITH (UPDLOCK) WHERE id = @id;
    IF @actual IS NULL BEGIN ROLLBACK; RAISERROR('El plan no existe.', 16, 1); RETURN; END

    IF NOT ((@actual = N'PROPUESTO' AND @estado IN (N'ACEPTADO', N'CANCELADO'))
         OR (@actual = N'ACEPTADO' AND @estado IN (N'TERMINADO', N'CANCELADO')))
    BEGIN
        ROLLBACK;
        DECLARE @msg NVARCHAR(200) = CONCAT(N'Un plan ', LOWER(@actual), N' no puede pasar a ', LOWER(@estado), N'.');
        RAISERROR(@msg, 16, 1);
        RETURN;
    END
    IF @estado = N'ACEPTADO' AND @orden_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.service_orders WHERE id = @orden_id AND customer_id = @pac)
    BEGIN ROLLBACK; RAISERROR('La orden de servicio no es de este paciente.', 16, 1); RETURN; END

    UPDATE dbo.salud_planes
       SET estado = @estado,
           orden_id = CASE WHEN @estado = N'ACEPTADO' THEN @orden_id ELSE orden_id END,
           aceptado_at = CASE WHEN @estado = N'ACEPTADO' THEN SYSDATETIME() ELSE aceptado_at END
     WHERE id = @id;

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion) VALUES (@user_id, @pac, N'PLAN');
    COMMIT;

    SELECT id, estado, orden_id, aceptado_at FROM dbo.salud_planes WHERE id = @id;
END
GO

/* ---------- sp_salud_plan_guardar (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_plan_guardar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Crea o reescribe un plan de tratamiento PROPUESTO con sus procedimientos.
 * Aceptado ya no se reescribe: lo que el paciente aceptó es lo que se cobra.
 *
 * @items: JSON [{ "fase": 1, "diente": 36, "procedimiento": "Resina", "productId": 12, "precio": 650 }]
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_plan_guardar]
    @id          INT           = NULL,
    @customer_id INT,
    @titulo      NVARCHAR(120),
    @items       NVARCHAR(MAX),
    @user_id     INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @titulo = NULLIF(LTRIM(RTRIM(@titulo)), N'');
    IF @titulo IS NULL BEGIN RAISERROR('Ponle nombre al plan.', 16, 1); RETURN; END
    IF @items IS NULL OR ISJSON(@items) <> 1 BEGIN RAISERROR('Procedimientos inválidos.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.salud_pacientes WHERE customer_id = @customer_id AND consentimiento_at IS NOT NULL)
    BEGIN RAISERROR('SIN_CONSENTIMIENTO: el paciente no ha dado su consentimiento para el tratamiento de sus datos.', 16, 1); RETURN; END

    DECLARE @it TABLE (fase TINYINT, diente TINYINT, procedimiento NVARCHAR(160), product_id INT, precio DECIMAL(10,2));
    INSERT INTO @it
    SELECT ISNULL(TRY_CAST(j.fase AS TINYINT), 1), TRY_CAST(j.diente AS TINYINT),
           LEFT(LTRIM(RTRIM(j.procedimiento)), 160), TRY_CAST(j.productId AS INT), TRY_CAST(j.precio AS DECIMAL(10,2))
      FROM OPENJSON(@items)
           WITH (fase NVARCHAR(5) '$.fase', diente NVARCHAR(5) '$.diente', procedimiento NVARCHAR(400) '$.procedimiento',
                 productId NVARCHAR(12) '$.productId', precio NVARCHAR(20) '$.precio') j;

    IF NOT EXISTS (SELECT 1 FROM @it)
    BEGIN RAISERROR('El plan necesita al menos un procedimiento.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @it WHERE NULLIF(procedimiento, N'') IS NULL OR precio IS NULL OR precio < 0)
    BEGIN RAISERROR('Cada procedimiento necesita nombre y precio.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @it i WHERE i.product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.products p WHERE p.id = i.product_id))
    BEGIN RAISERROR('Uno de los servicios del plan ya no existe.', 16, 1); RETURN; END

    BEGIN TRAN;
    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.salud_planes (paciente_id, titulo, created_by) VALUES (@customer_id, @titulo, @user_id);
        SET @id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        DECLARE @estado NVARCHAR(12), @pac INT;
        SELECT @estado = estado, @pac = paciente_id FROM dbo.salud_planes WITH (UPDLOCK) WHERE id = @id;
        IF @estado IS NULL OR @pac <> @customer_id BEGIN ROLLBACK; RAISERROR('El plan no existe.', 16, 1); RETURN; END
        IF @estado <> N'PROPUESTO' BEGIN ROLLBACK; RAISERROR('Un plan aceptado ya no se cambia.', 16, 1); RETURN; END
        UPDATE dbo.salud_planes SET titulo = @titulo WHERE id = @id;
        DELETE FROM dbo.salud_plan_items WHERE plan_id = @id;
    END

    INSERT INTO dbo.salud_plan_items (plan_id, fase, diente, procedimiento, product_id, precio)
    SELECT @id, fase, diente, procedimiento, product_id, precio FROM @it;

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion) VALUES (@user_id, @customer_id, N'PLAN');
    COMMIT;

    SELECT @id AS id;
END
GO

/* ---------- sp_salud_plan_item_hecho (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_plan_item_hecho
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Marca un procedimiento como hecho (o lo desmarca). Cuando todos están
 * hechos, el plan se termina solo: nadie tiene que acordarse de cerrarlo.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_plan_item_hecho]
    @item_id INT,
    @hecho   BIT,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRAN;
    DECLARE @plan INT, @estado NVARCHAR(12), @pac INT;
    SELECT @plan = i.plan_id, @estado = pl.estado, @pac = pl.paciente_id
      FROM dbo.salud_plan_items i WITH (UPDLOCK)
      JOIN dbo.salud_planes pl WITH (UPDLOCK) ON pl.id = i.plan_id
     WHERE i.id = @item_id;
    IF @plan IS NULL BEGIN ROLLBACK; RAISERROR('El procedimiento no existe.', 16, 1); RETURN; END
    IF @estado NOT IN (N'ACEPTADO', N'TERMINADO')
    BEGIN ROLLBACK; RAISERROR('Solo se avanza un plan aceptado.', 16, 1); RETURN; END

    UPDATE dbo.salud_plan_items
       SET estado = CASE WHEN @hecho = 1 THEN N'HECHO' ELSE N'PENDIENTE' END,
           hecho_at = CASE WHEN @hecho = 1 THEN SYSDATETIME() END
     WHERE id = @item_id;

    UPDATE dbo.salud_planes
       SET estado = CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.salud_plan_items WHERE plan_id = @plan AND estado = N'PENDIENTE')
                         THEN N'TERMINADO' ELSE N'ACEPTADO' END
     WHERE id = @plan;

    INSERT INTO dbo.salud_bitacora (user_id, paciente_id, accion) VALUES (@user_id, @pac, N'PLAN');
    COMMIT;

    SELECT pl.id AS plan_id, pl.estado FROM dbo.salud_planes pl WHERE pl.id = @plan;
END
GO

/* ---------- sp_salud_planes_get (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_planes_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Los planes de tratamiento de un paciente con su total y avance, y sus
 * procedimientos. Dos conjuntos.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_planes_get]
    @customer_id INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT pl.id, pl.titulo, pl.estado, pl.orden_id, pl.created_at, pl.aceptado_at,
           ISNULL(SUM(i.precio), 0) AS total,
           COUNT(i.id) AS procedimientos,
           SUM(CASE WHEN i.estado = N'HECHO' THEN 1 ELSE 0 END) AS hechos
      FROM dbo.salud_planes pl
      LEFT JOIN dbo.salud_plan_items i ON i.plan_id = pl.id
     WHERE pl.paciente_id = @customer_id
     GROUP BY pl.id, pl.titulo, pl.estado, pl.orden_id, pl.created_at, pl.aceptado_at
     ORDER BY pl.created_at DESC, pl.id DESC;

    SELECT i.id, i.plan_id, i.fase, i.diente, i.procedimiento, i.product_id, i.precio, i.estado, i.hecho_at
      FROM dbo.salud_plan_items i
      JOIN dbo.salud_planes pl ON pl.id = i.plan_id
     WHERE pl.paciente_id = @customer_id
     ORDER BY i.plan_id, i.fase, i.id;
END
GO

/* ---------- sp_salud_producto_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_producto_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* La ficha sanitaria de un producto: fracción (art. 226 LGS), si es
 * antibiótico, sustancia activa, registro sanitario y precio máximo.
 * Si requiere receta lo DERIVA la tabla (columna calculada): no se guarda
 * aparte para que no pueda contradecir a la fracción.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_producto_save]
    @product_id         INT,
    @fraccion           TINYINT       = NULL,
    @es_antibiotico     BIT           = 0,
    @sustancia_activa   NVARCHAR(160) = NULL,
    @presentacion       NVARCHAR(120) = NULL,
    @registro_sanitario NVARCHAR(40)  = NULL,
    @refrigeracion      BIT           = 0,
    @precio_maximo      DECIMAL(10,2) = NULL,
    @controla_lotes     BIT           = 1,
    @user_id            INT           = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
    BEGIN
        RAISERROR('El producto no existe.', 16, 1);
        RETURN;
    END
    IF @fraccion IS NOT NULL AND @fraccion NOT BETWEEN 1 AND 6
    BEGIN
        RAISERROR('La fracción va de I a VI.', 16, 1);
        RETURN;
    END
    IF @precio_maximo IS NOT NULL AND @precio_maximo < 0
    BEGIN
        RAISERROR('El precio máximo no puede ser negativo.', 16, 1);
        RETURN;
    END

    SET @sustancia_activa = NULLIF(LTRIM(RTRIM(@sustancia_activa)), N'');
    SET @presentacion = NULLIF(LTRIM(RTRIM(@presentacion)), N'');
    SET @registro_sanitario = NULLIF(LTRIM(RTRIM(@registro_sanitario)), N'');

    MERGE dbo.salud_productos AS d
    USING (SELECT @product_id AS product_id) AS s ON d.product_id = s.product_id
     WHEN MATCHED THEN
          UPDATE SET fraccion = @fraccion, es_antibiotico = ISNULL(@es_antibiotico, 0),
                     sustancia_activa = @sustancia_activa, presentacion = @presentacion,
                     registro_sanitario = @registro_sanitario, refrigeracion = ISNULL(@refrigeracion, 0),
                     precio_maximo = @precio_maximo, controla_lotes = ISNULL(@controla_lotes, 1),
                     updated_at = SYSDATETIME(), updated_by = @user_id
     WHEN NOT MATCHED THEN
          INSERT (product_id, fraccion, es_antibiotico, sustancia_activa, presentacion,
                  registro_sanitario, refrigeracion, precio_maximo, controla_lotes, updated_by)
          VALUES (@product_id, @fraccion, ISNULL(@es_antibiotico, 0), @sustancia_activa, @presentacion,
                  @registro_sanitario, ISNULL(@refrigeracion, 0), @precio_maximo, ISNULL(@controla_lotes, 1), @user_id);

    SELECT s.product_id, s.fraccion, s.es_antibiotico, s.sustancia_activa, s.presentacion,
           s.registro_sanitario, s.refrigeracion, s.precio_maximo, s.controla_lotes,
           s.requiere_receta, s.es_controlado
      FROM dbo.salud_productos s WHERE s.product_id = @product_id;
END
GO

/* ---------- sp_salud_productos_list (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_productos_list
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* La farmacia vista por su ficha sanitaria: existencia, cuánto tiene lote,
 * la caducidad más próxima y si el precio supera el máximo al público.
 *
 * Paginado por TOP y filtrado en SQL: una farmacia tiene miles de claves y
 * la pantalla nunca necesita todas a la vez. Los servicios (consulta,
 * limpieza) no son mercancía y no aparecen.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_productos_list]
    @buscar            NVARCHAR(100) = NULL,
    @solo_medicamentos BIT = 0,
    @top               INT = 200
AS
BEGIN
    SET NOCOUNT ON;
    SET @buscar = NULLIF(LTRIM(RTRIM(@buscar)), N'');
    IF @top IS NULL OR @top NOT BETWEEN 1 AND 1000 SET @top = 200;
    DECLARE @patron NVARCHAR(110) = N'%' + @buscar + N'%';

    ;WITH lotes AS (
        SELECT l.product_id,
               SUM(l.cantidad) AS en_lotes,
               MIN(CASE WHEN l.cantidad > 0 THEN l.caducidad END) AS proxima_caducidad
          FROM dbo.salud_lotes l
         GROUP BY l.product_id
    )
    SELECT TOP (@top)
           p.id AS product_id, p.nombre, p.part_number, p.bar_code, p.price,
           CAST(ISNULL(p.stock, 0) AS DECIMAL(12,3)) AS stock,
           s.fraccion, ISNULL(s.es_antibiotico, 0) AS es_antibiotico,
           s.sustancia_activa, s.presentacion, s.registro_sanitario,
           ISNULL(s.refrigeracion, 0) AS refrigeracion, s.precio_maximo,
           ISNULL(s.controla_lotes, 0) AS controla_lotes,
           ISNULL(s.requiere_receta, 0) AS requiere_receta,
           ISNULL(s.es_controlado, 0) AS es_controlado,
           CAST(CASE WHEN s.product_id IS NULL THEN 0 ELSE 1 END AS BIT) AS tiene_ficha,
           CAST(ISNULL(l.en_lotes, 0) AS DECIMAL(12,3)) AS en_lotes,
           CAST(CASE WHEN ISNULL(p.stock, 0) > ISNULL(l.en_lotes, 0)
                     THEN ISNULL(p.stock, 0) - ISNULL(l.en_lotes, 0) ELSE 0 END AS DECIMAL(12,3)) AS sin_lote,
           l.proxima_caducidad,
           CAST(CASE WHEN s.precio_maximo IS NOT NULL AND p.price > s.precio_maximo THEN 1 ELSE 0 END AS BIT) AS excede_maximo
      FROM dbo.products p
      LEFT JOIN dbo.salud_productos s ON s.product_id = p.id
      LEFT JOIN lotes l ON l.product_id = p.id
     WHERE p.active = 1
       AND ISNULL(p.inventory_mode, N'DIRECT') = N'DIRECT'
       AND NOT EXISTS (SELECT 1 FROM dbo.services sv WHERE sv.product_id = p.id)
       AND (@solo_medicamentos = 0 OR s.product_id IS NOT NULL)
       AND (@buscar IS NULL
            OR p.nombre LIKE @patron OR p.part_number LIKE @patron
            OR p.bar_code = @buscar OR s.sustancia_activa LIKE @patron)
     ORDER BY CASE WHEN s.product_id IS NULL THEN 1 ELSE 0 END, p.nombre;
END
GO

/* ---------- sp_salud_profesional_get (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_profesional_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Los datos con los que firma un profesional: nombre, cédula, institución
 * y especialidad. Sin fila, el usuario todavía no los ha capturado.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_profesional_get]
    @user_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT p.user_id, p.nombre, p.cedula, p.institucion, p.especialidad, p.cedula_especialidad, p.updated_at
      FROM dbo.salud_profesionales p
     WHERE p.user_id = @user_id;
END
GO

/* ---------- sp_salud_profesional_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_profesional_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Guarda los datos con los que firma un profesional. Cada quien captura los
 * suyos: la cédula es de la persona, no del negocio. Lo ya firmado no cambia
 * (cada documento guardó su copia al firmarse).
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_profesional_save]
    @user_id             INT,
    @nombre              NVARCHAR(160),
    @cedula              NVARCHAR(20),
    @institucion         NVARCHAR(160) = NULL,
    @especialidad        NVARCHAR(120) = NULL,
    @cedula_especialidad NVARCHAR(20)  = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @nombre              = NULLIF(LTRIM(RTRIM(@nombre)), N'');
    SET @cedula              = NULLIF(REPLACE(LTRIM(RTRIM(@cedula)), N' ', N''), N'');
    SET @institucion         = NULLIF(LTRIM(RTRIM(@institucion)), N'');
    SET @especialidad        = NULLIF(LTRIM(RTRIM(@especialidad)), N'');
    SET @cedula_especialidad = NULLIF(REPLACE(LTRIM(RTRIM(@cedula_especialidad)), N' ', N''), N'');

    IF @nombre IS NULL BEGIN RAISERROR('Escribe tu nombre completo como aparece en tu título.', 16, 1); RETURN; END
    IF @cedula IS NULL OR LEN(@cedula) NOT BETWEEN 5 AND 20 OR @cedula LIKE N'%[^0-9A-Za-z-]%'
    BEGIN RAISERROR('CEDULA_INVALIDA: la cédula profesional tiene de 5 a 20 letras o números.', 16, 1); RETURN; END
    IF @cedula_especialidad IS NOT NULL AND @especialidad IS NULL
    BEGIN RAISERROR('Escribe la especialidad de esa cédula.', 16, 1); RETURN; END
    IF @cedula_especialidad IS NOT NULL AND (LEN(@cedula_especialidad) < 5 OR @cedula_especialidad LIKE N'%[^0-9A-Za-z-]%')
    BEGIN RAISERROR('CEDULA_INVALIDA: la cédula de especialidad tiene de 5 a 20 letras o números.', 16, 1); RETURN; END

    MERGE dbo.salud_profesionales WITH (HOLDLOCK) AS t
    USING (SELECT @user_id AS user_id) AS s ON t.user_id = s.user_id
    WHEN MATCHED THEN UPDATE SET nombre = @nombre, cedula = @cedula, institucion = @institucion,
         especialidad = @especialidad, cedula_especialidad = @cedula_especialidad, updated_at = SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT (user_id, nombre, cedula, institucion, especialidad, cedula_especialidad)
         VALUES (@user_id, @nombre, @cedula, @institucion, @especialidad, @cedula_especialidad);

    EXEC dbo.sp_salud_profesional_get @user_id = @user_id;
END
GO

/* ---------- sp_salud_temperatura_save (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_temperatura_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Una lectura de temperatura del local o del refrigerador, con quién la tomó.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_temperatura_save]
    @equipo  NVARCHAR(40),
    @grados  DECIMAL(4,1),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @equipo = NULLIF(LTRIM(RTRIM(@equipo)), N'');
    IF @equipo IS NULL BEGIN RAISERROR('Elige el equipo.', 16, 1); RETURN; END
    IF @grados IS NULL OR @grados NOT BETWEEN -40 AND 60
    BEGIN RAISERROR('Temperatura fuera de rango.', 16, 1); RETURN; END

    INSERT INTO dbo.salud_temperaturas (equipo, grados, user_id) VALUES (@equipo, @grados, @user_id);
    SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;
END
GO

/* ---------- sp_salud_temperaturas_list (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_temperaturas_list
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Las lecturas de los últimos días, más recientes primero.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_temperaturas_list]
    @dias INT = 30
AS
BEGIN
    SET NOCOUNT ON;
    IF @dias IS NULL OR @dias NOT BETWEEN 1 AND 366 SET @dias = 30;
    SELECT t.id, t.equipo, t.grados, t.at, u.usuario
      FROM dbo.salud_temperaturas t
      LEFT JOIN dbo.users u ON u.id = t.user_id
     WHERE t.at >= DATEADD(DAY, -@dias, CAST(GETDATE() AS DATE))
     ORDER BY t.at DESC, t.id DESC;
END
GO

/* ---------- sp_salud_venta_aplicar (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_venta_aplicar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Después del COMMIT de la venta: guarda la receta que la respaldó y
 * descuenta los lotes, primero el que caduca primero (FEFO).
 *
 * Idempotente por venta: si ya hay movimientos o receta de esa venta no
 * hace nada, así que reintentarlo no descuenta dos veces.
 *
 * Lo que el stock vendió por encima de los lotes vigentes sale «sin lote»
 * (lote_id NULL) y se ve así en el libro, en vez de inventar un lote.
 * Los lotes caducados NO se consumen: si se vendió, no salió de ahí.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_venta_aplicar]
    @sale_id INT,
    @receta  NVARCHAR(MAX) = NULL,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.sales WHERE id = @sale_id)
    BEGIN RAISERROR('La venta no existe.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.salud_lote_movimientos WHERE sale_id = @sale_id)
       OR EXISTS (SELECT 1 FROM dbo.salud_recetas_surtidas WHERE sale_id = @sale_id)
    BEGIN
        SELECT CAST(1 AS BIT) AS ya_aplicada, CAST(NULL AS INT) AS receta_id;
        RETURN;
    END

    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);
    BEGIN TRAN;

    DECLARE @receta_id INT = NULL;
    IF @receta IS NOT NULL AND ISJSON(@receta) = 1
    BEGIN
        DECLARE @medico NVARCHAR(120) = NULLIF(LTRIM(RTRIM(JSON_VALUE(@receta, '$.medico'))), N''),
                @cedula NVARCHAR(20)  = NULLIF(LTRIM(RTRIM(JSON_VALUE(@receta, '$.cedula'))), N''),
                @fecha  DATE          = TRY_CAST(JSON_VALUE(@receta, '$.fecha') AS DATE);
        IF @medico IS NULL OR @cedula IS NULL OR @fecha IS NULL
        BEGIN ROLLBACK; RAISERROR('RECETA_INCOMPLETA: faltan médico, cédula o fecha de la receta.', 16, 1); RETURN; END

        INSERT INTO dbo.salud_recetas_surtidas
            (sale_id, medico, cedula, fecha_receta, institucion, paciente, retenida, surtidos_restantes, user_id)
        VALUES (@sale_id, @medico, @cedula, @fecha,
                NULLIF(LTRIM(RTRIM(JSON_VALUE(@receta, '$.institucion'))), N''),
                NULLIF(LTRIM(RTRIM(JSON_VALUE(@receta, '$.paciente'))), N''),
                ISNULL(TRY_CAST(JSON_VALUE(@receta, '$.retenida') AS BIT), 0),
                TRY_CAST(JSON_VALUE(@receta, '$.surtidosRestantes') AS TINYINT),
                @user_id);
        SET @receta_id = SCOPE_IDENTITY();
    END

    /* Lo vendido de cada producto con control de lotes. */
    DECLARE @lineas TABLE (product_id INT PRIMARY KEY, cantidad DECIMAL(12,3));
    INSERT INTO @lineas (product_id, cantidad)
    SELECT d.product_id, SUM(d.quantity)
      FROM dbo.sale_detail d
      JOIN dbo.salud_productos s ON s.product_id = d.product_id AND s.controla_lotes = 1
     WHERE d.sale_id = @sale_id
     GROUP BY d.product_id
    HAVING SUM(d.quantity) > 0;

    DECLARE @pid INT, @falta DECIMAL(12,3), @lote_id INT, @disp DECIMAL(12,3), @toma DECIMAL(12,3);
    WHILE EXISTS (SELECT 1 FROM @lineas)
    BEGIN
        SELECT TOP (1) @pid = product_id, @falta = cantidad FROM @lineas ORDER BY product_id;
        WHILE @falta > 0
        BEGIN
            SET @lote_id = NULL;
            SELECT TOP (1) @lote_id = id, @disp = cantidad
              FROM dbo.salud_lotes WITH (UPDLOCK, ROWLOCK)
             WHERE product_id = @pid AND cantidad > 0 AND caducidad > @hoy
             ORDER BY caducidad, id;
            IF @lote_id IS NULL
            BEGIN
                INSERT INTO dbo.salud_lote_movimientos (product_id, lote_id, tipo, cantidad, sale_id, receta_id, user_id, nota)
                VALUES (@pid, NULL, N'SALIDA', @falta, @sale_id, @receta_id, @user_id, N'Sin lote vigente');
                SET @falta = 0;
            END
            ELSE
            BEGIN
                SET @toma = CASE WHEN @disp < @falta THEN @disp ELSE @falta END;
                UPDATE dbo.salud_lotes SET cantidad = cantidad - @toma WHERE id = @lote_id;
                INSERT INTO dbo.salud_lote_movimientos (product_id, lote_id, tipo, cantidad, sale_id, receta_id, user_id)
                VALUES (@pid, @lote_id, N'SALIDA', @toma, @sale_id, @receta_id, @user_id);
                SET @falta = @falta - @toma;
            END
        END
        DELETE FROM @lineas WHERE product_id = @pid;
    END

    COMMIT;
    SELECT CAST(0 AS BIT) AS ya_aplicada, @receta_id AS receta_id;
END
GO

/* ---------- sp_salud_venta_requisitos (SQL_STORED_PROCEDURE) ---------- */
/* sp_salud_venta_requisitos
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* De los productos de una venta, cuáles exigen receta. La venta se frena
 * ANTES de cobrar si alguno la exige y no viene.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_venta_requisitos]
    @product_ids NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    IF ISJSON(@product_ids) <> 1 RETURN;

    SELECT p.id AS product_id, p.nombre, s.fraccion, s.es_antibiotico, s.es_controlado
      FROM (SELECT DISTINCT TRY_CAST([value] AS INT) AS id FROM OPENJSON(@product_ids)) j
      JOIN dbo.salud_productos s ON s.product_id = j.id
      JOIN dbo.products p ON p.id = s.product_id
     WHERE s.requiere_receta = 1;
END
GO
