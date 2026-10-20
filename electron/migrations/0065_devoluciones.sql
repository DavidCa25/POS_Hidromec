/* ============================================================
   0065 — devoluciones

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0065_devoluciones.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0065_devoluciones.sql ========== */
/* ============================================================
   0065 — Devoluciones (esquema)

   sale_refunds.reason       el motivo, obligatorio desde 0065 (el
                             procedimiento lo exige; las devoluciones
                             anteriores quedan sin motivo).
   sale_refunds.register_id  la caja que hizo la devolución. Antes solo se
                             sabía si había sacado efectivo (closure_id); una
                             devolución a tarjeta no aparecía en ningún corte.
   sale_refunds.exchange_amount   lo que se apartó para un CAMBIO (no regresó
                             como dinero); exchange_sale_id, la venta del
                             cambio que lo usó (una vez).

   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF COL_LENGTH(N'dbo.sale_refunds', N'reason') IS NULL
    ALTER TABLE dbo.sale_refunds ADD reason NVARCHAR(40) COLLATE Modern_Spanish_CI_AS NULL;
GO
IF COL_LENGTH(N'dbo.sale_refunds', N'register_id') IS NULL
    ALTER TABLE dbo.sale_refunds ADD register_id INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sale_refunds_register' AND object_id = OBJECT_ID(N'dbo.sale_refunds'))
    CREATE NONCLUSTERED INDEX IX_sale_refunds_register ON dbo.sale_refunds (register_id, datee) INCLUDE (refund_total, closure_id);
GO
IF COL_LENGTH(N'dbo.sale_refunds', N'exchange_amount') IS NULL
    ALTER TABLE dbo.sale_refunds ADD exchange_amount DECIMAL(12,2) NULL;
GO
IF COL_LENGTH(N'dbo.sale_refunds', N'exchange_sale_id') IS NULL
    ALTER TABLE dbo.sale_refunds ADD exchange_sale_id INT NULL;
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
    /* 0065: el motivo va primero en la nota; y cuentan las de la caja en su
       horario aunque no hayan sacado efectivo. */
    SELECT f.datee, f.sale_id, f.refund_total, f.payment_method,
           CONCAT(f.reason, CASE WHEN f.reason IS NOT NULL AND f.note IS NOT NULL THEN N' · ' END, f.note) AS note, u.usuario AS quien
      FROM dbo.sale_refunds f
      LEFT JOIN dbo.users u ON u.id = f.user_id
     WHERE f.closure_id = @closure_id
        OR (f.closure_id IS NULL AND f.register_id = @caja AND f.datee >= @desde AND f.datee <= @hasta)
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

