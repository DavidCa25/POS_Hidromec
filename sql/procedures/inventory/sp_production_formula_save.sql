/* sp_production_formula_save
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0060 · Guarda (crea o reemplaza) la fórmula de producción de un producto.

   El producto debe ser DIRECT: lo que se fabrica tiene existencia propia. Los
   ingredientes también DIRECT (y distintos del producto). Un ingrediente
   puede tener a su vez fórmula -una masa que se fabrica aparte-: producir
   consume su EXISTENCIA, nunca la expande, así que no hay ciclos que seguir.

   Las cantidades son para @yield_qty piezas y se convierten AQUÍ a la unidad
   base del ingrediente, igual que sp_save_recipe: producir nunca convierte. */
CREATE OR ALTER PROCEDURE dbo.sp_production_formula_save
    @product_id INT,
    @yield_qty  DECIMAL(12, 2),
    @notes      NVARCHAR(300) = NULL,
    @user_id    INT = NULL,
    @Lines      dbo.RecipeLineType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id AND active = 1)
    BEGIN RAISERROR('El producto no existe o esta inactivo.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id AND inventory_mode = 'DIRECT')
    BEGIN RAISERROR('Solo un producto con inventario directo se puede fabricar: lo que se produce tiene existencia propia.', 16, 1); RETURN; END
    IF @yield_qty IS NULL OR @yield_qty <= 0
    BEGIN RAISERROR('Indica para cuantas piezas es la formula.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM @Lines)
    BEGIN RAISERROR('La formula necesita al menos un ingrediente.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Lines WHERE input_qty IS NULL OR input_qty <= 0)
    BEGIN RAISERROR('Cada ingrediente necesita una cantidad mayor a cero.', 16, 1); RETURN; END
    IF EXISTS (SELECT ingredient_product_id FROM @Lines GROUP BY ingredient_product_id HAVING COUNT(*) > 1)
    BEGIN RAISERROR('Hay un ingrediente repetido en la formula.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Lines WHERE ingredient_product_id = @product_id)
    BEGIN RAISERROR('Un producto no puede ser ingrediente de si mismo.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Lines l LEFT JOIN dbo.products i ON i.id = l.ingredient_product_id AND i.active = 1
               WHERE i.id IS NULL OR i.inventory_mode <> 'DIRECT')
    BEGIN RAISERROR('Cada ingrediente debe ser un producto activo con inventario directo.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Lines l
               JOIN dbo.products i ON i.id = l.ingredient_product_id
               JOIN dbo.uoms ub ON ub.code = i.base_uom
               LEFT JOIN dbo.uoms ui ON ui.code = l.input_uom
               WHERE ui.code IS NULL OR ui.dimension <> ub.dimension)
    BEGIN RAISERROR('La unidad de una linea no corresponde a la unidad base del ingrediente (peso, volumen, longitud o piezas).', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Lines WHERE waste_pct IS NOT NULL AND (waste_pct < 0 OR waste_pct > 100))
    BEGIN RAISERROR('La merma debe estar entre 0 y 100 por ciento.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        IF EXISTS (SELECT 1 FROM dbo.production_formulas WITH (UPDLOCK, HOLDLOCK) WHERE product_id = @product_id)
        BEGIN
            UPDATE dbo.production_formulas
               SET yield_qty = @yield_qty, notes = @notes, updated_by = @user_id, updated_at = SYSDATETIME()
             WHERE product_id = @product_id;
            DELETE FROM dbo.production_formula_lines WHERE product_id = @product_id;
        END
        ELSE
            INSERT INTO dbo.production_formulas (product_id, yield_qty, notes, updated_by)
            VALUES (@product_id, @yield_qty, @notes, @user_id);

        INSERT INTO dbo.production_formula_lines (product_id, ingredient_product_id, qty_base, input_qty, input_uom, waste_pct, sort_order)
        SELECT @product_id, l.ingredient_product_id,
               CAST(l.input_qty * ui.factor_to_base / ub.factor_to_base AS DECIMAL(14, 4)),
               l.input_qty, l.input_uom, ISNULL(l.waste_pct, 0),
               ISNULL(l.sort_order, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)))
        FROM @Lines l
        JOIN dbo.products i ON i.id = l.ingredient_product_id
        JOIN dbo.uoms ub ON ub.code = i.base_uom
        JOIN dbo.uoms ui ON ui.code = l.input_uom;

        IF EXISTS (SELECT 1 FROM dbo.production_formula_lines WHERE product_id = @product_id AND qty_base <= 0)
        BEGIN
            RAISERROR('Una cantidad es demasiado pequena para la unidad base (queda en cero).', 16, 1);
        END
        COMMIT TRAN;
        SELECT @product_id AS product_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
