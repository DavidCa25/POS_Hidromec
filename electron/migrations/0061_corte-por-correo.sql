/* ============================================================
   0061 — corte por correo

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0061_corte-por-correo.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0061_corte-por-correo.sql ========== */
/* ============================================================
   0061 — Corte de caja por correo (esquema)

   cash_closure_email_jobs    Un renglón por corte que se intentó enviar.
                              Es la BANDERA: un corte con status ENVIADO no
                              se vuelve a mandar, ni solo ni en lote. Un corte
                              sin renglón nunca se intentó (cortes anteriores
                              a esta versión: "sin enviar").

   El correo lo arma y lo manda la nube (función corte-email) a los dueños
   del negocio en Owner. Aquí solo vive el estado del envío de cada corte.
   `id` es la llave de idempotencia con la nube: reintentar el mismo corte
   nunca produce dos correos.

   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF OBJECT_ID(N'dbo.cash_closure_email_jobs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.cash_closure_email_jobs (
        closure_id      INT              NOT NULL,
        id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_cash_closure_email_jobs_id DEFAULT (NEWID()),
        status          NVARCHAR(12)     COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_cash_closure_email_jobs_status DEFAULT (N'PENDIENTE'),
        attempts        INT              NOT NULL CONSTRAINT DF_cash_closure_email_jobs_attempts DEFAULT (0),
        recipients      INT              NULL,
        last_error      NVARCHAR(300)    COLLATE Modern_Spanish_CI_AS NULL,
        requested_by    INT              NULL,
        created_at      DATETIME2(0)     NOT NULL CONSTRAINT DF_cash_closure_email_jobs_created_at DEFAULT (SYSDATETIME()),
        last_attempt_at DATETIME2(0)     NULL,
        sent_at         DATETIME2(0)     NULL,
        CONSTRAINT PK_cash_closure_email_jobs PRIMARY KEY CLUSTERED (closure_id),
        CONSTRAINT UQ_cash_closure_email_jobs_id UNIQUE NONCLUSTERED (id),
        CONSTRAINT FK_cash_closure_email_jobs_closure FOREIGN KEY (closure_id) REFERENCES dbo.cash_closures (id),
        CONSTRAINT CK_cash_closure_email_jobs_status CHECK (status IN (N'PENDIENTE', N'ENVIANDO', N'ENVIADO', N'ERROR'))
    );
END;
GO

/* ---------- sp_cash_closure_email_data (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================= sp_cash_closure_email_data (0061) =================
   Lo que el correo del corte necesita y el comprobante impreso no trae.
   Los importes del corte (ventas, formas de pago, arqueo) salen del
   snapshot congelado (sp_cash_closure_ticket) y el desglose de efectivo de
   sp_get_cash_movements: aquí no se recalcula nada de eso.

     1  encabezado   negocio, caja, quién abrió, quién cerró, quién autorizó
     2  productos    los 15 que más vendieron en el turno (por importe)
     3  productos    cuántos productos distintos y piezas en total
     4  devoluciones del turno, una por una
     5  bitácora     eventos de seguridad del turno, agrupados por tipo

   Las ventas del turno se eligen igual que en el comprobante: las que ya
   llevan su closure_id, o las de esa caja dentro del horario del turno.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_cash_closure_email_data
    @closure_id INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @caja INT, @desde DATETIME2(0), @hasta DATETIME2(0);
    SELECT @caja = register_id, @desde = opened_at, @hasta = closed_at
      FROM dbo.cash_closures WHERE id = @closure_id AND closed_at IS NOT NULL;
    IF @desde IS NULL THROW 51000, 'Ese corte no existe o sigue abierto.', 1;

    /* 1 encabezado */
    SELECT c.id, c.uuid, c.opened_at, c.closed_at, c.blind_count,
           r.name AS register_name,
           (SELECT TOP 1 business_name FROM dbo.business_config ORDER BY id) AS business_name,
           ua.usuario AS opened_by, uc.usuario AS closed_by, uz.usuario AS authorized_by,
           c.opened_machine_name, c.closed_machine_name
      FROM dbo.cash_closures c
      LEFT JOIN dbo.registers r ON r.id = c.register_id
      LEFT JOIN dbo.users ua ON ua.id = c.userId
      LEFT JOIN dbo.users uc ON uc.id = c.closed_by_user_id
      LEFT JOIN dbo.users uz ON uz.id = c.close_authorized_by
     WHERE c.id = @closure_id;

    SELECT s.id INTO #ventas
      FROM dbo.sales s
     WHERE s.closure_id = @closure_id
        OR (s.closure_id IS NULL AND s.register_id = @caja AND s.datee >= @desde AND s.datee <= @hasta);

    /* 2 productos más vendidos */
    SELECT TOP (15) p.nombre AS producto, SUM(d.quantity) AS cantidad, SUM(d.subtotal) AS importe
      FROM #ventas v
      JOIN dbo.sale_detail d ON d.sale_id = v.id
      JOIN dbo.products p ON p.id = d.product_id
     GROUP BY p.nombre
     ORDER BY SUM(d.subtotal) DESC, p.nombre;

    /* 3 totales de productos */
    SELECT COUNT(DISTINCT d.product_id) AS productos, ISNULL(SUM(d.quantity), 0) AS piezas
      FROM #ventas v JOIN dbo.sale_detail d ON d.sale_id = v.id;

    /* 4 devoluciones */
    SELECT f.datee, f.sale_id, f.refund_total, f.payment_method, f.note, u.usuario AS quien
      FROM dbo.sale_refunds f
      LEFT JOIN dbo.users u ON u.id = f.user_id
     WHERE f.closure_id = @closure_id
     ORDER BY f.datee;

    /* 5 bitácora del turno */
    SELECT e.event_type, COUNT(*) AS veces, SUM(e.amount) AS monto
      FROM dbo.security_events e
     WHERE (e.register_id = @caja OR e.register_id IS NULL)
       AND e.datee >= @desde AND e.datee <= @hasta
     GROUP BY e.event_type
     ORDER BY COUNT(*) DESC;
