/* ==========================================================================
   0045 — PANTALLAS OPERATIVAS SOBRE WYBIX LOCAL HOST
   --------------------------------------------------------------------------
   El Local Host deja de ser «la forma de conectar la cocina» y pasa a servir
   SUPERFICIES: pantallas de una sola funcion (Preparacion, Mesero, Mi jornada,
   Tecnico, Inventario de piso, Estado de pedidos). Tres cosas distintas, y
   separadas a proposito:

     DISPOSITIVO   la tablet emparejada: su credencial y su FUNCION actual
                   (`dispositivos_locales.superficie`). No es una persona.
     TRABAJADOR    quien la usa ahora, por QR o PIN. La identidad es la que ya
                   existe: `users` o `professionals` (un prestador puede no
                   tener usuario de Wybix). No hay `operational_users`.
     SESION        dispositivo + trabajador, corta y que caduca: una tablet de
                   salon no sigue siendo «Carlos» al dia siguiente.

   Nada de dominio nuevo: las superficies llaman a los procedimientos de
   siempre (comandas, cuentas, ordenes, citas). Lo que se anade aqui:

   · dispositivos_locales.superficie/config   la funcion del dispositivo.
   · trabajadores_acceso      QR (hash) y PIN (scrypt + sal) por persona.
   · trabajador_sesiones      sesiones de trabajador en un dispositivo.
   · superficie_auditoria     quien, desde que tablet, hizo que. Con clave de
                              idempotencia: una accion reenviada desde la cola
                              sin conexion no se aplica dos veces.
   · inventario_reportes      conteos y faltantes reportados desde el piso,
                              para que alguien con permiso los aplique.
   · version (ROWVERSION) en citas, lineas de orden y cuentas: el Host pregunta
     «que cambio desde N», igual que ya hacia con las comandas.
   · sp_service_order_add_event     nota, pausa y reanudacion en el historial.
   · sp_inventory_count_apply       el ajuste por conteo, atomico (antes vivia
                                    como SQL suelto en el proceso principal).

   Sin CHECK sobre el tipo de superficie, por la misma razon que `users.rol`:
   una version futura con una superficie mas no puede romper la base de un
   cliente. El codigo (el registro de superficies) valida.
   ========================================================================== */

/* -------------------------------------------------- dispositivo: su funcion */
IF COL_LENGTH(N'dbo.dispositivos_locales', N'superficie') IS NULL
    ALTER TABLE dbo.dispositivos_locales
      ADD superficie NVARCHAR(30) NOT NULL
          CONSTRAINT DF_dispositivos_locales_superficie DEFAULT ('PREPARATION') WITH VALUES;
GO
IF COL_LENGTH(N'dbo.dispositivos_locales', N'config') IS NULL
    ALTER TABLE dbo.dispositivos_locales ADD config NVARCHAR(2000) NULL;
GO
IF COL_LENGTH(N'dbo.dispositivos_locales', N'funcion_cambiada_en') IS NULL
    ALTER TABLE dbo.dispositivos_locales ADD funcion_cambiada_en DATETIME2(0) NULL, funcion_cambiada_por INT NULL;
GO
/* `alcance` era siempre 'KDS'. Ahora lo dice `superficie`; la columna se queda
   por compatibilidad y deja de estar atada a un solo valor. */
IF OBJECT_ID(N'dbo.CK_dispositivos_locales_alcance', 'C') IS NOT NULL
    ALTER TABLE dbo.dispositivos_locales DROP CONSTRAINT CK_dispositivos_locales_alcance;
GO
/* Una estacion solo la exige Preparacion. */
IF OBJECT_ID(N'dbo.CK_dispositivos_locales_destino', 'C') IS NOT NULL
    ALTER TABLE dbo.dispositivos_locales DROP CONSTRAINT CK_dispositivos_locales_destino;
GO
IF OBJECT_ID(N'dbo.CK_dispositivos_locales_estacion', 'C') IS NULL
    ALTER TABLE dbo.dispositivos_locales WITH CHECK
      ADD CONSTRAINT CK_dispositivos_locales_estacion
          CHECK (superficie <> 'PREPARATION' OR todas = 1 OR station_id IS NOT NULL);
