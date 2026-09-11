/* sp_sales_by_payment
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Ventas por metodo de pago en los ultimos @days dias */
CREATE OR ALTER PROCEDURE dbo.sp_sales_by_payment
    @days INT = 30
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        payment_method,
        COUNT(*)     AS tickets,
        SUM(total)   AS total
    FROM sales
    WHERE datee >= DATEADD(DAY, -@days, CAST(GETDATE() AS DATE))
    GROUP BY payment_method
    ORDER BY SUM(total) DESC;
END
GO
