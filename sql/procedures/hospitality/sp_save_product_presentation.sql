/* sp_save_product_presentation
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Crea o actualiza una presentacion. factor_to_base = cuantas unidades BASE
-- del producto trae una presentacion (Bolsa 1 kg de cafe en gramos: 1000;
-- Caja de 12 refrescos: 12).
--
-- 0089: una presentacion tambien se puede VENDER (el carton de 24 cervezas):
-- @con_venta = 1 escribe su codigo de barras y su precio de venta. Con
-- @con_venta = 0 (Compras, que solo da de alta la presentacion) esos dos
-- datos se conservan como estaban.
CREATE OR ALTER PROCEDURE dbo.sp_save_product_presentation
    @id             INT = NULL,
    @product_id     INT,
    @name           NVARCHAR(60),
    @factor_to_base DECIMAL(14, 4),
    @is_default     BIT = 0,
    @active         BIT = 1,
    @con_venta      BIT = 0,
    @bar_code       NVARCHAR(50) = NULL,
    @sale_price     DECIMAL(10, 2) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @name = LTRIM(RTRIM(ISNULL(@name, '')));
    SET @bar_code = NULLIF(LTRIM(RTRIM(@bar_code)), N'');
    IF @name = '' BEGIN RAISERROR('La presentacion necesita un nombre.', 16, 1); RETURN; END
    IF ISNULL(@factor_to_base, 0) <= 0 BEGIN RAISERROR('El contenido por presentacion debe ser mayor a cero.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
    BEGIN RAISERROR('El producto no existe.', 16, 1); RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.product_presentations WHERE product_id = @product_id AND name = @name AND (@id IS NULL OR id <> @id))
    BEGIN RAISERROR('Ya existe una presentacion con ese nombre para este producto.', 16, 1); RETURN; END

    IF @con_venta = 1
    BEGIN
        IF @bar_code IS NOT NULL AND @sale_price IS NULL
        BEGIN RAISERROR('Escribe el precio de venta de la presentación que lleva código de barras.', 16, 1); RETURN; END
        IF @sale_price IS NOT NULL AND (@sale_price < 0 OR @factor_to_base < 2 OR @factor_to_base > 1000 OR @factor_to_base <> ROUND(@factor_to_base, 0))
        BEGIN RAISERROR('Para venderse, la presentación trae de 2 a 1000 piezas enteras.', 16, 1); RETURN; END
        IF @bar_code IS NOT NULL AND (
               EXISTS (SELECT 1 FROM dbo.products WHERE LTRIM(RTRIM(bar_code)) = @bar_code)
            OR EXISTS (SELECT 1 FROM dbo.product_presentations WHERE bar_code = @bar_code AND (@id IS NULL OR id <> @id)))
        BEGIN RAISERROR('Ese código de barras ya es de otro producto o presentación.', 16, 1); RETURN; END
    END

    BEGIN TRY
        BEGIN TRAN;
        IF @id IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.product_presentations WHERE id = @id AND product_id = @product_id)
        BEGIN
            INSERT INTO dbo.product_presentations (product_id, name, factor_to_base, is_default, active, bar_code, sale_price)
            VALUES (@product_id, @name, @factor_to_base, @is_default, @active,
                    CASE WHEN @con_venta = 1 THEN @bar_code END, CASE WHEN @con_venta = 1 THEN @sale_price END);
            SET @id = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
            UPDATE dbo.product_presentations
               SET name = @name, factor_to_base = @factor_to_base, is_default = @is_default, active = @active,
                   bar_code   = CASE WHEN @con_venta = 1 THEN @bar_code   ELSE bar_code   END,
                   sale_price = CASE WHEN @con_venta = 1 THEN @sale_price ELSE sale_price END
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
