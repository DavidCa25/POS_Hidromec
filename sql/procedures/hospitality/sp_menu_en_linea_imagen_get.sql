/* sp_menu_en_linea_imagen_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0070 · Los bytes de una foto del menu: para subirla a la nube y para la
   vista previa de la pantalla Diseno del menu. */
CREATE OR ALTER PROCEDURE dbo.sp_menu_en_linea_imagen_get
    @id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT id, tipo, product_id, version, mime, data FROM dbo.menu_en_linea_imagenes WHERE id = @id;
END
GO
