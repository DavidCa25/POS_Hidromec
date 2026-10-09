/* ============================================================
   0054 — pagos mixtos

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0054_pagos-mixtos.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0054_pagos-mixtos.sql ========== */
/* Contrato aditivo. Ventas históricas mantienen su método y total. */
IF OBJECT_ID('dbo.sale_payments','U') IS NULL
CREATE TABLE dbo.sale_payments (
 id INT IDENTITY PRIMARY KEY, sale_id INT NOT NULL REFERENCES dbo.sales(id),
 payment_method NVARCHAR(50) NOT NULL, amount DECIMAL(12,2) NOT NULL CHECK(amount>0),
 received DECIMAL(12,2) NULL, reference NVARCHAR(100) NULL,
 CONSTRAINT UQ_sale_payments_method UNIQUE(sale_id,payment_method),
 CONSTRAINT CK_sale_payments_cash CHECK(received IS NULL OR (payment_method='EFECTIVO' AND received>=amount))
);
IF COL_LENGTH('dbo.sales','client_sale_key') IS NULL ALTER TABLE dbo.sales ADD client_sale_key UNIQUEIDENTIFIER NULL;
IF COL_LENGTH('dbo.sales','client_sale_hash') IS NULL ALTER TABLE dbo.sales ADD client_sale_hash VARCHAR(64) NULL;
GO
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.sales') AND name='UX_sales_client_key')
CREATE UNIQUE INDEX UX_sales_client_key ON dbo.sales(client_sale_key) WHERE client_sale_key IS NOT NULL;
GO

IF COL_LENGTH('dbo.cash_closures','receipt_snapshot') IS NULL ALTER TABLE dbo.cash_closures ADD receipt_snapshot NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.sale_detail','tax_rate') IS NULL ALTER TABLE dbo.sale_detail ADD tax_rate DECIMAL(9,6) NULL, tax_object NVARCHAR(2) NULL;
GO

IF OBJECT_ID('dbo.refund_payments','U') IS NULL CREATE TABLE dbo.refund_payments(
 refund_id INT NOT NULL REFERENCES dbo.sale_refunds(id),payment_method NVARCHAR(50) NOT NULL,amount DECIMAL(12,2) NOT NULL CHECK(amount>0),PRIMARY KEY(refund_id,payment_method));
GO

IF OBJECT_ID('dbo.ticket_email_jobs','U') IS NULL CREATE TABLE dbo.ticket_email_jobs(
 id UNIQUEIDENTIFIER PRIMARY KEY,sale_id INT NOT NULL REFERENCES dbo.sales(id),recipient NVARCHAR(254) NOT NULL,
 pdf VARBINARY(MAX) NOT NULL,created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),sent_at DATETIME2 NULL,
 CONSTRAINT UQ_ticket_email_destination UNIQUE(sale_id,recipient));
GO

