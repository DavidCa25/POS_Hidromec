/* sp_salud_producto_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* La ficha sanitaria de un producto: fracción (art. 226 LGS), si es
 * antibiótico, sustancia activa, registro sanitario y precio máximo.
 * Si requiere receta lo DERIVA la tabla (columna calculada): no se guarda
 * aparte para que no pueda contradecir a la fracción.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_producto_save]
    @product_id         INT,
    @fraccion           TINYINT       = NULL,
    @es_antibiotico     BIT           = 0,
    @sustancia_activa   NVARCHAR(160) = NULL,
    @presentacion       NVARCHAR(120) = NULL,
    @registro_sanitario NVARCHAR(40)  = NULL,
    @refrigeracion      BIT           = 0,
    @precio_maximo      DECIMAL(10,2) = NULL,
    @controla_lotes     BIT           = 1,
    @user_id            INT           = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
    BEGIN
        RAISERROR('El producto no existe.', 16, 1);
        RETURN;
    END
    IF @fraccion IS NOT NULL AND @fraccion NOT BETWEEN 1 AND 6
    BEGIN
        RAISERROR('La fracción va de I a VI.', 16, 1);
        RETURN;
    END
    IF @precio_maximo IS NOT NULL AND @precio_maximo < 0
    BEGIN
        RAISERROR('El precio máximo no puede ser negativo.', 16, 1);
        RETURN;
    END

    SET @sustancia_activa = NULLIF(LTRIM(RTRIM(@sustancia_activa)), N'');
    SET @presentacion = NULLIF(LTRIM(RTRIM(@presentacion)), N'');
    SET @registro_sanitario = NULLIF(LTRIM(RTRIM(@registro_sanitario)), N'');

    MERGE dbo.salud_productos AS d
    USING (SELECT @product_id AS product_id) AS s ON d.product_id = s.product_id
     WHEN MATCHED THEN
          UPDATE SET fraccion = @fraccion, es_antibiotico = ISNULL(@es_antibiotico, 0),
                     sustancia_activa = @sustancia_activa, presentacion = @presentacion,
                     registro_sanitario = @registro_sanitario, refrigeracion = ISNULL(@refrigeracion, 0),
                     precio_maximo = @precio_maximo, controla_lotes = ISNULL(@controla_lotes, 1),
                     updated_at = SYSDATETIME(), updated_by = @user_id
     WHEN NOT MATCHED THEN
          INSERT (product_id, fraccion, es_antibiotico, sustancia_activa, presentacion,
                  registro_sanitario, refrigeracion, precio_maximo, controla_lotes, updated_by)
          VALUES (@product_id, @fraccion, ISNULL(@es_antibiotico, 0), @sustancia_activa, @presentacion,
                  @registro_sanitario, ISNULL(@refrigeracion, 0), @precio_maximo, ISNULL(@controla_lotes, 1), @user_id);

    SELECT s.product_id, s.fraccion, s.es_antibiotico, s.sustancia_activa, s.presentacion,
           s.registro_sanitario, s.refrigeracion, s.precio_maximo, s.controla_lotes,
           s.requiere_receta, s.es_controlado
      FROM dbo.salud_productos s WHERE s.product_id = @product_id;
END
GO
