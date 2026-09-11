-- Reorden inteligente: predice qué productos se van a acabar según su velocidad de venta.
-- IMPORTANTE: confirma el nombre de la tabla de DETALLE de venta (aquí "sale_detail")
-- y de la tabla de ventas ("sales" con columnas id y datee). Si tu detalle usa otro
-- nombre (p.ej. sales_detail / detalle_venta), cámbialo en el WITH de abajo.

CREATE OR ALTER PROCEDURE sp_reorder_suggestions
  @dias_ventana   INT = 30,   -- ventana para medir la velocidad de venta
  @dias_alerta    INT = 7,    -- alerta si se acaba en <= estos días
  @dias_objetivo  INT = 30    -- pedir lo necesario para cubrir estos días
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH ventas AS (
      SELECT sd.product_id, SUM(sd.quantity) AS vendido
      FROM sale_detail sd                          -- << CONFIRMA esta tabla
      INNER JOIN sales s ON s.id = sd.sale_id
      WHERE s.datee >= DATEADD(DAY, -@dias_ventana, CAST(GETDATE() AS DATE))
      GROUP BY sd.product_id
  )
  SELECT
      p.id,
      p.nombre,
      p.stock,
      v.vendido AS vendido_ventana,
      CAST(v.vendido * 1.0 / NULLIF(@dias_ventana, 0) AS DECIMAL(12,2)) AS prom_diario,
      CAST(p.stock / NULLIF(v.vendido * 1.0 / @dias_ventana, 0) AS INT)  AS dias_restantes,
      CASE
        WHEN CEILING(v.vendido * 1.0 / @dias_ventana * @dias_objetivo) - p.stock > 0
        THEN CEILING(v.vendido * 1.0 / @dias_ventana * @dias_objetivo) - p.stock
        ELSE 0
      END AS sugerido
  FROM products p
  INNER JOIN ventas v ON v.product_id = p.id
  WHERE p.active = 1
    AND v.vendido > 0
    AND (p.stock / NULLIF(v.vendido * 1.0 / @dias_ventana, 0)) <= @dias_alerta
  ORDER BY dias_restantes ASC;
END
