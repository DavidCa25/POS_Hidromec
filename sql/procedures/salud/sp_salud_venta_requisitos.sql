/* sp_salud_venta_requisitos
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* De los productos de una venta, cuáles exigen receta. La venta se frena
 * ANTES de cobrar si alguno la exige y no viene.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_venta_requisitos]
    @product_ids NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    IF ISJSON(@product_ids) <> 1 RETURN;

    SELECT p.id AS product_id, p.nombre, s.fraccion, s.es_antibiotico, s.es_controlado
      FROM (SELECT DISTINCT TRY_CAST([value] AS INT) AS id FROM OPENJSON(@product_ids)) j
      JOIN dbo.salud_productos s ON s.product_id = j.id
      JOIN dbo.products p ON p.id = s.product_id
     WHERE s.requiere_receta = 1;
END
GO