/* ---------- sp_exchange_sale (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_exchange_sale (0065) =====================
   Un CAMBIO: el cliente devuelve unas piezas y se lleva otras, en una sola
   operación y en una sola transacción.

     1. Devuelve (sp_refund_sale) apartando para el cambio el valor de lo que
        se lleva (@exchange_amount). Esa parte no regresa como dinero.
     2. Registra la venta nueva (sp_register_sale) a precio de lista, pagada
        con ese apartado (pago CAMBIO, referencia = la devolución).
     3. Lo que falte lo paga con @diff_method (efectivo con @received,
        tarjeta o transferencia). Si lo que se lleva vale MENOS, la diferencia
        le regresa con las reglas de una devolución normal (paso 1).

   Si algo falla, nada queda: ni la devolución ni la venta.
   @new_lines_json = [{ "productId": 12, "qty": 1 }, ...]
   ================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_exchange_sale
    @sale_id INT,
    @user_id INT,
    @RefundDetails dbo.SaleDetailType READONLY,
    @new_lines_json NVARCHAR(MAX),
    @reason NVARCHAR(40),
    @note NVARCHAR(400) = NULL,
    @diff_method NVARCHAR(20) = NULL,
    @received DECIMAL(12,2) = NULL,
    @register_id INT = NULL,
    @machine_id NVARCHAR(64) = NULL,
    @machine_name NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF ISJSON(@new_lines_json) <> 1 THROW 51000, 'Elige qué se lleva a cambio.', 1;
    DECLARE @lleva dbo.SaleDetailType2;
    INSERT INTO @lleva (line_no, product_id, quantity, unit_price, note)
    SELECT ROW_NUMBER() OVER (ORDER BY (SELECT 1)), p.id, j.qty, p.price, NULL
      FROM OPENJSON(@new_lines_json) WITH (productId INT, qty DECIMAL(12,2)) j
      JOIN dbo.products p ON p.id = j.productId AND p.active = 1
     WHERE j.qty > 0;
    IF NOT EXISTS (SELECT 1 FROM @lleva) THROW 51000, 'Elige qué se lleva a cambio.', 1;
    DECLARE @nuevo DECIMAL(12,2) = (SELECT SUM(ROUND(quantity * unit_price, 2)) FROM @lleva);
    DECLARE @customer_id INT = (SELECT customer_id FROM dbo.sales WHERE id = @sale_id);

    BEGIN TRAN;

    /* 1. La devolución, con su apartado para el cambio. */
    EXEC dbo.sp_refund_sale @sale_id = @sale_id, @user_id = @user_id, @payment_method = N'EFECTIVO',
         @RefundDetails = @RefundDetails, @note = @note, @apply_net_update = 0, @register_id = @register_id,
         @machine_id = @machine_id, @machine_name = @machine_name, @reason = @reason, @exchange_amount = @nuevo;
    DECLARE @refund_id INT, @keep DECIMAL(12,2), @devuelto DECIMAL(12,2);
    SELECT TOP 1 @refund_id = id, @keep = ISNULL(exchange_amount, 0), @devuelto = refund_total
      FROM dbo.sale_refunds WHERE sale_id = @sale_id ORDER BY id DESC;
    IF ISNULL(@keep, 0) <= 0 THROW 51000, 'Lo que devuelve no tiene valor para un cambio.', 1;

    /* 2 y 3. La venta nueva, pagada con el cambio y, si falta, la diferencia. */
    DECLARE @diff DECIMAL(12,2) = @nuevo - @keep;
    IF @diff > 0 AND ISNULL(@diff_method, N'') NOT IN (N'EFECTIVO', N'TARJETA', N'TRANSFERENCIA')
        THROW 51000, 'Elige cómo paga la diferencia.', 1;
    IF @diff > 0 AND @diff_method = N'EFECTIVO' AND ISNULL(@received, 0) < @diff
        THROW 51000, 'El dinero recibido no alcanza para la diferencia.', 1;
    DECLARE @pagos NVARCHAR(MAX) = (
        SELECT method, amount, received, reference FROM (
            SELECT N'CAMBIO' AS method, @keep AS amount, CAST(NULL AS DECIMAL(12,2)) AS received, CAST(@refund_id AS NVARCHAR(20)) AS reference
            UNION ALL
            SELECT @diff_method, @diff, CASE WHEN @diff_method = N'EFECTIVO' THEN @received END, NULL WHERE @diff > 0) x
        FOR JSON PATH, INCLUDE_NULL_VALUES);
    DECLARE @vacio dbo.SaleDetailType, @mods dbo.SaleModifierType, @clave UNIQUEIDENTIFIER = NEWID();
    EXEC dbo.sp_register_sale @user_id = @user_id, @payment_method = N'MIXTO', @SaleDetails = @vacio,
         @customer_id = @customer_id, @register_id = @register_id, @SaleDetails2 = @lleva, @SaleModifiers = @mods,
         @machine_id = @machine_id, @machine_name = @machine_name, @payments_json = @pagos, @client_sale_key = @clave;
    DECLARE @venta_nueva INT = (SELECT id FROM dbo.sales WHERE client_sale_key = @clave);

    COMMIT;

    SELECT @refund_id AS refund_id, @venta_nueva AS sale_id, @devuelto AS devuelto, @nuevo AS lleva,
           CASE WHEN @diff > 0 THEN @diff ELSE 0 END AS paga, @devuelto - @keep AS regresa;