IF COL_LENGTH('dbo.sales','closure_id') IS NULL ALTER TABLE dbo.sales ADD closure_id INT NULL REFERENCES dbo.cash_closures(id);
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
 SELECT @snapshot=(SELECT c.id,c.userId,c.opened_at,c.closed_at,c.opening_cash,c.cash_expected,c.cash_delivered,c.difference,r.name register_name,u.usuario cashier,
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
            @authorized_by  AS close_authorized_by;

    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@ErrMsg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_cloud_daily_summary (SQL_STORED_PROCEDURE) ---------- */
/* sp_cloud_daily_summary
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------
   1) Resumen de ventas del dia
   Total, numero de tickets, ticket promedio y desglose por
   forma de pago. Opcionalmente filtra por caja.
   ------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE [dbo].[sp_cloud_daily_summary]
    @fecha DATE = NULL,
    @register_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @fecha IS NULL SET @fecha = CAST(GETDATE() AS DATE);

    SELECT
        @fecha AS fecha,
        ISNULL(SUM(s.total), 0)                                        AS total,
        COUNT(*)                                                       AS num_tickets,
        CASE WHEN COUNT(*) = 0 THEN 0
             ELSE CAST(ISNULL(SUM(s.total),0) / COUNT(*) AS DECIMAL(12,2))
        END                                                            AS ticket_promedio,
        ISNULL(SUM(COALESCE(pa.cash,CASE WHEN UPPER(s.payment_method) = 'EFECTIVO' THEN s.total ELSE 0 END)), 0)   AS total_efectivo,
        ISNULL(SUM(COALESCE(pa.card,CASE WHEN UPPER(s.payment_method) IN ('TARJETA','TERMINAL_MP') THEN s.total ELSE 0 END)), 0) AS total_tarjeta,
        ISNULL(SUM(CASE WHEN UPPER(s.payment_method) = 'CREDITO' THEN s.total ELSE 0 END), 0)    AS total_credito,
        ISNULL(SUM(COALESCE(pa.transfer,CASE WHEN UPPER(s.payment_method) = 'TRANSFERENCIA' THEN s.total ELSE 0 END)), 0) AS total_transferencia,
        ISNULL(SUM(COALESCE(pa.platform,CASE WHEN UPPER(s.payment_method)='PLATAFORMA' THEN s.total ELSE 0 END)),0) AS total_plataforma
    FROM dbo.sales s
    OUTER APPLY(SELECT SUM(CASE WHEN payment_method='EFECTIVO' THEN amount ELSE 0 END) cash,SUM(CASE WHEN payment_method IN('TARJETA','TERMINAL_MP') THEN amount ELSE 0 END) card,SUM(CASE WHEN payment_method='TRANSFERENCIA' THEN amount ELSE 0 END) transfer,SUM(CASE WHEN payment_method='PLATAFORMA' THEN amount ELSE 0 END) platform FROM dbo.sale_payments WHERE sale_id=s.id) pa
    WHERE CAST(s.datee AS DATE) = @fecha
      AND (@register_id IS NULL OR s.register_id = @register_id);
END
GO

/* ---------- sp_get_cash_movements (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_cash_movements
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   Movimientos del cajon, su resumen y su DESGLOSE.

   0049:
   · El turno se arma con EXACTAMENTE la misma regla que sp_close_shift: los
     movimientos amarrados al turno y los sueltos de SU CAJA dentro de su
     horario. Antes los sueltos se buscaban por usuario, asi que el efectivo
     esperado que mostraba el corte podia no ser el que guardaba el cierre.
   · Las ventas por forma de pago son las de ESA caja en ese horario, no las
     del usuario que abrio el turno.
   · Tercer resultado: el desglose por grupo y concepto (Ventas, Abonos,
     Retiros, Proveedores, Egresos por concepto, Devoluciones, Ajustes...).
     Lo calcula SQL, con el catalogo cash_movement_types, para que la pantalla
     no clasifique tipos por su cuenta: todo lo que suma al esperado aparece.
   · Modo dia: acepta la caja (@register_id) y no cuenta el fondo inicial dos
     veces.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_cash_movements]
    @start_date   DATE = NULL,
    @end_date     DATE = NULL,
    @user_id      INT  = NULL,
    @typee        NVARCHAR(20) = NULL,
    @only_open    BIT  = 0,
    @closure_id   INT  = NULL,
    @register_id  INT  = NULL
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @now DATETIME2(0) = SYSDATETIME();

  /* Los movimientos elegidos, una sola vez, para que detalle, resumen y
     desglose salgan exactamente del mismo conjunto. */
  /* COLLATE explicito: una tabla temporal toma la collation de tempdb, y al
     cruzarla con cash_movement_types (Modern_Spanish_CI_AS) SQL Server no
     sabria cual usar. */
  CREATE TABLE #m (
      id INT PRIMARY KEY, datee DATETIME2(7), userId INT,
      typee VARCHAR(30) COLLATE Modern_Spanish_CI_AS,
      amount DECIMAL(12,2), reference_id INT,
      reference NVARCHAR(100) COLLATE Modern_Spanish_CI_AS,
      note NVARCHAR(200) COLLATE Modern_Spanish_CI_AS, closure_id INT, register_id INT);

  DECLARE @opening_cash DECIMAL(12,2) = 0;
  DECLARE @ventas_desde DATETIME2(7), @ventas_hasta DATETIME2(7), @ventas_caja INT;
  DECLARE @ventas_dia_desde DATE = NULL, @ventas_dia_hasta DATE = NULL;

  /* ===========================
     MODO TURNO (por closure_id)
     =========================== */
  IF @closure_id IS NOT NULL
  BEGIN
      DECLARE @shift_user_id INT, @opened_at DATETIME2(0), @closed_at DATETIME2(0), @caja INT;

      SELECT
          @shift_user_id = userId,
          @opened_at     = opened_at,
          @closed_at     = ISNULL(closed_at, @now),
          @opening_cash  = ISNULL(opening_cash,0),
          @caja          = register_id
      FROM dbo.cash_closures
      WHERE id = @closure_id;

      IF @shift_user_id IS NULL
      BEGIN
          RAISERROR('closure_id no existe.', 16, 1);
          RETURN;
      END

      IF @user_id IS NOT NULL AND @user_id <> @shift_user_id
      BEGIN
          RAISERROR('El closure_id no pertenece al user_id indicado.', 16, 1);
          RETURN;
      END

      INSERT INTO #m
      SELECT m.id, m.datee, m.userId, m.typee, m.amount, m.reference_id, m.reference, m.note, m.closure_id, m.register_id
      FROM dbo.cash_movements AS m
      WHERE
          (
              m.closure_id = @closure_id
              OR (m.closure_id IS NULL AND m.register_id = @caja AND m.datee >= @opened_at AND m.datee <= @closed_at)
          )
          AND (@typee IS NULL OR m.typee = @typee);

      SELECT @ventas_desde = @opened_at, @ventas_hasta = @closed_at, @ventas_caja = @caja;
  END
  ELSE
  BEGIN
  /* ===========================
     MODO DIA (por rango fechas)
     =========================== */
      IF @start_date IS NULL SET @start_date = CONVERT(DATE, @now);
      IF @end_date   IS NULL SET @end_date   = @start_date;

      INSERT INTO #m
      SELECT m.id, m.datee, m.userId, m.typee, m.amount, m.reference_id, m.reference, m.note, m.closure_id, m.register_id
      FROM dbo.cash_movements AS m
      WHERE CAST(m.datee AS DATE) BETWEEN @start_date AND @end_date
        AND (@user_id     IS NULL OR m.userId = @user_id)
        AND (@register_id IS NULL OR m.register_id = @register_id)
        AND (@typee       IS NULL OR m.typee  = @typee)
        AND (
              (@only_open = 1 AND m.closure_id IS NULL)
           OR (@only_open = 0)
            );

      /* El fondo inicial es el de los turnos abiertos en el rango (de esa
         caja, si se pidio una). Sale de cash_closures, no de sumar OPENING:
         antes se sumaban las dos cosas y el fondo contaba doble. */
      SELECT @opening_cash = ISNULL(SUM(opening_cash), 0)
        FROM dbo.cash_closures
       WHERE CAST(opened_at AS DATE) BETWEEN @start_date AND @end_date
         AND (@register_id IS NULL OR register_id = @register_id)
         AND (@user_id IS NULL OR userId = @user_id);

      SELECT @ventas_dia_desde = @start_date, @ventas_dia_hasta = @end_date, @ventas_caja = @register_id;
  END

  /* 1) Detalle, con su grupo y su concepto */
  SELECT
      m.id, m.datee, m.userId, u.usuario AS user_name, m.typee, m.amount,
      m.reference_id, m.reference, m.note, m.closure_id, m.register_id,
      ISNULL(t.grupo, 'OTROS') AS grupo,
      ISNULL(t.label, CAST(m.typee AS NVARCHAR(60))) AS tipo_label,
      CASE
          WHEN m.typee = 'EXPENSE' THEN ISNULL(ec.name, N'Egreso')
          WHEN m.typee = 'SUPPLIER_PAYMENT' THEN ISNULL(s.nombre, N'Proveedor')
          ELSE ISNULL(t.label, CAST(m.typee AS NVARCHAR(60)))
      END AS concepto
  FROM #m AS m
  LEFT JOIN dbo.users AS u ON u.id = m.userId
  LEFT JOIN dbo.cash_movement_types AS t ON t.code = m.typee
  LEFT JOIN dbo.expenses AS e ON m.typee = 'EXPENSE' AND (e.cash_movement_id = m.id OR e.void_cash_movement_id = m.id)
  LEFT JOIN dbo.expense_categories AS ec ON ec.id = e.category_id
  LEFT JOIN dbo.supplier_payments AS sp ON m.typee = 'SUPPLIER_PAYMENT' AND sp.id = m.reference_id
  LEFT JOIN dbo.CAT_suppliers AS s ON s.id = sp.supplier_id
  ORDER BY m.datee ASC, m.id ASC;

  /* 2) Resumen (mismas columnas de siempre) */
  SELECT
      ISNULL(SUM(CASE WHEN m.typee <> 'OPENING' AND m.amount >= 0 THEN m.amount ELSE 0 END), 0)  AS total_entradas,
      ISNULL(SUM(CASE WHEN m.typee <> 'OPENING' AND m.amount  < 0 THEN -m.amount ELSE 0 END), 0) AS total_salidas,
      ISNULL(SUM(CASE WHEN m.typee <> 'OPENING' THEN m.amount ELSE 0 END), 0)                    AS neto,
      @opening_cash                                                                              AS opening_cash,
      (ISNULL(SUM(CASE WHEN m.typee <> 'OPENING' THEN m.amount ELSE 0 END),0) + @opening_cash)   AS cash_expected,

      /* Ventas por forma de pago: las de ESTA caja en este periodo. Son
         informativas; lo que suma al esperado son los movimientos del cajon. */
      (SELECT ISNULL(SUM(COALESCE(sp.amount,s.total)), 0) FROM dbo.sales s LEFT JOIN dbo.sale_payments sp ON sp.sale_id=s.id AND sp.payment_method='EFECTIVO' WHERE (s.payment_method = 'EFECTIVO' OR sp.id IS NOT NULL)      AND (@ventas_caja IS NULL OR s.register_id = @ventas_caja)
          AND ((@ventas_desde IS NOT NULL AND (s.closure_id=@closure_id OR (s.closure_id IS NULL AND s.datee >= @ventas_desde AND s.datee <= @ventas_hasta))) OR (@ventas_dia_desde IS NOT NULL AND CAST(s.datee AS DATE) BETWEEN @ventas_dia_desde AND @ventas_dia_hasta))
          AND (@user_id IS NULL OR @closure_id IS NOT NULL OR s.useer_id = @user_id)) AS ventas_efectivo,
      (SELECT ISNULL(SUM(COALESCE(sp.amount,s.total)), 0) FROM dbo.sales s LEFT JOIN dbo.sale_payments sp ON sp.sale_id=s.id AND sp.payment_method='TARJETA' WHERE (s.payment_method = 'TARJETA' OR sp.id IS NOT NULL)       AND (@ventas_caja IS NULL OR s.register_id = @ventas_caja)
          AND ((@ventas_desde IS NOT NULL AND (s.closure_id=@closure_id OR (s.closure_id IS NULL AND s.datee >= @ventas_desde AND s.datee <= @ventas_hasta))) OR (@ventas_dia_desde IS NOT NULL AND CAST(s.datee AS DATE) BETWEEN @ventas_dia_desde AND @ventas_dia_hasta))
          AND (@user_id IS NULL OR @closure_id IS NOT NULL OR s.useer_id = @user_id)) AS ventas_tarjeta,
      (SELECT ISNULL(SUM(COALESCE(sp.amount,s.total)), 0) FROM dbo.sales s LEFT JOIN dbo.sale_payments sp ON sp.sale_id=s.id AND sp.payment_method='TRANSFERENCIA' WHERE (s.payment_method = 'TRANSFERENCIA' OR sp.id IS NOT NULL) AND (@ventas_caja IS NULL OR s.register_id = @ventas_caja)
          AND ((@ventas_desde IS NOT NULL AND (s.closure_id=@closure_id OR (s.closure_id IS NULL AND s.datee >= @ventas_desde AND s.datee <= @ventas_hasta))) OR (@ventas_dia_desde IS NOT NULL AND CAST(s.datee AS DATE) BETWEEN @ventas_dia_desde AND @ventas_dia_hasta))
          AND (@user_id IS NULL OR @closure_id IS NOT NULL OR s.useer_id = @user_id)) AS ventas_transferencia,
      (SELECT ISNULL(SUM(COALESCE(sp.amount,s.total)), 0) FROM dbo.sales s LEFT JOIN dbo.sale_payments sp ON sp.sale_id=s.id AND sp.payment_method='TERMINAL_MP' WHERE (s.payment_method = 'TERMINAL_MP' OR sp.id IS NOT NULL)   AND (@ventas_caja IS NULL OR s.register_id = @ventas_caja)
          AND ((@ventas_desde IS NOT NULL AND (s.closure_id=@closure_id OR (s.closure_id IS NULL AND s.datee >= @ventas_desde AND s.datee <= @ventas_hasta))) OR (@ventas_dia_desde IS NOT NULL AND CAST(s.datee AS DATE) BETWEEN @ventas_dia_desde AND @ventas_dia_hasta))
          AND (@user_id IS NULL OR @closure_id IS NOT NULL OR s.useer_id = @user_id)) AS ventas_mp,
      (SELECT ISNULL(SUM(COALESCE(sp.amount,s.total)), 0) FROM dbo.sales s LEFT JOIN dbo.sale_payments sp ON sp.sale_id=s.id AND sp.payment_method='PLATAFORMA' WHERE (s.payment_method = 'PLATAFORMA' OR sp.id IS NOT NULL)   AND (@ventas_caja IS NULL OR s.register_id = @ventas_caja)
          AND ((@ventas_desde IS NOT NULL AND (s.closure_id=@closure_id OR (s.closure_id IS NULL AND s.datee >= @ventas_desde AND s.datee <= @ventas_hasta))) OR (@ventas_dia_desde IS NOT NULL AND CAST(s.datee AS DATE) BETWEEN @ventas_dia_desde AND @ventas_dia_hasta))
          AND (@user_id IS NULL OR @closure_id IS NOT NULL OR s.useer_id = @user_id)) AS ventas_plataforma,
      (SELECT ISNULL(SUM(s.total), 0) FROM dbo.sales s WHERE s.payment_method = 'CREDITO'       AND (@ventas_caja IS NULL OR s.register_id = @ventas_caja)
          AND ((@ventas_desde IS NOT NULL AND (s.closure_id=@closure_id OR (s.closure_id IS NULL AND s.datee >= @ventas_desde AND s.datee <= @ventas_hasta))) OR (@ventas_dia_desde IS NOT NULL AND CAST(s.datee AS DATE) BETWEEN @ventas_dia_desde AND @ventas_dia_hasta))
          AND (@user_id IS NULL OR @closure_id IS NOT NULL OR s.useer_id = @user_id)) AS ventas_credito
  FROM #m AS m;

  /* 3) Desglose por grupo y concepto. Sin el fondo (va aparte, arriba del
        todo). Los egresos van por su concepto; lo demas por su tipo. La suma
        de `total` de todas las filas es exactamente `neto`. */
  SELECT
      ISNULL(t.grupo, 'OTROS') AS grupo,
      MIN(ISNULL(t.sort_order, 900)) AS orden,
      CASE WHEN m.typee = 'EXPENSE' THEN ISNULL(ec.name, N'Egreso')
           ELSE ISNULL(t.label, CAST(m.typee AS NVARCHAR(60))) END AS concepto,
      SUM(m.amount) AS total,
      COUNT(*) AS movimientos
  FROM #m AS m
  LEFT JOIN dbo.cash_movement_types AS t ON t.code = m.typee
  LEFT JOIN dbo.expenses AS e ON m.typee = 'EXPENSE' AND (e.cash_movement_id = m.id OR e.void_cash_movement_id = m.id)
  LEFT JOIN dbo.expense_categories AS ec ON ec.id = e.category_id
  WHERE m.typee <> 'OPENING'
  GROUP BY ISNULL(t.grupo, 'OTROS'),
           CASE WHEN m.typee = 'EXPENSE' THEN ISNULL(ec.name, N'Egreso')
                ELSE ISNULL(t.label, CAST(m.typee AS NVARCHAR(60))) END
  ORDER BY orden, concepto;
END
GO

