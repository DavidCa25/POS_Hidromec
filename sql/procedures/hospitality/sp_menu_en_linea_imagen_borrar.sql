/* sp_menu_en_linea_imagen_borrar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0070 · Quitar una foto del menu (portada, logo, promo o la de un
   producto). La nube deja de ofrecerla en la siguiente publicacion. */
CREATE OR ALTER PROCEDURE dbo.sp_menu_en_linea_imagen_borrar
    @id INT
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.menu_en_linea_imagenes WHERE id = @id;
    SELECT @@ROWCOUNT AS borradas;
END
GO
