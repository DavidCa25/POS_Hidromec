/* sp_customers_kpis
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* KPIs de clientes */
CREATE OR ALTER PROCEDURE dbo.sp_customers_kpis
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        (SELECT COUNT(*) FROM customers WHERE active = 1) AS activos,
        (SELECT COUNT(*) FROM customers
          WHERE created_at >= DATEADD(DAY, -30, CAST(GETDATE() AS DATE))) AS nuevos_30d,
        (SELECT COUNT(DISTINCT customer_id) FROM sales WHERE customer_id IS NOT NULL) AS con_compras;
END
GO
