/* sp_menu_en_linea_imagen_guardar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0070 · Guardar una foto grande del menu (ya reducida por la caja).

   PORTADA y LOGO son una cada una; PRODUCTO, una por producto: guardar otra
   la reemplaza y sube la version (asi la nube sabe que debe pedirla). PROMO
   son hasta 5: con @id se edita esa (con @data NULL solo cambian titulo,
   producto u orden); sin @id se agrega. */
CREATE OR ALTER PROCEDURE dbo.sp_menu_en_linea_imagen_guardar
    @tipo NVARCHAR(10),
    @id INT = NULL,
    @product_id INT = NULL,
    @titulo NVARCHAR(60) = NULL,
    @subtitulo NVARCHAR(120) = NULL,
    @orden INT = NULL,
    @mime NVARCHAR(20) = NULL,
    @data VARBINARY(MAX) = NULL,
    @ancho INT = NULL,
    @alto INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @tipo = UPPER(LTRIM(RTRIM(ISNULL(@tipo, ''))));
    IF @tipo NOT IN ('PORTADA', 'LOGO', 'PROMO', 'PRODUCTO')
    BEGIN RAISERROR('Tipo de imagen no válido.', 16, 1); RETURN; END
    IF @tipo = 'PRODUCTO' AND NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
    BEGIN RAISERROR('El producto no existe.', 16, 1); RETURN; END
    IF @tipo = 'PROMO' AND @product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id AND active = 1)
    BEGIN RAISERROR('El producto de la promoción no existe.', 16, 1); RETURN; END
    IF @data IS NOT NULL AND DATALENGTH(@data) > 460800
    BEGIN RAISERROR('La imagen pesa demasiado.', 16, 1); RETURN; END
    IF @data IS NULL AND NOT (@tipo = 'PROMO' AND @id IS NOT NULL)
    BEGIN RAISERROR('Falta la imagen.', 16, 1); RETURN; END

    DECLARE @actual INT;
    BEGIN TRAN;
    IF @tipo = 'PROMO'
    BEGIN
        IF @id IS NOT NULL
        BEGIN
            SELECT @actual = id FROM dbo.menu_en_linea_imagenes WITH (UPDLOCK, HOLDLOCK) WHERE id = @id AND tipo = 'PROMO';
            IF @actual IS NULL BEGIN ROLLBACK TRAN; RAISERROR('La promoción no existe.', 16, 1); RETURN; END
        END
        ELSE IF (SELECT COUNT(*) FROM dbo.menu_en_linea_imagenes WITH (UPDLOCK, HOLDLOCK) WHERE tipo = 'PROMO') >= 5
        BEGIN ROLLBACK TRAN; RAISERROR('Ya tienes 5 promociones. Quita una para agregar otra.', 16, 1); RETURN; END
    END
    ELSE
        SELECT @actual = id FROM dbo.menu_en_linea_imagenes WITH (UPDLOCK, HOLDLOCK)
         WHERE tipo = @tipo AND (@tipo <> 'PRODUCTO' OR product_id = @product_id);

    IF @actual IS NULL
    BEGIN
        INSERT INTO dbo.menu_en_linea_imagenes (tipo, product_id, titulo, subtitulo, orden, mime, data, ancho, alto)
        VALUES (@tipo, CASE WHEN @tipo IN ('PRODUCTO', 'PROMO') THEN @product_id END,
                NULLIF(LTRIM(RTRIM(@titulo)), ''), NULLIF(LTRIM(RTRIM(@subtitulo)), ''), ISNULL(@orden, 0),
                @mime, @data, @ancho, @alto);
        SET @actual = SCOPE_IDENTITY();
    END
    ELSE
        UPDATE dbo.menu_en_linea_imagenes
           SET titulo = CASE WHEN @tipo = 'PROMO' THEN NULLIF(LTRIM(RTRIM(@titulo)), '') ELSE titulo END,
               subtitulo = CASE WHEN @tipo = 'PROMO' THEN NULLIF(LTRIM(RTRIM(@subtitulo)), '') ELSE subtitulo END,
               product_id = CASE WHEN @tipo = 'PROMO' THEN @product_id ELSE product_id END,
               orden = ISNULL(@orden, orden),
               mime = ISNULL(@mime, mime), data = ISNULL(@data, data),
               ancho = ISNULL(@ancho, ancho), alto = ISNULL(@alto, alto),
               version = version + CASE WHEN @data IS NOT NULL THEN 1 ELSE 0 END,
               actualizado_en = SYSDATETIME()
         WHERE id = @actual;
    COMMIT TRAN;

    SELECT id, tipo, product_id, titulo, subtitulo, orden, version, ancho, alto
      FROM dbo.menu_en_linea_imagenes WHERE id = @actual;
END
GO
