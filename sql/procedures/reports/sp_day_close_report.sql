/* sp_day_close_report
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ROLES V2 · CIERRE DEL DÍA.
   Todo el día del negocio en una consulta, para el Encargado y el
   Administrador (lo abre Inicio): las ventas, los cortes de TODAS las cajas
   -quién cerró, cuánto se esperaba, cuánto se contó, cuánto se quedó-, lo que
   salió del cajón, las promociones por cajero y lo que se autorizó.

   Devuelve siete resultados, en este orden:
     1 resumen        tickets, vendido, ahorro con promociones, devoluciones
     2 pagos          vendido por forma de pago
     3 cortes         turnos del día (abiertos o cerrados) de todas las cajas
     4 salidas        retiros, egresos, pagos a proveedor, devoluciones en efectivo
     5 promociones    descuento aplicado por cajero
     6 eventos        bitácora de seguridad del día
     7 ventas         los tickets del día (hasta 500, los más recientes primero)
   0060 (al final, para no mover los anteriores):
     8 produccion     por producto fabricado: lo producido ese día, la merma
                      de producción, lo vendido, lo traspasado, la merma de
                      terminado y cuánto queda ahora
     9 mermas         la merma de producto terminado del día, una por una */
CREATE OR ALTER PROCEDURE dbo.sp_day_close_report
    @fecha DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @fecha IS NULL SET @fecha = CAST(GETDATE() AS DATE);
    DECLARE @desde DATETIME2(0) = CAST(@fecha AS DATETIME2(0));
    DECLARE @hasta DATETIME2(0) = DATEADD(DAY, 1, @desde);

    /* 1 resumen */
    SELECT COUNT(*) AS tickets,
           ISNULL(SUM(s.total), 0) AS vendido,
           ISNULL(SUM(TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(s.commercial_snapshot, '$.discount'))), 0) AS ahorro_promociones,
           SUM(CASE WHEN TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(s.commercial_snapshot, '$.discount')) > 0 THEN 1 ELSE 0 END) AS tickets_con_promocion,
           (SELECT ISNULL(SUM(r.refund_total), 0) FROM dbo.sale_refunds r WHERE r.datee >= @desde AND r.datee < @hasta) AS devoluciones,
           (SELECT COUNT(*) FROM dbo.sale_refunds r WHERE r.datee >= @desde AND r.datee < @hasta) AS devoluciones_n
      FROM dbo.sales s
     WHERE s.datee >= @desde AND s.datee < @hasta;

    /* 2 pagos: el desglose de un pago mixto; si la venta no lo tiene, su método. */
    SELECT x.metodo, SUM(x.monto) AS monto, COUNT(*) AS movimientos
      FROM (SELECT p.payment_method AS metodo, p.amount AS monto
              FROM dbo.sale_payments p JOIN dbo.sales s ON s.id = p.sale_id
             WHERE s.datee >= @desde AND s.datee < @hasta
            UNION ALL
            SELECT s.payment_method, s.total
              FROM dbo.sales s
             WHERE s.datee >= @desde AND s.datee < @hasta
               AND NOT EXISTS (SELECT 1 FROM dbo.sale_payments p WHERE p.sale_id = s.id)) x
     GROUP BY x.metodo
     ORDER BY SUM(x.monto) DESC;

    /* 3 cortes: los turnos que abrieron o cerraron ese día, y los que siguen abiertos. */
    SELECT c.id, r.name AS caja, u.usuario AS cajero, c.opened_at, c.closed_at,
           c.opening_cash, c.cash_expected, c.cash_delivered, c.difference, c.cash_left, c.closing_note,
           CAST(ISNULL(c.blind_count, 0) AS BIT) AS a_ciegas,
           cb.usuario AS cerro, ca.usuario AS autorizo
      FROM dbo.cash_closures c
      LEFT JOIN dbo.registers r ON r.id = c.register_id
      LEFT JOIN dbo.users u ON u.id = c.userId
      LEFT JOIN dbo.users cb ON cb.id = c.closed_by_user_id
      LEFT JOIN dbo.users ca ON ca.id = c.close_authorized_by
     WHERE (c.opened_at >= @desde AND c.opened_at < @hasta)
        OR (c.closed_at >= @desde AND c.closed_at < @hasta)
        OR (c.closed_at IS NULL AND c.opened_at < @hasta)
     ORDER BY c.opened_at;

    /* 4 salidas de efectivo: todo lo que no es venta, abono, entrada ni fondo. */
    SELECT m.datee, t.label AS tipo, t.grupo, ABS(m.amount) AS monto, m.note, u.usuario AS quien, r.name AS caja
      FROM dbo.cash_movements m
      JOIN dbo.cash_movement_types t ON t.code = m.typee
      LEFT JOIN dbo.users u ON u.id = m.userId
      LEFT JOIN dbo.registers r ON r.id = m.register_id
     WHERE m.datee >= @desde AND m.datee < @hasta
       AND t.grupo NOT IN ('VENTAS', 'FONDO', 'ABONOS', 'ENTRADAS')
     ORDER BY m.datee;

    /* 5 promociones por cajero: quién aplica más descuento. */
    SELECT ISNULL(u.usuario, N'—') AS cajero, COUNT(*) AS tickets,
           SUM(TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(s.commercial_snapshot, '$.discount'))) AS ahorro
      FROM dbo.sales s
      LEFT JOIN dbo.users u ON u.id = s.useer_id
     WHERE s.datee >= @desde AND s.datee < @hasta
       AND TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(s.commercial_snapshot, '$.discount')) > 0
     GROUP BY u.usuario
     ORDER BY ahorro DESC;

    /* 6 eventos de seguridad del día (los más recientes primero). */
    SELECT TOP (300) e.datee, e.event_type, e.amount, e.detail, u.usuario AS quien, a.usuario AS autorizo
      FROM dbo.security_events e
      LEFT JOIN dbo.users u ON u.id = e.user_id
      LEFT JOIN dbo.users a ON a.id = e.authorized_by
     WHERE e.datee >= @desde AND e.datee < @hasta
     ORDER BY e.datee DESC;

    /* 7 ventas del día. */
    SELECT TOP (500) s.id AS folio, s.datee, u.usuario AS cajero, r.name AS caja, s.total, s.payment_method,
           TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(s.commercial_snapshot, '$.discount')) AS ahorro
      FROM dbo.sales s
      LEFT JOIN dbo.users u ON u.id = s.useer_id
      LEFT JOIN dbo.registers r ON r.id = s.register_id
     WHERE s.datee >= @desde AND s.datee < @hasta
     ORDER BY s.datee DESC;

    /* 8 produccion: los productos con formula, o con tandas o merma ese dia. */
    IF OBJECT_ID(N'dbo.production_batches', 'U') IS NOT NULL
    BEGIN
        SELECT p.id AS product_id, p.nombre AS producto, p.stock AS existencia,
               ISNULL(b.planeadas, 0) AS planeadas, ISNULL(b.producidas, 0) AS producidas,
               ISNULL(b.merma_produccion, 0) AS merma_produccion, b.costo_unitario,
               ISNULL(v.vendidas, 0) AS vendidas, ISNULL(t.traspasadas, 0) AS traspasadas,
               ISNULL(w.merma_terminado, 0) AS merma_terminado, ISNULL(w.costo_merma, 0) AS costo_merma
          FROM dbo.products p
          LEFT JOIN (SELECT product_id, SUM(planned_qty) AS planeadas, SUM(ISNULL(good_qty, 0)) AS producidas,
                            SUM(ISNULL(waste_qty, 0)) AS merma_produccion,
                            SUM(ISNULL(total_cost, 0)) / NULLIF(SUM(ISNULL(good_qty, 0)), 0) AS costo_unitario
                       FROM dbo.production_batches
                      WHERE production_date = @fecha AND status = 'DONE'
                      GROUP BY product_id) b ON b.product_id = p.id
          LEFT JOIN (SELECT d.product_id, SUM(d.quantity) AS vendidas
                       FROM dbo.sale_detail d JOIN dbo.sales s ON s.id = d.sale_id
                      WHERE s.datee >= @desde AND s.datee < @hasta
                      GROUP BY d.product_id) v ON v.product_id = p.id
          LEFT JOIN (SELECT product_id, SUM(quantity) AS traspasadas
                       FROM dbo.inventory_movements
                      WHERE source IN ('BRANCH_OUT', 'TRANSFER_OUT') AND typee = 'salida' AND datee >= @desde AND datee < @hasta
                      GROUP BY product_id) t ON t.product_id = p.id
          LEFT JOIN (SELECT product_id, SUM(qty) AS merma_terminado, SUM(qty * ISNULL(unit_cost, 0)) AS costo_merma
                       FROM dbo.production_waste
                      WHERE waste_date = @fecha
                      GROUP BY product_id) w ON w.product_id = p.id
         WHERE p.active = 1 AND p.inventory_mode = 'DIRECT'
           AND (EXISTS (SELECT 1 FROM dbo.production_formulas f WHERE f.product_id = p.id)
                OR b.product_id IS NOT NULL OR w.product_id IS NOT NULL)
         ORDER BY p.nombre;

        /* 9 mermas de producto terminado del dia. */
        SELECT w.created_at, p.nombre AS producto, w.qty, w.reason, w.unit_cost,
               w.qty * ISNULL(w.unit_cost, 0) AS costo, u.usuario AS quien
          FROM dbo.production_waste w
          JOIN dbo.products p ON p.id = w.product_id
          LEFT JOIN dbo.users u ON u.id = w.created_by
         WHERE w.waste_date = @fecha
         ORDER BY w.created_at DESC;
    END
END
GO
