/* ============================================================
   0051 — fase1 identidad cortes outbox

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0051_fase1-identidad-cortes-outbox.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0051_fase1-identidad-cortes-outbox.sql ========== */
/* ============================================================================
   0051 — FASE 1: CORTES CONFIABLES, IDENTIDAD GLOBAL Y OUTBOX DE HECHOS
   ----------------------------------------------------------------------------
   Todo es ADITIVO: columnas nuevas con default, tablas nuevas. No se borra,
   renombra ni reescribe ningún dato existente. Cada paso comprueba su
   existencia, así que la migración se puede reejecutar.

   1. CORTE AUDITABLE (cash_closures)
      El turno ya sabía quién lo abrió (`userId`, `opening_user_id`) y su caja
      (`register_id`). Le faltaba:
        closed_by_user_id    quién lo cerró (la sesión, no la pantalla)
        close_authorized_by  quién autorizó cerrar un turno AJENO
        opened_machine_*     el equipo que lo abrió
        closed_machine_*     el equipo que lo cerró
        blind_count          si el efectivo se contó a ciegas
      La ubicación y la empresa NO se repiten por fila: una base es una
      ubicación de una empresa, y eso vive una vez en `database_metadata`
      (`location_uuid`, `company_uuid`), que llena el enrolamiento.

   2. IDENTIFICADORES GLOBALES, SOLO DONDE CRUZAN FRONTERAS
      La PK local (`INT IDENTITY`) se queda. Se añade un `uuid` a lo que viaja
      a la nube en esta fase: ventas, turnos, movimientos de caja, cajas y
      usuarios (los hechos los referencian). Nada más.

   3. VERSIÓN DE FILA (rowversion) en ventas, turnos y movimientos de caja
      Es lo que permite capturar cambios para la nube SIN modificar los
      procedimientos de venta: el capturador lee lo que cambió desde la última
      marca. Ningún procedimiento ni consulta del POS usa `SELECT *` o
      `INSERT` sin lista de columnas sobre estas tablas (verificado), así que
      la columna nueva no rompe nada.

   4. OUTBOX (sync_outbox) y su marca de captura (sync_capture_state)
      Cada hecho sincronizable es una fila con UUID de evento, tipo,
      agregado, versión, fecha, carga y estado. La empresa, la ubicación y el
      equipo de origen son de la instancia (`database_metadata`) y se añaden
      al sobre al enviar: guardarlos en cada fila sería repetir lo mismo.

   5. IDENTIDAD DE LA INSTANCIA (database_metadata.instance_uuid)
      Un identificador de ESTA base, generado una vez. No es comercial: la
      empresa y la ubicación los asigna el enrolamiento en la nube.

   RECUPERACIÓN: las columnas nuevas admiten NULL o tienen default; revertir
   es dejarlas sin uso (el código anterior no las lee). Las tablas nuevas se
   pueden vaciar sin afectar la operación.
   ========================================================================== */

/* ---------------------------------------------------------------- 1 */
IF COL_LENGTH('dbo.cash_closures', 'closed_by_user_id') IS NULL
    ALTER TABLE dbo.cash_closures ADD closed_by_user_id INT NULL;
IF COL_LENGTH('dbo.cash_closures', 'close_authorized_by') IS NULL
    ALTER TABLE dbo.cash_closures ADD close_authorized_by INT NULL;
IF COL_LENGTH('dbo.cash_closures', 'opened_machine_id') IS NULL
    ALTER TABLE dbo.cash_closures ADD opened_machine_id NVARCHAR(64) NULL;
IF COL_LENGTH('dbo.cash_closures', 'opened_machine_name') IS NULL
    ALTER TABLE dbo.cash_closures ADD opened_machine_name NVARCHAR(120) NULL;
IF COL_LENGTH('dbo.cash_closures', 'closed_machine_id') IS NULL
    ALTER TABLE dbo.cash_closures ADD closed_machine_id NVARCHAR(64) NULL;
IF COL_LENGTH('dbo.cash_closures', 'closed_machine_name') IS NULL
    ALTER TABLE dbo.cash_closures ADD closed_machine_name NVARCHAR(120) NULL;
IF COL_LENGTH('dbo.cash_closures', 'blind_count') IS NULL
    ALTER TABLE dbo.cash_closures ADD blind_count BIT NULL;

/* Los turnos cerrados antes de esta migración: quien cerró es desconocido.
   NO se inventa (no se copia `userId`): queda NULL y así se ve en reportes. */

/* ---------------------------------------------------------------- 2 y 3 */
IF COL_LENGTH('dbo.cash_closures', 'uuid') IS NULL
    ALTER TABLE dbo.cash_closures ADD uuid UNIQUEIDENTIFIER NOT NULL
        CONSTRAINT DF_cash_closures_uuid DEFAULT NEWID();
IF COL_LENGTH('dbo.cash_closures', 'rv') IS NULL
    ALTER TABLE dbo.cash_closures ADD rv ROWVERSION;

