/* sp_get_top_selling_product
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David>
-- Create date: <16-08-2025>
-- Description:	<Get top selling product>
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[sp_get_top_selling_product]
AS
BEGIN
    SET NOCOUNT ON;

     SELECT TOP 1
        p.nombre       AS product_name,
        SUM(sd.quantity)                          AS total_sold,
        SUM(sd.quantity * sd.unitary_price)       AS total_revenue
    FROM dbo.sale_detail sd
    INNER JOIN dbo.sales    s ON s.id = sd.sale_id
    INNER JOIN dbo.products p ON p.id = sd.product_id
    GROUP BY p.nombre
    ORDER BY
        SUM(sd.quantity) DESC,
        SUM(sd.quantity * sd.unitary_price) DESC;
END
GO
