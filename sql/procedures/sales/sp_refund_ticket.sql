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
