/* sp_salud_estudios_catalogo
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Los estudios que ofrece el negocio, con su precio y su ficha.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_estudios_catalogo]
    @buscar NVARCHAR(100) = NULL,
    @tipo   NVARCHAR(10)  = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @buscar = NULLIF(LTRIM(RTRIM(@buscar)), N'');
    SELECT e.product_id, p.nombre, p.price AS precio, p.tasa_iva,
           CAST(CASE WHEN p.tasa_iva = 0 AND p.iva_exento = 1 THEN 1 ELSE 0 END AS BIT) AS iva_exento,
           e.tipo, e.modalidad, e.preparacion, e.muestra, e.entrega_horas, e.parametros
      FROM dbo.salud_estudios e
      JOIN dbo.products p ON p.id = e.product_id
     WHERE p.active = 1
       AND (@tipo IS NULL OR e.tipo = @tipo)
       AND (@buscar IS NULL OR p.nombre LIKE N'%' + @buscar + N'%')
     ORDER BY e.tipo, p.nombre;
END
GO
