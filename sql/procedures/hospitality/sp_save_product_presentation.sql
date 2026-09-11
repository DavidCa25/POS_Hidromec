/* sp_save_product_presentation
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Crea o actualiza una presentacion de compra. factor_to_base = cuantas
-- unidades BASE del producto trae una presentacion (Bolsa 1 kg de cafe en
-- gramos: 1000; Caja de 12 refrescos: 12).
CREATE OR ALTER PROCEDURE dbo.sp_save_product_presentation
    @id             INT = NULL,
    @product_id     INT,
    @name           NVARCHAR(60),
    @factor_to_base DECIMAL(14, 4),
    @is_default     BIT = 0,
    @active         BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @name = LTRIM(RTRIM(ISNULL(@name, '')));
    IF @name = '' BEGIN RAISERROR('La presentacion necesita un nombre.', 16, 1); RETURN; END
    IF ISNULL(@factor_to_base, 0) <= 0 BEGIN RAISERROR('El contenido por presentacion debe ser mayor a cero.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
    BEGIN RAISERROR('El producto no existe.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.product_presentations WHERE product_id = @product_id AND name = @name AND (@id IS NULL OR id <> @id))
    BEGIN RAISERROR('Ya existe una presentacion con ese nombre para este producto.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        IF @id IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.product_presentations WHERE id = @id AND product_id = @product_id)
        BEGIN
            INSERT INTO dbo.product_presentations (product_id, name, factor_to_base, is_default, active)
            VALUES (@product_id, @name, @factor_to_base, @is_default, @active);
            SET @id = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
            UPDATE dbo.product_presentations
               SET name = @name, factor_to_base = @factor_to_base, is_default = @is_default, active = @active
             WHERE id = @id;
        END
        IF @is_default = 1
            UPDATE dbo.product_presentations SET is_default = 0 WHERE product_id = @product_id AND id <> @id;
        COMMIT TRAN;
        SELECT @id AS id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
