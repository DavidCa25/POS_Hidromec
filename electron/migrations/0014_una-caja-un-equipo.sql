/* ============================================================
   0014 — una caja un equipo

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0014_una-caja-un-equipo.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0014_una-caja-un-equipo.sql ========== */
/* ---------------------------------------------------------------------------
   BLOQUE DE ESQUEMA — una caja, un equipo.

   Crea `register_assignments` y le siembra una fila LIBRE por cada caja que ya
   exista. La siembra es lo que hace que la actualizacion no le cambie nada a
   nadie: al arrancar, cada equipo reclama la caja que ya tenia guardada en su
   `device-config.json` y la toma sin conflicto, porque nadie mas la tiene.

   Idempotente: se puede reejecutar. Ni la tabla se duplica ni las filas.
   No toca `registers`, ni `cash_closures`, ni `sales`: ningun turno ni ninguna
   venta historica cambia.
   --------------------------------------------------------------------------- */

IF OBJECT_ID(N'dbo.register_assignments', 'U') IS NULL
BEGIN
CREATE TABLE dbo.register_assignments (
    register_id  INT NOT NULL,
    machine_id   NVARCHAR(64) COLLATE Modern_Spanish_CI_AS NOT NULL,
    machine_name NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
    claimed_at   DATETIME2(0) NOT NULL CONSTRAINT DF_register_assignments_claimed_at DEFAULT (sysutcdatetime()),
    heartbeat_at DATETIME2(0) NOT NULL CONSTRAINT DF_register_assignments_heartbeat_at DEFAULT (sysutcdatetime()),
    lease_until  DATETIME2(0) NOT NULL CONSTRAINT DF_register_assignments_lease_until DEFAULT (sysutcdatetime()),
    released_at  DATETIME2(0) NULL,
    released_by  NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    CONSTRAINT PK_register_assignments PRIMARY KEY CLUSTERED (register_id),
    CONSTRAINT FK_register_assignments_register FOREIGN KEY (register_id)
        REFERENCES dbo.registers (id)
);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_register_assignments_machine' AND object_id = OBJECT_ID(N'dbo.register_assignments'))
CREATE NONCLUSTERED INDEX IX_register_assignments_machine ON dbo.register_assignments (machine_id) INCLUDE (lease_until, released_at);
GO

/* Una fila LIBRE por caja existente. `machine_id` vacio no coincide con
   ninguna maquina real, y `released_at` puesto la deja disponible: la primera
   que la reclame se la lleva. */
INSERT INTO dbo.register_assignments
    (register_id, machine_id, machine_name, claimed_at, heartbeat_at, lease_until, released_at, released_by)
SELECT r.id, N'', NULL, SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME(), N'INICIAL'
FROM dbo.registers r
WHERE NOT EXISTS (SELECT 1 FROM dbo.register_assignments a WHERE a.register_id = r.id);
GO

