/* sp_set_product_modifier_groups
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Reemplaza los grupos ligados a un producto, en el orden dado.
-- @group_ids_json: arreglo JSON de ids, p. ej. '[3,1,7]'.
CREATE OR ALTER PROCEDURE dbo.sp_set_product_modifier_groups
    @product_id     INT,
    @group_ids_json NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
    BEGIN RAISERROR('El producto no existe.', 16, 1); RETURN; END
    IF @group_ids_json IS NULL OR ISJSON(@group_ids_json) = 0
    BEGIN RAISERROR('group_ids_json debe ser un arreglo JSON.', 16, 1); RETURN; END

    DECLARE @ids TABLE (group_id INT NOT NULL, sort_order INT NOT NULL);
    INSERT INTO @ids (group_id, sort_order)
    SELECT CAST([value] AS INT), CAST([key] AS INT) FROM OPENJSON(@group_ids_json);

    IF EXISTS (SELECT 1 FROM @ids i LEFT JOIN dbo.modifier_groups g ON g.id = i.group_id WHERE g.id IS NULL)
    BEGIN RAISERROR('Un grupo no existe.', 16, 1); RETURN; END

    -- Quitar un grupo SIZE que tenga recetas por variante dejaria recetas
    -- huerfanas: se exige borrarlas primero.
    IF EXISTS (
        SELECT 1 FROM dbo.recipes r
        JOIN dbo.modifier_options o ON o.id = r.variant_option_id
        WHERE r.product_id = @product_id AND o.group_id NOT IN (SELECT group_id FROM @ids))
    BEGIN RAISERROR('Este producto tiene recetas por tamano de un grupo que se intenta quitar. Elimina esas recetas primero.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        DELETE FROM dbo.product_modifier_groups WHERE product_id = @product_id;
        INSERT INTO dbo.product_modifier_groups (product_id, group_id, sort_order)
        SELECT @product_id, group_id, sort_order FROM @ids;
        COMMIT TRAN;
        SELECT @product_id AS product_id, (SELECT COUNT(*) FROM @ids) AS groups_count;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
