/* sp_get_sale_ticket
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David>
-- Create date: <11-12-2025>
-- Description:	<Store procedure para generar un ticket de venta>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_sale_ticket
    @sale_id INT
AS
BEGIN
    SET NOCOUNT ON;

    --------------------------
    -- 1) Encabezado de venta
    --------------------------
    SELECT
        s.id,
        s.datee,
        s.total,
        s.payment_method,
        s.paid_amount,
        s.balance,
        s.customer_id,
        s.due_date,
        u.usuario AS cashier,
        c.customerName AS customer_name,
        s.service_mode
    FROM dbo.sales s
    INNER JOIN dbo.users u ON u.id = s.useer_id
    LEFT JOIN dbo.customers c ON c.id = s.customer_id
    WHERE s.id = @sale_id;
    SELECT
        d.product_id,
        p.nombre,
        d.quantity,
        d.unitary_price,
        d.subtotal AS line_total,
        d.note,
        mods.modifiers
    FROM dbo.sale_detail d
    INNER JOIN dbo.products p ON p.id = d.product_id
    OUTER APPLY (
        SELECT STRING_AGG(CONCAT(CASE WHEN m.quantity > 1 THEN CONCAT(m.quantity, 'x ') ELSE '' END, m.option_name), ', ')
               WITHIN GROUP (ORDER BY m.id) AS modifiers
        FROM dbo.sale_detail_modifiers m
        WHERE m.sale_detail_id = d.id
    ) mods
    WHERE d.sale_id = @sale_id
    ORDER BY d.id;
END;
GO
