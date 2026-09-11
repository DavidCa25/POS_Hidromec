/* sp_update_product
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Update: + campos fiscales SAT (opcionales)
-- Conserva la logica original de bar_code.
-- Update: + inventory_mode, sellable, base_uom, allow_decimal_qty, cost.
--   NULL conserva el valor actual. Guardas de un solo nivel: un producto que
--   ya es ingrediente no puede volverse RECIPE; una RECIPE con recetas no
--   puede dejar de serlo sin borrarlas; la unidad base no cambia de
--   dimension mientras haya recetas que consuman el producto.
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[sp_update_product]
    @product_id INT,
    @nombre NVARCHAR(100),
    @precio DECIMAL(10,2),
    @stock DECIMAL(10,2),
    @numero_parte NVARCHAR(100),
    @bar_code NVARCHAR(100) = NULL,
    @clave_prod_serv NVARCHAR(8) = NULL,
    @clave_unidad NVARCHAR(5) = NULL,
    @objeto_impuesto NVARCHAR(2) = NULL,
    @tasa_iva DECIMAL(5,4) = NULL,
    @inventory_mode NVARCHAR(10) = NULL,
    @sellable BIT = NULL,
    @base_uom NVARCHAR(10) = NULL,
    @allow_decimal_qty BIT = NULL,
    @cost DECIMAL(14,4) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @modo_actual NVARCHAR(10), @uom_actual NVARCHAR(10);
    SELECT @modo_actual = inventory_mode, @uom_actual = base_uom FROM products WHERE id = @product_id;
    IF @modo_actual IS NULL
    BEGIN
        RAISERROR('El producto no existe.', 16, 1);
        RETURN;
    END

    IF @inventory_mode IS NOT NULL
    BEGIN
        SET @inventory_mode = UPPER(@inventory_mode);
        IF @inventory_mode NOT IN ('DIRECT', 'RECIPE', 'NONE')
        BEGIN
            RAISERROR('inventory_mode invalido: DIRECT, RECIPE o NONE.', 16, 1);
            RETURN;
        END
        IF @inventory_mode <> @modo_actual
        BEGIN
            IF @inventory_mode = 'RECIPE' AND (
                   EXISTS (SELECT 1 FROM dbo.recipe_lines WHERE ingredient_product_id = @product_id)
                OR EXISTS (SELECT 1 FROM dbo.modifier_options WHERE ingredient_product_id = @product_id OR replaces_product_id = @product_id))
            BEGIN
                RAISERROR('Este producto es ingrediente de una receta o modificador: no puede convertirse en receta.', 16, 1);
                RETURN;
            END
            IF @modo_actual = 'RECIPE' AND EXISTS (SELECT 1 FROM dbo.recipes WHERE product_id = @product_id)
            BEGIN
                RAISERROR('Este producto tiene recetas. Eliminalas antes de cambiar su tipo de inventario.', 16, 1);
                RETURN;
            END
            IF @modo_actual <> 'DIRECT' AND @inventory_mode = 'DIRECT' AND EXISTS (SELECT 1 FROM dbo.recipes WHERE product_id = @product_id)
            BEGIN
                RAISERROR('Este producto tiene recetas. Eliminalas antes de cambiar su tipo de inventario.', 16, 1);
                RETURN;
            END
        END
    END

    IF @base_uom IS NOT NULL AND @base_uom <> @uom_actual
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.uoms WHERE code = @base_uom AND is_base = 1)
        BEGIN
            RAISERROR('La unidad base debe ser una unidad base (pza, g, ml, cm).', 16, 1);
            RETURN;
        END
        IF EXISTS (SELECT 1 FROM dbo.recipe_lines WHERE ingredient_product_id = @product_id)
           OR EXISTS (SELECT 1 FROM dbo.modifier_options WHERE ingredient_product_id = @product_id OR replaces_product_id = @product_id)
        BEGIN
            RAISERROR('Este producto ya se usa en recetas o modificadores: su unidad base no puede cambiar.', 16, 1);
            RETURN;
        END
    END

    -- Si mandan un bar_code no vacio, valida que no lo tenga otro producto
    IF @bar_code IS NOT NULL AND LTRIM(RTRIM(@bar_code)) <> ''
    BEGIN
        IF EXISTS (
            SELECT 1 FROM products
            WHERE bar_code = @bar_code AND id <> @product_id
        )
        BEGIN
            RAISERROR('Ese codigo de barras ya esta asignado a otro producto.', 16, 1);
            RETURN;
        END
    END

    UPDATE products
    SET nombre = @nombre,
        price = @precio,
        stock = CASE WHEN ISNULL(@inventory_mode, inventory_mode) = 'RECIPE' THEN 0 ELSE @stock END,
        part_number = @numero_parte,
        bar_code = CASE
                     WHEN @bar_code IS NULL THEN bar_code           -- no lo tocan: conserva
                     WHEN LTRIM(RTRIM(@bar_code)) = '' THEN NULL     -- vacio: lo limpia
                     ELSE @bar_code
                   END,
        -- Campos fiscales: si mandan NULL, conservan el valor actual
        clave_prod_serv = ISNULL(@clave_prod_serv, clave_prod_serv),
        clave_unidad    = ISNULL(@clave_unidad, clave_unidad),
        objeto_impuesto = ISNULL(@objeto_impuesto, objeto_impuesto),
        tasa_iva        = ISNULL(@tasa_iva, tasa_iva),
        inventory_mode    = ISNULL(@inventory_mode, inventory_mode),
        sellable          = ISNULL(@sellable, sellable),
        base_uom          = ISNULL(@base_uom, base_uom),
        allow_decimal_qty = ISNULL(@allow_decimal_qty, allow_decimal_qty),
        cost              = ISNULL(@cost, cost)
    WHERE id = @product_id;
END;
GO
