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