IF COL_LENGTH('dbo.sales', 'uuid') IS NULL
    ALTER TABLE dbo.sales ADD uuid UNIQUEIDENTIFIER NOT NULL
        CONSTRAINT DF_sales_uuid DEFAULT NEWID();
IF COL_LENGTH('dbo.sales', 'rv') IS NULL
    ALTER TABLE dbo.sales ADD rv ROWVERSION;

IF COL_LENGTH('dbo.cash_movements', 'uuid') IS NULL
    ALTER TABLE dbo.cash_movements ADD uuid UNIQUEIDENTIFIER NOT NULL
        CONSTRAINT DF_cash_movements_uuid DEFAULT NEWID();
IF COL_LENGTH('dbo.cash_movements', 'rv') IS NULL
    ALTER TABLE dbo.cash_movements ADD rv ROWVERSION;

IF COL_LENGTH('dbo.registers', 'uuid') IS NULL
    ALTER TABLE dbo.registers ADD uuid UNIQUEIDENTIFIER NOT NULL
        CONSTRAINT DF_registers_uuid DEFAULT NEWID();

IF COL_LENGTH('dbo.users', 'uuid') IS NULL
    ALTER TABLE dbo.users ADD uuid UNIQUEIDENTIFIER NOT NULL
        CONSTRAINT DF_users_uuid DEFAULT NEWID();
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_cash_closures_uuid' AND object_id = OBJECT_ID(N'dbo.cash_closures'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_cash_closures_uuid ON dbo.cash_closures (uuid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_cash_closures_rv' AND object_id = OBJECT_ID(N'dbo.cash_closures'))
    CREATE NONCLUSTERED INDEX IX_cash_closures_rv ON dbo.cash_closures (rv);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_sales_uuid' AND object_id = OBJECT_ID(N'dbo.sales'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_sales_uuid ON dbo.sales (uuid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sales_rv' AND object_id = OBJECT_ID(N'dbo.sales'))
    CREATE NONCLUSTERED INDEX IX_sales_rv ON dbo.sales (rv);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_cash_movements_uuid' AND object_id = OBJECT_ID(N'dbo.cash_movements'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_cash_movements_uuid ON dbo.cash_movements (uuid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_cash_movements_rv' AND object_id = OBJECT_ID(N'dbo.cash_movements'))
    CREATE NONCLUSTERED INDEX IX_cash_movements_rv ON dbo.cash_movements (rv);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_registers_uuid' AND object_id = OBJECT_ID(N'dbo.registers'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_registers_uuid ON dbo.registers (uuid);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_users_uuid' AND object_id = OBJECT_ID(N'dbo.users'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_users_uuid ON dbo.users (uuid);

/* ---------------------------------------------------------------- 4 */
IF OBJECT_ID(N'dbo.sync_outbox', 'U') IS NULL
BEGIN
CREATE TABLE dbo.sync_outbox (
    id                BIGINT IDENTITY(1, 1) NOT NULL,
    event_uuid        UNIQUEIDENTIFIER NOT NULL,
    event_type        VARCHAR(40) NOT NULL,
    aggregate_type    VARCHAR(30) NOT NULL,
    aggregate_uuid    UNIQUEIDENTIFIER NOT NULL,
    aggregate_version BIGINT NOT NULL,
    occurred_at       DATETIMEOFFSET(0) NOT NULL,
    payload_version   SMALLINT NOT NULL CONSTRAINT DF_sync_outbox_pv DEFAULT ((1)),
    payload           NVARCHAR(MAX) NOT NULL,
    status            VARCHAR(12) NOT NULL CONSTRAINT DF_sync_outbox_status DEFAULT ('PENDING'),
    attempts          INT NOT NULL CONSTRAINT DF_sync_outbox_attempts DEFAULT ((0)),
    last_error        NVARCHAR(400) NULL,
    created_at        DATETIME2(3) NOT NULL CONSTRAINT DF_sync_outbox_created DEFAULT (SYSUTCDATETIME()),
    sent_at           DATETIME2(3) NULL,
    CONSTRAINT PK_sync_outbox PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UX_sync_outbox_event UNIQUE (event_uuid),
    CONSTRAINT CK_sync_outbox_status CHECK (status IN ('PENDING', 'SENT', 'REJECTED'))
);
CREATE NONCLUSTERED INDEX IX_sync_outbox_status ON dbo.sync_outbox (status, id);
CREATE NONCLUSTERED INDEX IX_sync_outbox_aggregate ON dbo.sync_outbox (aggregate_uuid, aggregate_version);
END;

IF OBJECT_ID(N'dbo.sync_capture_state', 'U') IS NULL
CREATE TABLE dbo.sync_capture_state (
    aggregate_type VARCHAR(30) NOT NULL,
    last_rv        BINARY(8) NOT NULL CONSTRAINT DF_sync_capture_state_rv DEFAULT (0x0000000000000000),
    updated_at     DATETIME2(3) NOT NULL CONSTRAINT DF_sync_capture_state_upd DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_sync_capture_state PRIMARY KEY CLUSTERED (aggregate_type)
);

/* ---------------------------------------------------------------- 5 */
IF OBJECT_ID(N'dbo.database_metadata', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.database_metadata WHERE clave = 'instance_uuid')
    INSERT INTO dbo.database_metadata (clave, valor) VALUES ('instance_uuid', LOWER(CONVERT(NVARCHAR(36), NEWID())));
GO

/* ---------- sp_close_shift (SQL_STORED_PROCEDURE) ---------- */
/* sp_close_shift
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_close_shift ====================== */
CREATE OR ALTER PROCEDURE [dbo].[sp_close_shift]
    @user_id        INT = NULL,
    @cash_delivered DECIMAL(12,2),
    @closure_date   DATE = NULL,
    @closure_id     INT = NULL,
    @register_id    INT = NULL,         -- multicaja
    @machine_id     NVARCHAR(64) = NULL,
    @machine_name   NVARCHAR(120) = NULL,
    /* 0051. Quien AUTORIZA cerrar un turno ajeno: un Encargado o Administrador
       que ya se reautentico en el proceso principal (PIN o contrasena). El
       procedimiento vuelve a comprobar su rol: no confia en que quien llama lo
       haya hecho. */
    @authorized_by  INT = NULL,
    @blind_count    BIT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    /* ------------------------- QUE TURNO Y QUIEN -------------------------------
       0051: el turno se identifica SIEMPRE por `@closure_id`. Antes, sin el, se
       cerraba "el turno abierto que se encontrara" en la caja: una llamada
       incompleta podia cerrar el turno de otra persona sin decir cual. Y quien
       cierra (`@user_id`) es obligatorio: es el actor de la sesion, que el
       proceso principal toma de la sesion y no de la pantalla.
       -------------------------------------------------------------------------- */
    IF @closure_id IS NULL
    BEGIN
        RAISERROR('Indica el turno que se va a cerrar.', 16, 1);
        RETURN;
    END
    IF @user_id IS NULL
    BEGIN
        RAISERROR('Falta quien cierra el turno.', 16, 1);
        RETURN;
    END

    DECLARE @now DATETIME2(0) = SYSDATETIME();
    IF @closure_date IS NULL
        SET @closure_date = CAST(@now AS DATE);

    /* ------------------- DE QUE CAJA ES ESTE CIERRE -------------------------
       El orden importa, y elegirlo mal fue un fallo real de QA.

       Antes era una sola linea: si no venia `@register_id`, se tomaba
       `TOP 1 ... ORDER BY id`, es decir la Caja 1. Mientras la caja solo servia
       para buscar el turno daba igual -el cierre llega con `@closure_id`, que
       ya identifica el turno-, pero desde que el arriendo se valida con
       `@register_id`, ese TOP 1 pasó a significar "valida la Caja 1". La
       laptop, cerrando SU Caja 2, recibia:

           "Esta caja la esta usando DESKTOP-LNQIU8G"

       El mensaje era cierto -ese equipo tiene la Caja 1- pero la caja
       comprobada no era la suya. Un cierre nunca puede validarse contra una
       caja distinta de la del turno que cierra.

       Ahora la caja se deduce, en este orden:
         1. la que dice quien llama;
         2. la del TURNO que se esta cerrando (la fuente de verdad: cerrar un
            turno es una operacion sobre ESE turno, no sobre "una caja");
         3. la que este equipo tiene arrendada;
         4. y solo si no hay nada de eso, la unica caja que existe.
       ------------------------------------------------------------------------ */
    IF @register_id IS NULL AND @closure_id IS NOT NULL
        SELECT @register_id = register_id FROM dbo.cash_closures WHERE id = @closure_id;

    IF @register_id IS NULL AND NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N'') IS NOT NULL
        SELECT @register_id = a.register_id
        FROM dbo.register_assignments a
        WHERE a.machine_id = @machine_id
          AND a.released_at IS NULL
          AND a.lease_until > SYSUTCDATETIME();

    IF @register_id IS NULL
        SELECT TOP 1 @register_id = id FROM dbo.registers ORDER BY id;


    /* ---------------- MULTICAJA: esta caja es de este equipo ----------------
       La proteccion NO puede vivir solo en el selector de la pantalla. El
       turno es de la CAJA (`cash_closures.register_id`), asi que dos equipos
       declarados C1 comparten turno y comparten corte: cerrar en uno cierra
       para el otro y las ventas de ambos caen en el mismo arqueo. Eso es
       dinero, y tiene que rechazarse aqui, donde no hay UI que saltarse.

       `@machine_id` NULO = el que llama no dice quien es. Entonces NO se
       exige nada: es el contrato de siempre, el que usan las instalaciones de
       una sola caja, las pruebas y cualquier version anterior de la app. Una
       instalacion MonoCaja no gana ni una friccion por esto.

       Cuando SI se identifica, la llamada ademas RENUEVA el arriendo. Una
       caja que esta vendiendo no puede perder su identidad porque un
       temporizador se estrangulo: vender es la senal de vida mas fuerte que
       existe. Y si el arriendo habia caducado sin que nadie lo tomara, se
       recupera en el acto en vez de interrumpir la venta.
       ---------------------------------------------------------------------- */
    IF NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N'') IS NOT NULL
    BEGIN
        DECLARE @lease_res NVARCHAR(20), @lease_holder NVARCHAR(64),
                @lease_holder_name NVARCHAR(120), @lease_hasta DATETIME2(0);

        EXEC dbo.sp_register_lease_touch
            @register_id   = @register_id,
            @machine_id    = @machine_id,
            @machine_name  = @machine_name,
            @lease_seconds = 300,
            @resultado     = @lease_res OUTPUT,
            @holder_id     = @lease_holder OUTPUT,
            @holder_name   = @lease_holder_name OUTPUT,
            @lease_until   = @lease_hasta OUTPUT;

        IF @lease_res = N'OCUPADA'
        BEGIN
            /* Sin acentos a proposito: el texto de un error de SQL Server
               llega al cliente degradado a un byte por caracter y cualquier
               acento se convierte en basura. El nombre del equipo si viaja
               bien porque lo puso el propio equipo. */
            DECLARE @lease_quien NVARCHAR(120) =
                ISNULL(NULLIF(LTRIM(RTRIM(@lease_holder_name)), N''), N'otro equipo');
            RAISERROR('Esta caja la esta usando %s. Dos equipos no pueden operar la misma caja: cada una lleva su propio turno y su propio corte.', 16, 1, @lease_quien);
            RETURN;
        END
    END
    BEGIN TRY
        BEGIN TRAN;

        DECLARE @cid INT = NULL;
        DECLARE @opened_at DATETIME2(0);
        DECLARE @opening_cash DECIMAL(12,2);
        DECLARE @shift_user_id INT;

        /* 1) Resolver turno a cerrar */
        IF @closure_id IS NOT NULL
        BEGIN
            SELECT
                @cid          = id,
                @shift_user_id= userId,
                @opened_at    = opened_at,
                @opening_cash = opening_cash
            FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
            WHERE id = @closure_id
              AND closed_at IS NULL;

            IF @cid IS NULL
            BEGIN
                RAISERROR('Ese turno no existe o ya está cerrado.', 16, 1);
                ROLLBACK TRAN;
                RETURN;
            END

            /* Cerrar un turno AJENO esta controlado de forma explicita: hace
               falta un autorizador activo con rol de Encargado o
               Administrador. Puede ser el propio actor si el es Encargado (se
               reautentico con su PIN); un Operador nunca se autoriza solo. El
               codigo REQUIERE_AUTORIZACION lo reconoce el proceso principal
               para pedir el PIN. Sin acentos: ver la nota de MULTICAJA. */
            IF @user_id <> @shift_user_id
            BEGIN
                IF @authorized_by IS NULL OR NOT EXISTS (
                    SELECT 1 FROM dbo.users
                     WHERE id = @authorized_by AND active = 1
                       AND LOWER(LTRIM(RTRIM(rol))) IN (N'admin', N'supervisor'))
                BEGIN
                    RAISERROR('REQUIERE_AUTORIZACION: este turno es de otra persona. Para cerrarlo hace falta la autorizacion de un encargado.', 16, 1);
                    ROLLBACK TRAN;
                    RETURN;
                END
            END
            ELSE
                SET @authorized_by = NULL;   -- el propio turno no necesita autorizador
        END

        /* 2) Sumar movimientos del turno (amarrados + sueltos por caja y rango) */
        DECLARE @mov_sum DECIMAL(12,2) =
        (
            SELECT ISNULL(SUM(CASE WHEN m.typee = 'OPENING' THEN 0 ELSE m.amount END), 0.00)
            FROM dbo.cash_movements AS m WITH (UPDLOCK)
            WHERE
                (
                    m.closure_id = @cid
                    OR (
                        m.closure_id IS NULL
                        AND m.register_id = @register_id
                        AND m.datee >= @opened_at
                        AND m.datee <= @now
                    )
                )
        );

        DECLARE @cash_expected DECIMAL(12,2) = ISNULL(@opening_cash,0) + ISNULL(@mov_sum,0);
        DECLARE @difference    DECIMAL(12,2) = @cash_delivered - @cash_expected;

        /* 3) Cerrar */
        UPDATE dbo.cash_closures
           SET cash_expected  = @cash_expected,
               cash_delivered = @cash_delivered,
               difference     = @difference,
               closed_at      = @now,
               create_date    = ISNULL(create_date, CAST(@opened_at AS DATE)),
               closed_by_user_id   = @user_id,
               close_authorized_by = @authorized_by,
               closed_machine_id   = NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N''),
               closed_machine_name = @machine_name,
               blind_count         = @blind_count
         WHERE id = @cid;

        /* Bitacora: SIEMPRE queda el cierre, y aparte si fue de un turno ajeno. */
        DECLARE @detalle NVARCHAR(400) = CONCAT(
            N'turno ', @cid, N' · esperado ', @cash_expected, N' · contado ', @cash_delivered,
            CASE WHEN @blind_count = 1 THEN N' · a ciegas' ELSE N'' END,
            CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(@machine_name, N''))), N'') IS NULL THEN N''
                 ELSE CONCAT(N' · equipo ', @machine_name) END);
        INSERT INTO dbo.security_events (datee, user_id, authorized_by, register_id, event_type, amount, detail)
        VALUES (SYSDATETIME(), @user_id, @authorized_by, @register_id, N'SHIFT_CLOSED', @difference, @detalle);
        IF @user_id <> @shift_user_id
            INSERT INTO dbo.security_events (datee, user_id, authorized_by, register_id, event_type, amount, detail)
            VALUES (SYSDATETIME(), @user_id, @authorized_by, @register_id, N'SHIFT_CLOSED_BY_OTHER', @difference,
                    CONCAT(N'turno ', @cid, N' de usuario ', @shift_user_id));

        /* 4) Amarrar sueltos de esta caja al cierre */
        UPDATE dbo.cash_movements
           SET closure_id = @cid
         WHERE register_id = @register_id
           AND closure_id IS NULL
           AND datee >= @opened_at
           AND datee <= @now;

        COMMIT TRAN;

        SELECT
            @cid            AS closure_id,
            CAST(@opened_at AS DATE) AS closure_date,
            @opened_at      AS opened_at,
            @now            AS closed_at,
            ISNULL(@opening_cash,0) AS opening_cash,
            ISNULL(@mov_sum,0)      AS movements_sum,
            @cash_expected  AS cash_expected,
            @cash_delivered AS cash_delivered,
            @difference     AS difference,
            @register_id    AS register_id,
            @shift_user_id  AS opened_by_user_id,
            @user_id        AS closed_by_user_id,
            @authorized_by  AS close_authorized_by;

    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@ErrMsg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_open_shift (SQL_STORED_PROCEDURE) ---------- */