END;
GO

/* ---------- sp_cash_closure_email_job (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================= sp_cash_closure_email_job (0061) =================
   El estado del correo de UN corte. Es la bandera que impide mandarlo dos
   veces.

     @accion = 'RESERVAR'  Antes de llamar a la nube. Devuelve `resultado`:
                 RESERVADO   adelante: el renglón queda ENVIANDO.
                 YA_ENVIADO  ya salió; no se manda otra vez.
                 OCUPADO     otro envío del mismo corte está en curso
                             (menos de 2 minutos): no se duplica.
     @accion = 'ENVIADO'   La nube confirmó. Guarda cuántos destinatarios.
     @accion = 'ERROR'     No salió. Se puede reintentar.

   Solo cortes CERRADOS: un turno abierto todavía no tiene corte.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_cash_closure_email_job
    @closure_id INT,
    @accion     VARCHAR(10),
    @user_id    INT = NULL,
    @recipients INT = NULL,
    @error      NVARCHAR(300) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @accion NOT IN ('RESERVAR', 'ENVIADO', 'ERROR')
        THROW 51000, 'Accion de correo no valida.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.cash_closures WHERE id = @closure_id AND closed_at IS NOT NULL)
        THROW 51000, 'Ese corte no existe o sigue abierto.', 1;

    DECLARE @resultado VARCHAR(12) = @accion;

    BEGIN TRAN;
    IF @accion = 'RESERVAR'
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.cash_closure_email_jobs WITH (UPDLOCK, HOLDLOCK) WHERE closure_id = @closure_id)
            INSERT dbo.cash_closure_email_jobs (closure_id, requested_by) VALUES (@closure_id, @user_id);

        DECLARE @status NVARCHAR(12), @ultimo DATETIME2(0);
        SELECT @status = status, @ultimo = last_attempt_at
          FROM dbo.cash_closure_email_jobs WITH (UPDLOCK) WHERE closure_id = @closure_id;

        IF @status = N'ENVIADO'
            SET @resultado = 'YA_ENVIADO';
        ELSE IF @status = N'ENVIANDO' AND @ultimo > DATEADD(MINUTE, -2, SYSDATETIME())
            SET @resultado = 'OCUPADO';
        ELSE
        BEGIN
            UPDATE dbo.cash_closure_email_jobs
               SET status = N'ENVIANDO', attempts = attempts + 1, last_attempt_at = SYSDATETIME(),
                   requested_by = ISNULL(@user_id, requested_by)
             WHERE closure_id = @closure_id;
            SET @resultado = 'RESERVADO';
        END
    END
    ELSE IF @accion = 'ENVIADO'
        UPDATE dbo.cash_closure_email_jobs
           SET status = N'ENVIADO', sent_at = SYSDATETIME(), recipients = @recipients, last_error = NULL
         WHERE closure_id = @closure_id;
    ELSE
        UPDATE dbo.cash_closure_email_jobs
           SET status = N'ERROR', last_error = LEFT(@error, 300)
         WHERE closure_id = @closure_id AND status <> N'ENVIADO';
    COMMIT TRAN;

    SELECT j.closure_id, j.id, j.status, j.attempts, j.recipients, j.last_error, j.sent_at, @resultado AS resultado
      FROM dbo.cash_closure_email_jobs j WHERE j.closure_id = @closure_id;
END;
GO

/* ---------- sp_cash_closure_email_list (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================= sp_cash_closure_email_list (0061) =================
   Los cortes cerrados de un periodo con el estado de su correo. Un corte
   sin renglón en cash_closure_email_jobs sale como SIN_ENVIAR: es lo que
   pasa con los cortes anteriores a esta versión.

   @solo_pendientes = 1: lo que el botón "Enviar pendientes" puede mandar
   (todo lo que no está ENVIADO), del más viejo al más nuevo.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_cash_closure_email_list
    @desde           DATE = NULL,
    @hasta           DATE = NULL,
    @register_id     INT  = NULL,
    @solo_pendientes BIT  = 0,
    @top             INT  = 200
AS
BEGIN
    SET NOCOUNT ON;
    IF @hasta IS NULL SET @hasta = CAST(SYSDATETIME() AS DATE);
    IF @desde IS NULL SET @desde = DATEADD(DAY, -30, @hasta);
    IF @top IS NULL OR @top < 1 OR @top > 500 SET @top = 200;

    SELECT TOP (@top)
           c.id, c.opened_at, c.closed_at, r.name AS register_name, u.usuario AS cashier,
           TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(c.receipt_snapshot, '$.total')) AS total,
           c.difference,
           ISNULL(j.status, N'SIN_ENVIAR') AS email_status,
           j.sent_at, j.attempts, j.recipients, j.last_error
      FROM dbo.cash_closures c
      LEFT JOIN dbo.registers r ON r.id = c.register_id
      LEFT JOIN dbo.users u ON u.id = c.userId
      LEFT JOIN dbo.cash_closure_email_jobs j ON j.closure_id = c.id
     WHERE c.closed_at IS NOT NULL
       AND c.closed_at >= @desde AND c.closed_at < DATEADD(DAY, 1, @hasta)
       AND (@register_id IS NULL OR c.register_id = @register_id)
       AND (@solo_pendientes = 0 OR ISNULL(j.status, N'SIN_ENVIAR') <> N'ENVIADO')
     ORDER BY CASE WHEN @solo_pendientes = 1 THEN c.closed_at END ASC,
              c.closed_at DESC, c.id DESC;
END;
GO