END;
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
          AND (@user_id IS NULL OR @closure_id IS NOT NULL OR s.useer_id = @user_id)) AS ventas_credito,
      /* 0065: lo cobrado con un CAMBIO (el valor de lo que devolvió). No es efectivo. */
      (SELECT ISNULL(SUM(sp.amount), 0) FROM dbo.sales s JOIN dbo.sale_payments sp ON sp.sale_id=s.id AND sp.payment_method='CAMBIO' WHERE (@ventas_caja IS NULL OR s.register_id = @ventas_caja)
          AND ((@ventas_desde IS NOT NULL AND (s.closure_id=@closure_id OR (s.closure_id IS NULL AND s.datee >= @ventas_desde AND s.datee <= @ventas_hasta))) OR (@ventas_dia_desde IS NOT NULL AND CAST(s.datee AS DATE) BETWEEN @ventas_dia_desde AND @ventas_dia_hasta))
          AND (@user_id IS NULL OR @closure_id IS NOT NULL OR s.useer_id = @user_id)) AS ventas_cambio
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

  /* 4) 0065: las devoluciones del periodo, para el apartado del corte. Todas,
        no solo las de efectivo: una devolución a tarjeta también se explica.
        En turno: las ligadas al turno, o las de su caja en su horario. */
  SELECT f.id, f.datee, f.sale_id, f.refund_total, f.payment_method, f.reason, f.note,
         u.usuario AS quien, c.customerName AS cliente,
         ISNULL((SELECT SUM(rp.amount) FROM dbo.refund_payments rp
                  WHERE rp.refund_id = f.id AND rp.payment_method = N'EFECTIVO'), 0) AS efectivo
    FROM dbo.sale_refunds f
    JOIN dbo.sales s ON s.id = f.sale_id
    LEFT JOIN dbo.users u ON u.id = f.user_id
    LEFT JOIN dbo.customers c ON c.id = s.customer_id
   WHERE (@ventas_desde IS NOT NULL
          AND (f.closure_id = @closure_id
               OR (f.closure_id IS NULL AND f.register_id = @ventas_caja AND f.datee >= @ventas_desde AND f.datee <= @ventas_hasta)))
      OR (@ventas_dia_desde IS NOT NULL
          AND CAST(f.datee AS DATE) BETWEEN @ventas_dia_desde AND @ventas_dia_hasta
          AND (@ventas_caja IS NULL OR f.register_id = @ventas_caja OR (f.register_id IS NULL AND s.register_id = @ventas_caja)))
   ORDER BY f.datee;
END
GO

