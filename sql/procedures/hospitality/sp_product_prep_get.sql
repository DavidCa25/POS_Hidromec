/* sp_product_prep_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Lo que se vende, con su estacion. Solo lo vendible: un ingrediente no se
   pide, asi que tampoco se prepara por separado. */
CREATE OR ALTER PROCEDURE dbo.sp_product_prep_get
AS
BEGIN
    SET NOCOUNT ON;
    SELECT p.id AS product_id, p.nombre, p.part_number, ISNULL(c.namee, '') AS category_name,
           p.inventory_mode, pp.station_id
      FROM dbo.products p
      LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
      LEFT JOIN dbo.product_prep_station pp ON pp.product_id = p.id
     WHERE p.active = 1 AND p.sellable = 1
     ORDER BY ISNULL(c.namee, ''), p.nombre;
END
GO
