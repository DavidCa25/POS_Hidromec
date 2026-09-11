/* sp_get_customers_open_credit_not_overdue
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David>
-- Create date: <02-12-2025>
-- Description:	<Obtener clientes que tengan credito no vencido>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_customers_open_credit_not_overdue
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        c.id,
        c.customerName,
        c.phone,
        c.email,
        SUM(s.balance) AS total_balance,
        MIN(s.due_date) AS next_due_date,
        COUNT(*) AS open_credit_count
    FROM customers c
    INNER JOIN sales s
        ON s.customer_id = c.id
    WHERE
        UPPER(s.payment_method) = 'CREDITO'
        AND s.balance > 0
        AND (
              s.due_date IS NULL
              OR s.due_date >= CONVERT(date, GETDATE())
            )
    GROUP BY
        c.id,
        c.customerName,
        c.phone,
        c.email
    ORDER BY
        c.customerName;
END;
GO
