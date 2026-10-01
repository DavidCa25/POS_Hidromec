/* sp_prep_stations_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_prep_stations_get
AS
BEGIN
    SET NOCOUNT ON;
    SELECT s.id, s.nombre, s.salida, s.impresora, s.ancho_mm, s.orden,
           (SELECT COUNT(*) FROM dbo.product_prep_station p WHERE p.station_id = s.id) AS productos
      FROM dbo.prep_stations s
     WHERE s.activa = 1
     ORDER BY s.orden, s.nombre;
END
GO
