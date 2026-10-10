/* ============================================================
   0056 — permisos y corte

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0056_permisos-y-corte.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0056_permisos-y-corte.sql ========== */
/* ============================================================
   0056 — Permisos por usuario y lo que se queda en caja (esquema)

   user_permissions        PAQUETES EXTRA de una persona, encima de los de su
                           rol: un Operador de confianza que también hace
                           cortes o configura la impresora. Solo SUMAN, nunca
                           quitan: un permiso que el rol ya trae no se puede
                           retirar a una persona (eso sería otro rol).
                           Que paquetes se pueden otorgar lo decide el código
                           (electron/seguridad/permisos.js, OTORGABLES).
   cash_closures.cash_left Efectivo que se queda físicamente en la caja al
                           cerrar (fondo del siguiente turno). Lo demás se
                           retira.
   cash_closures.closing_note
                           Notas del cierre. La pantalla ya las pedía y se
                           perdían: el proceso principal no las guardaba.

   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF OBJECT_ID(N'dbo.user_permissions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_permissions (
        user_id    INT          NOT NULL,
        permiso    VARCHAR(40)  NOT NULL,
        granted_by INT          NULL,
        granted_at DATETIME2(0) NOT NULL CONSTRAINT DF_user_permissions_granted_at DEFAULT (SYSDATETIME()),
        CONSTRAINT PK_user_permissions PRIMARY KEY CLUSTERED (user_id, permiso),
        CONSTRAINT FK_user_permissions_user FOREIGN KEY (user_id) REFERENCES dbo.users (id)
    );
END;

IF COL_LENGTH('dbo.cash_closures', 'cash_left') IS NULL
    ALTER TABLE dbo.cash_closures ADD cash_left DECIMAL(12, 2) NULL;
IF COL_LENGTH('dbo.cash_closures', 'closing_note') IS NULL
    ALTER TABLE dbo.cash_closures ADD closing_note NVARCHAR(500) COLLATE Modern_Spanish_CI_AS NULL;
GO

IF OBJECT_ID(N'dbo.CK_cash_closures_cash_left', 'C') IS NULL
    ALTER TABLE dbo.cash_closures WITH CHECK ADD CONSTRAINT CK_cash_closures_cash_left
        CHECK (cash_left IS NULL OR (cash_left >= 0 AND cash_left <= cash_delivered));
GO

/* ---------- sp_cash_closure_ticket (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_cash_closure_ticket @closure_id INT, @freeze BIT=0
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @snapshot NVARCHAR(MAX);
 SELECT @snapshot=receipt_snapshot FROM dbo.cash_closures WHERE id=@closure_id;
 IF @snapshot IS NULL BEGIN
 SELECT @snapshot=(SELECT c.id,c.userId,c.opened_at,c.closed_at,c.opening_cash,c.cash_expected,c.cash_delivered,c.difference,c.cash_left,c.closing_note,r.name register_name,u.usuario cashier,
 ISNULL(v.total,0) total,ISNULL(v.tickets,0) tickets,ISNULL(v.discount,0) discount,
 (SELECT ISNULL(SUM(refund_total),0) FROM dbo.sale_refunds f WHERE f.closure_id=c.id) refunds,
 (SELECT ISNULL(SUM(CASE WHEN amount>0 AND typee NOT IN('OPENING','SALE') THEN amount ELSE 0 END),0) FROM dbo.cash_movements m WHERE m.closure_id=c.id) cash_in,
 (SELECT ISNULL(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END),0) FROM dbo.cash_movements m WHERE m.closure_id=c.id) cash_out,
 (SELECT SUM(CASE WHEN d.tax_object='02' THEN d.subtotal-d.subtotal/(1+d.tax_rate) ELSE 0 END) FROM dbo.sales s JOIN dbo.sale_detail d ON d.sale_id=s.id WHERE (s.closure_id=c.id OR (s.closure_id IS NULL AND s.register_id=c.register_id AND s.datee>=c.opened_at AND s.datee<=ISNULL(c.closed_at,SYSDATETIME()))) AND d.tax_rate IS NOT NULL) tax,
 JSON_QUERY((SELECT p.payment_method,SUM(p.amount) amount FROM (
 SELECT s.register_id,s.datee,s.closure_id,p.payment_method,p.amount FROM dbo.sales s JOIN dbo.sale_payments p ON p.sale_id=s.id
 UNION ALL SELECT s.register_id,s.datee,s.closure_id,s.payment_method,s.total FROM dbo.sales s WHERE NOT EXISTS(SELECT 1 FROM dbo.sale_payments p WHERE p.sale_id=s.id)
 ) p WHERE (p.closure_id=c.id OR (p.closure_id IS NULL AND c.register_id=p.register_id AND p.datee>=c.opened_at AND p.datee<=ISNULL(c.closed_at,SYSDATETIME()))) GROUP BY p.payment_method FOR JSON PATH)) payments
 FROM dbo.cash_closures c LEFT JOIN dbo.registers r ON r.id=c.register_id LEFT JOIN dbo.users u ON u.id=c.userId
 OUTER APPLY(SELECT SUM(s.total) total,COUNT(*) tickets,SUM(TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(s.commercial_snapshot,'$.discount'))) discount FROM dbo.sales s WHERE (s.closure_id=c.id OR (s.closure_id IS NULL AND s.register_id=c.register_id AND s.datee>=c.opened_at AND s.datee<=ISNULL(c.closed_at,SYSDATETIME())))) v WHERE c.id=@closure_id FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
 END;
 IF @snapshot IS NULL THROW 51000,'No existe ese corte.',1;
 IF @freeze=1 BEGIN
 UPDATE dbo.cash_closures SET receipt_snapshot=@snapshot WHERE id=@closure_id AND closed_at IS NOT NULL AND receipt_snapshot IS NULL;
 RETURN;
 END;
 SELECT @snapshot document_json;
END;
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
    @blind_count    BIT = NULL,
    /* 0056. Lo que se queda fisicamente en la caja (fondo del siguiente
       turno) y las notas del cierre. NULL = no se dijo. */
    @cash_left      DECIMAL(12,2) = NULL,
    @closing_note   NVARCHAR(500) = NULL
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
                /* 0056: o el permiso CAJA_CORTES otorgado a esa persona (un
                   Operador de confianza que hace los cortes de los demas). */
                IF @authorized_by IS NULL OR NOT EXISTS (
                    SELECT 1 FROM dbo.users u
                     WHERE u.id = @authorized_by AND u.active = 1
                       AND (LOWER(LTRIM(RTRIM(u.rol))) IN (N'admin', N'supervisor')
                            OR EXISTS (SELECT 1 FROM dbo.user_permissions p
                                        WHERE p.user_id = u.id AND p.permiso = 'CAJA_CORTES')))
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

        IF @cash_left IS NOT NULL AND (@cash_left < 0 OR @cash_left > @cash_delivered)
        BEGIN
            RAISERROR('Lo que se queda en caja no puede ser negativo ni mayor que el efectivo contado.', 16, 1);
            ROLLBACK TRAN;
            RETURN;
        END
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
               blind_count         = @blind_count,
               cash_left           = @cash_left,
               closing_note        = NULLIF(LTRIM(RTRIM(ISNULL(@closing_note, N''))), N'')
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

        EXEC dbo.sp_cash_closure_ticket @closure_id=@cid,@freeze=1;
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
            @authorized_by  AS close_authorized_by,
            @cash_left      AS cash_left;

    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@ErrMsg, 16, 1);
    END CATCH
END
GO
