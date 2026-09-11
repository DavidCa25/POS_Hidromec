/* sp_get_customers_credit_summary
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David>
-- Create date: <03-12-2025>
-- Description:	<Obtener la suma de credito del cliente>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_customers_credit_summary
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH credit AS (
        SELECT
            s.customer_id,
            SUM(
                CASE WHEN UPPER(s.payment_method) = 'CREDITO'
                          AND s.balance > 0
                     THEN s.balance ELSE 0 END
            ) AS total_balance,
            SUM(
                CASE WHEN UPPER(s.payment_method) = 'CREDITO'
                          AND s.balance > 0
                          AND s.due_date IS NOT NULL
                          AND s.due_date < CONVERT(date, GETDATE())
                     THEN 1 ELSE 0 END
            ) AS overdue_count
        FROM sales s
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
    FROM customers c
    LEFT JOIN credit cr
        ON cr.customer_id = c.id
    ORDER BY c.customerName;
END;
GO
