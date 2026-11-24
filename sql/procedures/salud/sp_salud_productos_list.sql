/* sp_salud_productos_list
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* La farmacia vista por su ficha sanitaria: existencia, cuánto tiene lote,
 * la caducidad más próxima y si el precio supera el máximo al público.
 *
 * Paginado por TOP y filtrado en SQL: una farmacia tiene miles de claves y
 * la pantalla nunca necesita todas a la vez. Los servicios (consulta,
 * limpieza) no son mercancía y no aparecen.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_productos_list]
    @buscar            NVARCHAR(100) = NULL,
    @solo_medicamentos BIT = 0,
    @top               INT = 200
AS
BEGIN
    SET NOCOUNT ON;
    SET @buscar = NULLIF(LTRIM(RTRIM(@buscar)), N'');
    IF @top IS NULL OR @top NOT BETWEEN 1 AND 1000 SET @top = 200;
    DECLARE @patron NVARCHAR(110) = N'%' + @buscar + N'%';

    ;WITH lotes AS (
        SELECT l.product_id,
               SUM(l.cantidad) AS en_lotes,
               MIN(CASE WHEN l.cantidad > 0 THEN l.caducidad END) AS proxima_caducidad
          FROM dbo.salud_lotes l
         GROUP BY l.product_id
    )
    SELECT TOP (@top)
           p.id AS product_id, p.nombre, p.part_number, p.bar_code, p.price,
           CAST(ISNULL(p.stock, 0) AS DECIMAL(12,3)) AS stock,
           s.fraccion, ISNULL(s.es_antibiotico, 0) AS es_antibiotico,
           s.sustancia_activa, s.presentacion, s.registro_sanitario,
           ISNULL(s.refrigeracion, 0) AS refrigeracion, s.precio_maximo,
           ISNULL(s.controla_lotes, 0) AS controla_lotes,
           ISNULL(s.requiere_receta, 0) AS requiere_receta,
           ISNULL(s.es_controlado, 0) AS es_controlado,
           CAST(CASE WHEN s.product_id IS NULL THEN 0 ELSE 1 END AS BIT) AS tiene_ficha,
           CAST(ISNULL(l.en_lotes, 0) AS DECIMAL(12,3)) AS en_lotes,
           CAST(CASE WHEN ISNULL(p.stock, 0) > ISNULL(l.en_lotes, 0)
                     THEN ISNULL(p.stock, 0) - ISNULL(l.en_lotes, 0) ELSE 0 END AS DECIMAL(12,3)) AS sin_lote,
           l.proxima_caducidad,
           CAST(CASE WHEN s.precio_maximo IS NOT NULL AND p.price > s.precio_maximo THEN 1 ELSE 0 END AS BIT) AS excede_maximo
      FROM dbo.products p
      LEFT JOIN dbo.salud_productos s ON s.product_id = p.id
      LEFT JOIN lotes l ON l.product_id = p.id
     WHERE p.active = 1
       AND ISNULL(p.inventory_mode, N'DIRECT') = N'DIRECT'
       AND NOT EXISTS (SELECT 1 FROM dbo.services sv WHERE sv.product_id = p.id)
       AND (@solo_medicamentos = 0 OR s.product_id IS NOT NULL)
       AND (@buscar IS NULL
            OR p.nombre LIKE @patron OR p.part_number LIKE @patron
            OR p.bar_code = @buscar OR s.sustancia_activa LIKE @patron)
     ORDER BY CASE WHEN s.product_id IS NULL THEN 1 ELSE 0 END, p.nombre;
END
GO
