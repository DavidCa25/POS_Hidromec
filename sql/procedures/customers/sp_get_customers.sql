/* sp_get_customers
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:      <David>
-- Description: <Todos los clientes con su estado de credito calculado>
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
CREATE OR ALTER PROCEDURE dbo.sp_get_customers
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CONVERT(date, GETDATE());

    /* `balance` y `overdueCount` los leia la pantalla de Clientes, pero la
       tabla no tiene esas columnas: salian siempre en 0. Ahora se calculan de
       las ventas, que es donde vive la deuda. */
    ;WITH abiertas AS (
        SELECT s.customer_id, s.balance, s.due_date,
               CASE WHEN s.due_date IS NOT NULL AND DATEADD(DAY, c.grace_days, s.due_date) < @hoy
                    THEN DATEDIFF(DAY, DATEADD(DAY, c.grace_days, s.due_date), @hoy) ELSE 0 END AS atraso,
               c.late_fee_pct, c.late_fee_fixed
        FROM dbo.sales s
        JOIN dbo.customers c ON c.id = s.customer_id
        WHERE UPPER(s.payment_method) = 'CREDITO' AND s.balance > 0
    ), por_cliente AS (
        SELECT customer_id,
               SUM(balance) AS deuda,
               SUM(CASE WHEN atraso > 0 THEN 1 ELSE 0 END) AS vencidas,
               SUM(CASE WHEN atraso > 0 THEN balance ELSE 0 END) AS deuda_vencida,
               MIN(due_date) AS primer_vencimiento,
               MAX(atraso) AS atraso_max,
               SUM(CASE WHEN atraso > 0
                        THEN late_fee_fixed + balance * late_fee_pct / 100.0 * atraso / 30.0
                        ELSE 0 END) AS mora
        FROM abiertas
        GROUP BY customer_id
    )
    SELECT
        c.*,
        CAST(ISNULL(p.deuda, 0) AS DECIMAL(12,2))          AS balance,
        ISNULL(p.vencidas, 0)                               AS overdueCount,
        CAST(ISNULL(p.deuda_vencida, 0) AS DECIMAL(12,2))   AS overdue_balance,
        CAST(CASE WHEN c.credit_limit - ISNULL(p.deuda, 0) > 0
                  THEN c.credit_limit - ISNULL(p.deuda, 0) ELSE 0 END AS DECIMAL(12,2)) AS available_credit,
        p.primer_vencimiento                                AS next_due_date,
        ISNULL(p.atraso_max, 0)                             AS max_days_late,
        CAST(ROUND(ISNULL(p.mora, 0), 2) AS DECIMAL(12,2))  AS late_fee_estimate,
        CASE
            WHEN c.active = 0 THEN 'INACTIVO'
            WHEN c.credit_limit <= 0 THEN 'SIN_LIMITE'
            WHEN c.risk_level >= 3 THEN 'RIESGO'
            WHEN ISNULL(p.vencidas, 0) > 0 THEN 'VENCIDAS'
            WHEN c.credit_limit - ISNULL(p.deuda, 0) <= 0 THEN 'SIN_DISPONIBLE'
        END                                                 AS credit_block
    FROM dbo.customers c
    LEFT JOIN por_cliente p ON p.customer_id = c.id;
END
GO
