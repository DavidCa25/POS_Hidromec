/* sp_save_recipe
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Guarda (crea o reemplaza) la receta de un producto RECIPE, base o por
-- variante. Convierte cada linea a la unidad BASE del ingrediente AQUI, al
-- configurar, para que la venta nunca convierta unidades.
--
-- Garantias de un solo nivel / sin ciclos: el ingrediente debe ser DIRECT
-- (nunca RECIPE) y distinto del producto. sp_update_product impide despues
-- convertir a RECIPE un producto que ya es ingrediente.
CREATE OR ALTER PROCEDURE dbo.sp_save_recipe
    @product_id        INT,
    @variant_option_id INT = NULL,
    @notes             NVARCHAR(300) = NULL,
    @Lines             dbo.RecipeLineType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @mode NVARCHAR(10);
    SELECT @mode = inventory_mode FROM dbo.products WHERE id = @product_id AND active = 1;
    IF @mode IS NULL
    BEGIN RAISERROR('El producto no existe o esta inactivo.', 16, 1); RETURN; END
    IF @mode <> 'RECIPE'
    BEGIN RAISERROR('Solo un producto de tipo RECETA puede tener receta.', 16, 1); RETURN; END

    IF @variant_option_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM dbo.modifier_options o
        JOIN dbo.modifier_groups g ON g.id = o.group_id
        JOIN dbo.product_modifier_groups pmg ON pmg.group_id = g.id AND pmg.product_id = @product_id
        WHERE o.id = @variant_option_id AND g.role = 'SIZE')
    BEGIN RAISERROR('La variante no pertenece a un grupo de tamano de este producto.', 16, 1); RETURN; END

    IF NOT EXISTS (SELECT 1 FROM @Lines)
    BEGIN RAISERROR('La receta necesita al menos un ingrediente.', 16, 1); RETURN; END

    IF EXISTS (SELECT 1 FROM @Lines WHERE input_qty IS NULL OR input_qty <= 0)
    BEGIN RAISERROR('Cada ingrediente necesita una cantidad mayor a cero.', 16, 1); RETURN; END

    IF EXISTS (SELECT ingredient_product_id FROM @Lines GROUP BY ingredient_product_id HAVING COUNT(*) > 1)
    BEGIN RAISERROR('Hay un ingrediente repetido en la receta.', 16, 1); RETURN; END

    IF EXISTS (SELECT 1 FROM @Lines WHERE ingredient_product_id = @product_id)
    BEGIN RAISERROR('Un producto no puede ser ingrediente de si mismo.', 16, 1); RETURN; END

    IF EXISTS (
        SELECT 1 FROM @Lines l
        LEFT JOIN dbo.products i ON i.id = l.ingredient_product_id AND i.active = 1
        WHERE i.id IS NULL OR i.inventory_mode <> 'DIRECT')
    BEGIN RAISERROR('Cada ingrediente debe ser un producto activo con inventario directo (no una receta).', 16, 1); RETURN; END

    IF EXISTS (
        SELECT 1 FROM @Lines l
        JOIN dbo.products i ON i.id = l.ingredient_product_id
        JOIN dbo.uoms ub ON ub.code = i.base_uom
        LEFT JOIN dbo.uoms ui ON ui.code = l.input_uom
        WHERE ui.code IS NULL OR ui.dimension <> ub.dimension)
    BEGIN RAISERROR('La unidad de una linea no corresponde a la unidad base del ingrediente (peso, volumen, longitud o piezas).', 16, 1); RETURN; END

    IF EXISTS (SELECT 1 FROM @Lines WHERE waste_pct IS NOT NULL AND (waste_pct < 0 OR waste_pct > 100))
    BEGIN RAISERROR('La merma debe estar entre 0 y 100 por ciento.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;

        DECLARE @recipe_id INT;
        SELECT @recipe_id = id FROM dbo.recipes WITH (UPDLOCK, HOLDLOCK)
        WHERE product_id = @product_id
          AND ((@variant_option_id IS NULL AND variant_option_id IS NULL) OR variant_option_id = @variant_option_id);

        IF @recipe_id IS NULL
        BEGIN
            INSERT INTO dbo.recipes (product_id, variant_option_id, notes) VALUES (@product_id, @variant_option_id, @notes);
            SET @recipe_id = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
            UPDATE dbo.recipes SET notes = @notes, active = 1, updated_at = SYSDATETIME() WHERE id = @recipe_id;
            DELETE FROM dbo.recipe_lines WHERE recipe_id = @recipe_id;
        END

        INSERT INTO dbo.recipe_lines (recipe_id, ingredient_product_id, qty_base, input_qty, input_uom, waste_pct, sort_order)
        SELECT
            @recipe_id,
            l.ingredient_product_id,
            CAST(l.input_qty * ui.factor_to_base / ub.factor_to_base AS DECIMAL(14, 4)),
            l.input_qty,
            l.input_uom,
            ISNULL(l.waste_pct, 0),
            ISNULL(l.sort_order, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)))
        FROM @Lines l
        JOIN dbo.products i ON i.id = l.ingredient_product_id
        JOIN dbo.uoms ub ON ub.code = i.base_uom
        JOIN dbo.uoms ui ON ui.code = l.input_uom;

        IF EXISTS (SELECT 1 FROM dbo.recipe_lines WHERE recipe_id = @recipe_id AND qty_base <= 0)
        BEGIN
            RAISERROR('Una cantidad es demasiado pequena para la unidad base (queda en cero).', 16, 1);
            ROLLBACK TRAN; RETURN;
        END

        COMMIT TRAN;
        SELECT @recipe_id AS recipe_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
