/* sp_get_total_sales_today
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <16-08-2025>
-- Description:	<Get total sales today>
-- =============================================
CREATE OR ALTER PROCEDURE sp_get_total_sales_today
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        SUM(s.total) AS total_sales_today
    FROM sales s
    WHERE CAST(s.datee AS DATE) = CAST(GETDATE() AS DATE);
END
GO
