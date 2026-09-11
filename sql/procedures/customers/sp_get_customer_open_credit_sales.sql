/* sp_get_customer_open_credit_sales
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_get_customer_open_credit_sales
    @customer_id INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        s.id,
        s.datee,
        s.total,
        s.paid_amount,
        s.balance,
        s.due_date
    FROM sales s
    WHERE
        s.customer_id = @customer_id
        AND UPPER(s.payment_method) = 'CREDITO'
        AND s.balance > 0
    ORDER BY
        s.due_date, s.datee;
END;
GO
