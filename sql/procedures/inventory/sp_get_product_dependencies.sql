/* sp_get_product_dependencies
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Que esta usando este producto, para poder DECIRLO con su nombre correcto.
--
-- POR QUE EXISTE
-- --------------
-- `sp_delete_product` ya bloquea la baja y explica el motivo en su mensaje de
-- error. El problema es el canal: el driver (msnodesqlv8) degrada el texto de
-- los ERRORES a un solo byte, asi que "QA Frappe" con acento llegaba a
-- pantalla como "QA Frapp?". Comprobado: las FILAS de datos conservan el
-- acento intacto; solo el mensaje de error lo pierde.
--
-- Cambiar RAISERROR por THROW no arregla nada -se probo, se degrada igual-,
-- porque la perdida no ocurre en SQL Server sino al leer el error. La
-- solucion es no mandar datos del usuario por el canal de errores: SQL sigue
-- negando la baja, y los nombres viajan por donde viajan bien.
--
-- OJO: las condiciones de aqui y las de `sp_delete_product` describen la MISMA
-- regla -receta viva o modificador activo- y tienen que moverse juntas. Este
-- procedimiento solo informa; el que decide es el otro.
CREATE OR ALTER PROCEDURE dbo.sp_get_product_dependencies
    @product_id INT
AS
BEGIN
    SET NOCOUNT ON;

    /* Recetas vivas que lo llevan como ingrediente. Una receta desactivada, o
       la de un producto que ya esta de baja, no consume nada. */
    SELECT DISTINCT
           N'RECIPE' AS tipo,
           pr.id     AS owner_id,
           pr.nombre AS nombre
    FROM dbo.recipe_lines rl
    JOIN dbo.recipes  r  ON r.id = rl.recipe_id AND r.active = 1
    JOIN dbo.products pr ON pr.id = r.product_id AND pr.active = 1
    WHERE rl.ingredient_product_id = @product_id

    UNION ALL

    /* Opciones de modificador que lo agregan o lo sustituyen. */
    SELECT DISTINCT
           N'MODIFIER' AS tipo,
           o.id        AS owner_id,
           g.name + N' / ' + o.name AS nombre
    FROM dbo.modifier_options o
    JOIN dbo.modifier_groups g ON g.id = o.group_id AND g.active = 1
    WHERE o.active = 1
      AND (o.ingredient_product_id = @product_id OR o.replaces_product_id = @product_id)

    ORDER BY tipo, nombre;
END;
GO