/* ---------- sp_get_sale_by_folio (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_sale_by_folio
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE [dbo].[sp_get_sale_by_folio]
  @sale_id INT
AS
BEGIN
  SET NOCOUNT ON;

  IF @sale_id IS NULL OR @sale_id <= 0
  BEGIN
    RAISERROR('sale_id inválido.',16,1);
    RETURN;
  END

  SELECT
    s.id AS sale_id,
    s.datee,
    s.useer_id AS user_id,
    s.total,
    s.payment_method,
    (SELECT payment_method,amount,received,reference FROM dbo.sale_payments WHERE sale_id=s.id FOR JSON PATH) payments_json,
    JSON_VALUE(s.commercial_snapshot,'$.channelId') commercial_channel,
    TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(s.commercial_snapshot,'$.discount')) commercial_discount,
    s.customer_id,
    s.paid_amount,
    s.balance,
    s.due_date,
    s.invoice_status,
    ISNULL(r.refund_total,0) AS refund_total,
    s.service_mode,
    s.register_id
  FROM dbo.sales s
  OUTER APPLY (
    SELECT SUM(sr.refund_total) AS refund_total
    FROM dbo.sale_refunds sr
    WHERE sr.sale_id = s.id
  ) r
  WHERE s.id = @sale_id;

  IF EXISTS(SELECT 1 FROM dbo.sales WHERE id=@sale_id AND commercial_snapshot IS NOT NULL)
  BEGIN
    ;WITH sold AS(SELECT product_id,SUM(quantity) quantity,SUM(quantity*unitary_price) line_total,MAX(unit_cost) unit_cost,MAX(inventory_mode) inventory_mode FROM dbo.sale_detail WHERE sale_id=@sale_id GROUP BY product_id),
    returned AS(SELECT d.product_id,SUM(d.quantity) qty FROM dbo.sale_refund_detail d JOIN dbo.sale_refunds r ON r.id=d.refund_id WHERE r.sale_id=@sale_id GROUP BY d.product_id)
    SELECT @sale_id sale_id,s.product_id,p.nombre,s.quantity,CAST(s.line_total/s.quantity AS DECIMAL(10,2)) unitary_price,s.line_total,
      ISNULL(r.qty,0) refunded_qty,s.quantity-ISNULL(r.qty,0) remaining_qty,NULL sale_detail_id,s.unit_cost,s.inventory_mode,
      N'Oferta comercial: devolución proporcional al importe pagado' note,p.clave_prod_serv,p.clave_unidad,p.objeto_impuesto,p.tasa_iva,
      N'Oferta comercial' modifiers
    FROM sold s JOIN dbo.products p ON p.id=s.product_id LEFT JOIN returned r ON r.product_id=s.product_id;
    RETURN;
  END;
  ;WITH refunded AS (
    SELECT
      srd.product_id,
      SUM(srd.quantity) AS refunded_qty
    FROM dbo.sale_refunds sr
    JOIN dbo.sale_refund_detail srd ON srd.refund_id = sr.id
    WHERE sr.sale_id = @sale_id
    GROUP BY srd.product_id
  )
  SELECT
    d.sale_id,
    d.product_id,
    p.nombre,
    d.quantity,
    d.unitary_price,
    (d.quantity * d.unitary_price) AS line_total,
    ISNULL(r.refunded_qty,0) AS refunded_qty,
    (d.quantity - ISNULL(r.refunded_qty,0)) AS remaining_qty,
    d.id AS sale_detail_id,
    d.unit_cost,
    d.inventory_mode,
    d.note,
    p.clave_prod_serv,
    p.clave_unidad,
    p.objeto_impuesto,
    p.tasa_iva,
    mods.modifiers
  FROM dbo.sale_detail d
  JOIN dbo.products p ON p.id = d.product_id
  LEFT JOIN refunded r ON r.product_id = d.product_id
  OUTER APPLY (
    SELECT STRING_AGG(CONCAT(CASE WHEN m.quantity > 1 THEN CONCAT(m.quantity, 'x ') ELSE '' END, m.option_name), ', ')
           WITHIN GROUP (ORDER BY m.id) AS modifiers
    FROM dbo.sale_detail_modifiers m
    WHERE m.sale_detail_id = d.id
  ) mods
  WHERE d.sale_id = @sale_id
  ORDER BY d.product_id, d.id;
END
GO

/* ---------- sp_get_sale_ticket (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_sale_ticket
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David>
-- Create date: <11-12-2025>
-- Description:	<Store procedure para generar un ticket de venta>
-- Update:      + register_name y + impuestos por linea.
--
--              El ticket calculaba el IVA dividiendo el total entre 1.16, con
--              la tasa escrita a mano en el codigo. Eso solo es cierto si
--              TODO lo vendido es objeto de impuesto a la tasa general: en una
--              venta con productos exentos el ticket inventaba un IVA que
--              nadie cobro. La tasa de cada producto viaja ahora con su linea
--              y el desglose se calcula linea por linea.
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_sale_ticket
    @sale_id INT
AS
BEGIN
    SET NOCOUNT ON;

    --------------------------
    -- 1) Encabezado de venta
    --------------------------
    SELECT
        s.id,
        s.datee,
        s.total,
        (SELECT payment_method,amount,received,reference FROM dbo.sale_payments WHERE sale_id=s.id FOR JSON PATH) payments_json,
        s.payment_method,
        s.paid_amount,
        s.balance,
        s.customer_id,
        s.due_date,
        u.usuario AS cashier,
        c.customerName AS customer_name,
        s.service_mode,
        s.register_id,
        r.name AS register_name,
        JSON_VALUE(s.commercial_snapshot,'$.channelName') AS commercial_channel,
        TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(s.commercial_snapshot,'$.discount')) AS commercial_discount
    FROM dbo.sales s
    INNER JOIN dbo.users u ON u.id = s.useer_id
    LEFT JOIN dbo.customers c ON c.id = s.customer_id
    LEFT JOIN dbo.registers r ON r.id = s.register_id
    WHERE s.id = @sale_id;
    SELECT
        d.product_id,
        p.nombre,
        d.quantity,
        d.unitary_price,
        d.subtotal AS line_total,
        d.note,
        /* La tasa de CADA producto: sin esto el ticket tiene que suponer que
           todo lleva IVA general, y con un producto exento miente. */
        COALESCE(d.tax_object,p.objeto_impuesto) objeto_impuesto,
        COALESCE(d.tax_rate,p.tasa_iva) tasa_iva,
        p.base_uom,
        mods.modifiers,
        JSON_VALUE(d.commercial_snapshot,'$.ruleName') AS commercial_offer
    FROM dbo.sale_detail d
    INNER JOIN dbo.products p ON p.id = d.product_id
    /* Los modificadores TAL COMO SE COBRARON, con su importe.
       Antes solo salia el nombre: un ticket con "Leche de almendra" y un total
       $12 mas alto obliga al cliente a fiarse. Ahora cada extra dice lo que
       sumo, y los que no suman nada -"Sin azucar"- no llevan cifra.
       Se lee del snapshot de la venta, no de la configuracion de hoy: un
       ticket reimpreso manana tiene que decir lo mismo que el de hoy.
       Nada tecnico: nombres e importes, nunca identificadores. */
    OUTER APPLY (
        SELECT STRING_AGG(
                   CONCAT(
                       CASE WHEN m.quantity > 1 THEN CONCAT(m.quantity, 'x ') ELSE '' END,
                       m.option_name,
                       CASE WHEN ISNULL(m.price_delta, 0) <> 0
                            THEN CONCAT(' +', FORMAT(m.price_delta * m.quantity, 'N2'))
                            ELSE '' END),
                   ', ')
               WITHIN GROUP (ORDER BY m.id) AS modifiers
        FROM dbo.sale_detail_modifiers m
        WHERE m.sale_detail_id = d.id
    ) mods
    WHERE d.sale_id = @sale_id
    ORDER BY d.id;
END;
GO

/* ---------- sp_refund_sale (SQL_STORED_PROCEDURE) ---------- */
/* sp_refund_sale
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* -------------------- sp_refund_sale --------------------
   Devolucion / cambio. Lo que se repone al inventario es lo que ESA venta
   consumio realmente (inventory_movements ligados al producto vendido), por
   unidad devuelta: quantity / units. Un Latte devuelto repone cafe, leche,
   vaso y tapa segun la receta y modificadores DE ESE DIA, no la receta de
   hoy. Un producto DIRECT repone el propio producto (como siempre). Ventas
   anteriores a Wybix Core (sin movimientos ligados) reponen el producto.
   -------------------------------------------------------- */