/* sp_open_shift
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_open_shift ====================== */
CREATE OR ALTER PROCEDURE [dbo].[sp_open_shift]
    @user_id         INT,
    @opening_cash    DECIMAL(12,2) = 0,
    @opening_note    NVARCHAR(255) = NULL,
    @opening_user_id INT = NULL,
    @register_id     INT = NULL,         -- multicaja
    -- Identidad del equipo. Ver el bloque MULTICAJA mas abajo: NULO = no se
    -- exige nada, que es el contrato de MonoCaja y el de las versiones previas.
    @machine_id      NVARCHAR(64) = NULL,
    @machine_name    NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @now DATETIME2(0) = SYSDATETIME();

    /* Si este equipo dice quien es, SU caja es la que tiene arrendada. Caer a
       `TOP 1 ... ORDER BY id` significaria "la Caja 1", que es de otro equipo:
       el mismo error que hacia que la laptop validara la caja de la VM. */
    IF @register_id IS NULL AND NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N'') IS NOT NULL
        SELECT @register_id = a.register_id
        FROM dbo.register_assignments a
        WHERE a.machine_id = @machine_id
          AND a.released_at IS NULL
          AND a.lease_until > SYSUTCDATETIME();

    IF @register_id IS NULL
        SELECT TOP 1 @register_id = id FROM dbo.registers ORDER BY id;


    /* ---------------- MULTICAJA: esta caja es de este equipo ----------------
       La proteccion NO puede vivir solo en el selector de la pantalla. El
       turno es de la CAJA (`cash_closures.register_id`), asi que dos equipos
       declarados C1 comparten turno y comparten corte: cerrar en uno cierra
       para el otro y las ventas de ambos caen en el mismo arqueo. Eso es
       dinero, y tiene que rechazarse aqui, donde no hay UI que saltarse.

       `@machine_id` NULO = el que llama no dice quien es. Entonces NO se
       exige nada: es el contrato de siempre, el que usan las instalaciones de
       una sola caja, las pruebas y cualquier version anterior de la app. Una
       instalacion MonoCaja no gana ni una friccion por esto.

       Cuando SI se identifica, la llamada ademas RENUEVA el arriendo. Una
       caja que esta vendiendo no puede perder su identidad porque un
       temporizador se estrangulo: vender es la senal de vida mas fuerte que
       existe. Y si el arriendo habia caducado sin que nadie lo tomara, se
       recupera en el acto en vez de interrumpir la venta.
       ---------------------------------------------------------------------- */
    IF NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N'') IS NOT NULL
    BEGIN
        DECLARE @lease_res NVARCHAR(20), @lease_holder NVARCHAR(64),
                @lease_holder_name NVARCHAR(120), @lease_hasta DATETIME2(0);

        EXEC dbo.sp_register_lease_touch
            @register_id   = @register_id,
            @machine_id    = @machine_id,
            @machine_name  = @machine_name,
            @lease_seconds = 300,
            @resultado     = @lease_res OUTPUT,
            @holder_id     = @lease_holder OUTPUT,
            @holder_name   = @lease_holder_name OUTPUT,
            @lease_until   = @lease_hasta OUTPUT;

        IF @lease_res = N'OCUPADA'
        BEGIN
            /* Sin acentos a proposito: el texto de un error de SQL Server
               llega al cliente degradado a un byte por caracter y cualquier
               acento se convierte en basura. El nombre del equipo si viaja
               bien porque lo puso el propio equipo. */
            DECLARE @lease_quien NVARCHAR(120) =
                ISNULL(NULLIF(LTRIM(RTRIM(@lease_holder_name)), N''), N'otro equipo');
            RAISERROR('Esta caja la esta usando %s. Dos equipos no pueden operar la misma caja: cada una lleva su propio turno y su propio corte.', 16, 1, @lease_quien);
            RETURN;
        END
    END
    BEGIN TRY
        BEGIN TRAN;

        /* Un turno abierto por CAJA (no por usuario) */
        IF EXISTS (
            SELECT 1
            FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
            WHERE register_id = @register_id
              AND closed_at IS NULL
        )
        BEGIN
            RAISERROR('Ya existe un turno abierto en esta caja.', 16, 1);
            ROLLBACK TRAN;
            RETURN;
        END

        /* 0051: queda el equipo que abrio, y quien abrio nunca queda vacio:
           si no se dice otra cosa, es el mismo usuario dueno del turno. */
        INSERT INTO dbo.cash_closures (
            userId, create_date, opened_at, closed_at,
            opening_cash, opening_note, opening_user_id,
            cash_expected, cash_delivered, difference,
            register_id, opened_machine_id, opened_machine_name
        )
        VALUES (
            @user_id, CAST(@now AS DATE), @now, NULL,
            ISNULL(@opening_cash, 0), @opening_note, ISNULL(@opening_user_id, @user_id),
            0, 0, 0,
            @register_id,
            NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N''), @machine_name
        );

        DECLARE @closure_id INT = SCOPE_IDENTITY();

        IF ISNULL(@opening_cash,0) > 0
        BEGIN
            INSERT INTO dbo.cash_movements (
                datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id
            )
            VALUES (
                @now, @user_id, 'OPENING', @closure_id, 'FONDO INICIAL',
                ISNULL(@opening_cash,0), @opening_note, NULL, @register_id
            );
        END

        COMMIT TRAN;

        SELECT
            @closure_id AS closure_id,
            @user_id AS user_id,
            CAST(@now AS DATE) AS create_date,
            @now AS opened_at,
            ISNULL(@opening_cash,0) AS opening_cash,
            @register_id AS register_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_sync_capture (SQL_STORED_PROCEDURE) ---------- */
