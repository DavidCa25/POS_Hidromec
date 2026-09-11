/* sp_get_total_orders
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <16-08-2025>
-- Description:	<Get total orders>
-- =============================================
CREATE OR ALTER PROCEDURE sp_get_total_orders
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        COUNT(*) AS total_orders
    FROM sales s
    WHERE MONTH(s.datee) = MONTH(GETDATE())
      AND YEAR(s.datee) = YEAR(GETDATE());
END
GO