CREATE OR ALTER PROCEDURE [dbo].[sp_refund_sale]
  @sale_id INT,
  @user_id INT,
  @payment_method NVARCHAR(50),
  @RefundDetails dbo.SaleDetailType READONLY,
  @note NVARCHAR(400) = NULL,
  @apply_net_update BIT = 1,
  -- 0049: la caja que DEVUELVE el efectivo. El turno se busca por caja, no
  -- por quien lo abrio: si devolvia otra persona fallaba con "no hay turno", y
  -- en MultiCaja el dinero podia salir del corte de otra caja.
  @register_id INT = NULL,
  @machine_id NVARCHAR(64) = NULL,
  @machine_name NVARCHAR(120) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  IF @sale_id IS NULL OR @sale_id <= 0
  BEGIN
    RAISERROR('sale_id inválido.',16,1);
    RETURN;
  END

  BEGIN TRY
    BEGIN TRAN;

    DECLARE @commercial BIT = CASE WHEN EXISTS(SELECT 1 FROM dbo.sales WHERE id=@sale_id AND commercial_snapshot IS NOT NULL) THEN 1 ELSE 0 END;
    IF @commercial=1 AND @apply_net_update=1 THROW 51000,'Las ventas con ofertas conservan su historial. Devuelve sin modificar la venta original.',1;
    DECLARE @sale_total DECIMAL(12,2);
    DECLARE @sale_method NVARCHAR(50);
    DECLARE @customer_id INT;

    SELECT
      @sale_total = s.total,
      @sale_method = s.payment_method,
      @customer_id = s.customer_id
    FROM dbo.sales s WITH (UPDLOCK, HOLDLOCK)
    WHERE s.id = @sale_id;

    IF @sale_total IS NULL
    BEGIN
      RAISERROR('La venta no existe.',16,1);
    END

    ;WITH r AS (
      SELECT product_id, SUM(quantity) AS qty
      FROM @RefundDetails
      GROUP BY product_id
    )
    SELECT * INTO #req FROM r;

    SELECT d.product_id, SUM(d.quantity) AS sold_qty, MAX(d.unitary_price) AS price, SUM(d.quantity*d.unitary_price) AS net_amount
    INTO #sold
    FROM dbo.sale_detail d WITH (UPDLOCK, HOLDLOCK)
    WHERE d.sale_id = @sale_id
    GROUP BY d.product_id;

    SELECT srd.product_id, SUM(srd.quantity) AS refunded_qty, SUM(COALESCE(srd.commercial_amount,srd.quantity*srd.unitary_price)) AS refunded_amount
    INTO #ref
    FROM dbo.sale_refunds sr
    JOIN dbo.sale_refund_detail srd ON srd.refund_id = sr.id
    WHERE sr.sale_id = @sale_id
    GROUP BY srd.product_id;

    IF EXISTS (
      SELECT 1
      FROM #req q
      LEFT JOIN #sold s ON s.product_id = q.product_id
      LEFT JOIN #ref  r2 ON r2.product_id = q.product_id
      WHERE ISNULL(s.sold_qty,0) - ISNULL(r2.refunded_qty,0) < q.qty
    )
    BEGIN
      RAISERROR('Reembolso inválido: excede lo vendido/disponible para devolver.',16,1);
    END

    IF EXISTS(SELECT 1 FROM #req WHERE qty<=0) THROW 51000,'Cantidad de devolución inválida.',1;
    IF NOT EXISTS(SELECT 1 FROM #req) THROW 51000,'Selecciona productos para devolver.',1;
    SELECT q.product_id,q.qty,CAST(CASE WHEN @commercial=1 THEN
      ROUND(s.net_amount*(ISNULL(r.refunded_qty,0)+q.qty)/s.sold_qty,2)-ISNULL(r.refunded_amount,0)
      ELSE q.qty*s.price END AS DECIMAL(12,2)) amount
    INTO #refund_amount FROM #req q JOIN #sold s ON s.product_id=q.product_id LEFT JOIN #ref r ON r.product_id=q.product_id;
    DECLARE @refund_total DECIMAL(12,2);
    SELECT @refund_total=ISNULL(SUM(amount),0) FROM #refund_amount;

    IF @refund_total < 0 OR (@refund_total=0 AND @commercial=0)
    BEGIN
      RAISERROR('El total del reembolso debe ser mayor a cero.',16,1);
    END

    DECLARE @rp TABLE(method NVARCHAR(50) PRIMARY KEY,amount DECIMAL(12,2));
    IF EXISTS(SELECT 1 FROM dbo.sale_payments WHERE sale_id=@sale_id) BEGIN
      SET @apply_net_update=0;
      DECLARE @rest DECIMAL(12,2)=@refund_total,@pm NVARCHAR(50),@available DECIMAL(12,2),@part DECIMAL(12,2);
      DECLARE refunds_cursor CURSOR LOCAL FAST_FORWARD FOR
      SELECT p.payment_method,p.amount-ISNULL((SELECT SUM(rp.amount) FROM dbo.refund_payments rp JOIN dbo.sale_refunds r ON r.id=rp.refund_id WHERE r.sale_id=@sale_id AND rp.payment_method=p.payment_method),0)-ISNULL((SELECT SUM(r.refund_total) FROM dbo.sale_refunds r WHERE r.sale_id=@sale_id AND r.payment_method=p.payment_method AND NOT EXISTS(SELECT 1 FROM dbo.refund_payments rp WHERE rp.refund_id=r.id)),0)
      FROM dbo.sale_payments p WHERE p.sale_id=@sale_id ORDER BY CASE WHEN p.payment_method='EFECTIVO' THEN 0 ELSE 1 END,p.id;
      OPEN refunds_cursor;FETCH NEXT FROM refunds_cursor INTO @pm,@available;
      WHILE @@FETCH_STATUS=0 AND @rest>0 BEGIN
        SET @part=CASE WHEN @available>@rest THEN @rest ELSE @available END;
        IF @part>0 BEGIN INSERT @rp VALUES(@pm,@part);SET @rest=@rest-@part;END;
        FETCH NEXT FROM refunds_cursor INTO @pm,@available;
      END;
      CLOSE refunds_cursor;DEALLOCATE refunds_cursor;
      IF @rest>0 THROW 51000,'El reembolso supera los pagos originales disponibles.',1;
      SET @payment_method=CASE WHEN (SELECT COUNT(*) FROM @rp)>1 THEN 'MIXTO' ELSE (SELECT TOP 1 method FROM @rp) END;
    END ELSE INSERT @rp VALUES(@payment_method,@refund_total);
    DECLARE @refund_cash DECIMAL(12,2)=ISNULL((SELECT amount FROM @rp WHERE method='EFECTIVO'),0);
    DECLARE @closure_id_open INT = NULL;
    DECLARE @caja INT = NULL;
    IF @refund_cash>0
    BEGIN
      EXEC dbo.sp_resolve_cash_register
          @register_id = @register_id, @machine_id = @machine_id,
          @machine_name = @machine_name, @user_id = @user_id, @resolved = @caja OUTPUT;
      IF @caja IS NULL
        RAISERROR('No se pudo determinar la caja de la que sale la devolucion. Abre el turno en esta caja e intenta de nuevo.',16,1);

      SELECT TOP(1) @closure_id_open = id
      FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
      WHERE register_id = @caja AND closed_at IS NULL
      ORDER BY opened_at DESC, id DESC;

      IF @closure_id_open IS NULL
      BEGIN
        RAISERROR('No hay turno abierto para registrar el reembolso en efectivo.',16,1);
      END
    END

    DECLARE @refund_id INT;
    INSERT INTO dbo.sale_refunds (sale_id, user_id, payment_method, refund_total, note, closure_id)
    VALUES (@sale_id, @user_id, @payment_method, @refund_total, @note, @closure_id_open);

    SET @refund_id = SCOPE_IDENTITY();
    INSERT dbo.refund_payments(refund_id,payment_method,amount) SELECT @refund_id,method,amount FROM @rp;

    INSERT INTO dbo.sale_refund_detail(refund_id,product_id,quantity,unitary_price,commercial_amount)
    SELECT @refund_id,q.product_id,q.qty,
      CASE WHEN @commercial=1 THEN CAST(a.amount/q.qty AS DECIMAL(10,2)) ELSE s.price END,
      CASE WHEN @commercial=1 THEN a.amount ELSE NULL END
    FROM #req q JOIN #sold s ON s.product_id=q.product_id JOIN #refund_amount a ON a.product_id=q.product_id;

    /* ---- Que repone cada producto devuelto: consumo REAL de esta venta ---- */
    SELECT q.product_id AS sold_product_id, m.product_id, SUM(m.quantity) AS consumed, SUM(m.units) AS units
    INTO #consumo
    FROM #req q
    JOIN dbo.inventory_movements m
      ON m.reference = CAST(@sale_id AS NVARCHAR(50))
     AND m.sold_product_id = q.product_id
     AND m.typee = 'salida'
     AND m.source IN ('SALE', 'RECIPE')
    GROUP BY q.product_id, m.product_id
    HAVING SUM(m.units) > 0;

    /* Ventas sin movimientos ligados (anteriores a Wybix Core): el propio producto. */
    INSERT INTO #consumo (sold_product_id, product_id, consumed, units)
    SELECT q.product_id, q.product_id, 1, 1
    FROM #req q
    JOIN dbo.products p ON p.id = q.product_id
    WHERE p.inventory_mode = 'DIRECT'
      AND NOT EXISTS (SELECT 1 FROM #consumo c WHERE c.sold_product_id = q.product_id);

    SELECT c.product_id,
           c.sold_product_id,
           CAST(q.qty * c.consumed / c.units AS DECIMAL(14,4)) AS qty,
           q.qty AS units
    INTO #restore
    FROM #consumo c
    JOIN #req q ON q.product_id = c.sold_product_id;

    UPDATE p
    SET p.stock = p.stock + r.qty
    FROM dbo.products p
    JOIN (SELECT product_id, SUM(qty) AS qty FROM #restore GROUP BY product_id) r ON r.product_id = p.id;

    INSERT INTO dbo.inventory_movements
      (product_id, typee, reference, quantity, datee, descriptionn, source, sold_product_id, units, unit_cost)
    SELECT
      r.product_id,
      'entrada',
      CAST(@sale_id AS NVARCHAR(50)),
      r.qty,
      GETDATE(),
      CONCAT('Reembolso venta ', @sale_id, ' (refund_id ', @refund_id, ')', COALESCE(CONCAT(' - ', @note), '')),
      'REFUND',
      r.sold_product_id,
      r.units,
      p.cost
    FROM #restore r
    JOIN dbo.products p ON p.id = r.product_id;

    IF @refund_cash>0
    BEGIN
      INSERT INTO dbo.cash_movements
        (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
      VALUES
        (GETDATE(), @user_id, 'REFUND', @sale_id,
         CONCAT('Reembolso Venta ', @sale_id, ' (', @refund_id, ')'),
         -@refund_cash,
         @note,
         @closure_id_open,
         @caja);
    END

    IF @apply_net_update = 1
    BEGIN
      UPDATE d
      SET d.quantity = d.quantity - q.qty
      FROM dbo.sale_detail d
      JOIN #req q ON q.product_id = d.product_id
      WHERE d.sale_id = @sale_id;

      DELETE FROM dbo.sale_detail
      WHERE sale_id = @sale_id AND quantity <= 0;

      UPDATE dbo.sales
      SET total = total - @refund_total,
          paid_amount = CASE WHEN @customer_id IS NULL THEN (total - @refund_total) ELSE paid_amount END,
          balance = CASE WHEN @customer_id IS NULL THEN 0 ELSE (balance - @refund_total) END
      WHERE id = @sale_id;
    END

    COMMIT TRAN;

    SELECT
      @refund_id AS refund_id,
      @sale_id AS sale_id,
      @refund_total AS refund_total,
      @closure_id_open AS closure_id;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRAN;
    DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@msg,16,1);
  END CATCH
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
    @machine_name   NVARCHAR(120) = NULL,
    -- MODO VENTA ESENCIAL (licencia sin suscripcion activa). Lo decide el
    -- proceso principal con la licencia firmada, nunca la pantalla. Se vende
    -- y se cobra igual, pero el inventario NO se administra: no se valida
    -- existencia, no se descuenta y no se crean movimientos. No se toca
    -- ningun producto (vendible, modo de inventario, recetas, stock): al
    -- renovar todo vuelve tal cual estaba. La venta queda marcada para poder
    -- avisar cuantas hubo y desde cuando.
    @venta_esencial BIT = 0,
    @commercial_quote UNIQUEIDENTIFIER = NULL,
    @commercial_payment_reference NVARCHAR(100) = NULL,
    @payments_json NVARCHAR(MAX) = NULL,
    @client_sale_key UNIQUEIDENTIFIER = NULL,
    @client_sale_hash VARCHAR(64) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @sale_id INT;
    DECLARE @total   DECIMAL(10,2);
    DECLARE @is_credit BIT;
    DECLARE @errmsg NVARCHAR(400);

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

    IF @client_sale_key IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.sales WHERE client_sale_key=@client_sale_key) BEGIN
      IF @client_sale_hash IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.sales WHERE client_sale_key=@client_sale_key AND client_sale_hash=@client_sale_hash AND useer_id=@user_id AND register_id=@register_id) THROW 51000,'La clave de venta ya pertenece a otro cobro.',1;
      SELECT id sale_id,total,payment_method,register_id,service_mode,CAST(CASE WHEN payment_method='CREDITO' THEN 1 ELSE 0 END AS BIT) is_credit FROM dbo.sales WHERE client_sale_key=@client_sale_key;
      RETURN;
    END;

    SET @is_credit =
      CASE WHEN @customer_id IS NOT NULL AND UPPER(@payment_method) = 'CREDITO' THEN 1 ELSE 0 END;

    /* Una venta A CREDITO sin cliente quedaba con @is_credit = 0 y se
       registraba como PAGADA: saldo 0, nadie a quien cobrarle. */
    IF UPPER(@payment_method) = 'CREDITO' AND @customer_id IS NULL
    BEGIN
        RAISERROR('Una venta a credito necesita el cliente.', 16, 1);
        RETURN;
    END


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
        variant_option_id INT NULL,
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

    /* En Venta Esencial solo se vende lo COMERCIALMENTE vendible (sellable = 1).
       Un ingrediente o insumo no aparece en la venta, y aqui tampoco entra
       aunque alguien llame el canal a mano: la regla no depende de la
       pantalla. Fuera de Venta Esencial no cambia nada (una orden de servicio
       puede cobrar una refaccion que no se vende en mostrador, y en Venta
       Esencial Servicios esta en pausa). */
    IF ISNULL(@venta_esencial, 0) = 1
    BEGIN
        DECLARE @novendible NVARCHAR(100) = NULL;
        SELECT TOP 1 @novendible = p.nombre
        FROM #lines l
        JOIN dbo.products p ON p.id = l.product_id
        WHERE p.sellable = 0
        ORDER BY l.line_no;

        IF @novendible IS NOT NULL
        BEGIN
            SET @errmsg = N'"' + @novendible + N'" no es un producto de venta: no se puede cobrar en Venta Esencial.';
            RAISERROR(@errmsg, 16, 1);
            RETURN;
        END
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

    /* ------------------------- 3) LA RECETA EFECTIVA -------------------------
       El calculo NO vive aqui: vive en `sp_resolver_receta_efectiva`, que es
       el mismo que usa `sp_check_availability`. Tenerlo escrito dos veces
       seria tener dos motores que empiezan iguales y terminan distintos, y el
       sintoma seria el peor posible: la pantalla dice que hay y el cobro dice
       que no.

       El contrato son tablas temporales. No puede ser una funcion -el
       constructor del baseline solo despliega procedimientos- ni devolver un
       resultset -`INSERT ... EXEC` prohibe el ROLLBACK que este procedimiento
       necesita-.
       ------------------------------------------------------------------------ */
    CREATE TABLE #ef_lineas (
        line_no INT NOT NULL PRIMARY KEY,
        product_id INT NOT NULL,
        inventory_mode NVARCHAR(10) NULL,
        recipe_id INT NULL,
        variant_option_id INT NULL,
        scale DECIMAL(8,4) NULL
    );
    CREATE TABLE #ef_opciones (
        line_no INT NOT NULL,
        modifier_option_id INT NOT NULL,
        qty INT NOT NULL
    );
    CREATE TABLE #ef_requerimientos (
        line_no INT NOT NULL,
        product_id INT NOT NULL,
        qty_per_unit DECIMAL(18,6) NOT NULL,
        origen NVARCHAR(12) NOT NULL,
        modifier_option_id INT NULL,
        recipe_id INT NULL
    );

    INSERT INTO #ef_lineas (line_no, product_id, inventory_mode, scale)
    SELECT line_no, product_id, inventory_mode, 1 FROM #lines;
    INSERT INTO #ef_opciones (line_no, modifier_option_id, qty)
    SELECT line_no, option_id, qty FROM #mods;

    EXEC dbo.sp_resolver_receta_efectiva;

    /* La receta que se uso queda en la linea: es lo que se guarda en el
       detalle para poder decir despues con que receta se preparo. */
    UPDATE l SET recipe_id = e.recipe_id, variant_option_id = e.variant_option_id, scale = e.scale
    FROM #lines l JOIN #ef_lineas e ON e.line_no = l.line_no;

    /* ------------------------------------------------------------------------
       CUANDO NO HAY RECETA, DECIR CUAL DE LAS TRES COSAS PASA.

       El mensaje era siempre el mismo -"no tiene receta configurada"- y en QA
       fue falso: los productos 5 y 7 SI tenian receta, pero solo la de la
       variante (`variant_option_id = 1`). Retail no mandaba ninguna opcion de
       tamano, el CROSS APPLY de arriba no encontraba nada, y la venta se
       rechazaba diciendo que faltaba algo que estaba ahi. Quien lea eso va a
       buscar el problema en el sitio equivocado.

       Son tres situaciones distintas y cada una se arregla en otro lugar:

         SIN RECETA        no hay ninguna fila en `recipes`  -> configurarla
         FALTA LA VARIANTE hay recetas, pero todas por variante y la venta no
                           eligio tamano                     -> elegirlo
         VARIANTE SIN RECETA se eligio un tamano que no tiene receta propia y
                           tampoco hay receta base           -> configurarla

       No se toca la resolucion: una receta puede depender de la variante y eso
       es correcto. Lo que cambia es lo que se cuenta cuando falla.
       ------------------------------------------------------------------------ */
    IF EXISTS (SELECT 1 FROM #lines WHERE inventory_mode = 'RECIPE' AND recipe_id IS NULL)
    BEGIN
        SELECT TOP 1 @errmsg =
            CASE
                WHEN NOT EXISTS (SELECT 1 FROM dbo.recipes r
                                  WHERE r.product_id = l.product_id AND r.active = 1)
                    THEN CONCAT('El producto "', l.product_name, '" no tiene receta configurada.')
                WHEN NOT EXISTS (SELECT 1 FROM #mods m
                                  WHERE m.line_no = l.line_no AND m.role = 'SIZE')
                    THEN CONCAT('Falta elegir el tamano de "', l.product_name,
                                '": su receta depende del tamano y la venta no indico ninguno.')
                ELSE CONCAT('El tamano elegido para "', l.product_name,
                            '" no tiene receta, y el producto no tiene receta base.')
            END
        FROM #lines l
        WHERE l.inventory_mode = 'RECIPE' AND l.recipe_id IS NULL
        ORDER BY l.line_no;
        RAISERROR(@errmsg, 16, 1);
        RETURN;
    END


    /* Los requerimientos efectivos pasan a la estructura que ya usaba el resto
       del procedimiento. `source` conserva su significado historico -lo leen
       los reembolsos y las alertas de reposicion-: 'SALE' cuando el producto
       se consume a si mismo, 'RECIPE' cuando sale de una receta o de un
       modificador. */
    CREATE TABLE #req (
        line_no INT NOT NULL,
        product_id INT NOT NULL,
        qty_per_unit DECIMAL(18,6) NOT NULL,
        source NVARCHAR(20) NOT NULL,
        origen NVARCHAR(12) NOT NULL,
        modifier_option_id INT NULL
    );

    INSERT INTO #req (line_no, product_id, qty_per_unit, source, origen, modifier_option_id)
    SELECT line_no, product_id, qty_per_unit,
           CASE WHEN origen = 'DIRECT' THEN 'SALE' ELSE 'RECIPE' END,
           origen, modifier_option_id
    FROM #ef_requerimientos;

    /* Una cotización proviene del proceso principal, nunca de precios enviados por UI.
       La lista de partidas/opciones debe coincidir exactamente. Su consumo es atómico abajo. */
    DECLARE @cq NVARCHAR(MAX) = NULL;
    IF @commercial_quote IS NOT NULL
    BEGIN
      SELECT @cq=payload FROM dbo.commercial_quotes WHERE id=@commercial_quote AND actor_id=@user_id
        AND ISNULL(register_id,-1)=ISNULL(@register_id,-1) AND sale_id IS NULL
        AND ((@commercial_payment_reference IS NULL AND payment_reference IS NULL AND expires_at>SYSUTCDATETIME())
          OR (@payment_method='TERMINAL_MP' AND payment_reference=@commercial_payment_reference));
      IF @cq IS NULL THROW 51000,'La cotización venció o pertenece a otra cuenta.',1;
      IF (SELECT COUNT(*) FROM OPENJSON(@cq,'$.lines'))<>(SELECT COUNT(*) FROM #lines)
        THROW 51000,'Las partidas no coinciden con la cotización.',1;
      IF EXISTS(SELECT 1 FROM OPENJSON(@cq,'$.lines') WITH(line_no INT, productId INT, qty DECIMAL(12,2), unitPrice DECIMAL(10,2)) c
        LEFT JOIN #lines l ON l.line_no=c.line_no WHERE l.line_no IS NULL OR l.product_id<>c.productId OR l.quantity<>c.qty OR l.unit_price<>c.unitPrice)
        THROW 51000,'El precio o cantidad no coincide con la cotización.',1;
      IF EXISTS(SELECT 1 FROM (SELECT line_no,option_id,qty FROM #mods EXCEPT
        SELECT c.line_no,m.optionId,m.quantity FROM OPENJSON(@cq,'$.lines') WITH(line_no INT,options NVARCHAR(MAX) AS JSON) c
        CROSS APPLY OPENJSON(c.options) WITH(optionId INT,quantity INT) m) x)
        OR EXISTS(SELECT 1 FROM (SELECT c.line_no,m.optionId,m.quantity FROM OPENJSON(@cq,'$.lines') WITH(line_no INT,options NVARCHAR(MAX) AS JSON) c
        CROSS APPLY OPENJSON(c.options) WITH(optionId INT,quantity INT) m EXCEPT SELECT line_no,option_id,qty FROM #mods) x)
        THROW 51000,'Las opciones no coinciden con la cotización.',1;
    END;

    /* ------------------------ PRECIO DE LOS MODIFICADORES --------------------
       El precio de las opciones lo decide SQL, no la pantalla.

       Hasta ahora la interfaz sumaba los `price_delta` y mandaba un
       `unit_price` ya calculado, y aqui se aceptaba tal cual. Es la unica
       parte del flujo donde la interfaz podia cobrar una cosa y el inventario
       aplicar otra: elegir leche de almendra -que SI se descuenta del
       almacen- y cobrar el precio de la normal.

       Se compara SOLO la parte que pertenece a los modificadores, y solo en
       las lineas que llevan alguno con precio. Una linea sin opciones no se
       toca: el precio de un producto suelto sigue siendo cosa de la pantalla,
       con sus politicas y sus excepciones.

       La tolerancia de un centavo absorbe el redondeo decimal; cualquier cosa
       mayor es una discrepancia de verdad.
       ------------------------------------------------------------------------ */
    IF @commercial_quote IS NULL AND EXISTS (SELECT 1 FROM #mods WHERE ISNULL(price_delta, 0) <> 0)
    BEGIN
        DECLARE @linea_mal INT, @esperado DECIMAL(10,2), @recibido DECIMAL(10,2), @prod NVARCHAR(100);

        SELECT TOP 1
               @linea_mal = l.line_no,
               @prod      = l.product_name,
               @recibido  = l.unit_price,
               @esperado  = CAST(p.price + d.delta AS DECIMAL(10,2))
        FROM #lines l
        JOIN dbo.products p ON p.id = l.product_id
        CROSS APPLY (SELECT delta = ISNULL(SUM(m.price_delta * m.qty), 0)
                       FROM #mods m WHERE m.line_no = l.line_no) d
        WHERE d.delta <> 0
          AND ABS(l.unit_price - (p.price + d.delta)) > 0.01
        ORDER BY l.line_no;

        IF @linea_mal IS NOT NULL
        BEGIN
            SET @errmsg = CONCAT(
                'El precio de "', @prod, '" no coincide con sus opciones: se esperaba ',
                CONVERT(NVARCHAR(30), @esperado), ' y llego ', CONVERT(NVARCHAR(30), @recibido),
                '. Vuelve a agregar el producto.');
            RAISERROR(@errmsg, 16, 1);
            RETURN;
        END
    END

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
        IF @client_sale_key IS NOT NULL BEGIN
          DECLARE @prior_id INT, @prior_hash VARCHAR(64);
          SELECT @prior_id=id,@prior_hash=client_sale_hash FROM dbo.sales WITH(UPDLOCK,HOLDLOCK) WHERE client_sale_key=@client_sale_key;
          IF @prior_id IS NOT NULL BEGIN
            IF @prior_hash IS NULL OR @client_sale_hash IS NULL OR @prior_hash<>@client_sale_hash THROW 51000,'La identidad del cobro ya pertenece a otra intencion.',1;
            COMMIT TRAN; SELECT id AS sale_id,total,payment_method,register_id,service_mode,CAST(0 AS BIT) AS is_credit FROM dbo.sales WHERE id=@prior_id; RETURN;
          END
        END
        DECLARE @sale_closure INT;
        SELECT TOP 1 @sale_closure=id FROM dbo.cash_closures WITH(UPDLOCK,HOLDLOCK) WHERE register_id=@register_id AND closed_at IS NULL ORDER BY id DESC;
        IF @sale_closure IS NULL THROW 51000,'Abre el turno de esta caja antes de vender.',1;
        IF @commercial_quote IS NOT NULL
        BEGIN
          IF NOT EXISTS(SELECT 1 FROM dbo.commercial_quotes WITH(UPDLOCK,HOLDLOCK) WHERE id=@commercial_quote
              AND sale_id IS NULL AND ((@commercial_payment_reference IS NULL AND payment_reference IS NULL AND expires_at>SYSUTCDATETIME() AND policy_version=(SELECT version FROM dbo.commercial_policy WITH(HOLDLOCK) WHERE id=1))
                OR (@payment_method='TERMINAL_MP' AND payment_reference=@commercial_payment_reference)))
            THROW 51000,'La cotización cambió o ya se utilizó. Revisa la cuenta.',1;
          IF @commercial_payment_reference IS NULL AND EXISTS(SELECT 1 FROM OPENJSON(@cq,'$.catalog') WITH(id INT,price DECIMAL(10,2)) c
             JOIN dbo.products p WITH(HOLDLOCK) ON p.id=c.id WHERE p.price<>c.price)
            THROW 51000,'Cambió el precio del catálogo. Revisa la cuenta.',1;
          IF @commercial_payment_reference IS NULL AND EXISTS(SELECT 1 FROM OPENJSON(@cq,'$.optionPrices') WITH(id INT,price DECIMAL(10,2)) c
             LEFT JOIN dbo.modifier_options o WITH(HOLDLOCK) ON o.id=c.id WHERE o.id IS NULL OR o.active=0 OR o.price_delta<>c.price)
            THROW 51000,'Cambió el precio de una opción. Revisa la cuenta.',1;
        END;

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

        IF @pid IS NOT NULL AND ISNULL(@venta_esencial, 0) = 0
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
        DECLARE @cash_applied DECIMAL(12,2)=CASE WHEN @payment_method='EFECTIVO' THEN @total ELSE 0 END;
        DECLARE @pay TABLE(method NVARCHAR(50),amount DECIMAL(12,2),received DECIMAL(12,2),reference NVARCHAR(100));
        IF @payments_json IS NOT NULL BEGIN
          IF ISJSON(@payments_json)<>1 OR LEFT(LTRIM(@payments_json),1)<>'[' OR @is_credit=1 OR @payment_method='TERMINAL_MP' THROW 51000,'Distribucion de pagos invalida.',1;
          IF EXISTS(SELECT 1 FROM OPENJSON(@payments_json) j WHERE j.type<>5 OR TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(j.value,'$.amount')) IS NULL OR TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(j.value,'$.amount'))<>TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(j.value,'$.amount')) OR (JSON_VALUE(j.value,'$.received') IS NOT NULL AND (TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(j.value,'$.received')) IS NULL OR TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(j.value,'$.received'))<>TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(j.value,'$.received')))) OR LEN(JSON_VALUE(j.value,'$.reference'))>100) THROW 51000,'Importe o referencia de pago invalido.',1;
          INSERT @pay SELECT method,amount,CASE WHEN method='EFECTIVO' THEN ISNULL(received,amount) ELSE NULL END,reference FROM OPENJSON(@payments_json) WITH(method NVARCHAR(50),amount DECIMAL(12,2),received DECIMAL(12,2),reference NVARCHAR(100));
          IF (SELECT COUNT(*) FROM @pay) NOT BETWEEN 1 AND 4 OR EXISTS(SELECT 1 FROM @pay WHERE method IS NULL OR method NOT IN('EFECTIVO','TARJETA','TRANSFERENCIA','PLATAFORMA') OR amount IS NULL OR amount<=0 OR (method='EFECTIVO' AND received<amount)) OR EXISTS(SELECT method FROM @pay GROUP BY method HAVING COUNT(*)>1) OR (SELECT SUM(amount) FROM @pay)<>@total THROW 51000,'Los pagos deben cubrir exactamente la venta, sin metodos duplicados.',1;
          SELECT @cash_applied=ISNULL(SUM(CASE WHEN method='EFECTIVO' THEN amount ELSE 0 END),0) FROM @pay;
          SET @payment_method=CASE WHEN (SELECT COUNT(*) FROM @pay)>1 THEN 'MIXTO' ELSE (SELECT TOP 1 method FROM @pay) END;
        END
        ELSE IF @payment_method='MIXTO' THROW 51000,'Falta la distribucion del pago mixto.',1;

        /* 5b) CREDITO: el cliente puede llevarselo fiado.
           La pantalla ya filtra, pero la regla vive AQUI, donde no hay pantalla
           que saltarse. La fila del cliente se bloquea: dos cajas vendiendole a
           la vez no pueden gastar dos veces el mismo disponible.

           Misma regla que sp_get_customers y sp_get_customers_with_credit_available:
             - activo, con limite, y sin riesgo alto (3);
             - sin ventas VENCIDAS: vencida = vencimiento + dias de gracia < hoy;
             - la deuda abierta mas esta venta no pasa del limite.
           Y si la venta no trae vencimiento, vence a los dias de plazo del cliente. */
        IF @is_credit = 1
        BEGIN
            DECLARE @cr_limite DECIMAL(12,2), @cr_activo BIT, @cr_riesgo TINYINT,
                    @cr_plazo INT, @cr_gracia INT, @cr_deuda DECIMAL(12,2), @cr_vencidas INT,
                    @cr_hoy DATE = CONVERT(date, GETDATE());

            SELECT @cr_limite = credit_limit, @cr_activo = active, @cr_riesgo = risk_level,
                   @cr_plazo = terms_days, @cr_gracia = grace_days
            FROM dbo.customers WITH (UPDLOCK, HOLDLOCK)
            WHERE id = @customer_id;

            IF @cr_limite IS NULL
                RAISERROR('El cliente de la venta a credito no existe.', 16, 1);
            IF @cr_activo = 0
                RAISERROR('El cliente esta inactivo: no se le puede vender a credito.', 16, 1);
            IF @cr_limite <= 0
                RAISERROR('Este cliente no tiene credito autorizado.', 16, 1);
            IF @cr_riesgo >= 3
                RAISERROR('Este cliente esta en riesgo alto: el credito nuevo esta suspendido.', 16, 1);

            SELECT @cr_deuda = ISNULL(SUM(balance), 0),
                   @cr_vencidas = ISNULL(SUM(CASE WHEN due_date IS NOT NULL
                                                   AND DATEADD(DAY, @cr_gracia, due_date) < @cr_hoy
                                                  THEN 1 ELSE 0 END), 0)
            FROM dbo.sales
            WHERE customer_id = @customer_id
              AND UPPER(payment_method) = 'CREDITO'
              AND balance > 0;

            IF @cr_vencidas > 0
                RAISERROR('Este cliente tiene ventas a credito vencidas. Registra un abono antes de volver a venderle a credito.', 16, 1);

            IF @cr_deuda + @total > @cr_limite
            BEGIN
                SET @errmsg = CONCAT('La venta ($', FORMAT(@total, 'N2', 'es-MX'),
                                     ') supera el credito disponible del cliente ($',
                                     FORMAT(CASE WHEN @cr_limite - @cr_deuda > 0 THEN @cr_limite - @cr_deuda ELSE 0 END, 'N2', 'es-MX'),
                                     ').');
                RAISERROR(@errmsg, 16, 1);
            END

            IF @due_date IS NULL AND @cr_plazo > 0
                SET @due_date = DATEADD(DAY, @cr_plazo, @cr_hoy);
        END

        /* 6) Venta */
        INSERT INTO sales (datee, useer_id, total, payment_method, customer_id, paid_amount, balance, due_date, register_id, service_mode, venta_esencial)
        VALUES (
          GETDATE(), @user_id, @total, @payment_method,
          @customer_id,
          CASE WHEN @is_credit = 1 THEN 0 ELSE @total END,
          CASE WHEN @is_credit = 1 THEN @total ELSE 0 END,
          @due_date,
          @register_id,
          @service_mode,
          ISNULL(@venta_esencial, 0)
        );

        SET @sale_id = SCOPE_IDENTITY();
        UPDATE dbo.sales SET client_sale_key=@client_sale_key,client_sale_hash=@client_sale_hash,closure_id=@sale_closure WHERE id=@sale_id;
        IF @payments_json IS NOT NULL INSERT dbo.sale_payments(sale_id,payment_method,amount,received,reference) SELECT @sale_id,method,amount,received,reference FROM @pay;
        ELSE IF @is_credit=0 INSERT dbo.sale_payments(sale_id,payment_method,amount) VALUES(@sale_id,@payment_method,@total);
        IF @commercial_quote IS NOT NULL BEGIN
          UPDATE dbo.commercial_quotes SET sale_id=@sale_id WHERE id=@commercial_quote;
          UPDATE dbo.sales SET commercial_snapshot=@cq WHERE id=@sale_id;
        END;

        /* El cupón de una cotización se consume DENTRO de la transacción de venta. */
        DECLARE @coupon_code NVARCHAR(24)=JSON_VALUE(@cq,'$.coupon.code'),@coupon_id INT;
        IF @coupon_code IS NOT NULL
        BEGIN
          UPDATE ci SET uses_count=ci.uses_count+1,status=CASE WHEN ci.uses_count+1>=ci.uses_allowed THEN 'REDEEMED' ELSE ci.status END,sale_id=ISNULL(ci.sale_id,@sale_id)
          FROM dbo.coupon_instances ci JOIN dbo.coupon_definitions cd ON cd.id=ci.definition_id
          WHERE ci.code=@coupon_code AND ci.id=TRY_CONVERT(INT,JSON_VALUE(@cq,'$.coupon.instanceId')) AND cd.kind='FREE_PRODUCT' AND cd.product_id=TRY_CONVERT(INT,JSON_VALUE(@cq,'$.coupon.productId')) AND ci.status='ISSUED' AND cd.active=1 AND ci.uses_count<ci.uses_allowed AND (ci.expires_at IS NULL OR ci.expires_at>=SYSDATETIME());
          IF @@ROWCOUNT<>1 THROW 51000,'El cupón venció o ya se utilizó. La venta no se registró.',1;
          SELECT @coupon_id=id FROM dbo.coupon_instances WHERE code=@coupon_code;
          INSERT dbo.loyalty_redemptions(kind,reward_instance_id,coupon_instance_id,sale_id,register_id,machine_id,amount_applied,created_at)
          VALUES('COUPON',NULL,@coupon_id,@sale_id,@register_id,@machine_id,TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(@cq,'$.coupon.amountApplied')),SYSDATETIME());
        END;

        /* 7) Detalle (MERGE para recuperar line_no -> sale_detail_id) */
        /* `recipe_id` y `variant_option_id` dejan constancia de CON QUE receta
           se preparo esta linea. No son el historico completo -si manana
           cambian `recipe_lines`, la receta ya no dice lo mismo-, pero
           permiten responder "esto se hizo con la receta Grande" sin tener que
           deducirlo. El consumo real queda congelado en inventory_movements. */
        MERGE INTO dbo.sale_detail AS t
        USING (SELECT line_no, product_id, quantity, unit_price, unit_cost, inventory_mode, note,
                      recipe_id, variant_option_id FROM #lines) AS s
           ON 1 = 0
        WHEN NOT MATCHED THEN
            INSERT (sale_id, product_id, quantity, unitary_price, unit_cost, inventory_mode, note,
                    recipe_id, variant_option_id)
            VALUES (@sale_id, s.product_id, s.quantity, s.unit_price, s.unit_cost, s.inventory_mode, s.note,
                    s.recipe_id, s.variant_option_id)
        OUTPUT inserted.id, s.line_no INTO #map (sale_detail_id, line_no);
        UPDATE d SET tax_rate=p.tasa_iva,tax_object=p.objeto_impuesto FROM dbo.sale_detail d JOIN dbo.products p ON p.id=d.product_id WHERE d.sale_id=@sale_id;

        IF @cq IS NOT NULL UPDATE d SET commercial_snapshot=c.audit
          FROM dbo.sale_detail d JOIN #map m ON m.sale_detail_id=d.id
          JOIN OPENJSON(@cq,'$.lines') WITH(line_no INT,audit NVARCHAR(MAX) AS JSON) c ON c.line_no=m.line_no;

        /* El snapshot guarda lo que se COBRO y ahora tambien lo que el
           modificador HIZO fisicamente: que ingrediente metio, cual quito y
           con que cantidades. Antes solo quedaba el nombre y el precio, asi
           que auditar "por que esta venta consumio leche de almendra" obligaba
           a mirar la definicion ACTUAL de la opcion, que pudo cambiar.
           `price_delta` sale de `modifier_options`, no de lo que mando la
           pantalla: el precio canonico es el de la configuracion. */
        INSERT INTO dbo.sale_detail_modifiers (
            sale_detail_id, modifier_option_id, group_name, option_name, price_delta, quantity, effect,
            ingredient_product_id, replaces_product_id, qty_base_aplicado, qty_factor_aplicado)
        SELECT mp.sale_detail_id, m.option_id, m.group_name, m.option_name, ISNULL(m.price_delta, 0), m.qty, m.effect,
               m.ingredient_product_id, m.replaces_product_id, m.qty_base, m.qty_factor
        FROM #mods m
        JOIN #map mp ON mp.line_no = m.line_no;

        /* 8 y 9) Inventario. En Venta Esencial NO se administra: ni stock ni
              movimientos. La venta registrada es la evidencia. */
        IF ISNULL(@venta_esencial, 0) = 0
        BEGIN
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
        END

        /* 10) Movimiento CAJA (solo EFECTIVO contado) - turno POR CAJA */
        IF @is_credit = 0 AND @cash_applied > 0
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
            (GETDATE(), @user_id, 'SALE', @sale_id, CONCAT('Venta ', @sale_id), @cash_applied, NULL, @closure_id_open, @register_id);
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

/* ---------- sp_sales_by_payment (SQL_STORED_PROCEDURE) ---------- */
/* sp_sales_by_payment
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Ventas por metodo de pago en los ultimos @days dias */
CREATE OR ALTER PROCEDURE dbo.sp_sales_by_payment
    @days INT = 30
AS
BEGIN
    SET NOCOUNT ON;
    ;WITH payments AS (
      SELECT s.id,s.datee,p.payment_method,p.amount FROM dbo.sales s JOIN dbo.sale_payments p ON p.sale_id=s.id
      UNION ALL SELECT s.id,s.datee,s.payment_method,s.total FROM dbo.sales s WHERE NOT EXISTS(SELECT 1 FROM dbo.sale_payments p WHERE p.sale_id=s.id)
    ) SELECT payment_method,COUNT(DISTINCT id) tickets,SUM(amount) total FROM payments WHERE datee>=DATEADD(DAY,-@days,CAST(GETDATE() AS DATE)) GROUP BY payment_method ORDER BY SUM(amount) DESC;
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
       TRANSFER      0052: TRANSFER_SENT / TRANSFER_RECEIVED (salida a un evento
                     y su confirmación) · RETURN_RECEIVED (el sobrante que volvió).
                     Lleva sus líneas con UUID de producto: la nube arma el ledger
                     del evento y la tablet recibe la mercancía.
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
    /* Las transferencias se capturan TODAS (son pocas y la feria las necesita). */
    IF NOT EXISTS (SELECT 1 FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'TRANSFER')
        INSERT INTO dbo.sync_capture_state (aggregate_type, last_rv) VALUES ('TRANSFER', 0x0000000000000000);

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
                JSON_QUERY((SELECT payment_method method,amount,received,reference FROM dbo.sale_payments WHERE sale_id=s.id FOR JSON PATH)) AS payments,
                s.service_mode                  AS service_mode,
                s.venta_esencial                AS venta_esencial,
                JSON_QUERY(s.commercial_snapshot) AS commercial,
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

    /* ------------------------------------------------------ TRANSFERENCIAS */
    SELECT @wm = last_rv FROM dbo.sync_capture_state WITH (UPDLOCK, HOLDLOCK) WHERE aggregate_type = 'TRANSFER';

    SELECT TOP (@max_rows) t.id, t.uuid, t.rv, CAST(t.rv AS BIGINT) AS version
      INTO #transf
      FROM dbo.stock_transfers t
     WHERE t.rv > @wm AND t.rv < @tope
     ORDER BY t.rv;

    INSERT INTO dbo.sync_outbox (event_uuid, event_type, aggregate_type, aggregate_uuid, aggregate_version, occurred_at, payload)
    SELECT k.event_uuid,
           CASE WHEN t.kind = 'RETURN_IN' THEN 'RETURN_RECEIVED'
                WHEN t.status = 'RECEIVED' THEN 'TRANSFER_RECEIVED'
                ELSE 'TRANSFER_SENT' END,
           'TRANSFER', t.uuid, x.version,
           TODATETIMEOFFSET(ISNULL(t.received_at, t.created_at), @offset),
           (SELECT
                t.uuid                 AS transfer_uuid,
                t.kind                 AS kind,
                t.status               AS status,
                t.event_location_uuid  AS event_location_uuid,
                t.event_name           AS event_name,
                t.note                 AS note,
                CONVERT(VARCHAR(19), t.created_at, 126)  AS created_local,
                CONVERT(VARCHAR(19), t.received_at, 126) AS received_local,
                t.created_machine_name AS device,
                t.manifest_signature   AS signature,
                u.uuid AS [created_by.uuid], u.usuario AS [created_by.name],
                (SELECT p.uuid AS product_uuid, p.nombre AS product_name,
                        CONVERT(VARCHAR(20), l.qty_sent) AS qty_sent,
                        CONVERT(VARCHAR(20), l.qty_received) AS qty_received
                   FROM dbo.stock_transfer_lines l JOIN dbo.products p ON p.id = l.product_id
                  WHERE l.transfer_id = t.id
                  ORDER BY l.id
                    FOR JSON PATH) AS lines
              FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
      FROM #transf x
      JOIN dbo.stock_transfers t ON t.id = x.id
      LEFT JOIN dbo.users u ON u.id = t.created_by
     CROSS APPLY (SELECT CAST(CAST(HASHBYTES('SHA2_256',
                    CONCAT('TRANSFER|', CONVERT(VARCHAR(36), t.uuid), '|', x.version)) AS BINARY(16)) AS UNIQUEIDENTIFIER) AS event_uuid) k
     WHERE NOT EXISTS (SELECT 1 FROM dbo.sync_outbox o WHERE o.event_uuid = k.event_uuid);
    SET @capturados += @@ROWCOUNT;

    IF EXISTS (SELECT 1 FROM #transf)
        UPDATE dbo.sync_capture_state SET last_rv = (SELECT MAX(rv) FROM #transf), updated_at = SYSUTCDATETIME()
         WHERE aggregate_type = 'TRANSFER';

    COMMIT TRAN;

    SELECT @capturados AS capturados,
           (SELECT COUNT(*) FROM dbo.sync_outbox WHERE status = 'PENDING') AS pendientes;
END
GO

/* ---------- sp_update_sale (SQL_STORED_PROCEDURE) ---------- */
/* sp_update_sale
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* -------------------- sp_update_sale -------------------- */
CREATE OR ALTER PROCEDURE [dbo].[sp_update_sale]
  @sale_id INT,
  @user_id INT,
  @SaleDetails dbo.SaleDetailType READONLY,
  @note NVARCHAR(400) = NULL,
  -- 0049: la caja donde se cobra o se devuelve la diferencia. El turno se
  -- busca por caja, no por quien lo abrio (mismo criterio que la devolucion).
  @register_id INT = NULL,
  @machine_id NVARCHAR(64) = NULL,
  @machine_name NVARCHAR(120) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  IF @sale_id IS NULL OR @sale_id <= 0
  BEGIN
    RAISERROR('sale_id inválido.',16,1);
    RETURN;
  END

  BEGIN TRY
    BEGIN TRAN;

    IF EXISTS(SELECT 1 FROM dbo.sales WHERE id=@sale_id AND commercial_snapshot IS NOT NULL) THROW 51000,'Las ventas con ofertas se corrigen mediante devolución y una nueva venta.',1;
    IF EXISTS(SELECT 1 FROM dbo.sales WHERE id=@sale_id AND payment_method='MIXTO') THROW 51000,'Corrige un pago mixto mediante devolución y una nueva venta.',1;
    IF EXISTS (SELECT 1 FROM dbo.sale_refunds WHERE sale_id = @sale_id)
    BEGIN
      RAISERROR('No se puede actualizar: la venta ya tiene reembolsos.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    /* La edicion recalcula stock por PRODUCTO vendido: solo vale para lineas
       DIRECT sin modificadores. Una venta con recetas se corrige con
       Reembolso / Cambio, que repone lo que realmente se consumio. */
    IF EXISTS (SELECT 1 FROM dbo.sale_detail d WHERE d.sale_id = @sale_id AND d.inventory_mode = 'RECIPE')
       OR EXISTS (SELECT 1 FROM dbo.sale_detail d JOIN dbo.sale_detail_modifiers m ON m.sale_detail_id = d.id WHERE d.sale_id = @sale_id)
       OR EXISTS (SELECT 1 FROM @SaleDetails n JOIN dbo.products p ON p.id = n.product_id WHERE p.inventory_mode = 'RECIPE')
    BEGIN
      RAISERROR('Esta venta contiene recetas o modificadores: usa Reembolso / Cambio en lugar de modificarla.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    DECLARE @old_total DECIMAL(12,2);
    DECLARE @payment_method NVARCHAR(50);
    DECLARE @customer_id INT;
    DECLARE @paid_amount DECIMAL(12,2);
    DECLARE @balance DECIMAL(12,2);

    SELECT
      @old_total = s.total,
      @payment_method = s.payment_method,
      @customer_id = s.customer_id,
      @paid_amount = s.paid_amount,
      @balance = s.balance
    FROM dbo.sales s WITH (UPDLOCK, HOLDLOCK)
    WHERE s.id = @sale_id;

    IF @old_total IS NULL
    BEGIN
      RAISERROR('La venta no existe.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    IF (@customer_id IS NOT NULL AND UPPER(@payment_method)='CREDITO')
       AND (ISNULL(@paid_amount,0) > 0 AND ISNULL(@balance,0) < ISNULL(@old_total,0))
    BEGIN
      RAISERROR('No se puede actualizar: venta a crédito con pagos registrados.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    ;WITH n AS (
      SELECT product_id, SUM(quantity) AS qty, MAX(unit_price) AS unit_price
      FROM @SaleDetails
      GROUP BY product_id
    )
    SELECT * INTO #new FROM n;

    SELECT
      d.product_id,
      SUM(d.quantity) AS qty,
      MAX(d.unitary_price) AS unit_price,
      MAX(d.unit_cost) AS unit_cost
    INTO #old
    FROM dbo.sale_detail d
    WHERE d.sale_id = @sale_id
    GROUP BY d.product_id;

    /* Solo los productos con inventario directo mueven stock; NONE no. */
    ;WITH delta AS (
      SELECT
        COALESCE(o.product_id, n.product_id) AS product_id,
        ISNULL(o.qty,0) AS old_qty,
        ISNULL(n.qty,0) AS new_qty,
        CASE WHEN p.inventory_mode = 'DIRECT' THEN (ISNULL(o.qty,0) - ISNULL(n.qty,0)) ELSE 0 END AS stock_change
      FROM #old o
      FULL JOIN #new n ON n.product_id = o.product_id
      JOIN dbo.products p ON p.id = COALESCE(o.product_id, n.product_id)
    )
    SELECT * INTO #delta FROM delta;

    IF EXISTS (
      SELECT 1
      FROM #delta d
      JOIN dbo.products p WITH (UPDLOCK, HOLDLOCK) ON p.id = d.product_id
      WHERE d.stock_change < 0
        AND p.stock < ABS(d.stock_change)
    )
    BEGIN
      RAISERROR('No hay stock suficiente para aumentar cantidades en la venta.',16,1);
      ROLLBACK TRAN;
      RETURN;
    END

    UPDATE p
    SET p.stock = p.stock + d.stock_change
    FROM dbo.products p
    JOIN #delta d ON d.product_id = p.id;

    DECLARE @new_total DECIMAL(12,2);
    SELECT @new_total = ISNULL(SUM(qty * unit_price),0) FROM #new;

    DELETE FROM dbo.sale_detail WHERE sale_id = @sale_id;

    /* Se conserva el costo congelado de la linea original; una linea nueva
       toma el costo actual del producto. */
    INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, inventory_mode)
    SELECT @sale_id, n.product_id, n.qty, n.unit_price, ISNULL(o.unit_cost, p.cost), p.inventory_mode
    FROM #new n
    JOIN dbo.products p ON p.id = n.product_id
    LEFT JOIN #old o ON o.product_id = n.product_id;

    INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, sold_product_id, units, unit_cost)
    SELECT
      d.product_id,
      CASE WHEN d.stock_change < 0 THEN 'salida' ELSE 'entrada' END,
      CAST(@sale_id AS NVARCHAR(50)),
      ABS(d.stock_change),
      GETDATE(),
      CONCAT('Ajuste venta ', @sale_id, COALESCE(CONCAT(' - ', @note), '')),
      'EDIT',
      d.product_id,
      ABS(d.stock_change),
      p.cost
    FROM #delta d
    JOIN dbo.products p ON p.id = d.product_id
    WHERE d.stock_change <> 0;

    UPDATE dbo.sales
    SET total = @new_total,
        paid_amount = CASE
            WHEN @customer_id IS NOT NULL AND UPPER(@payment_method)='CREDITO' THEN ISNULL(paid_amount,0)
            ELSE @new_total
        END,
        balance = CASE
            WHEN @customer_id IS NOT NULL AND UPPER(@payment_method)='CREDITO' THEN @new_total
            ELSE 0
        END
    WHERE id = @sale_id;

    IF (@customer_id IS NULL OR UPPER(@payment_method) <> 'CREDITO')
       AND UPPER(@payment_method)='EFECTIVO'
    BEGIN
      DECLARE @delta_total DECIMAL(12,2) = (@new_total - ISNULL(@old_total,0));

      /* Sin diferencia no se toca el cajon, y por lo tanto no hace falta ni
         caja ni turno: editar una venta sin cambiar su total no debe fallar
         porque la caja este cerrada. */
      IF @delta_total <> 0
      BEGIN
        DECLARE @caja INT, @closure_id_open INT;
        EXEC dbo.sp_resolve_cash_register
            @register_id = @register_id, @machine_id = @machine_id,
            @machine_name = @machine_name, @user_id = @user_id, @resolved = @caja OUTPUT;
        IF @caja IS NULL
          RAISERROR('No se pudo determinar la caja del ajuste. Abre el turno en esta caja e intenta de nuevo.',16,1);

        SELECT TOP(1) @closure_id_open = id
        FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
        WHERE register_id = @caja AND closed_at IS NULL
        ORDER BY opened_at DESC, id DESC;

        IF @closure_id_open IS NULL
          RAISERROR('No hay turno abierto para registrar el ajuste en caja.',16,1);

        INSERT INTO dbo.cash_movements
          (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
        VALUES
          (GETDATE(), @user_id, 'SALE_ADJ', @sale_id,
           CONCAT('Ajuste Venta ', @sale_id),
           @delta_total,
           @note,
           @closure_id_open,
           @caja);
      END
    END

    UPDATE p SET amount=s.total FROM dbo.sale_payments p JOIN dbo.sales s ON s.id=p.sale_id WHERE s.id=@sale_id;
    COMMIT TRAN;

    SELECT
      @sale_id AS sale_id,
      @old_total AS old_total,
      @new_total AS new_total,
      (@new_total - @old_total) AS delta_total;

  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRAN;
    DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
    RAISERROR(@msg,16,1);
  END CATCH
END
GO
