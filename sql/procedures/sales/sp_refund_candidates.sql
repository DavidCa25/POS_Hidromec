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
