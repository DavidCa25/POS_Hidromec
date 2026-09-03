/* sp_get_daily_sales_last_7_days
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <06-12-2025>
-- Description:	<Obtener las ventas de 7 días atrás incluyendo el día de hoy>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_daily_sales_last_7_days
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @hoy  DATE = CAST(GETDATE() AS DATE);
    DECLARE @ini  DATE = DATEADD(DAY, -6, @hoy);  -- últimos 7 días (incluyendo hoy)

    ;WITH days AS (
        SELECT @ini AS d
        UNION ALL
        SELECT DATEADD(DAY, 1, d)
        FROM days
        WHERE d < @hoy
    )
    SELECT
        d.d              AS sale_date,
        ISNULL(SUM(s.total), 0) AS total_sales
    FROM days d
    LEFT JOIN sales s
        ON CONVERT(DATE, s.datee) = d.d
    GROUP BY d.d
    ORDER BY d.d
    OPTION (MAXRECURSION 7);
END;
GO
