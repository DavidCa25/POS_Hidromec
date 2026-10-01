/* sp_get_expenses
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   HISTORIAL Y REPORTE DE EGRESOS. Una sola consulta para las dos vistas:
   "Egresos" (todo) y "Pagos al personal" (@only_staff = 1). Es la misma
   fuente: un pago al personal ES un egreso, no hay una segunda tabla.

   Resultados:
     1. los egresos del periodo (con los cancelados solo si se piden);
     2. total por concepto;
     3. total por persona (solo pagos al personal);
     4. total por forma de pago;
     5. el total, y cuanto de eso salio del cajon.
   Los totales nunca cuentan cancelados.

   Las compras NO estan aqui: tienen su dominio (purchase / supplier_payments).
   Un reporte consolidado puede ponerlas al lado, pero la fuente es otra.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_get_expenses
    @date_from       DATE = NULL,
    @date_to         DATE = NULL,
    @category_id     INT = NULL,
    @payment_method  VARCHAR(20) = NULL,
    @staff_user_id   INT = NULL,
    @only_staff      BIT = 0,
    @register_id     INT = NULL,
    @include_voided  BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CAST(SYSDATETIME() AS DATE);
    IF @date_to IS NULL SET @date_to = @hoy;
    IF @date_from IS NULL SET @date_from = DATEFROMPARTS(YEAR(@date_to), MONTH(@date_to), 1);
    SET @payment_method = NULLIF(UPPER(LTRIM(RTRIM(@payment_method))), '');

    SELECT e.id
      INTO #sel
      FROM dbo.expenses e
      JOIN dbo.expense_categories c ON c.id = e.category_id
     WHERE e.expense_date BETWEEN @date_from AND @date_to
       AND (@category_id    IS NULL OR e.category_id = @category_id)
       AND (@payment_method IS NULL OR e.payment_method = @payment_method)
       AND (@staff_user_id  IS NULL OR e.staff_user_id = @staff_user_id)
       AND (@only_staff = 0 OR c.kind = 'PERSONAL')
       AND (@register_id    IS NULL OR e.register_id = @register_id);

    /* 1) Detalle */
    SELECT
        e.id, e.expense_date, e.created_at, e.category_id, c.name AS category_name, c.kind AS category_kind,
        e.amount, e.payment_method, e.note, e.beneficiary,
        e.staff_user_id, st.usuario AS staff_name, e.period_kind, e.period_from, e.period_to,
        e.user_id, u.usuario AS user_name,
        e.register_id, r.name AS register_name, e.closure_id, e.cash_movement_id,
        e.voided_at, vu.usuario AS voided_by_name, e.void_reason,
        CAST(CASE WHEN e.payment_method = 'EFECTIVO' AND e.voided_at IS NULL
                   AND EXISTS (SELECT 1 FROM dbo.cash_closures cc WHERE cc.id = e.closure_id AND cc.closed_at IS NULL)
                  THEN 1
                  WHEN e.payment_method <> 'EFECTIVO' AND e.voided_at IS NULL THEN 1
                  ELSE 0 END AS BIT) AS cancelable
    FROM #sel s
    JOIN dbo.expenses e ON e.id = s.id
    JOIN dbo.expense_categories c ON c.id = e.category_id
    LEFT JOIN dbo.users st ON st.id = e.staff_user_id
    LEFT JOIN dbo.users u  ON u.id = e.user_id
    LEFT JOIN dbo.users vu ON vu.id = e.voided_by
    LEFT JOIN dbo.registers r ON r.id = e.register_id
    WHERE @include_voided = 1 OR e.voided_at IS NULL
    ORDER BY e.expense_date DESC, e.id DESC;

    /* 2) Por concepto */
    SELECT c.id AS category_id, c.name AS category_name, c.kind AS category_kind,
           SUM(e.amount) AS total, COUNT(*) AS egresos
      FROM #sel s JOIN dbo.expenses e ON e.id = s.id
      JOIN dbo.expense_categories c ON c.id = e.category_id
     WHERE e.voided_at IS NULL
     GROUP BY c.id, c.name, c.kind, c.sort_order
     ORDER BY SUM(e.amount) DESC, c.name;

    /* 3) Por persona (pagos al personal) */
    SELECT e.staff_user_id, st.usuario AS staff_name,
           SUM(e.amount) AS total, COUNT(*) AS pagos,
           MIN(e.period_from) AS primer_periodo, MAX(e.period_to) AS ultimo_periodo
      FROM #sel s JOIN dbo.expenses e ON e.id = s.id
      JOIN dbo.users st ON st.id = e.staff_user_id
     WHERE e.voided_at IS NULL
     GROUP BY e.staff_user_id, st.usuario
     ORDER BY SUM(e.amount) DESC, st.usuario;

    /* 4) Por forma de pago */
    SELECT e.payment_method, SUM(e.amount) AS total, COUNT(*) AS egresos
      FROM #sel s JOIN dbo.expenses e ON e.id = s.id
     WHERE e.voided_at IS NULL
     GROUP BY e.payment_method
     ORDER BY SUM(e.amount) DESC;

    /* 5) Total */
    SELECT ISNULL(SUM(e.amount), 0) AS total,
           ISNULL(SUM(CASE WHEN e.payment_method = 'EFECTIVO' THEN e.amount ELSE 0 END), 0) AS del_cajon,
           COUNT(*) AS egresos,
           @date_from AS date_from, @date_to AS date_to
      FROM #sel s JOIN dbo.expenses e ON e.id = s.id
     WHERE e.voided_at IS NULL;
END
GO
