/* sp_kds_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Igual que en 0040; la cocina canta el mismo numero que ve el cliente. */
CREATE OR ALTER PROCEDURE dbo.sp_kds_get
    @station_id INT = NULL,
    @comanda_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @k TABLE (id INT PRIMARY KEY);
    INSERT INTO @k (id)
    SELECT k.id FROM dbo.comandas k
     WHERE (@comanda_id IS NOT NULL AND k.id = @comanda_id)
        OR (@comanda_id IS NULL
            AND k.estado IN ('NUEVA', 'PREPARANDO', 'LISTA')
            AND (@station_id IS NULL OR k.station_id = @station_id));

    SELECT k.id, k.orden_id, k.cuenta_id, k.station_id, s.nombre AS estacion, k.estado,
           k.creada_en, k.empezada_en, k.lista_en, k.entregada_en,
           DATEDIFF(SECOND, k.creada_en, SYSDATETIME()) AS segundos,
           COALESCE(m.nombre,
                    CASE WHEN c.numero_dia IS NOT NULL
                         THEN CONCAT(N'Pedido ', c.numero_dia, CASE WHEN c.etiqueta IS NOT NULL THEN N' · ' + c.etiqueta END) END,
                    c.etiqueta, CONCAT(N'Cuenta ', c.id)) AS destino,
           c.numero_dia,
           a.nombre AS area
      FROM @k x
      JOIN dbo.comandas k ON k.id = x.id
      JOIN dbo.prep_stations s ON s.id = k.station_id
      JOIN dbo.hosp_cuentas c ON c.id = k.cuenta_id
      LEFT JOIN dbo.salon_mesas m ON m.id = c.mesa_id
      LEFT JOIN dbo.salon_areas a ON a.id = m.area_id
     ORDER BY k.creada_en, k.id;

    SELECT l.comanda_id, l.id, l.nombre, l.cantidad, l.nota, l.estado
      FROM dbo.hosp_orden_lineas l
      JOIN @k x ON x.id = l.comanda_id
     ORDER BY l.comanda_id, l.id;

    SELECT l.comanda_id, o.linea_id, o.group_name, o.option_name, o.quantity
      FROM dbo.hosp_orden_linea_opciones o
      JOIN dbo.hosp_orden_lineas l ON l.id = o.linea_id
      JOIN @k x ON x.id = l.comanda_id
     ORDER BY o.linea_id, o.id;
END
GO
