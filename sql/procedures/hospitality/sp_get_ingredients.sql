/* sp_get_ingredients
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Productos que pueden usarse como ingrediente de una receta: activos y con
-- inventario DIRECT (una receta nunca consume otra receta: un solo nivel).
CREATE OR ALTER PROCEDURE dbo.sp_get_ingredients
    @search NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        p.id,
        p.nombre        AS product_name,
        p.part_number,
        p.base_uom,
        u.dimension,
        p.stock,
        p.cost,
        p.sellable,
        p.category_id,
        c.namee         AS category_name
    FROM dbo.products p
    JOIN dbo.uoms u ON u.code = p.base_uom
    LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
    WHERE p.active = 1
      AND p.inventory_mode = 'DIRECT'
      AND (@search IS NULL OR LTRIM(RTRIM(@search)) = ''
           OR p.nombre LIKE '%' + @search + '%'
           OR p.part_number LIKE '%' + @search + '%')
    ORDER BY p.nombre;
END
GO
