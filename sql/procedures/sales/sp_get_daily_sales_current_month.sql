/* sp_get_daily_sales_current_month
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <06-12-2025>
-- Description:	<Obtener las ventas del mes incluyendo el día de hoy>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_daily_sales_current_month
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @firstOfMonth DATE = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1);
    DECLARE @firstNextMonth DATE = DATEADD(MONTH, 1, @firstOfMonth);

    SELECT
        CONVERT(date, datee)      AS sale_date,
        SUM(total)                AS total_sales
    FROM sales
    WHERE datee >= @firstOfMonth
      AND datee <  @firstNextMonth
    GROUP BY CONVERT(date, datee)
    ORDER BY sale_date;
END;
GO
