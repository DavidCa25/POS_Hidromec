/* sp_cloud_sales_trend
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------
   Tendencia de ventas de 7 dias (reusa la logica existente)
   Devuelve fecha + total por dia, opcional por caja.
   ------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE [dbo].[sp_cloud_sales_trend]
    @register_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);
    DECLARE @ini DATE = DATEADD(DAY, -6, @hoy);

    ;WITH days AS (
        SELECT @ini AS d
        UNION ALL
        SELECT DATEADD(DAY, 1, d) FROM days WHERE d < @hoy
    )
    SELECT
        d.d                       AS fecha,
        ISNULL(SUM(s.total), 0)   AS total
    FROM days d
    LEFT JOIN sales s
        ON CONVERT(DATE, s.datee) = d.d
       AND (@register_id IS NULL OR s.register_id = @register_id)
    GROUP BY d.d
    ORDER BY d.d
    OPTION (MAXRECURSION 7);
END
GO