/* sp_sync_capture
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_sync_capture ======================
   0051. Convierte lo que cambio desde la ultima captura en EVENTOS del outbox.

   POR QUE ASI Y NO DESDE CADA PROCEDURE
   -------------------------------------
   Una venta se escribe por varios caminos (Retail, Touch, Hospitality,
   importacion, edicion, devolucion). Emitir el evento dentro de cada uno era
   tocar `sp_register_sale` y otros cinco procedures criticos, y bastaba
   olvidar un camino para perder hechos. Aqui se lee la VERSION de fila
   (`rowversion`): todo lo confirmado, venga de donde venga, se captura.

   SIN PERDER NADA
   ---------------
   Una transaccion abierta puede tener una version MENOR que otra ya
   confirmada. Si se capturara hasta "lo mas nuevo", esa fila se confirmaria
   despues por debajo de la marca y nunca se veria. Por eso el tope es
   `MIN_ACTIVE_ROWVERSION()`: solo se captura por debajo de la transaccion
   abierta mas antigua.

   IDEMPOTENTE
   -----------
   El UUID de cada evento se DERIVA de (agregado, uuid, version): capturar dos
   veces lo mismo produce el mismo UUID y la llave unica del outbox lo
   descarta. La nube hace lo mismo del otro lado.

   QUE ES CADA EVENTO
   ------------------
   La carga es el ESTADO del agregado en esa version (una venta con su total y
   sus devoluciones; un turno con sus montos). Los saldos (existencias,
   credito) NO viajan: se reconstruyen de los hechos.
       SALE          SALE_RECORDED / SALE_UPDATED
       SHIFT         SHIFT_OPENED / SHIFT_CLOSED
       CASH_MOVEMENT CASH_MOVEMENT_RECORDED (todo menos SALE, que ya va en la venta)
   ============================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_sync_capture
    @max_rows INT = 500
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @offset INT = DATEPART(TZOFFSET, SYSDATETIMEOFFSET());
    DECLARE @tope BINARY(8) = MIN_ACTIVE_ROWVERSION();
    DECLARE @capturados INT = 0;

    BEGIN TRAN;

    /* La primera vez no se arrastra toda la historia: se parte de lo que tiene
       menos de 62 dias. Lo anterior que cambie despues tambien se captura. */
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'SALE')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv)
        SELECT 'SALE', ISNULL(MAX(rv), 0x0000000000000000) FROM dbo.sales WHERE datee < DATEADD(DAY, -62, GETDATE());
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'SHIFT')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv)
        SELECT 'SHIFT', ISNULL(MAX(rv), 0x0000000000000000) FROM dbo.cash_closures WHERE opened_at < DATEADD(DAY, -62, SYSDATETIME());
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'CASH_MOVEMENT')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv)
        SELECT 'CASH_MOVEMENT', ISNULL(MAX(rv), 0x0000000000000000) FROM dbo.cash_movements WHERE datee < DATEADD(DAY, -62, SYSDATETIME());

    DECLARE @wm BINARY(8);

    /* ------------------------------------------------------------- VENTAS */
    SELECT @wm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'SALE';

    SELECT TOP (@max_rows) s.id, s.uuid, s.rv, CAST(s.rv AS BIGINT) AS version
      INTO #ventas
      FROM dbo.sales s
     WHERE s.rv > @wm AND s.rv < @tope
     ORDER BY s.rv;

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid,
           CASE WHEN EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.aggregate_uuid = s.uuid) THEN 'SALE_UPDATED' ELSE 'SALE_RECORDED' END,
           'SALE', s.uuid, v.version, TODATETIMEOFFSET(s.datee, @offset),
           (SELECT
                s.uuid                          AS sale_uuid,
                s.id                            AS folio,
                CONVERT(VARCHAR(10), CAST(s.datee AS DATE), 23) AS business_date,
                CONVERT(VARCHAR(19), s.datee, 126) AS occurred_local,
                s.total                         AS total,
                s.paid_amount                   AS paid_amount,
                s.balance                       AS balance,
                s.payment_method                AS payment_method,
                s.service_mode                  AS service_mode,
                s.venta_esencial                AS venta_esencial,
                ISNULL((SELECT SUM(r.refund_total) FROM dbo.sale_refunds r WHERE r.sale_id = s.id), 0) AS refunded_total,
                rg.uuid AS [register.uuid], rg.code AS [register.code], rg.name AS [register.name],
                u.uuid  AS [user.uuid],     u.usuario AS [user.name]
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #ventas v
      JOIN dbo.sales s ON s.id = v.id
      LEFT JOIN dbo.registers rg ON rg.id = s.register_id
      LEFT JOIN dbo.users u ON u.id = s.useer_id
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256',
                    CONCAT('SALE|', CONVERT(VARCHAR(36), s.uuid), '|', v.version)) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #ventas)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #ventas), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'SALE';

    /* ------------------------------------------------------------- TURNOS */
    SELECT @wm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'SHIFT';

    SELECT TOP (@max_rows) c.id, c.uuid, c.rv, CAST(c.rv AS BIGINT) AS version
      INTO #turnos
      FROM dbo.cash_closures c
     WHERE c.rv > @wm AND c.rv < @tope
     ORDER BY c.rv;

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid,
           CASE WHEN c.closed_at IS NULL THEN 'SHIFT_OPENED' ELSE 'SHIFT_CLOSED' END,
           'SHIFT', c.uuid, t.version,
           TODATETIMEOFFSET(ISNULL(c.closed_at, c.opened_at), @offset),
           (SELECT
                c.uuid                AS shift_uuid,
                c.id                  AS closure_id,
                CASE WHEN c.closed_at IS NULL THEN 'OPEN' ELSE 'CLOSED' END AS status,
                CONVERT(VARCHAR(10), CAST(c.opened_at AS DATE), 23) AS business_date,
                CONVERT(VARCHAR(19), c.opened_at, 126) AS opened_local,
                CONVERT(VARCHAR(19), c.closed_at, 126) AS closed_local,
                c.opening_cash        AS opening_cash,
                CASE WHEN c.closed_at IS NULL THEN NULL ELSE c.cash_expected END  AS cash_expected,
                CASE WHEN c.closed_at IS NULL THEN NULL ELSE c.cash_delivered END AS cash_counted,
                CASE WHEN c.closed_at IS NULL THEN NULL ELSE c.difference END     AS difference,
                c.blind_count         AS blind_count,
                c.opened_machine_name AS opened_device,
                c.closed_machine_name AS closed_device,
                rg.uuid AS [register.uuid], rg.code AS [register.code], rg.name AS [register.name],
                uo.uuid AS [opened_by.uuid], uo.usuario AS [opened_by.name],
                uc.uuid AS [closed_by.uuid], uc.usuario AS [closed_by.name],
                ua.uuid AS [authorized_by.uuid], ua.usuario AS [authorized_by.name]
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #turnos t
      JOIN dbo.cash_closures c ON c.id = t.id
      LEFT JOIN dbo.registers rg ON rg.id = c.register_id
      LEFT JOIN dbo.users uo ON uo.id = ISNULL(c.opening_user_id, c.userId)
      LEFT JOIN dbo.users uc ON uc.id = c.closed_by_user_id
      LEFT JOIN dbo.users ua ON ua.id = c.close_authorized_by
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256',
                    CONCAT('SHIFT|', CONVERT(VARCHAR(36), c.uuid), '|', t.version)) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #turnos)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #turnos), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'SHIFT';

    /* ------------------------------------------------- MOVIMIENTOS DE CAJA */
    SELECT @wm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'CASH_MOVEMENT';

    SELECT TOP (@max_rows) m.id, m.uuid, m.rv, CAST(m.rv AS BIGINT) AS version, m.typee
      INTO #movs
      FROM dbo.cash_movements m
     WHERE m.rv > @wm AND m.rv < @tope
     ORDER BY m.rv;

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid, 'CASH_MOVEMENT_RECORDED', 'CASH_MOVEMENT', m.uuid, x.version,
           TODATETIMEOFFSET(CAST(m.datee AS DATETIME2(0)), @offset),
           (SELECT
                m.uuid          AS movement_uuid,
                m.typee         AS type,
                m.amount        AS amount,
                CONVERT(VARCHAR(10), CAST(m.datee AS DATE), 23) AS business_date,
                CONVERT(VARCHAR(19), CAST(m.datee AS DATETIME2(0)), 126) AS occurred_local,
                m.reference     AS reference,
                m.note          AS note,
                c.uuid          AS shift_uuid,
                rg.uuid AS [register.uuid], rg.code AS [register.code], rg.name AS [register.name],
                u.uuid  AS [user.uuid], u.usuario AS [user.name]
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #movs x
      JOIN dbo.cash_movements m ON m.id = x.id
      LEFT JOIN dbo.cash_closures c ON c.id = m.closure_id
      LEFT JOIN dbo.registers rg ON rg.id = m.register_id
      LEFT JOIN dbo.users u ON u.id = m.userId
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256',
                    CONCAT('CASH_MOVEMENT|', CONVERT(VARCHAR(36), m.uuid), '|', x.version)) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE x.typee <> 'SALE'
       AND NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #movs)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #movs), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'CASH_MOVEMENT';

    COMMIT TRAN;

    SELECT @capturados AS capturados,
           (SELECT COUNT(*) FROM dbo.sync_outbox WHERE status = 'PENDING') AS pendientes;
