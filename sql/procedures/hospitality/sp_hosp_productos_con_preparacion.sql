/* sp_hosp_productos_con_preparacion
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Que productos de una lista van a preparacion: los que tienen una estacion
   ACTIVA. Es la MISMA regla con la que `sp_hosp_orden_enviar` crea comandas;
   la caja la usa para no dejar cobrar en silencio algo que la cocina nunca
   recibio. Un producto sin estacion (una botella de agua) no cuenta. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_productos_con_preparacion
    @ids NVARCHAR(2000)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @x XML = CAST(N'<i>' + REPLACE(ISNULL(@ids, N''), N',', N'</i><i>') + N'</i>' AS XML);
    SELECT DISTINCT pp.product_id
      FROM (SELECT TRY_CAST(t.v.value('.', 'NVARCHAR(12)') AS INT) AS id FROM @x.nodes('/i') t(v)) x
      JOIN dbo.product_prep_station pp ON pp.product_id = x.id
      JOIN dbo.prep_stations st ON st.id = pp.station_id AND st.activa = 1;
END
GO
