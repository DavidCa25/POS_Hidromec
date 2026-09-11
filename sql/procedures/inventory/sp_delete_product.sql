/* sp_delete_product
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Description: Baja LOGICA de un producto (active = 0).
--
-- Nunca borra la fila: sale_detail, purchase_detail e inventory_movements la
-- referencian, y un ticket de hace seis meses tiene que seguir diciendo que se
-- vendio. Dar de baja significa "no se vende mas", no "nunca existio".
--
-- Update: + validacion de dependencias vivas. Antes solo hacia el UPDATE, asi
--         que se podia retirar un ingrediente que una receta activa seguia
--         necesitando y la receta quedaba apuntando a algo retirado. La guarda
--         vive aqui y no solo en la pantalla: el boton se puede deshabilitar,
--         pero el procedimiento es lo unico que no se puede saltar.
-- =============================================
CREATE OR ALTER PROCEDURE sp_delete_product
    @product_id INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @nombre NVARCHAR(100), @activo BIT, @usos NVARCHAR(600), @msg NVARCHAR(900);

    SELECT @nombre = nombre, @activo = active
    FROM dbo.products
    WHERE id = @product_id;

    IF @nombre IS NULL
    BEGIN
        RAISERROR('El producto no existe.', 16, 1);
        RETURN;
    END

    IF @activo = 0
    BEGIN
        RAISERROR('Este producto ya estaba dado de baja.', 16, 1);
        RETURN;
    END

    /* ---------------------------------------------------------- RECETAS
       Solo cuentan las vivas: una receta desactivada, o la de un producto que
       ya esta de baja, no consume nada y no debe bloquear a nadie. */
    SET @usos = STUFF((
        SELECT DISTINCT N', ' + pr.nombre
        FROM dbo.recipe_lines rl
        JOIN dbo.recipes  r  ON r.id = rl.recipe_id AND r.active = 1
        JOIN dbo.products pr ON pr.id = r.product_id AND pr.active = 1
        WHERE rl.ingredient_product_id = @product_id
        FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(600)'), 1, 2, N'');

    IF @usos IS NOT NULL
    BEGIN
        SET @msg = N'"' + @nombre + N'" se usa como ingrediente en: ' + @usos
                 + N'. Quitalo de esas recetas antes de darlo de baja.';
        RAISERROR(@msg, 16, 1);
        RETURN;
    END

    /* ---------------------------------------------------- MODIFICADORES
       ADD y SUBSTITUTE lo agregan; REMOVE y SUBSTITUTE lo reemplazan. En los
       cuatro casos la opcion quedaria apuntando a un producto retirado. */
    SET @usos = STUFF((
        SELECT DISTINCT N', ' + g.name + N' / ' + o.name
        FROM dbo.modifier_options o
        JOIN dbo.modifier_groups g ON g.id = o.group_id AND g.active = 1
        WHERE o.active = 1
          AND (o.ingredient_product_id = @product_id OR o.replaces_product_id = @product_id)
        FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(600)'), 1, 2, N'');

    IF @usos IS NOT NULL
    BEGIN
        SET @msg = N'"' + @nombre + N'" se usa en los modificadores: ' + @usos
                 + N'. Cambialos antes de darlo de baja.';
        RAISERROR(@msg, 16, 1);
        RETURN;
    END

    /* Sin dependencias vivas. El historico se queda donde esta: no se toca
       ninguna receta, ninguna venta y ningun movimiento de inventario. */
    UPDATE dbo.products
    SET active = 0
    WHERE id = @product_id;

    SELECT @product_id AS id, @nombre AS nombre;
END;
GO
