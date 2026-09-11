/* sp_cloud_top_products
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------
   2) Top productos del dia
   Los mas vendidos por importe. Devuelve nombre, cantidad e importe.
   ------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE [dbo].[sp_cloud_top_products]
    @fecha DATE = NULL,
    @top INT = 10,
    @register_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @fecha IS NULL SET @fecha = CAST(GETDATE() AS DATE);

    SELECT TOP (@top)
        p.nombre                              AS producto,
        SUM(sd.quantity)                      AS cantidad,
        SUM(sd.quantity * sd.unitary_price)   AS importe
    FROM dbo.sale_detail sd
    JOIN dbo.sales s    ON s.id = sd.sale_id
    JOIN dbo.products p ON p.id = sd.product_id
    WHERE CAST(s.datee AS DATE) = @fecha
      AND (@register_id IS NULL OR s.register_id = @register_id)
    GROUP BY p.nombre
    ORDER BY importe DESC;
END
GO
