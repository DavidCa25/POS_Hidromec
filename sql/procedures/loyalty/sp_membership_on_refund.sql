SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_membership_on_refund (0063) =====================
   Una devolución deshace lo que la venta hizo en el Club. Se llama desde
   sp_refund_sale, dentro de su transacción.

   · Si se devuelve el producto de cobro de un plan: el pago de esa venta se
     anula y la membresía pierde esos días (paid_until retrocede lo que el
     pago cubría).
   · Si se devuelve un producto que se dio con el beneficio: el canje se
     anula y el cliente recupera su café del día.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_membership_on_refund
    @refund_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @sale_id INT = (SELECT sale_id FROM dbo.sale_refunds WHERE id = @refund_id);
    IF @sale_id IS NULL RETURN;

    /* Pagos: por cada renglón de membresía devuelto. */
    DECLARE @anulados TABLE (membership_id INT, dias INT);
    UPDATE pay
       SET voided_at = SYSDATETIME(), void_refund_id = @refund_id
    OUTPUT inserted.membership_id, DATEDIFF(DAY, inserted.period_from, inserted.period_to) + 1 INTO @anulados
      FROM dbo.membership_payments pay
      JOIN dbo.sale_detail d ON d.id = pay.sale_detail_id
     WHERE pay.sale_id = @sale_id AND pay.voided_at IS NULL
       AND d.product_id IN (SELECT product_id FROM dbo.sale_refund_detail WHERE refund_id = @refund_id);

    UPDATE m
       SET paid_until = CASE WHEN a.dias IS NULL OR m.paid_until IS NULL THEN m.paid_until
                             ELSE DATEADD(DAY, -a.dias, m.paid_until) END,
           updated_at = SYSDATETIME()
      FROM dbo.customer_memberships m
      JOIN (SELECT membership_id, SUM(dias) AS dias FROM @anulados GROUP BY membership_id) a ON a.membership_id = m.id;

    /* Canjes: el producto regalado que se devolvió. */
    UPDATE r
       SET voided_at = SYSDATETIME()
      FROM dbo.membership_redemptions r
     WHERE r.sale_id = @sale_id AND r.voided_at IS NULL
       AND r.product_id IN (SELECT product_id FROM dbo.sale_refund_detail WHERE refund_id = @refund_id);
END;
GO
