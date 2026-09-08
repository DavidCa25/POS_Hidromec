/* sp_set_product_image
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Guarda (o quita, con @thumb NULL) la miniatura de un producto. La miniatura
-- vive en SQL para que TODAS las cajas de la sucursal la vean, viaje en el
-- respaldo y funcione sin red; cada caja la cachea en disco por version.
-- La app la reduce antes (<= 64 KB, ver CK_product_images_size).
CREATE OR ALTER PROCEDURE dbo.sp_set_product_image
    @product_id INT,
    @thumb      VARBINARY(MAX) = NULL,
    @mime       NVARCHAR(30) = 'image/jpeg',
    @width      INT = 0,
    @height     INT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
    BEGIN RAISERROR('El producto no existe.', 16, 1); RETURN; END
    IF @thumb IS NOT NULL AND DATALENGTH(@thumb) > 65536
    BEGIN RAISERROR('La miniatura supera 64 KB. Reduce la imagen antes de guardarla.', 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        DECLARE @version INT;
        UPDATE dbo.products SET image_version = image_version + 1, @version = image_version + 1 WHERE id = @product_id;

        IF @thumb IS NULL
        BEGIN
            DELETE FROM dbo.product_images WHERE product_id = @product_id;
        END
        ELSE IF EXISTS (SELECT 1 FROM dbo.product_images WHERE product_id = @product_id)
        BEGIN
            UPDATE dbo.product_images
               SET thumb = @thumb, mime = ISNULL(@mime, 'image/jpeg'), width = ISNULL(@width, 0), height = ISNULL(@height, 0),
                   version = @version, updated_at = SYSDATETIME()
             WHERE product_id = @product_id;
        END
        ELSE
        BEGIN
            INSERT INTO dbo.product_images (product_id, thumb, mime, width, height, version)
            VALUES (@product_id, @thumb, ISNULL(@mime, 'image/jpeg'), ISNULL(@width, 0), ISNULL(@height, 0), @version);
        END
        COMMIT TRAN;
        SELECT @product_id AS product_id, @version AS image_version, CASE WHEN @thumb IS NULL THEN 0 ELSE 1 END AS has_image;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO
