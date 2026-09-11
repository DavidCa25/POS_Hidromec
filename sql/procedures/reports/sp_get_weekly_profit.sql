/* sp_get_weekly_profit
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <06-12-2025>
-- Description:	<Obtener una utilidad por semana>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_weekly_profit
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @from DATE = DATEADD(DAY, -6, CAST(GETDATE() AS DATE));
    DECLARE @to   DATE = DATEADD(DAY,  1, CAST(GETDATE() AS DATE));

    ;WITH daily AS (
        SELECT
            CAST(s.datee AS DATE)                           AS sale_date,
            SUM(d.quantity * d.unitary_price)              AS total_sales,
            SUM(d.quantity * ISNULL(p.cost, 0))            AS total_cost
        FROM sales        AS s
        JOIN sale_detail  AS d ON d.sale_id   = s.id
        JOIN products     AS p ON p.id        = d.product_id
        WHERE s.datee >= @from
          AND s.datee <  @to
        GROUP BY CAST(s.datee AS DATE)
    )
    SELECT
        sale_date,
        total_sales,
        total_cost,
        (total_sales - total_cost) AS profit
    FROM daily
    ORDER BY sale_date;
END;
GO
