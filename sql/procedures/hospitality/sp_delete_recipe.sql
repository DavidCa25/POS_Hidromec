/* sp_delete_recipe
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Elimina una receta (base o de variante). Las ventas pasadas no dependen
-- de ella: sus consumos quedaron en inventory_movements.
CREATE OR ALTER PROCEDURE dbo.sp_delete_recipe
    @recipe_id INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.recipes WHERE id = @recipe_id)
    BEGIN RAISERROR('La receta no existe.', 16, 1); RETURN; END
    DELETE FROM dbo.recipe_lines WHERE recipe_id = @recipe_id;
    DELETE FROM dbo.recipes WHERE id = @recipe_id;
    SELECT @recipe_id AS recipe_id;
END
GO
