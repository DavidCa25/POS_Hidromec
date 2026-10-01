/* sp_hosp_cuenta_get
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Igual que en 0046, mas el cliente. Esto lo lee la CAJA (privada): lleva el
   nombre completo, que es el que el cajero reconoce. Nunca el codigo de
   seguimiento. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_get
    @cuenta_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.id, c.mesa_id, m.nombre AS mesa, a.nombre AS area,
           COALESCE(m.nombre,
                    CASE WHEN c.numero_dia IS NOT NULL
                         THEN CONCAT(N'Pedido ', c.numero_dia, CASE WHEN c.etiqueta IS NOT NULL THEN N' · ' + c.etiqueta END) END,
                    c.etiqueta) AS titulo,
           c.etiqueta, c.numero_dia, c.estado, c.personas, c.abierta_en, c.abierta_por, c.cerrada_en, c.sale_id,
           c.customer_id, cu.customerName AS customer_name,
           DATEDIFF(MINUTE, c.abierta_en, SYSDATETIME()) AS minutos
      FROM dbo.hosp_cuentas c
      LEFT JOIN dbo.salon_mesas m ON m.id = c.mesa_id
      LEFT JOIN dbo.salon_areas a ON a.id = m.area_id
      LEFT JOIN dbo.customers cu ON cu.id = c.customer_id
     WHERE c.id = @cuenta_id;

    SELECT l.id, l.orden_id, l.product_id, l.nombre, l.cantidad, l.precio_unitario, l.nota,
           l.station_id, s.nombre AS estacion, l.comanda_id, k.estado AS comanda_estado, l.estado,
           l.origen, o.enviada_en,
           p.inventory_mode, p.clave_prod_serv, p.clave_unidad, p.objeto_impuesto, p.tasa_iva
      FROM dbo.hosp_orden_lineas l
      JOIN dbo.hosp_ordenes o ON o.id = l.orden_id
      JOIN dbo.products p ON p.id = l.product_id
      LEFT JOIN dbo.prep_stations s ON s.id = l.station_id
      LEFT JOIN dbo.comandas k ON k.id = l.comanda_id
     WHERE l.cuenta_id = @cuenta_id
     ORDER BY l.orden_id, l.id;

    SELECT x.linea_id, x.modifier_option_id, x.group_id, x.group_name, x.option_name, x.price_delta, x.quantity
      FROM dbo.hosp_orden_linea_opciones x
      JOIN dbo.hosp_orden_lineas l ON l.id = x.linea_id
     WHERE l.cuenta_id = @cuenta_id
     ORDER BY x.linea_id, x.id;

    SELECT k.id, k.orden_id, k.station_id, s.nombre AS estacion, k.estado, k.creada_en, k.lista_en, k.entregada_en
      FROM dbo.comandas k
      JOIN dbo.prep_stations s ON s.id = k.station_id
     WHERE k.cuenta_id = @cuenta_id
     ORDER BY k.id;
END
GO
