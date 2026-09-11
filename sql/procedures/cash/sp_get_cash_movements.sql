/* sp_get_cash_movements
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE [dbo].[sp_get_cash_movements]
    @start_date   DATE = NULL,
    @end_date     DATE = NULL,
    @user_id      INT  = NULL,
    @typee        NVARCHAR(20) = NULL,
    @only_open    BIT  = 0,
    @closure_id   INT  = NULL
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @now DATETIME2(0) = SYSDATETIME();

  /* ===========================
     MODO TURNO (por closure_id)
     =========================== */
  IF @closure_id IS NOT NULL
  BEGIN
      DECLARE @shift_user_id INT;
      DECLARE @opened_at DATETIME2(0);
      DECLARE @closed_at DATETIME2(0);
      DECLARE @opening_cash DECIMAL(12,2);

      SELECT
          @shift_user_id = userId,
          @opened_at     = opened_at,
          @closed_at     = ISNULL(closed_at, @now),
          @opening_cash  = ISNULL(opening_cash,0)
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

      -- Detalle turno
      SELECT
          m.id, m.datee, m.userId, u.usuario AS user_name, m.typee, m.amount,
          m.reference_id, m.reference, m.note, m.closure_id
      FROM dbo.cash_movements AS m
      LEFT JOIN dbo.users AS u ON u.id = m.userId
      WHERE
          (
              m.closure_id = @closure_id
              OR (m.closure_id IS NULL AND m.userId = @shift_user_id AND m.datee >= @opened_at AND m.datee <= @closed_at)
          )
          AND (@typee IS NULL OR m.typee = @typee)
      ORDER BY m.datee ASC, m.id ASC;

      -- Summary turno CON DESGLOSE DE VENTAS
      SELECT
          ISNULL(SUM(CASE WHEN m.typee <> 'OPENING' AND m.amount >= 0 THEN m.amount ELSE 0 END), 0)  AS total_entradas,
          ISNULL(SUM(CASE WHEN m.typee <> 'OPENING' AND m.amount  < 0 THEN -m.amount ELSE 0 END), 0) AS total_salidas,
          ISNULL(SUM(CASE WHEN m.typee <> 'OPENING' THEN m.amount ELSE 0 END), 0)                    AS neto,
          @opening_cash                                                                              AS opening_cash,
          (ISNULL(SUM(CASE WHEN m.typee <> 'OPENING' THEN m.amount ELSE 0 END),0) + @opening_cash)   AS cash_expected,

          -- Subconsultas directas a dbo.sales para todos los metodos de pago
          (SELECT ISNULL(SUM(total), 0) FROM dbo.sales WHERE payment_method = 'EFECTIVO' AND useer_id = @shift_user_id AND datee >= @opened_at AND datee <= @closed_at) AS ventas_efectivo,
          (SELECT ISNULL(SUM(total), 0) FROM dbo.sales WHERE payment_method = 'TARJETA' AND useer_id = @shift_user_id AND datee >= @opened_at AND datee <= @closed_at) AS ventas_tarjeta,
          (SELECT ISNULL(SUM(total), 0) FROM dbo.sales WHERE payment_method = 'TRANSFERENCIA' AND useer_id = @shift_user_id AND datee >= @opened_at AND datee <= @closed_at) AS ventas_transferencia,
          (SELECT ISNULL(SUM(total), 0) FROM dbo.sales WHERE payment_method = 'TERMINAL_MP' AND useer_id = @shift_user_id AND datee >= @opened_at AND datee <= @closed_at) AS ventas_mp,
          (SELECT ISNULL(SUM(total), 0) FROM dbo.sales WHERE payment_method = 'CREDITO' AND useer_id = @shift_user_id AND datee >= @opened_at AND datee <= @closed_at) AS ventas_credito
        FROM dbo.cash_movements AS m
        WHERE
            (
                m.closure_id = @closure_id
                OR (m.closure_id IS NULL AND m.userId = @shift_user_id AND m.datee >= @opened_at AND m.datee <= @closed_at)
            )
            AND (@typee IS NULL OR m.typee = @typee);

      RETURN;
  END

  /* ===========================
     MODO DÍA (por rango fechas)
     =========================== */
  IF @start_date IS NULL SET @start_date = CONVERT(DATE, @now);
  IF @end_date   IS NULL SET @end_date   = @start_date;

  -- Detalle por rango
  SELECT
      m.id, m.datee, m.userId, u.usuario AS user_name, m.typee, m.amount,
      m.reference_id, m.reference, m.note, m.closure_id
  FROM dbo.cash_movements AS m
  LEFT JOIN dbo.users AS u ON u.id = m.userId
  WHERE CAST(m.datee AS DATE) BETWEEN @start_date AND @end_date
    AND (@user_id IS NULL OR m.userId = @user_id)
    AND (@typee   IS NULL OR m.typee  = @typee)
    AND (
          (@only_open = 1 AND m.closure_id IS NULL)
       OR (@only_open = 0 AND (@closure_id IS NULL OR m.closure_id = @closure_id))
        )
  ORDER BY m.datee ASC, m.id ASC;

  DECLARE @opening_cash2 DECIMAL(12,2) = 0;

  IF @only_open = 1 AND @user_id IS NOT NULL
  BEGIN
      SELECT TOP(1) @opening_cash2 = ISNULL(opening_cash,0)
      FROM dbo.cash_closures
      WHERE userId = @user_id AND closed_at IS NULL
      ORDER BY opened_at DESC, id DESC;
  END

  -- Summary por rango CON DESGLOSE DE VENTAS
  SELECT
    ISNULL(SUM(CASE WHEN m.amount >= 0 THEN m.amount ELSE 0 END), 0)  AS total_entradas,
    ISNULL(SUM(CASE WHEN m.amount  < 0 THEN -m.amount ELSE 0 END), 0) AS total_salidas,
    ISNULL(SUM(m.amount), 0)                                          AS neto,
    @opening_cash2                                                    AS opening_cash,
    (ISNULL(SUM(m.amount),0) + @opening_cash2)                         AS cash_expected,

    -- Subconsultas directas a dbo.sales para todos los metodos de pago
    (SELECT ISNULL(SUM(total), 0) FROM dbo.sales WHERE payment_method = 'EFECTIVO' AND CAST(datee AS DATE) BETWEEN @start_date AND @end_date AND (@user_id IS NULL OR useer_id = @user_id)) AS ventas_efectivo,
    (SELECT ISNULL(SUM(total), 0) FROM dbo.sales WHERE payment_method = 'TARJETA' AND CAST(datee AS DATE) BETWEEN @start_date AND @end_date AND (@user_id IS NULL OR useer_id = @user_id)) AS ventas_tarjeta,
    (SELECT ISNULL(SUM(total), 0) FROM dbo.sales WHERE payment_method = 'TRANSFERENCIA' AND CAST(datee AS DATE) BETWEEN @start_date AND @end_date AND (@user_id IS NULL OR useer_id = @user_id)) AS ventas_transferencia,
    (SELECT ISNULL(SUM(total), 0) FROM dbo.sales WHERE payment_method = 'TERMINAL_MP' AND CAST(datee AS DATE) BETWEEN @start_date AND @end_date AND (@user_id IS NULL OR useer_id = @user_id)) AS ventas_mp,
    (SELECT ISNULL(SUM(total), 0) FROM dbo.sales WHERE payment_method = 'CREDITO' AND CAST(datee AS DATE) BETWEEN @start_date AND @end_date AND (@user_id IS NULL OR useer_id = @user_id)) AS ventas_credito
  FROM dbo.cash_movements AS m
  WHERE CAST(m.datee AS DATE) BETWEEN @start_date AND @end_date
    AND (@user_id IS NULL OR m.userId = @user_id)
    AND (@typee   IS NULL OR m.typee  = @typee)
    AND (
          (@only_open = 1 AND m.closure_id IS NULL)
       OR (@only_open = 0 AND (@closure_id IS NULL OR m.closure_id = @closure_id))
        );
END
GO
