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