GO

IF COL_LENGTH(N'dbo.dispositivos_emparejamientos', N'superficie') IS NULL
    ALTER TABLE dbo.dispositivos_emparejamientos
      ADD superficie NVARCHAR(30) NOT NULL
          CONSTRAINT DF_dispositivos_emp_superficie DEFAULT ('PREPARATION') WITH VALUES;
GO
IF COL_LENGTH(N'dbo.dispositivos_emparejamientos', N'config') IS NULL
    ALTER TABLE dbo.dispositivos_emparejamientos ADD config NVARCHAR(2000) NULL;
GO
IF OBJECT_ID(N'dbo.CK_dispositivos_emp_alcance', 'C') IS NOT NULL
    ALTER TABLE dbo.dispositivos_emparejamientos DROP CONSTRAINT CK_dispositivos_emp_alcance;
GO

/* ------------------------------------------------- acceso de un trabajador
   Una fila por PERSONA: o un usuario, o un profesional sin usuario. Si el
   profesional tiene usuario, el acceso es del usuario (y de ahi se llega al
   profesional por `professionals.user_id`): una persona, una identidad.

   QR: 256 bits aleatorios, solo su SHA-256. Se rota generando otro (el viejo
   deja de valer) y se revoca.
   PIN: scrypt con sal propia. Cinco fallos lo bloquean unos minutos.        */
