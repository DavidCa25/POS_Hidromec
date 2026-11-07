/* sp_socios_movimientos
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_socios_movimientos (0079) ======================
   El historial de dinero de los socios en un rango: retiros, pagos y
   aportaciones, y los gastos que un socio pago de su bolsa. Lo mas nuevo
   primero.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_movimientos
    @desde DATE,
    @hasta DATE
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @fin DATETIME2(0) = DATEADD(DAY, 1, CAST(@hasta AS DATETIME2(0)));

    SELECT 'MOVIMIENTO' AS origen, m.id, m.socio_id, s.nombre, m.fecha, m.tipo, m.monto, m.metodo,
           m.nota, u.usuario
      FROM dbo.socios_movimientos m
      JOIN dbo.socios s ON s.id = m.socio_id
      LEFT JOIN dbo.users u ON u.id = m.user_id
     WHERE m.fecha >= @desde AND m.fecha < @fin
    UNION ALL
    SELECT 'GASTO', e.id, g.pagado_por_socio_id, s.nombre, CAST(e.expense_date AS DATETIME2(0)),
           'APORTACION', e.amount, e.payment_method,
           CONCAT(N'Pagó el gasto: ', c.name, CASE WHEN e.note IS NULL THEN N'' ELSE CONCAT(N' · ', e.note) END),
           u.usuario
      FROM dbo.expenses e
      JOIN dbo.socios_gasto g ON g.expense_id = e.id
      JOIN dbo.socios s ON s.id = g.pagado_por_socio_id
      JOIN dbo.expense_categories c ON c.id = e.category_id
      LEFT JOIN dbo.users u ON u.id = e.user_id
     WHERE e.voided_at IS NULL AND e.expense_date >= @desde AND e.expense_date <= @hasta
     ORDER BY fecha DESC, id DESC;
END
GO
