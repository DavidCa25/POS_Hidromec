/* sp_get_customers_with_credit_available
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:      <David>
-- Description: <Clientes a los que se les puede vender a credito, y los que no con su motivo>
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
CREATE OR ALTER PROCEDURE dbo.sp_get_customers_with_credit_available
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CONVERT(date, GETDATE());

    /* Salen TODOS los clientes activos con limite: los bloqueados tambien,
       con su motivo, para que la caja diga POR QUE no puede fiarle a alguien
       en vez de que el cliente simplemente no aparezca. */
    ;WITH deuda AS (
        SELECT s.customer_id,
               SUM(s.balance) AS current_balance,
               SUM(CASE WHEN s.due_date IS NOT NULL AND DATEADD(DAY, c.grace_days, s.due_date) < @hoy
                        THEN 1 ELSE 0 END) AS vencidas
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
        c.terms_days,
        c.risk_level,
        CAST(ISNULL(d.current_balance, 0) AS DECIMAL(12,2)) AS current_balance,
        CAST(CASE WHEN c.credit_limit - ISNULL(d.current_balance, 0) > 0
                  THEN c.credit_limit - ISNULL(d.current_balance, 0) ELSE 0 END AS DECIMAL(12,2)) AS available_credit,
        ISNULL(d.vencidas, 0) AS overdue_count,
        CASE
            WHEN c.risk_level >= 3 THEN 'RIESGO'
            WHEN ISNULL(d.vencidas, 0) > 0 THEN 'VENCIDAS'
            WHEN c.credit_limit - ISNULL(d.current_balance, 0) <= 0 THEN 'SIN_DISPONIBLE'
        END AS credit_block
    FROM dbo.customers c
    LEFT JOIN deuda d ON d.customer_id = c.id
    WHERE c.active = 1
      AND c.credit_limit > 0
    ORDER BY c.customerName;
END;
GO
