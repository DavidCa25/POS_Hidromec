/* sp_get_customers_credit_summary
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:      <David>
-- Description: <Deuda y vencidas por cliente>
-- =============================================
/* LA REGLA DE CREDITO (la misma en sp_get_customers,
   sp_get_customers_with_credit_available, sp_get_customer_open_credit_sales,
   sp_get_customers_credit_summary y sp_register_sale):

     deuda      ventas CREDITO con saldo > 0
     vencida    vencimiento + dias de gracia < hoy
     atraso     dias desde (vencimiento + gracia) hasta hoy
     mora       recargo fijo + saldo * interes mensual% / 100 * atraso / 30
                (estimada: se informa, no se carga sola a la cuenta)
     bloqueo    inactivo, sin limite, riesgo alto (3), con vencidas o sin
                disponible: no se le vende a credito */
CREATE OR ALTER PROCEDURE dbo.sp_get_customers_credit_summary
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CONVERT(date, GETDATE());

    ;WITH credit AS (
        SELECT
            s.customer_id,
            SUM(s.balance) AS total_balance,
            SUM(CASE WHEN s.due_date IS NOT NULL AND DATEADD(DAY, c.grace_days, s.due_date) < @hoy
                     THEN 1 ELSE 0 END) AS overdue_count
        FROM dbo.sales s
        JOIN dbo.customers c ON c.id = s.customer_id
        WHERE UPPER(s.payment_method) = 'CREDITO' AND s.balance > 0
        GROUP BY s.customer_id
    )
    SELECT
        c.id,
        c.customerName,
        c.phone,
        c.email,
        c.credit_limit,
        c.active,
        ISNULL(cr.total_balance, 0) AS total_balance,
        ISNULL(cr.overdue_count, 0) AS overdue_count
    FROM dbo.customers c
    LEFT JOIN credit cr ON cr.customer_id = c.id
    ORDER BY c.customerName;
END;
GO
