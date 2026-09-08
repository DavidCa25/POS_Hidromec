/* sp_save_modifier_group
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Crea o actualiza un grupo con sus opciones. Las opciones existentes que no
-- vengan en @Options se DESACTIVAN (no se borran): las ventas pasadas las
-- referencian en sale_detail_modifiers.
--
-- Semantica explicita, sin heuristicas por nombre:
--   role    SIZE | ADDON | SUBSTITUTION | NOTE
--   effect  NONE | ADD (ingrediente+qty_base) | REMOVE (replaces)
--           | SUBSTITUTE (replaces -> ingrediente, misma cantidad salvo qty_base)
--           | SCALE (qty_factor sobre la receta base)
CREATE OR ALTER PROCEDURE dbo.sp_save_modifier_group
    @group_id   INT = NULL,
    @name       NVARCHAR(80),
    @role       NVARCHAR(15),
    @min_select INT = 0,
    @max_select INT = 1,
    @required   BIT = 0,
    @active     BIT = 1,
    @sort_order INT = 0,
    @Options    dbo.ModifierOptionType READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @name = LTRIM(RTRIM(ISNULL(@name, '')));
    SET @role = UPPER(LTRIM(RTRIM(ISNULL(@role, ''))));
    IF @name = '' BEGIN RAISERROR('El grupo necesita un nombre.', 16, 1); RETURN; END
    IF @role NOT IN ('SIZE', 'ADDON', 'SUBSTITUTION', 'NOTE')
    BEGIN RAISERROR('role invalido: SIZE, ADDON, SUBSTITUTION o NOTE.', 16, 1); RETURN; END
    IF @min_select < 0 OR @max_select < 1 OR @min_select > @max_select
    BEGIN RAISERROR('min_select/max_select invalidos.', 16, 1); RETURN; END

    IF EXISTS (SELECT 1 FROM @Options WHERE LTRIM(RTRIM(ISNULL(name, ''))) = '')
    BEGIN RAISERROR('Cada opcion necesita un nombre.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Options WHERE UPPER(effect) NOT IN ('NONE', 'ADD', 'REMOVE', 'SUBSTITUTE', 'SCALE'))
    BEGIN RAISERROR('effect invalido: NONE, ADD, REMOVE, SUBSTITUTE o SCALE.', 16, 1); RETURN; END
    IF @role = 'NOTE' AND EXISTS (SELECT 1 FROM @Options WHERE UPPER(effect) <> 'NONE')
    BEGIN RAISERROR('Las opciones de un grupo NOTE no afectan inventario (effect NONE).', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Options WHERE UPPER(effect) = 'ADD' AND (ingredient_product_id IS NULL OR ISNULL(qty_base, 0) <= 0))
    BEGIN RAISERROR('Una opcion ADD necesita ingrediente y cantidad en unidad base.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Options WHERE UPPER(effect) = 'REMOVE' AND replaces_product_id IS NULL)
    BEGIN RAISERROR('Una opcion REMOVE necesita el ingrediente que retira.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Options WHERE UPPER(effect) = 'SUBSTITUTE' AND (ingredient_product_id IS NULL OR replaces_product_id IS NULL))
    BEGIN RAISERROR('Una opcion SUBSTITUTE necesita el ingrediente que retira y el que pone.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Options WHERE UPPER(effect) = 'SCALE' AND ISNULL(qty_factor, 0) <= 0)
    BEGIN RAISERROR('Una opcion SCALE necesita un factor mayor a cero.', 16, 1); RETURN; END
    IF EXISTS (
        SELECT 1 FROM @Options o
        LEFT JOIN dbo.products i ON i.id = o.ingredient_product_id
        WHERE o.ingredient_product_id IS NOT NULL AND (i.id IS NULL OR i.inventory_mode <> 'DIRECT'))
    BEGIN RAISERROR('El ingrediente de una opcion debe ser un producto con inventario directo.', 16, 1); RETURN; END
    IF EXISTS (
        SELECT 1 FROM @Options o
        LEFT JOIN dbo.products r ON r.id = o.replaces_product_id
        WHERE o.replaces_product_id IS NOT NULL AND r.id IS NULL)
    BEGIN RAISERROR('El ingrediente a sustituir no existe.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM @Options WHERE id IS NOT NULL AND @group_id IS NOT NULL AND id NOT IN (SELECT id FROM dbo.modifier_options WHERE group_id = @group_id))
    BEGIN RAISERROR('Una opcion no pertenece a este grupo.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;

        IF @group_id IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.modifier_groups WHERE id = @group_id)
        BEGIN
            INSERT INTO dbo.modifier_groups (name, role, min_select, max_select, required, active, sort_order)
            VALUES (@name, @role, @min_select, @max_select, @required, @active, @sort_order);
            SET @group_id = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
            UPDATE dbo.modifier_groups
               SET name = @name, role = @role, min_select = @min_select, max_select = @max_select,
                   required = @required, active = @active, sort_order = @sort_order
             WHERE id = @group_id;
        END

        -- Desactivar las que ya no vienen
        UPDATE o SET active = 0
        FROM dbo.modifier_options o
        WHERE o.group_id = @group_id
          AND o.id NOT IN (SELECT id FROM @Options WHERE id IS NOT NULL);

        -- Actualizar existentes
        UPDATE o
           SET name = LTRIM(RTRIM(n.name)),
               price_delta = ISNULL(n.price_delta, 0),
               effect = UPPER(n.effect),
               ingredient_product_id = n.ingredient_product_id,
               replaces_product_id = n.replaces_product_id,
               qty_base = n.qty_base,
               qty_factor = n.qty_factor,
               active = ISNULL(n.active, 1),
               sort_order = ISNULL(n.sort_order, o.sort_order)
        FROM dbo.modifier_options o
        JOIN @Options n ON n.id = o.id
        WHERE o.group_id = @group_id;

        -- Insertar nuevas
        INSERT INTO dbo.modifier_options
            (group_id, name, price_delta, effect, ingredient_product_id, replaces_product_id, qty_base, qty_factor, active, sort_order)
        SELECT @group_id, LTRIM(RTRIM(n.name)), ISNULL(n.price_delta, 0), UPPER(n.effect),
               n.ingredient_product_id, n.replaces_product_id, n.qty_base, n.qty_factor, ISNULL(n.active, 1),
               ISNULL(n.sort_order, 100 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)))
        FROM @Options n
        WHERE n.id IS NULL;

        COMMIT TRAN;

        SELECT @group_id AS group_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