IF OBJECT_ID(N'dbo.trabajadores_acceso', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.trabajadores_acceso (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_trabajadores_acceso PRIMARY KEY,
        user_id INT NULL CONSTRAINT FK_trab_acceso_user REFERENCES dbo.users(id),
        professional_id INT NULL CONSTRAINT FK_trab_acceso_prof REFERENCES dbo.professionals(id),
        qr_hash CHAR(64) NULL,
        qr_creado_en DATETIME2(0) NULL,
        pin_hash VARCHAR(128) NULL,
        pin_sal VARCHAR(64) NULL,
        pin_creado_en DATETIME2(0) NULL,
        pin_fallos INT NOT NULL CONSTRAINT DF_trab_acceso_fallos DEFAULT ((0)),
        bloqueado_hasta DATETIME2(0) NULL,
        creado_en DATETIME2(0) NOT NULL CONSTRAINT DF_trab_acceso_creado DEFAULT (SYSUTCDATETIME()),
        creado_por INT NULL,
        revocado_en DATETIME2(0) NULL,
        revocado_por INT NULL,
        CONSTRAINT CK_trab_acceso_persona CHECK (
            (user_id IS NOT NULL AND professional_id IS NULL) OR (user_id IS NULL AND professional_id IS NOT NULL))
    );
    CREATE UNIQUE INDEX UX_trab_acceso_user ON dbo.trabajadores_acceso(user_id) WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX UX_trab_acceso_prof ON dbo.trabajadores_acceso(professional_id) WHERE professional_id IS NOT NULL;
    CREATE UNIQUE INDEX UX_trab_acceso_qr ON dbo.trabajadores_acceso(qr_hash) WHERE qr_hash IS NOT NULL;
END
GO

/* ------------------------------------------------- sesion en un dispositivo */
IF OBJECT_ID(N'dbo.trabajador_sesiones', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.trabajador_sesiones (
        id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_trabajador_sesiones PRIMARY KEY
            CONSTRAINT DF_trabajador_sesiones_id DEFAULT (NEWID()),
        token_hash CHAR(64) NOT NULL,
        dispositivo_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_trab_ses_disp REFERENCES dbo.dispositivos_locales(id),
        acceso_id INT NOT NULL CONSTRAINT FK_trab_ses_acceso REFERENCES dbo.trabajadores_acceso(id),
        user_id INT NULL,
        professional_id INT NULL,
        superficie NVARCHAR(30) NOT NULL,
        via NVARCHAR(8) NOT NULL,               -- QR | PIN
        inicio DATETIME2(0) NOT NULL CONSTRAINT DF_trab_ses_inicio DEFAULT (SYSUTCDATETIME()),
        ultima_actividad DATETIME2(0) NOT NULL CONSTRAINT DF_trab_ses_act DEFAULT (SYSUTCDATETIME()),
        expira_en DATETIME2(0) NOT NULL,        -- tope absoluto (fin del dia local)
        cerrada_en DATETIME2(0) NULL,
        motivo_cierre NVARCHAR(20) NULL         -- SALIR | INACTIVIDAD | CADUCADA | REVOCADA | OTRA_SESION | FUNCION
    );
    CREATE UNIQUE INDEX UX_trab_ses_token ON dbo.trabajador_sesiones(token_hash);
    CREATE INDEX IX_trab_ses_disp ON dbo.trabajador_sesiones(dispositivo_id) WHERE cerrada_en IS NULL;
END
GO

/* ---------------------------------------------------------------- auditoria
   Solo acciones que cambian algo, no cada pantalla que se pinta. La clave de
   idempotencia es la que manda la tablet con cada accion: si la cola sin
   conexion la reenvia, la segunda vez se devuelve el resultado guardado.    */
IF OBJECT_ID(N'dbo.superficie_auditoria', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.superficie_auditoria (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_superficie_auditoria PRIMARY KEY,
        momento DATETIME2(0) NOT NULL CONSTRAINT DF_sup_aud_momento DEFAULT (SYSUTCDATETIME()),
        local_creado_en DATETIME2(0) NULL,      -- cuando lo hizo la persona (cola sin conexion)
        dispositivo_id UNIQUEIDENTIFIER NULL,
        sesion_id UNIQUEIDENTIFIER NULL,
        user_id INT NULL,
        professional_id INT NULL,
        superficie NVARCHAR(30) NOT NULL,
        accion NVARCHAR(40) NOT NULL,
        entidad NVARCHAR(30) NULL,
        entidad_id NVARCHAR(40) NULL,
        detalle NVARCHAR(400) NULL,
        idem_key NVARCHAR(64) NULL,
        resultado NVARCHAR(2000) NULL
    );
    CREATE UNIQUE INDEX UX_sup_aud_idem ON dbo.superficie_auditoria(idem_key) WHERE idem_key IS NOT NULL;
    CREATE INDEX IX_sup_aud_momento ON dbo.superficie_auditoria(momento DESC);
END
GO

/* ------------------------------------------------ inventario desde el piso
   Un empleado de piso sin permiso de inventario no ajusta existencias:
   REPORTA. Quien tiene el permiso lo aplica (con el mismo ajuste de siempre)
   o lo descarta.                                                             */
IF OBJECT_ID(N'dbo.inventario_reportes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.inventario_reportes (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_inventario_reportes PRIMARY KEY,
        product_id INT NOT NULL CONSTRAINT FK_inv_rep_product REFERENCES dbo.products(id),
        tipo NVARCHAR(10) NOT NULL CONSTRAINT CK_inv_rep_tipo CHECK (tipo IN ('CONTEO', 'FALTANTE')),
        cantidad DECIMAL(12, 2) NULL,
        stock_al_reportar DECIMAL(12, 2) NULL,
        nota NVARCHAR(200) NULL,
        estado NVARCHAR(10) NOT NULL CONSTRAINT DF_inv_rep_estado DEFAULT ('PENDIENTE')
            CONSTRAINT CK_inv_rep_estado CHECK (estado IN ('PENDIENTE', 'APLICADO', 'DESCARTADO')),
        reportado_en DATETIME2(0) NOT NULL CONSTRAINT DF_inv_rep_en DEFAULT (SYSUTCDATETIME()),
        local_creado_en DATETIME2(0) NULL,
        user_id INT NULL,
        professional_id INT NULL,
        dispositivo_id UNIQUEIDENTIFIER NULL,
        resuelto_en DATETIME2(0) NULL,
        resuelto_por INT NULL,
        version ROWVERSION
    );
    CREATE INDEX IX_inv_rep_pendientes ON dbo.inventario_reportes(estado, reportado_en DESC);
END
GO

/* -------------------------------------- versiones para el tiempo real      */
IF COL_LENGTH(N'dbo.appointments', N'version') IS NULL
    ALTER TABLE dbo.appointments ADD version ROWVERSION;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_appointments_version' AND object_id = OBJECT_ID(N'dbo.appointments'))
    CREATE INDEX IX_appointments_version ON dbo.appointments(version) INCLUDE (professional_id, status);
GO
IF COL_LENGTH(N'dbo.service_order_lines', N'version') IS NULL
    ALTER TABLE dbo.service_order_lines ADD version ROWVERSION;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_solines_version' AND object_id = OBJECT_ID(N'dbo.service_order_lines'))
    CREATE INDEX IX_solines_version ON dbo.service_order_lines(version) INCLUDE (order_id, professional_id, status);
GO
IF COL_LENGTH(N'dbo.hosp_cuentas', N'version') IS NULL
    ALTER TABLE dbo.hosp_cuentas ADD version ROWVERSION;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_hosp_cuentas_version' AND object_id = OBJECT_ID(N'dbo.hosp_cuentas'))
    CREATE INDEX IX_hosp_cuentas_version ON dbo.hosp_cuentas(version) INCLUDE (mesa_id, estado, abierta_por);
GO

/* --------------------------------------------- historial: nota y pausa
   El dominio de ordenes no tiene un estado «pausada», y no se inventa: una
   linea sigue EN_PROCESO y la pausa queda en el historial, que es donde el
   taller la busca («¿por que tardo tanto?»).                                */
CREATE OR ALTER PROCEDURE dbo.sp_service_order_add_event
    @order_id   INT,
    @event_type NVARCHAR(30),
    @detail     NVARCHAR(400),
    @user_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @event_type = UPPER(LTRIM(RTRIM(ISNULL(@event_type, ''))));
    IF @event_type NOT IN ('NOTA', 'PAUSA', 'REANUDA')
    BEGIN RAISERROR('Ese evento no se registra por aqui.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.service_orders WHERE id = @order_id)
    BEGIN RAISERROR('Esa orden no existe.', 16, 1); RETURN; END
    IF LEN(LTRIM(RTRIM(ISNULL(@detail, '')))) = 0 AND @event_type = 'NOTA'
    BEGIN RAISERROR('La nota esta vacia.', 16, 1); RETURN; END

    INSERT INTO dbo.service_order_events (order_id, event_type, detail, user_id)
    VALUES (@order_id, @event_type, LEFT(LTRIM(RTRIM(@detail)), 400), @user_id);
    SELECT SCOPE_IDENTITY() AS id;
END
GO

/* ---------------------------------------------- ajuste por conteo fisico
   Lo mismo que hacia `inventory:apply-count` en el proceso principal, pero en
   una transaccion y con la fila bloqueada: dos ajustes a la vez sobre el
   mismo producto ya no pueden calcular la diferencia contra un stock viejo. */
CREATE OR ALTER PROCEDURE dbo.sp_inventory_count_apply
    @product_id INT,
    @fisico     DECIMAL(12, 2),
    @user_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @fisico IS NULL OR @fisico < 0
    BEGIN RAISERROR('El conteo no puede ser negativo.', 16, 1); RETURN; END

    BEGIN TRAN;
    DECLARE @teorico DECIMAL(12, 2);
    SELECT @teorico = ISNULL(stock, 0) FROM dbo.products WITH (UPDLOCK, ROWLOCK) WHERE id = @product_id;
    IF @@ROWCOUNT = 0
    BEGIN ROLLBACK; RAISERROR('Ese producto no existe.', 16, 1); RETURN; END

    DECLARE @dif DECIMAL(12, 2) = @fisico - @teorico;
    IF @dif <> 0
    BEGIN
        UPDATE dbo.products SET stock = @fisico WHERE id = @product_id;
        INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn)
        VALUES (@product_id, CASE WHEN @dif > 0 THEN 'entrada' ELSE 'salida' END, 'CONTEO', ABS(@dif), GETDATE(),
                'Ajuste por conteo fisico (dif ' + CONVERT(NVARCHAR(20), CONVERT(FLOAT, @dif)) + ')');
    END
    COMMIT;
    SELECT @teorico AS teorico, @fisico AS fisico, @dif AS diferencia;
END
GO