/* ---------- sp_refund_candidates (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_refund_candidates (0065) =====================
   Las ventas que se pueden devolver, para elegirlas sin teclear el folio:

     @folio        esa venta (de cualquier día)
     @customer_id  las de ese cliente en los últimos 30 días
     si no         las de hoy de esta caja (@register_id)

   Solo lectura. Cada fila dice qué se vendió (resumen), cuánto ya se
   devolvió y si ya no queda nada por devolver.
   ====================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_refund_candidates
    @register_id INT = NULL,
    @customer_id INT = NULL,
    @folio INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);

    SELECT TOP (60)
           s.id, s.datee, s.total, s.payment_method, s.customer_id, c.customerName AS cliente,
           (SELECT COUNT(*) FROM dbo.sale_detail d WHERE d.sale_id = s.id) AS renglones,
           ISNULL((SELECT SUM(r.refund_total) FROM dbo.sale_refunds r WHERE r.sale_id = s.id), 0) AS devuelto,
           (SELECT STRING_AGG(x.txt, N', ') FROM (
                SELECT TOP (3) CONCAT(CASE WHEN d.quantity <> 1 THEN CONCAT(CAST(d.quantity AS DECIMAL(12, 0)), N'× ') END, p.nombre) AS txt
                  FROM dbo.sale_detail d JOIN dbo.products p ON p.id = d.product_id
                 WHERE d.sale_id = s.id ORDER BY d.id) x) AS resumen,
           CAST(CASE WHEN NOT EXISTS (
                SELECT 1 FROM (SELECT product_id, SUM(quantity) AS q FROM dbo.sale_detail WHERE sale_id = s.id GROUP BY product_id) v
                 WHERE v.q > ISNULL((SELECT SUM(rd.quantity) FROM dbo.sale_refund_detail rd JOIN dbo.sale_refunds r ON r.id = rd.refund_id
                                      WHERE r.sale_id = s.id AND rd.product_id = v.product_id), 0))
                THEN 1 ELSE 0 END AS BIT) AS devuelta
      FROM dbo.sales s
      LEFT JOIN dbo.customers c ON c.id = s.customer_id
     WHERE (@folio IS NOT NULL AND s.id = @folio)
        OR (@folio IS NULL AND @customer_id IS NOT NULL AND s.customer_id = @customer_id AND s.datee >= DATEADD(DAY, -30, @hoy))
        OR (@folio IS NULL AND @customer_id IS NULL AND CAST(s.datee AS DATE) = @hoy
            AND (@register_id IS NULL OR s.register_id = @register_id))
     ORDER BY s.datee DESC, s.id DESC;
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

   0065:
   · El MOTIVO es obligatorio (@reason): sin él no hay devolución.
   · Venta a CRÉDITO: lo devuelto baja lo que el cliente debe; solo lo que
     ya había abonado sale en efectivo. Antes salía TODO en efectivo del
     cajón por una venta que nunca se cobró, y el saldo quedaba igual.
   · Toda devolución queda en el turno abierto de la caja que la hace
     (closure_id y register_id), aunque no saque efectivo: así el corte la
     enseña en su apartado de devoluciones.
   · CAMBIO (@exchange_amount): esa parte de lo devuelto no regresa como
     dinero; queda en la devolución para pagar la venta nueva del cambio
     (sp_exchange_sale). El resto sigue las reglas de siempre.
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
  @machine_name NVARCHAR(120) = NULL,
  @reason NVARCHAR(40) = NULL,
  @exchange_amount DECIMAL(12,2) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  SET @reason = NULLIF(LTRIM(RTRIM(@reason)), N'');
  IF @reason IS NULL THROW 51000, 'Elige el motivo de la devolución.', 1;

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
    DECLARE @credito_aplicado DECIMAL(12,2) = 0;
    /* 0065: lo que se va al cambio no se reparte como dinero. */
    DECLARE @keep DECIMAL(12,2) = CASE WHEN ISNULL(@exchange_amount, 0) <= 0 THEN 0
                                       WHEN @exchange_amount > @refund_total THEN @refund_total ELSE @exchange_amount END;
    DECLARE @por_repartir DECIMAL(12,2) = @refund_total - @keep;
    IF EXISTS(SELECT 1 FROM dbo.sale_payments WHERE sale_id=@sale_id) BEGIN
      SET @apply_net_update=0;
      DECLARE @rest DECIMAL(12,2)=@por_repartir,@pm NVARCHAR(50),@available DECIMAL(12,2),@part DECIMAL(12,2);
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
      /* 0063: devolver algo de $0 (un beneficio del Club) no reparte dinero: conserva la forma de pago indicada. */
      SET @payment_method=ISNULL(CASE WHEN (SELECT COUNT(*) FROM @rp)>1 THEN 'MIXTO' ELSE (SELECT TOP 1 method FROM @rp) END, @payment_method);
    /* 0064: una venta en $0 (todo canjeado) no tiene pagos ni reparte dinero al devolverse. */
    END ELSE IF @por_repartir>0
    BEGIN
      /* 0065: venta a CRÉDITO. Primero se descuenta de lo que debe; si ya
         había abonado más de lo que queda, esa parte sí se le regresa en efectivo. */
      DECLARE @saldo DECIMAL(12,2) = CASE WHEN @sale_method = N'CREDITO' THEN ISNULL((SELECT balance FROM dbo.sales WHERE id = @sale_id), 0) ELSE 0 END;
      SET @credito_aplicado = CASE WHEN @saldo >= @por_repartir THEN @por_repartir WHEN @saldo > 0 THEN @saldo ELSE 0 END;
      IF @credito_aplicado > 0 INSERT @rp VALUES (N'CREDITO', @credito_aplicado);
      IF @por_repartir - @credito_aplicado > 0
        INSERT @rp VALUES (CASE WHEN @sale_method = N'CREDITO' THEN N'EFECTIVO' ELSE @payment_method END, @por_repartir - @credito_aplicado);
      IF @sale_method = N'CREDITO'
        SET @payment_method = CASE WHEN @credito_aplicado >= @por_repartir THEN N'CREDITO' WHEN @credito_aplicado > 0 THEN N'MIXTO' ELSE N'EFECTIVO' END;
    END
    IF @keep > 0
    BEGIN
      INSERT @rp VALUES (N'CAMBIO', @keep);
      SET @payment_method = CASE WHEN (SELECT COUNT(*) FROM @rp) > 1 THEN N'MIXTO' ELSE N'CAMBIO' END;
    END
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
    ELSE
    BEGIN
      /* 0065: sin efectivo también queda en el turno de la caja, si lo hay. */
      EXEC dbo.sp_resolve_cash_register
          @register_id = @register_id, @machine_id = @machine_id,
          @machine_name = @machine_name, @user_id = @user_id, @resolved = @caja OUTPUT;
      IF @caja IS NOT NULL
        SELECT TOP(1) @closure_id_open = id
          FROM dbo.cash_closures
         WHERE register_id = @caja AND closed_at IS NULL
         ORDER BY opened_at DESC, id DESC;
    END

    DECLARE @refund_id INT;
    INSERT INTO dbo.sale_refunds (sale_id, user_id, payment_method, refund_total, note, closure_id, reason, register_id, exchange_amount)
    VALUES (@sale_id, @user_id, @payment_method, @refund_total, @note, @closure_id_open, @reason, @caja, NULLIF(@keep, 0));

    /* 0065: lo que se descontó del crédito ya no lo debe. (Con @apply_net_update
       lo hace el bloque de abajo, que reescribe la venta entera.) */
    IF @credito_aplicado > 0 AND @apply_net_update = 0
      UPDATE dbo.sales SET balance = balance - @credito_aplicado WHERE id = @sale_id;

    SET @refund_id = SCOPE_IDENTITY();
    INSERT dbo.refund_payments(refund_id,payment_method,amount) SELECT @refund_id,method,amount FROM @rp;

    INSERT INTO dbo.sale_refund_detail(refund_id,product_id,quantity,unitary_price,commercial_amount)
    SELECT @refund_id,q.product_id,q.qty,
      CASE WHEN @commercial=1 THEN CAST(a.amount/q.qty AS DECIMAL(10,2)) ELSE s.price END,
      CASE WHEN @commercial=1 THEN a.amount ELSE NULL END
    FROM #req q JOIN #sold s ON s.product_id=q.product_id JOIN #refund_amount a ON a.product_id=q.product_id;

    /* 0063: lo que la venta hizo en el Club (membresía cobrada, café dado). */
    EXEC dbo.sp_membership_on_refund @refund_id = @refund_id;
    /* 0064: puntos, sellos, canjes y premios de campaña de esa venta. */
    EXEC dbo.sp_loyalty_points_on_refund @refund_id = @refund_id;

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

