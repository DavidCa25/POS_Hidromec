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
    ;WITH payments AS (
      SELECT s.id,s.datee,p.payment_method,p.amount FROM dbo.sales s JOIN dbo.sale_payments p ON p.sale_id=s.id
      UNION ALL SELECT s.id,s.datee,s.payment_method,s.total FROM dbo.sales s WHERE NOT EXISTS(SELECT 1 FROM dbo.sale_payments p WHERE p.sale_id=s.id)
    ) SELECT payment_method,COUNT(DISTINCT id) tickets,SUM(amount) total FROM payments WHERE datee>=DATEADD(DAY,-@days,CAST(GETDATE() AS DATE)) GROUP BY payment_method ORDER BY SUM(amount) DESC;
END
GO
