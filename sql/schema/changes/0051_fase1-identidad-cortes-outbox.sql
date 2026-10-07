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
