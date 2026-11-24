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
