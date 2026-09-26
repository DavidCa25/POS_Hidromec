/* sp_get_customer_open_credit_sales
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:      <David>
-- Description: <Ventas a credito con saldo de un cliente, con su atraso y su mora estimada>
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
CREATE OR ALTER PROCEDURE dbo.sp_get_customer_open_credit_sales
    @customer_id INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CONVERT(date, GETDATE());

    SELECT
        v.id, v.datee, v.total, v.paid_amount, v.balance, v.due_date,
        v.atraso AS days_late,
        CAST(CASE WHEN v.atraso > 0 THEN 1 ELSE 0 END AS BIT) AS is_overdue,
        CAST(ROUND(CASE WHEN v.atraso > 0
                        THEN v.late_fee_fixed + v.balance * v.late_fee_pct / 100.0 * v.atraso / 30.0
                        ELSE 0 END, 2) AS DECIMAL(12,2)) AS late_fee_estimate
    FROM (
        SELECT s.id, s.datee, s.total, s.paid_amount, s.balance, s.due_date,
               c.late_fee_fixed, c.late_fee_pct,
               CASE WHEN s.due_date IS NOT NULL AND DATEADD(DAY, c.grace_days, s.due_date) < @hoy
                    THEN DATEDIFF(DAY, DATEADD(DAY, c.grace_days, s.due_date), @hoy) ELSE 0 END AS atraso
        FROM dbo.sales s
        JOIN dbo.customers c ON c.id = s.customer_id
        WHERE s.customer_id = @customer_id
          AND UPPER(s.payment_method) = 'CREDITO'
          AND s.balance > 0
    ) v
    /* Lo mas vencido primero: es lo que hay que cobrar antes. */
    ORDER BY v.atraso DESC, v.due_date, v.datee;
END;
GO