END
GO

/* ---------- sp_sync_outbox_ack (SQL_STORED_PROCEDURE) ---------- */
/* sp_sync_outbox_ack
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_sync_outbox_ack ======================
   0051. Lo que respondio la nube, evento por evento:

       APPLIED / DUPLICATE   -> SENT      (las dos son exito: la nube ya lo tiene)
       REJECTED              -> REJECTED  (la nube no lo acepta: no se reintenta)
       cualquier otra cosa   -> sigue PENDING, suma un intento y guarda el error

   `@acuses` es JSON: [{"event_uuid":"...","result":"APPLIED","error":null}, ...]
   ================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_sync_outbox_ack
    @acuses NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH a AS (
        SELECT TRY_CAST(j.event_uuid AS UNIQUEIDENTIFIER) AS event_uuid,
               UPPER(ISNULL(j.result, '')) AS result,
               LEFT(j.error, 400) AS error
          FROM OPENJSON(@acuses) WITH (
                event_uuid NVARCHAR(36) '$.event_uuid',
                result     NVARCHAR(20) '$.result',
                error      NVARCHAR(400) '$.error') j
    )
    UPDATE o
       SET status     = CASE WHEN a.result IN ('APPLIED', 'DUPLICATE') THEN 'SENT'
                             WHEN a.result = 'REJECTED' THEN 'REJECTED'
                             ELSE o.status END,
           sent_at    = CASE WHEN a.result IN ('APPLIED', 'DUPLICATE') THEN SYSUTCDATETIME() ELSE o.sent_at END,
           attempts   = o.attempts + 1,
           last_error = CASE WHEN a.result IN ('APPLIED', 'DUPLICATE') THEN NULL ELSE ISNULL(a.error, a.result) END
      FROM dbo.sync_outbox o
      JOIN a ON a.event_uuid = o.event_uuid
     WHERE o.status = 'PENDING';

    SELECT @@ROWCOUNT AS actualizados;
END
GO

/* ---------- sp_sync_outbox_next (SQL_STORED_PROCEDURE) ---------- */
/* sp_sync_outbox_next
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_sync_outbox_next ======================
   0051. El siguiente lote de eventos por enviar, en orden de captura, y la
   identidad de la instancia para el sobre (empresa, ubicacion, instancia).

   El orden importa: un turno se abre antes de cerrarse y una venta se registra
   antes de editarse. La nube aplica "la version mayor gana" por agregado, asi
   que un desorden no corrompe nada, pero enviar en orden evita estados
   intermedios raros en el tablero.
   ================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_sync_outbox_next
    @max_rows INT = 100
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@max_rows)
           o.event_uuid, o.event_type, o.aggregate_type, o.aggregate_uuid, o.aggregate_version,
           o.occurred_at, o.payload_version, o.payload, o.attempts
      FROM dbo.sync_outbox o
     WHERE o.status = 'PENDING'
     ORDER BY o.id;

    SELECT
        (SELECT valor FROM dbo.database_metadata WHERE clave = 'instance_uuid') AS instance_uuid,
        (SELECT valor FROM dbo.database_metadata WHERE clave = 'company_uuid')  AS company_uuid,
        (SELECT valor FROM dbo.database_metadata WHERE clave = 'location_uuid') AS location_uuid;
END
GO
