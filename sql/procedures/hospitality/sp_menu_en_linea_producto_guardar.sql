/* sp_menu_en_linea_producto_guardar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0070 · Lo que el menu en linea dice de un producto: descripcion,
   etiquetas (lista separada por comas de NUEVO, RECOMENDADO, PICANTE,
   VEGETARIANO), destacado y oculto. No toca el producto de la caja. */
CREATE OR ALTER PROCEDURE dbo.sp_menu_en_linea_producto_guardar
    @product_id INT,
    @descripcion NVARCHAR(300) = NULL,
    @etiquetas NVARCHAR(100) = NULL,
    @destacado BIT = 0,
    @oculto BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE id = @product_id)
    BEGIN RAISERROR('El producto no existe.', 16, 1); RETURN; END

    SET @etiquetas = NULLIF(UPPER(REPLACE(LTRIM(RTRIM(ISNULL(@etiquetas, ''))), ' ', '')), '');
    IF EXISTS (SELECT 1 FROM STRING_SPLIT(ISNULL(@etiquetas, ''), ',')
                WHERE value <> '' AND value NOT IN ('NUEVO', 'RECOMENDADO', 'PICANTE', 'VEGETARIANO'))
    BEGIN RAISERROR('Etiqueta no válida.', 16, 1); RETURN; END

    MERGE dbo.menu_en_linea_productos AS d
    USING (SELECT @product_id AS product_id) AS s ON d.product_id = s.product_id
    WHEN MATCHED THEN UPDATE SET descripcion = NULLIF(LTRIM(RTRIM(@descripcion)), ''), etiquetas = @etiquetas,
                                 destacado = ISNULL(@destacado, 0), oculto = ISNULL(@oculto, 0), actualizado_en = SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT (product_id, descripcion, etiquetas, destacado, oculto)
                          VALUES (@product_id, NULLIF(LTRIM(RTRIM(@descripcion)), ''), @etiquetas, ISNULL(@destacado, 0), ISNULL(@oculto, 0));

    SELECT product_id, descripcion, etiquetas, destacado, oculto FROM dbo.menu_en_linea_productos WHERE product_id = @product_id;
END
GO
