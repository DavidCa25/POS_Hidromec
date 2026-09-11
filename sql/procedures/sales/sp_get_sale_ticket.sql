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
-- Update:      + register_name y + impuestos por linea.
--
--              El ticket calculaba el IVA dividiendo el total entre 1.16, con
--              la tasa escrita a mano en el codigo. Eso solo es cierto si
--              TODO lo vendido es objeto de impuesto a la tasa general: en una
--              venta con productos exentos el ticket inventaba un IVA que
--              nadie cobro. La tasa de cada producto viaja ahora con su linea
--              y el desglose se calcula linea por linea.
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
        s.service_mode,
        s.register_id,
        r.name AS register_name
    FROM dbo.sales s
    INNER JOIN dbo.users u ON u.id = s.useer_id
    LEFT JOIN dbo.customers c ON c.id = s.customer_id
    LEFT JOIN dbo.registers r ON r.id = s.register_id
    WHERE s.id = @sale_id;
    SELECT
        d.product_id,
        p.nombre,
        d.quantity,
        d.unitary_price,
        d.subtotal AS line_total,
        d.note,
        /* La tasa de CADA producto: sin esto el ticket tiene que suponer que
           todo lleva IVA general, y con un producto exento miente. */
        p.objeto_impuesto,
        p.tasa_iva,
        p.base_uom,
        mods.modifiers
    FROM dbo.sale_detail d
    INNER JOIN dbo.products p ON p.id = d.product_id
    /* Los modificadores TAL COMO SE COBRARON, con su importe.
       Antes solo salia el nombre: un ticket con "Leche de almendra" y un total
       $12 mas alto obliga al cliente a fiarse. Ahora cada extra dice lo que
       sumo, y los que no suman nada -"Sin azucar"- no llevan cifra.
       Se lee del snapshot de la venta, no de la configuracion de hoy: un
       ticket reimpreso manana tiene que decir lo mismo que el de hoy.
       Nada tecnico: nombres e importes, nunca identificadores. */
    OUTER APPLY (
        SELECT STRING_AGG(
                   CONCAT(
                       CASE WHEN m.quantity > 1 THEN CONCAT(m.quantity, 'x ') ELSE '' END,
                       m.option_name,
                       CASE WHEN ISNULL(m.price_delta, 0) <> 0
                            THEN CONCAT(' +', FORMAT(m.price_delta * m.quantity, 'N2'))
                            ELSE '' END),
                   ', ')
               WITHIN GROUP (ORDER BY m.id) AS modifiers
        FROM dbo.sale_detail_modifiers m
        WHERE m.sale_detail_id = d.id
    ) mods
    WHERE d.sale_id = @sale_id
    ORDER BY d.id;
END;
GO