/* ---------- sp_add_register (SQL_STORED_PROCEDURE) ---------- */
/* sp_add_register
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Crear caja ----
   code: prefijo de folio (C1, C2, ...). Si no se manda, se genera C{n}.
*/
CREATE OR ALTER PROCEDURE [dbo].[sp_add_register]
    @name NVARCHAR(60),
    @code NVARCHAR(10) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        BEGIN TRAN;

        IF (LTRIM(RTRIM(ISNULL(@name,''))) = '')
        BEGIN
            RAISERROR('El nombre de la caja es obligatorio.', 16, 1);
            ROLLBACK TRAN; RETURN;
        END

        -- Genera un code tipo C{siguiente} si no lo mandan
        IF (@code IS NULL OR LTRIM(RTRIM(@code)) = '')
        BEGIN
            DECLARE @next INT = (SELECT ISNULL(MAX(id),0) + 1 FROM dbo.registers);
            SET @code = CONCAT('C', @next);
        END

        IF EXISTS (SELECT 1 FROM dbo.registers WHERE code = @code)
        BEGIN
            RAISERROR('Ya existe una caja con ese codigo.', 16, 1);
            ROLLBACK TRAN; RETURN;
        END

        INSERT INTO dbo.registers (code, name, is_active)
        VALUES (@code, @name, 1);

        DECLARE @new_id INT = SCOPE_IDENTITY();

        /* La caja nace con su fila de asignacion, LIBRE. Que la fila exista
           siempre es lo que permite que reclamarla sea un UPDATE sobre la
           clave primaria -una sola sentencia, un solo candado- en vez de un
           INSERT condicional con su carrera. Nace en la misma transaccion
           que la caja: no hay ventana en la que exista una sin la otra. */
        INSERT INTO dbo.register_assignments
            (register_id, machine_id, machine_name, claimed_at, heartbeat_at, lease_until, released_at, released_by)
        VALUES (@new_id, N'', NULL, SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME(), N'INICIAL');

        COMMIT TRAN;

        SELECT id, code, name, is_active, created_at
        FROM dbo.registers
        WHERE id = @new_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
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
    @machine_name   NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @now DATETIME2(0) = SYSDATETIME();
    IF @closure_date IS NULL
        SET @closure_date = CAST(@now AS DATE);

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

            IF @user_id IS NOT NULL AND @user_id <> @shift_user_id
            BEGIN
                RAISERROR('El turno no pertenece al usuario indicado.', 16, 1);
                ROLLBACK TRAN;
                RETURN;
            END
        END
        ELSE
        BEGIN
            /* Sin closure_id: cerrar el turno abierto de ESTA CAJA */
            SELECT TOP (1)
                @cid          = id,
                @shift_user_id= userId,
                @opened_at    = opened_at,
                @opening_cash = opening_cash
            FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
            WHERE register_id = @register_id
              AND closed_at IS NULL
            ORDER BY opened_at DESC, id DESC;

            IF @cid IS NULL
            BEGIN
                RAISERROR('No hay un turno abierto en esta caja.', 16, 1);
                ROLLBACK TRAN;
                RETURN;
            END
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
               create_date    = ISNULL(create_date, CAST(@opened_at AS DATE))
         WHERE id = @cid;

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
            @register_id    AS register_id;

    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@ErrMsg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_get_register_assignments (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_register_assignments
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_get_register_assignments — el catalogo de cajas CON quien tiene cada una.

   Sustituye a `sp_get_registers` en la pantalla de Cajas. Devuelve las mismas
   columnas -para no romper a quien ya las lee- mas el estado del arriendo,
   resuelto aqui y no en la pantalla: el unico reloj valido es el del servidor,
   y una pantalla que reste fechas con la hora local dira "libre" o "ocupada"
   segun lo adelantado que ande ese equipo.

   `estado` se entrega ya masticado:
     LIBRE     nadie la tiene
     MIA       la tiene este equipo
     OCUPADA   la tiene otro equipo, ahora mismo
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_register_assignments]
    @machine_id  NVARCHAR(64) = NULL,
    @only_active BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @now DATETIME2(0) = SYSUTCDATETIME();
    SET @machine_id = NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N'');

    SELECT
        r.id,
        r.code,
        r.name,
        r.is_active,
        r.created_at,
        CASE WHEN a.released_at IS NULL AND a.lease_until > @now THEN 1 ELSE 0 END AS tomada,
        CASE
            WHEN a.register_id IS NULL                                   THEN N'LIBRE'
            WHEN a.released_at IS NOT NULL OR a.lease_until <= @now      THEN N'LIBRE'
            WHEN @machine_id IS NOT NULL AND a.machine_id = @machine_id  THEN N'MIA'
            ELSE N'OCUPADA'
        END AS estado,
        CASE WHEN a.released_at IS NULL AND a.lease_until > @now THEN a.machine_id END       AS holder_machine_id,
        CASE WHEN a.released_at IS NULL AND a.lease_until > @now THEN a.machine_name END     AS holder_machine_name,
        CASE WHEN a.released_at IS NULL AND a.lease_until > @now THEN a.lease_until END      AS lease_until,
        CASE WHEN a.released_at IS NULL AND a.lease_until > @now
             THEN DATEDIFF(SECOND, @now, a.lease_until) END                                  AS segundos_restantes,
        a.heartbeat_at,
        /* Quien la tuvo por ultima vez, este tomada o no. Es lo que permite
           decir "la tenia CAJA-MOSTRADOR" cuando alguien pregunta por que no
           puede entrar, en vez de un hueco. */
        a.machine_name AS ultimo_equipo,
        a.released_by
    FROM dbo.registers r
    LEFT JOIN dbo.register_assignments a ON a.register_id = r.id
    WHERE (@only_active = 0 OR r.is_active = 1)
    ORDER BY r.id;
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

        INSERT INTO dbo.cash_closures (
            userId, create_date, opened_at, closed_at,
            opening_cash, opening_note, opening_user_id,
            cash_expected, cash_delivered, difference,
            register_id
        )
        VALUES (
            @user_id, CAST(@now AS DATE), @now, NULL,
            ISNULL(@opening_cash, 0), @opening_note, @opening_user_id,
            0, 0, 0,
            @register_id
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

/* ---------- sp_register_claim (SQL_STORED_PROCEDURE) ---------- */
/* sp_register_claim
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_register_claim — "esta maquina es esta caja".

   Lo llama la app en tres momentos que son el mismo: al elegir la caja en
   Configuracion, al arrancar (reclamando la que quedo guardada) y cada minuto
   mientras esta abierta. Envuelve a `sp_register_lease_touch` y devuelve algo
   que la pantalla pueda mostrar tal cual.

   EL MENSAJE VIAJA COMO DATO, NO COMO ERROR
   -----------------------------------------
   Perder la carrera no es una excepcion: es una respuesta. Y ademas el
   controlador `msnodesqlv8` degrada el TEXTO de los errores a un byte por
   caracter -los acentos llegan como U+FFFD- mientras que las filas de datos
   conservan el juego de caracteres. Un nombre de equipo con acento solo
   sobrevive por el canal de datos.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_register_claim]
    @register_id   INT,
    @machine_id    NVARCHAR(64),
    @machine_name  NVARCHAR(120) = NULL,
    @lease_seconds INT = 300
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @resultado NVARCHAR(20), @holder_id NVARCHAR(64),
            @holder_name NVARCHAR(120), @hasta DATETIME2(0);

    EXEC dbo.sp_register_lease_touch
        @register_id   = @register_id,
        @machine_id    = @machine_id,
        @machine_name  = @machine_name,
        @lease_seconds = @lease_seconds,
        @resultado     = @resultado OUTPUT,
        @holder_id     = @holder_id OUTPUT,
        @holder_name   = @holder_name OUTPUT,
        @lease_until   = @hasta OUTPUT;

    DECLARE @quien NVARCHAR(120) = ISNULL(NULLIF(LTRIM(RTRIM(@holder_name)), N''), N'otro equipo');

    SELECT
        CASE WHEN @resultado IN (N'RECLAMADA', N'RENOVADA', N'RECUPERADA') THEN 1 ELSE 0 END AS ok,
        @resultado                AS resultado,
        @register_id              AS register_id,
        (SELECT name FROM dbo.registers WHERE id = @register_id) AS register_name,
        @holder_id                AS holder_machine_id,
        @holder_name              AS holder_machine_name,
        @hasta                    AS lease_until,
        CASE WHEN @hasta IS NULL THEN NULL
             ELSE DATEDIFF(SECOND, SYSUTCDATETIME(), @hasta) END AS segundos_restantes,
        CASE @resultado
            WHEN N'OCUPADA'  THEN CONCAT(N'Esta caja la está usando ', @quien,
                                         N'. Libérala en ese equipo, o elige otra caja.')
            WHEN N'SIN_CAJA' THEN N'Esa caja ya no existe en el catálogo.'
            ELSE NULL
        END AS mensaje;
END
GO

/* ---------- sp_register_lease_touch (SQL_STORED_PROCEDURE) ---------- */
/* sp_register_lease_touch
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_register_lease_touch — el unico sitio donde se toma una caja.

   Reclamar, renovar y recuperar son la MISMA operacion: "este equipo sigue
   siendo esta caja, cuentalo desde ahora". Separarlas en tres procedimientos
   habria dado tres implementaciones de la misma carrera, y la carrera es
   justo lo unico dificil de esto.

   POR QUE UN SELECT CON UPDLOCK Y NO UN "UPDATE ... WHERE"
   -------------------------------------------------------
   Un UPDATE condicional tambien seria atomico, pero no dejaria decir QUIEN
   tiene la caja cuando se pierde la carrera, y ese dato es la mitad del valor
   para quien esta parado frente a la pantalla. Con UPDLOCK, HOLDLOCK sobre la
   clave primaria, dos equipos que reclaman C1 a la vez se serializan: el
   segundo espera, y cuando entra LEE el estado que dejo el primero. Uno gana,
   el otro se entera de por que perdio.

   EL RELOJ ES EL DEL SERVIDOR
   ---------------------------
   SYSUTCDATETIME() se lee UNA vez y se usa para todo. Con la hora del cliente
   bastaria adelantar el reloj local para robar una caja viva.

   RESULTADO
   ---------
     RECLAMADA   estaba libre (nunca tomada, liberada o caducada) y es mia
     RENOVADA    ya era mia y seguia viva
     RECUPERADA  era mia, habia caducado, y nadie la tomo entre medias
     OCUPADA     la tiene otro equipo, con arriendo vigente. No se toca nada.
     SIN_CAJA    ese register_id no existe

   Idempotente: llamarlo mil veces seguidas deja exactamente el mismo estado.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_register_lease_touch]
    @register_id   INT,
    @machine_id    NVARCHAR(64),
    @machine_name  NVARCHAR(120) = NULL,
    @lease_seconds INT = 300,
    @resultado     NVARCHAR(20)  OUTPUT,
    @holder_id     NVARCHAR(64)  OUTPUT,
    @holder_name   NVARCHAR(120) OUTPUT,
    @lease_until   DATETIME2(0)  OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @resultado  = NULL;
    SET @holder_id  = NULL;
    SET @holder_name = NULL;
    SET @lease_until = NULL;

    SET @machine_id = LTRIM(RTRIM(ISNULL(@machine_id, N'')));
    IF @machine_id = N''
    BEGIN
        RAISERROR('Falta la identidad del equipo para tomar la caja.', 16, 1);
        RETURN;
    END

    /* Un arriendo de 5 segundos convertiria cualquier microcorte en una caja
       perdida; uno de un dia devuelve el problema que se queria evitar. */
    SET @lease_seconds = CASE
        WHEN ISNULL(@lease_seconds, 0) < 30   THEN 30
        WHEN @lease_seconds > 3600            THEN 3600
        ELSE @lease_seconds END;

    IF NOT EXISTS (SELECT 1 FROM dbo.registers WHERE id = @register_id)
    BEGIN
        SET @resultado = N'SIN_CAJA';
        RETURN;
    END

    DECLARE @now DATETIME2(0) = SYSUTCDATETIME();
    DECLARE @hasta DATETIME2(0) = DATEADD(SECOND, @lease_seconds, @now);

    /* La fila tiene que existir para que reclamar sea un UPDATE puro. Nace
       LIBRE (released_at = ahora) y con un machine_id que ningun equipo real
       puede tener. Si dos equipos la crean a la vez, uno choca contra la clave
       primaria: eso no es un fallo, es que el otro ya hizo el trabajo. */
    IF NOT EXISTS (SELECT 1 FROM dbo.register_assignments WHERE register_id = @register_id)
    BEGIN
        /* XACT_ABORT se apaga SOLO aqui a proposito: con el encendido, una
           violacion de clave primaria condena la transaccion entera en vez de
           dejarse atrapar, y lo que aqui se quiere es exactamente lo
           contrario: que el choque sea inofensivo. */
        SET XACT_ABORT OFF;
        BEGIN TRY
            INSERT INTO dbo.register_assignments
                (register_id, machine_id, machine_name, claimed_at, heartbeat_at, lease_until, released_at, released_by)
            VALUES (@register_id, N'', NULL, @now, @now, @now, @now, N'INICIAL');
        END TRY
        BEGIN CATCH
            IF ERROR_NUMBER() NOT IN (2601, 2627) THROW;
        END CATCH
        SET XACT_ABORT ON;
    END

    DECLARE @cur_machine NVARCHAR(64), @cur_name NVARCHAR(120);
    DECLARE @cur_until DATETIME2(0), @cur_released DATETIME2(0);

    BEGIN TRAN;

        SELECT @cur_machine  = machine_id,
               @cur_name     = machine_name,
               @cur_until    = lease_until,
               @cur_released = released_at
        FROM dbo.register_assignments WITH (UPDLOCK, HOLDLOCK)
        WHERE register_id = @register_id;

        DECLARE @era_mia  BIT = CASE WHEN @cur_machine = @machine_id THEN 1 ELSE 0 END;
        DECLARE @vigente  BIT = CASE WHEN @cur_released IS NULL AND @cur_until > @now THEN 1 ELSE 0 END;

        IF (@vigente = 1 AND @era_mia = 0)
        BEGIN
            SET @resultado   = N'OCUPADA';
            SET @holder_id   = @cur_machine;
            SET @holder_name = @cur_name;
            SET @lease_until = @cur_until;
        END
        ELSE
        BEGIN
            UPDATE dbo.register_assignments
               SET machine_id   = @machine_id,
                   machine_name = ISNULL(NULLIF(LTRIM(RTRIM(@machine_name)), N''), machine_name),
                   heartbeat_at = @now,
                   lease_until  = @hasta,
                   released_at  = NULL,
                   released_by  = NULL,
                   /* `claimed_at` marca desde cuando este equipo es esta caja
                      SIN interrupcion. Un latido no lo mueve; recuperarla tras
                      una caida si, porque hubo un hueco. */
                   claimed_at   = CASE WHEN @era_mia = 1 AND @vigente = 1 THEN claimed_at ELSE @now END
             WHERE register_id = @register_id;

            SET @resultado = CASE
                WHEN @era_mia = 1 AND @vigente = 1 THEN N'RENOVADA'
                WHEN @era_mia = 1                  THEN N'RECUPERADA'
                ELSE N'RECLAMADA' END;
            SET @holder_id   = @machine_id;
            SET @holder_name = @machine_name;
            SET @lease_until = @hasta;
        END

    COMMIT TRAN;
END
GO

/* ---------- sp_register_release (SQL_STORED_PROCEDURE) ---------- */
/* sp_register_release
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_register_release — soltar la caja.

   DOS CAMINOS, Y LA DIFERENCIA IMPORTA
   ------------------------------------
   EQUIPO  Wybix se cierra limpiamente y suelta SU caja. Solo puede soltar la
           suya: por eso se exige @machine_id y se compara. Sin esto, un
           equipo podria echar a otro sin que nadie lo autorice.

   ADMIN   alguien con permiso libera una caja desde Configuracion porque el
           equipo que la tenia ya no existe -robado, reinstalado, muerto- y
           no quiere esperar a que caduque el arriendo. Es la escotilla, y se
           registra como tal en `released_by`.

   Sin la escotilla, cambiar de equipo obligaria a esperar; sin la
   comprobacion de @machine_id, la escotilla estaria abierta para todos. Las
   dos cosas a la vez, no una.

   Idempotente: liberar algo ya libre devuelve 'YA_LIBRE' y no es un error.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_register_release]
    @register_id  INT,
    @machine_id   NVARCHAR(64) = NULL,
    @por          NVARCHAR(20) = N'EQUIPO'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @por = UPPER(LTRIM(RTRIM(ISNULL(@por, N'EQUIPO'))));
    IF @por NOT IN (N'EQUIPO', N'ADMIN')
    BEGIN
        RAISERROR('Origen de liberacion invalido: EQUIPO o ADMIN.', 16, 1);
        RETURN;
    END

    SET @machine_id = LTRIM(RTRIM(ISNULL(@machine_id, N'')));
    IF @por = N'EQUIPO' AND @machine_id = N''
    BEGIN
        RAISERROR('Falta la identidad del equipo para soltar la caja.', 16, 1);
        RETURN;
    END

    DECLARE @now DATETIME2(0) = SYSUTCDATETIME();
    DECLARE @resultado NVARCHAR(20) = N'YA_LIBRE';
    DECLARE @cur_machine NVARCHAR(64), @cur_name NVARCHAR(120);

    BEGIN TRAN;

        SELECT @cur_machine = machine_id, @cur_name = machine_name
        FROM dbo.register_assignments WITH (UPDLOCK, HOLDLOCK)
        WHERE register_id = @register_id
          AND released_at IS NULL
          AND lease_until > @now;

        IF @cur_machine IS NOT NULL
        BEGIN
            IF @por = N'ADMIN' OR @cur_machine = @machine_id
            BEGIN
                UPDATE dbo.register_assignments
                   SET released_at = @now,
                       released_by = @por,
                       heartbeat_at = @now
                 WHERE register_id = @register_id;
                SET @resultado = CASE WHEN @por = N'ADMIN' THEN N'LIBERADA_ADMIN' ELSE N'LIBERADA' END;
            END
            ELSE
                SET @resultado = N'NO_ES_TUYA';
        END

    COMMIT TRAN;

    SELECT
        CASE WHEN @resultado IN (N'LIBERADA', N'LIBERADA_ADMIN', N'YA_LIBRE') THEN 1 ELSE 0 END AS ok,
        @resultado   AS resultado,
        @register_id AS register_id,
        @cur_name    AS holder_machine_name,
        CASE WHEN @resultado = N'NO_ES_TUYA'
             THEN CONCAT(N'Esa caja la tiene ', ISNULL(NULLIF(@cur_name, N''), N'otro equipo'),
                         N'. Solo ese equipo puede soltarla, o un administrador puede liberarla.')
             ELSE NULL END AS mensaje;
END
GO

/* ---------- sp_register_sale (SQL_STORED_PROCEDURE) ---------- */
/* sp_register_sale
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_register_sale — UNICA transaccion de venta de Wybix (Retail y Touch)

   La APP declara: que se vendio, cuanto, a que precio y que opciones eligio.
   La APP NO calcula inventario. Este procedure:

     lineas ─┬─ DIRECT  → requiere el propio producto
             ├─ RECIPE  → receta (variante por tamano, o base × SCALE)
             │            + modificadores ADD / REMOVE / SUBSTITUTE
             └─ NONE    → sin inventario
     ↓ agrupa requerimientos por producto
     ↓ bloquea products en orden ascendente de id (UPDLOCK, HOLDLOCK)
     ↓ valida stock → registra sale, sale_detail (con unit_cost), modifiers
     ↓ inventory_movements (ligados a la linea y al producto vendido)
     ↓ caja (solo efectivo contado, turno de la caja) → COMMIT

   Transicion ADITIVA: @SaleDetails (tipo v1) sigue funcionando tal cual;
   @SaleDetails2 / @SaleModifiers / @service_mode son opcionales.

   Errores dentro de la transaccion: se lanzan con RAISERROR (severidad 16),
   que dentro de un TRY transfiere al CATCH; ES EL CATCH quien hace el
   ROLLBACK. Una sola salida, un solo sitio donde se deshace todo.

   COMO INVOCARLO: directamente (EXEC / Command.Execute), como hace el IPC.
   NO se puede envolver en "INSERT ... EXEC": SQL Server prohibe el ROLLBACK
   dentro de esa construccion y sustituye cualquier error del procedure por
   "Cannot use the ROLLBACK statement within an INSERT-EXEC statement",
   ocultando la causa real (por ejemplo, que falto stock). Es una limitacion
   de INSERT-EXEC, no de este procedure.

   Concurrencia: transaccion corta, sin dispositivos dentro, bloqueo en orden
   consistente. Si SQL Server elige a esta sesion como victima de deadlock
   (1205) NADA quedo escrito: el IPC puede reintentar la misma intencion.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_register_sale]
    @user_id INT,
    @payment_method NVARCHAR(50),
    @SaleDetails dbo.SaleDetailType READONLY,
    @customer_id    INT = NULL,
    @due_date       DATE = NULL,
    @register_id    INT = NULL,
    @SaleDetails2   dbo.SaleDetailType2 READONLY,
    @SaleModifiers  dbo.SaleModifierType READONLY,
    @service_mode   NVARCHAR(10) = NULL,
    -- Identidad del equipo. Ver el bloque MULTICAJA mas abajo: NULO = no se
    -- exige nada, que es el contrato de MonoCaja y el de las versiones previas.
    @machine_id     NVARCHAR(64) = NULL,
    @machine_name   NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @sale_id INT;
    DECLARE @total   DECIMAL(10,2);
    DECLARE @is_credit BIT;
    DECLARE @errmsg NVARCHAR(400);

    IF @register_id IS NULL
        SELECT TOP 1 @register_id = id FROM dbo.registers ORDER BY id;

    SET @is_credit =
      CASE WHEN @customer_id IS NOT NULL AND UPPER(@payment_method) = 'CREDITO' THEN 1 ELSE 0 END;


    /* ---------------- MULTICAJA: esta caja es de este equipo ----------------
       La proteccion NO puede vivir solo en el selector de la pantalla. El
       turno es de la CAJA (`cash_closures.register_id`), asi que dos equipos
       declarados C1 comparten turno y comparten corte: las ventas de ambos
       caen en el mismo arqueo. Eso es dinero, y tiene que rechazarse aqui,
       donde no hay UI que saltarse.

       `@machine_id` NULO = el que llama no dice quien es. Entonces NO se
       exige nada: es el contrato de siempre, el que usan las instalaciones de
       una sola caja, las pruebas y cualquier version anterior de la app.

       Cuando SI se identifica, la llamada ademas RENUEVA el arriendo. Vender
       es la senal de vida mas fuerte que existe: una caja que esta cobrando
       no puede perder su identidad porque un temporizador se estrangulo.
       Se comprueba ANTES de abrir transaccion: no hay nada que deshacer.
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
            /* Sin acentos a proposito: el texto de un error de SQL Server llega
               degradado a un byte por caracter y los acentos se pierden. */
            DECLARE @lease_quien NVARCHAR(120) =
                ISNULL(NULLIF(LTRIM(RTRIM(@lease_holder_name)), N''), N'otro equipo');
            RAISERROR('Esta caja la esta usando %s. Dos equipos no pueden operar la misma caja: cada una lleva su propio turno y su propio corte.', 16, 1, @lease_quien);
            RETURN;
        END
    END

    /* Sin turno abierto en ESTA caja no se vende, se cobre como se cobre.
       Antes solo se exigia para el efectivo, porque el turno hacia falta para
       colgar el movimiento de caja: una venta con tarjeta o a credito entraba
       sin turno y quedaba fuera del corte del dia. El turno no es un detalle
       del efectivo, es a quien pertenece la venta.
       Se comprueba ANTES de abrir transaccion: no hay nada que deshacer. */
    IF NOT EXISTS (
        SELECT 1 FROM dbo.cash_closures
        WHERE register_id = @register_id AND closed_at IS NULL)
    BEGIN
        RAISERROR('No hay un turno abierto en esta caja. Abre el turno antes de vender.', 16, 1);
        RETURN;
    END

    IF @service_mode IS NOT NULL
    BEGIN
        SET @service_mode = UPPER(LTRIM(RTRIM(@service_mode)));
        IF @service_mode = '' SET @service_mode = NULL;
        ELSE IF @service_mode NOT IN ('DINE_IN', 'TAKEAWAY')
        BEGIN
            RAISERROR('service_mode invalido: DINE_IN o TAKEAWAY.', 16, 1);
            RETURN;
        END
    END

    /* ---------------------------------------------------- 0) Lineas */
    IF EXISTS (SELECT line_no FROM @SaleDetails2 GROUP BY line_no HAVING COUNT(*) > 1)
    BEGIN
        RAISERROR('line_no repetido en el detalle de la venta.', 16, 1);
        RETURN;
    END

    CREATE TABLE #lines (
        line_no        INT NOT NULL PRIMARY KEY CLUSTERED,
        product_id     INT NOT NULL,
        product_name   NVARCHAR(100) NULL,
        quantity       DECIMAL(12,2) NOT NULL,
        unit_price     DECIMAL(10,2) NOT NULL,
        note           NVARCHAR(200) NULL,
        inventory_mode NVARCHAR(10) NULL,
        product_cost   DECIMAL(14,4) NULL,
        recipe_id      INT NULL,
        scale          DECIMAL(8,4) NOT NULL DEFAULT 1,
        unit_cost      DECIMAL(14,4) NULL
    );

    /* Las lineas v1 reciben line_no >= 100000 para no chocar con v2. */
    INSERT INTO #lines (line_no, product_id, quantity, unit_price, note)
    SELECT 100000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)), product_id, ISNULL(quantity, 0), ISNULL(unit_price, 0), NULL
    FROM @SaleDetails
    UNION ALL
    SELECT line_no, product_id, quantity, unit_price, note
    FROM @SaleDetails2;

    IF NOT EXISTS (SELECT 1 FROM #lines)
    BEGIN
        RAISERROR('La venta no tiene partidas.', 16, 1);
        RETURN;
    END
    IF EXISTS (SELECT 1 FROM #lines WHERE quantity <= 0)
    BEGIN
        RAISERROR('Cada partida necesita una cantidad mayor a cero.', 16, 1);
        RETURN;
    END

    UPDATE l
       SET inventory_mode = p.inventory_mode,
           product_cost   = ISNULL(p.cost, 0),
           product_name   = p.nombre
    FROM #lines l
    JOIN dbo.products p ON p.id = l.product_id;

    IF EXISTS (SELECT 1 FROM #lines WHERE inventory_mode IS NULL)
    BEGIN
        RAISERROR('Un producto de la venta no existe.', 16, 1);
        RETURN;
    END

    /* Un producto dado de baja no vuelve a venderse.
       Las pantallas ya lo ocultan -sp_get_active_products y sp_get_menu_catalog
       filtran active = 1-, pero un catalogo cargado en memoria antes de la baja,
       o una caja secundaria que aun no lo sabe, llegan igual hasta aqui. La
       unica comprobacion que nadie puede saltarse es esta. */
    DECLARE @debaja NVARCHAR(100) = NULL;
    SELECT TOP 1 @debaja = p.nombre
    FROM #lines l
    JOIN dbo.products p ON p.id = l.product_id
    WHERE p.active = 0
    ORDER BY l.line_no;

    IF @debaja IS NOT NULL
    BEGIN
        SET @errmsg = N'El producto "' + @debaja + N'" esta dado de baja y ya no puede venderse.';
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END

    /* ---------------------------------------------- 1) Modificadores */
    CREATE TABLE #mods (
        line_no INT NOT NULL,
        option_id INT NOT NULL,
        qty INT NOT NULL,
        group_id INT NULL,
        role NVARCHAR(15) NULL,
        effect NVARCHAR(12) NULL,
        ingredient_product_id INT NULL,
        replaces_product_id INT NULL,
        qty_base DECIMAL(14,4) NULL,
        qty_factor DECIMAL(8,4) NULL,
        price_delta DECIMAL(10,2) NULL,
        group_name NVARCHAR(80) NULL,
        option_name NVARCHAR(80) NULL
    );

    INSERT INTO #mods
    SELECT m.line_no, m.modifier_option_id, ISNULL(m.quantity, 1),
           o.group_id, g.role, o.effect, o.ingredient_product_id, o.replaces_product_id,
           o.qty_base, o.qty_factor, o.price_delta, g.name, o.name
    FROM @SaleModifiers m
    LEFT JOIN dbo.modifier_options o ON o.id = m.modifier_option_id AND o.active = 1
    LEFT JOIN dbo.modifier_groups g ON g.id = o.group_id AND g.active = 1;

    IF EXISTS (SELECT 1 FROM #mods WHERE group_id IS NULL)
    BEGIN RAISERROR('Un modificador no existe o esta inactivo.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM #mods WHERE qty <= 0)
    BEGIN RAISERROR('La cantidad de un modificador debe ser mayor a cero.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM #mods m LEFT JOIN #lines l ON l.line_no = m.line_no WHERE l.line_no IS NULL)
    BEGIN RAISERROR('Un modificador apunta a una partida inexistente.', 16, 1); RETURN; END
    IF EXISTS (
        SELECT 1 FROM #mods m JOIN #lines l ON l.line_no = m.line_no
        WHERE NOT EXISTS (SELECT 1 FROM dbo.product_modifier_groups pmg WHERE pmg.product_id = l.product_id AND pmg.group_id = m.group_id))
    BEGIN RAISERROR('Un modificador no corresponde al producto de su partida.', 16, 1); RETURN; END
    IF EXISTS (
        SELECT 1 FROM #mods m JOIN dbo.modifier_groups g ON g.id = m.group_id
        GROUP BY m.line_no, m.group_id, g.max_select
        HAVING COUNT(DISTINCT m.option_id) > g.max_select)
    BEGIN RAISERROR('Se eligieron mas opciones de las permitidas en un grupo de modificadores.', 16, 1); RETURN; END
    /* Grupos obligatorios: solo se exigen a las lineas v2 (las v1 no pueden declararlos). */
    IF EXISTS (
        SELECT 1
        FROM #lines l
        JOIN dbo.product_modifier_groups pmg ON pmg.product_id = l.product_id
        JOIN dbo.modifier_groups g ON g.id = pmg.group_id AND g.active = 1 AND g.required = 1
        WHERE l.line_no < 100000
          AND (SELECT COUNT(DISTINCT m.option_id) FROM #mods m WHERE m.line_no = l.line_no AND m.group_id = g.id)
              < CASE WHEN g.min_select > 0 THEN g.min_select ELSE 1 END)
    BEGIN
        SELECT TOP 1 @errmsg = CONCAT('Falta elegir "', g.name, '" para ', l.product_name, '.')
        FROM #lines l
        JOIN dbo.product_modifier_groups pmg ON pmg.product_id = l.product_id
        JOIN dbo.modifier_groups g ON g.id = pmg.group_id AND g.active = 1 AND g.required = 1
        WHERE l.line_no < 100000
          AND (SELECT COUNT(DISTINCT m.option_id) FROM #mods m WHERE m.line_no = l.line_no AND m.group_id = g.id)
              < CASE WHEN g.min_select > 0 THEN g.min_select ELSE 1 END
        ORDER BY l.line_no;
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END

    /* ------------------------------------------------- 2) Recetas */
    /* Receta de la variante elegida (SIZE) si existe; si no, la base. */
    UPDATE l SET recipe_id = r.id
    FROM #lines l
    CROSS APPLY (
        SELECT TOP 1 r.id
        FROM dbo.recipes r
        WHERE r.product_id = l.product_id AND r.active = 1
          AND (r.variant_option_id IS NULL
               OR r.variant_option_id IN (SELECT m.option_id FROM #mods m WHERE m.line_no = l.line_no AND m.role = 'SIZE'))
        ORDER BY CASE WHEN r.variant_option_id IS NULL THEN 1 ELSE 0 END
    ) r
    WHERE l.inventory_mode = 'RECIPE';

    IF EXISTS (SELECT 1 FROM #lines WHERE inventory_mode = 'RECIPE' AND recipe_id IS NULL)
    BEGIN
        SELECT TOP 1 @errmsg = CONCAT('El producto "', product_name, '" no tiene receta configurada.')
        FROM #lines WHERE inventory_mode = 'RECIPE' AND recipe_id IS NULL ORDER BY line_no;
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END

    /* SCALE solo aplica cuando se usa la receta base (la variante ya trae su cantidad). */
    UPDATE l SET scale = m.qty_factor
    FROM #lines l
    JOIN dbo.recipes r ON r.id = l.recipe_id AND r.variant_option_id IS NULL
    JOIN #mods m ON m.line_no = l.line_no AND m.effect = 'SCALE'
    WHERE l.inventory_mode = 'RECIPE';

    /* -------------------------------- 3) Requerimientos por unidad */
    CREATE TABLE #req (
        line_no INT NOT NULL,
        product_id INT NOT NULL,
        qty_per_unit DECIMAL(18,6) NOT NULL,
        source NVARCHAR(20) NOT NULL
    );

    INSERT INTO #req (line_no, product_id, qty_per_unit, source)
    SELECT line_no, product_id, 1, 'SALE' FROM #lines WHERE inventory_mode = 'DIRECT';

    INSERT INTO #req (line_no, product_id, qty_per_unit, source)
    SELECT l.line_no, rl.ingredient_product_id, rl.qty_base * (1 + rl.waste_pct / 100.0) * l.scale, 'RECIPE'
    FROM #lines l
    JOIN dbo.recipe_lines rl ON rl.recipe_id = l.recipe_id
    WHERE l.inventory_mode = 'RECIPE';

    /* REMOVE: retira el ingrediente de la receta. */
    DELETE r
    FROM #req r
    JOIN #mods m ON m.line_no = r.line_no AND m.effect = 'REMOVE' AND m.replaces_product_id = r.product_id
    WHERE r.source = 'RECIPE';

    /* SUBSTITUTE: mismo consumo con otro ingrediente (o el qty_base explicito). */
    UPDATE r
       SET product_id = m.ingredient_product_id,
           qty_per_unit = ISNULL(m.qty_base * l.scale, r.qty_per_unit)
    FROM #req r
    JOIN #lines l ON l.line_no = r.line_no
    JOIN #mods m ON m.line_no = r.line_no AND m.effect = 'SUBSTITUTE' AND m.replaces_product_id = r.product_id
    WHERE r.source = 'RECIPE';

    /* ADD: consumo extra (no escala con el tamano: un shot es un shot). */
    INSERT INTO #req (line_no, product_id, qty_per_unit, source)
    SELECT m.line_no, m.ingredient_product_id, m.qty_base * m.qty, 'RECIPE'
    FROM #mods m
    WHERE m.effect = 'ADD';

    /* Costo de UNA unidad vendida de cada linea, al costo actual de los ingredientes. */
    UPDATE l
       SET unit_cost = CAST(
              CASE WHEN l.inventory_mode = 'NONE' THEN l.product_cost ELSE 0 END
            + ISNULL((SELECT SUM(r.qty_per_unit * ISNULL(p.cost, 0))
                        FROM #req r JOIN dbo.products p ON p.id = r.product_id
                       WHERE r.line_no = l.line_no), 0) AS DECIMAL(14,4))
    FROM #lines l;

    /* Necesidad total por producto, en orden de id (orden de bloqueo). */
    CREATE TABLE #need (
        product_id INT NOT NULL PRIMARY KEY CLUSTERED,
        qty DECIMAL(14,4) NOT NULL
    );
    INSERT INTO #need (product_id, qty)
    SELECT r.product_id, SUM(r.qty_per_unit * l.quantity)
    FROM #req r JOIN #lines l ON l.line_no = r.line_no
    GROUP BY r.product_id;

    CREATE TABLE #map (sale_detail_id INT NOT NULL, line_no INT NOT NULL);

    BEGIN TRY
        BEGIN TRAN;

        /* 4) Bloqueo consistente y validacion de stock.
           LOOP JOIN + FORCE ORDER: se recorre #need por su clave y se toma el
           bloqueo de cada products en orden ascendente de id. */
        SELECT p.id AS product_id, p.stock, n.qty, p.nombre
        INTO #stk
        FROM #need AS n
        INNER LOOP JOIN dbo.products AS p WITH (UPDLOCK, HOLDLOCK) ON p.id = n.product_id
        OPTION (FORCE ORDER);

        DECLARE @pid INT = NULL, @stk DECIMAL(12,2), @rq DECIMAL(14,4), @pname NVARCHAR(100);
        SELECT TOP 1 @pid = product_id, @stk = stock, @rq = qty, @pname = nombre
        FROM #stk WHERE stock < qty ORDER BY product_id;

        IF @pid IS NOT NULL
        BEGIN
            SET @errmsg =
                CONCAT('No hay stock suficiente. ProductoId=', @pid,
                       ', Stock=', CONVERT(NVARCHAR(30), @stk),
                       ', Requerido=', CONVERT(NVARCHAR(30), @rq),
                       ' (', @pname, ')');
            /* El CATCH hace el ROLLBACK: ver nota de cabecera. */
            RAISERROR(@errmsg, 16, 1);
        END

        /* 5) Total */
        SELECT @total = SUM(quantity * unit_price) FROM #lines;

        /* 6) Venta */
        INSERT INTO sales (datee, useer_id, total, payment_method, customer_id, paid_amount, balance, due_date, register_id, service_mode)
        VALUES (
          GETDATE(), @user_id, @total, @payment_method,
          @customer_id,
          CASE WHEN @is_credit = 1 THEN 0 ELSE @total END,
          CASE WHEN @is_credit = 1 THEN @total ELSE 0 END,
          @due_date,
          @register_id,
          @service_mode
        );

        SET @sale_id = SCOPE_IDENTITY();

        /* 7) Detalle (MERGE para recuperar line_no -> sale_detail_id) */
        MERGE INTO dbo.sale_detail AS t
        USING (SELECT line_no, product_id, quantity, unit_price, unit_cost, inventory_mode, note FROM #lines) AS s
           ON 1 = 0
        WHEN NOT MATCHED THEN
            INSERT (sale_id, product_id, quantity, unitary_price, unit_cost, inventory_mode, note)
            VALUES (@sale_id, s.product_id, s.quantity, s.unit_price, s.unit_cost, s.inventory_mode, s.note)
        OUTPUT inserted.id, s.line_no INTO #map (sale_detail_id, line_no);

        INSERT INTO dbo.sale_detail_modifiers (sale_detail_id, modifier_option_id, group_name, option_name, price_delta, quantity, effect)
        SELECT mp.sale_detail_id, m.option_id, m.group_name, m.option_name, ISNULL(m.price_delta, 0), m.qty, m.effect
        FROM #mods m
        JOIN #map mp ON mp.line_no = m.line_no;

        /* 8) Stock */
        UPDATE p
        SET p.stock = p.stock - n.qty
        FROM products p
        JOIN #need n ON n.product_id = p.id;

        /* 9) Movimientos: uno por linea e ingrediente, ligados a la linea y al
              producto vendido; units = unidades vendidas que cubre. */
        INSERT INTO inventory_movements
            (product_id, typee, reference, quantity, datee, descriptionn, source, sale_detail_id, unit_cost, sold_product_id, units)
        SELECT r.product_id,
               'salida',
               CAST(@sale_id AS NVARCHAR(50)),
               SUM(r.qty_per_unit) * l.quantity,
               GETDATE(),
               CASE WHEN MAX(r.source) = 'SALE' THEN 'Venta' ELSE CONCAT('Venta: ', l.product_name) END,
               MAX(r.source),
               mp.sale_detail_id,
               ISNULL(p.cost, 0),
               l.product_id,
               l.quantity
        FROM #req r
        JOIN #lines l ON l.line_no = r.line_no
        JOIN #map mp ON mp.line_no = r.line_no
        JOIN dbo.products p ON p.id = r.product_id
        GROUP BY r.line_no, r.product_id, l.quantity, l.product_name, l.product_id, mp.sale_detail_id, p.cost;

        /* 10) Movimiento CAJA (solo EFECTIVO contado) - turno POR CAJA */
        IF @is_credit = 0 AND UPPER(@payment_method) = 'EFECTIVO'
        BEGIN
            DECLARE @closure_id_open INT;

            SELECT TOP(1) @closure_id_open = id
            FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
            WHERE register_id = @register_id
              AND closed_at IS NULL
            ORDER BY opened_at DESC, id DESC;

            IF @closure_id_open IS NULL
            BEGIN
                RAISERROR('No hay un turno abierto en esta caja para registrar la venta en efectivo.',16,1);
            END

            INSERT INTO cash_movements
            (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES
            (GETDATE(), @user_id, 'SALE', @sale_id, CONCAT('Venta ', @sale_id), @total, NULL, @closure_id_open, @register_id);
        END

        COMMIT TRAN;

        SELECT
            @sale_id        AS sale_id,
            @total          AS total,
            @payment_method AS payment_method,
            @is_credit      AS is_credit,
            @register_id    AS register_id,
            @service_mode   AS service_mode;

    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @num INT = ERROR_NUMBER();
        /* 1205 (deadlock) se re-lanza con su numero original en el mensaje
           para que el IPC lo reconozca y reintente la misma intencion. */
        IF @num = 1205 SET @msg = CONCAT('[1205] ', @msg);
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
