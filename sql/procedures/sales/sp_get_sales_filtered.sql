/* sp_get_sales_filtered
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <17-12-2025>
-- Description:	<Obtener ventas por filtro>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_sales_filtered
  @start_date DATE = NULL,
  @end_date   DATE = NULL
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    s.id,
    s.datee,
    s.useer_id,
    u.usuario AS user_name,
    s.total,
    s.payment_method,
    s.customer_id,
    c.customerName AS customer_name,
    s.paid_amount,
    s.balance,
    s.due_date
  FROM dbo.sales s
  LEFT JOIN dbo.users u       ON u.id = s.useer_id
  LEFT JOIN dbo.customers c   ON c.id = s.customer_id
  WHERE
    (@start_date IS NULL OR CONVERT(date, s.datee) >= @start_date)
    AND (@end_date   IS NULL OR CONVERT(date, s.datee) <= @end_date)
  ORDER BY s.id DESC;
END
GO
