/* sp_delete_modifier_group
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Si alguna venta uso una opcion del grupo (o una receta por variante lo
-- referencia), el grupo se DESACTIVA; si no, se borra por completo.
CREATE OR ALTER PROCEDURE dbo.sp_delete_modifier_group
    @group_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.modifier_groups WHERE id = @group_id)
    BEGIN RAISERROR('El grupo no existe.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        IF EXISTS (SELECT 1 FROM dbo.sale_detail_modifiers m JOIN dbo.modifier_options o ON o.id = m.modifier_option_id WHERE o.group_id = @group_id)
           OR EXISTS (SELECT 1 FROM dbo.recipes r JOIN dbo.modifier_options o ON o.id = r.variant_option_id WHERE o.group_id = @group_id)
        BEGIN
            UPDATE dbo.modifier_groups SET active = 0 WHERE id = @group_id;
            UPDATE dbo.modifier_options SET active = 0 WHERE group_id = @group_id;
            DELETE FROM dbo.product_modifier_groups WHERE group_id = @group_id;
            COMMIT TRAN;
            SELECT @group_id AS group_id, 'DEACTIVATED' AS result;
            RETURN;
        END

        DELETE FROM dbo.product_modifier_groups WHERE group_id = @group_id;
        DELETE FROM dbo.modifier_options WHERE group_id = @group_id;
        DELETE FROM dbo.modifier_groups WHERE id = @group_id;
        COMMIT TRAN;
        SELECT @group_id AS group_id, 'DELETED' AS result;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
