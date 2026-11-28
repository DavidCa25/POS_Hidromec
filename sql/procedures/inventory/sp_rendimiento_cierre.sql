/* sp_rendimiento_cierre
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0095 · LO QUE EL CORTE PREGUNTA: «¿CUÁNTA CARNE TE QUEDÓ?»

   Por cada carne activa, desde su último conteo (o desde que se encendió):

     tenia_kg      lo que hay en inventario: lo que quedó la última vez más lo
                   que se compró desde entonces (menos mermas, si las hubo).
     comprado_kg   lo que entró por compras en ese tiempo.
     vendidos      tacos vendidos de esa carne (platillo × sus tacos), menos
                   los devueltos. Una noche que no se contó se suma a esta.
     precio_taco   lo que se cobró en promedio por cada taco: para decir en
                   pesos lo que se fue.
     contado       1 si este corte ya la contó; entonces trae lo que se dijo.

   Solo lee (salvo refrescar el mapeo de platillos, para que uno nuevo del
   menú cuente desde hoy). */
CREATE OR ALTER PROCEDURE dbo.sp_rendimiento_cierre
    @closure_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    EXEC dbo.sp_rendimiento_mapear;

    ;WITH base AS (
        SELECT c.product_id AS carne_id, p.nombre, c.rinde, p.stock, ISNULL(p.cost, 0) AS costo_g,
               ISNULL((SELECT MAX(k.contado_en) FROM dbo.rendimiento_conteos k
                        WHERE k.carne_id = c.product_id
                          AND (@closure_id IS NULL OR k.closure_id IS NULL OR k.closure_id <> @closure_id)), c.desde) AS desde,
               hecho.id AS conteo_id, hecho.tenia AS h_tenia, hecho.quedo AS h_quedo, hecho.vendidos AS h_vendidos
          FROM dbo.rendimiento_carnes c
          JOIN dbo.products p ON p.id = c.product_id
          OUTER APPLY (SELECT TOP 1 k.id, k.tenia, k.quedo, k.vendidos FROM dbo.rendimiento_conteos k
                        WHERE @closure_id IS NOT NULL AND k.carne_id = c.product_id AND k.closure_id = @closure_id) hecho
         WHERE c.activo = 1)
    SELECT b.carne_id, b.nombre, b.rinde, b.desde,
           CAST(ISNULL(b.h_tenia, b.stock) / 1000.0 AS DECIMAL(12, 3)) AS tenia_kg,
           CAST(ISNULL((SELECT SUM(m.quantity) FROM dbo.inventory_movements m
                         WHERE m.product_id = b.carne_id AND m.source = 'PURCHASE' AND m.typee = 'entrada'
                           AND m.datee >= b.desde), 0) / 1000.0 AS DECIMAL(12, 3)) AS comprado_kg,
           CAST(ISNULL(b.h_vendidos, ISNULL(v.tacos, 0) - ISNULL(r.tacos, 0)) AS DECIMAL(12, 2)) AS vendidos,
           CAST(v.cobrado / NULLIF(v.tacos, 0) AS DECIMAL(10, 2)) AS precio_taco,
           CAST(b.costo_g * 1000 AS DECIMAL(12, 2)) AS costo_kg,
           CAST(CASE WHEN b.conteo_id IS NULL THEN 0 ELSE 1 END AS BIT) AS contado,
           CAST(b.h_quedo / 1000.0 AS DECIMAL(12, 3)) AS quedo_kg
      FROM base b
      OUTER APPLY (SELECT SUM(d.quantity * rp.tacos) AS tacos, SUM(ISNULL(d.subtotal, d.quantity * d.unitary_price)) AS cobrado
                     FROM dbo.sale_detail d
                     JOIN dbo.sales s ON s.id = d.sale_id
                     JOIN dbo.rendimiento_platillos rp ON rp.product_id = d.product_id AND rp.carne_id = b.carne_id
                    WHERE s.datee >= b.desde) v
      OUTER APPLY (SELECT SUM(rd.quantity * rp.tacos) AS tacos
                     FROM dbo.sale_refund_detail rd
                     JOIN dbo.sale_refunds f ON f.id = rd.refund_id
                     JOIN dbo.rendimiento_platillos rp ON rp.product_id = rd.product_id AND rp.carne_id = b.carne_id
                    WHERE f.datee >= b.desde) r
     ORDER BY b.nombre;
END;
GO
