/* sp_get_customers_with_credit_available
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David>
-- Create date: <03-12-2025>
-- Description:	<Store procedure para obtener clientes con credito disponible>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_customers_with_credit_available
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH deuda AS (
        SELECT
            s.customer_id,
            SUM(CASE
                    WHEN UPPER(s.payment_method) = 'CREDITO'
                         AND s.balance > 0
                    THEN s.balance
                    ELSE 0
                END) AS current_balance
        FROM sales s
        GROUP BY s.customer_id
    )
    SELECT
        c.id,
        c.customerName,
        c.phone,
        c.email,
        c.credit_limit,
        ISNULL(d.current_balance, 0) AS current_balance,
        (c.credit_limit - ISNULL(d.current_balance, 0)) AS available_credit
    FROM customers c
    LEFT JOIN deuda d
        ON d.customer_id = c.id
    WHERE
        c.active = 1
        AND c.credit_limit > 0
        AND (c.credit_limit - ISNULL(d.current_balance, 0)) > 0  -- aún tiene crédito disponible
    ORDER BY
        c.customerName;
END;
GO