/* ---------- sp_refund_ticket (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_refund_ticket (0065) =====================
   Lo que imprime el comprobante de una devolución: qué se devolvió, por qué,
   cómo regresó el dinero y, si fue un cambio, la venta nueva.
   Un solo JSON (document_json), como el ticket del corte.
   ================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_refund_ticket
    @refund_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT (
        SELECT r.id, r.sale_id, CONVERT(VARCHAR(16), r.datee, 120) AS datee, r.refund_total AS total, r.payment_method,
               r.reason, r.note, r.exchange_amount, r.exchange_sale_id,
               u.usuario AS cashier, rg.name AS register_name, c.customerName AS cliente,
               JSON_QUERY(ISNULL((SELECT rp.payment_method, rp.amount FROM dbo.refund_payments rp
                                   WHERE rp.refund_id = r.id ORDER BY rp.payment_method FOR JSON PATH), N'[]')) AS payments,
               JSON_QUERY(ISNULL((SELECT p.nombre, d.quantity, d.unitary_price FROM dbo.sale_refund_detail d
                                   JOIN dbo.products p ON p.id = d.product_id
                                  WHERE d.refund_id = r.id ORDER BY d.id FOR JSON PATH), N'[]')) AS lines,
               JSON_QUERY(ISNULL((SELECT p.nombre, d.quantity, d.unitary_price FROM dbo.sale_detail d
                                   JOIN dbo.products p ON p.id = d.product_id
                                  WHERE d.sale_id = r.exchange_sale_id ORDER BY d.id FOR JSON PATH), N'[]')) AS exchange_lines,
               (SELECT total FROM dbo.sales WHERE id = r.exchange_sale_id) AS exchange_total
          FROM dbo.sale_refunds r
          JOIN dbo.sales s ON s.id = r.sale_id
          LEFT JOIN dbo.users u ON u.id = r.user_id
          LEFT JOIN dbo.registers rg ON rg.id = ISNULL(r.register_id, s.register_id)
          LEFT JOIN dbo.customers c ON c.id = s.customer_id
         WHERE r.id = @refund_id
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS document_json;
END;
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
          IF (SELECT COUNT(*) FROM @pay) NOT BETWEEN 1 AND 4 OR EXISTS(SELECT 1 FROM @pay WHERE method IS NULL OR method NOT IN('EFECTIVO','TARJETA','TRANSFERENCIA','PLATAFORMA','CAMBIO') OR amount IS NULL OR amount<=0 OR (method='EFECTIVO' AND received<amount)) OR EXISTS(SELECT method FROM @pay GROUP BY method HAVING COUNT(*)>1) OR (SELECT SUM(amount) FROM @pay)<>@total THROW 51000,'Los pagos deben cubrir exactamente la venta, sin metodos duplicados.',1;
          /* 0065: CAMBIO paga con lo que una devolución apartó para el cambio. La
             referencia es esa devolución; se usa entera y una sola vez. */
          IF EXISTS(SELECT 1 FROM @pay p WHERE p.method='CAMBIO' AND NOT EXISTS(
               SELECT 1 FROM dbo.sale_refunds r WITH (UPDLOCK, HOLDLOCK)
                WHERE r.id=TRY_CONVERT(INT,p.reference) AND r.exchange_amount=p.amount AND r.exchange_sale_id IS NULL))
            THROW 51000,'Ese cambio ya se usó o no coincide con la devolución.',1;
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
        IF @payments_json IS NOT NULL
          UPDATE r SET exchange_sale_id=@sale_id FROM dbo.sale_refunds r JOIN @pay p ON p.method='CAMBIO' AND r.id=TRY_CONVERT(INT,p.reference);
        /* 0063: una venta de $0 (solo el beneficio del Club o un producto gratis) no tiene pago que registrar. */
        ELSE IF @is_credit=0 AND @total>0 INSERT dbo.sale_payments(sale_id,payment_method,amount) VALUES(@sale_id,@payment_method,@total);
        IF @commercial_quote IS NOT NULL BEGIN
          UPDATE dbo.commercial_quotes SET sale_id=@sale_id WHERE id=@commercial_quote;
          UPDATE dbo.sales SET commercial_snapshot=@cq WHERE id=@sale_id;
        END;

        /* El cupón de una cotización se consume DENTRO de la transacción de venta. */
        DECLARE @coupon_code NVARCHAR(24)=JSON_VALUE(@cq,'$.coupon.code'),@coupon_id INT;
        IF @coupon_code IS NOT NULL
        BEGIN
          /* 0064: también $ y %, que la cotización reparte entre los renglones. */
          IF ISNULL(TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(@cq,'$.coupon.amountApplied')),0)<=0 THROW 51000,'El cupón no aplicó a ningún producto.',1;
          UPDATE ci SET uses_count=ci.uses_count+1,status=CASE WHEN ci.uses_count+1>=ci.uses_allowed THEN 'REDEEMED' ELSE ci.status END,sale_id=ISNULL(ci.sale_id,@sale_id)
          FROM dbo.coupon_instances ci JOIN dbo.coupon_definitions cd ON cd.id=ci.definition_id
          WHERE ci.code=@coupon_code AND ci.id=TRY_CONVERT(INT,JSON_VALUE(@cq,'$.coupon.instanceId')) AND (cd.kind IN ('AMOUNT','PERCENT') OR (cd.kind='FREE_PRODUCT' AND cd.product_id=TRY_CONVERT(INT,JSON_VALUE(@cq,'$.coupon.productId')))) AND ci.status='ISSUED' AND cd.active=1 AND ci.uses_count<ci.uses_allowed AND (ci.expires_at IS NULL OR ci.expires_at>=SYSDATETIME());
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

        /* 11) Club (0063): membresías que se cobran en esta venta y el
           beneficio del día. Dentro de la transacción: si no procede, la
           venta no se registra. */
        EXEC dbo.sp_membership_apply_sale @sale_id = @sale_id, @customer_id = @customer_id,
             @user_id = @user_id, @register_id = @register_id, @quote = @cq;
        /* 12) Puntos y sellos (0064): el canje se descuenta aquí, con el
           saldo comprobado bajo candado. */
        EXEC dbo.sp_loyalty_points_apply_sale @sale_id = @sale_id, @customer_id = @customer_id,
             @user_id = @user_id, @quote = @cq;

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
