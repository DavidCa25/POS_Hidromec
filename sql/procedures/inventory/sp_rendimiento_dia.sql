/* sp_rendimiento_dia
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0095 · CÓMO RINDIÓ LA CARNE EN UN CORTE.

   Sin @closure_id: los conteos más recientes de cada carne.

   1  por carne: lo que había, quedó y se usó (kg), tacos vendidos y los que
      debieron salir (usado × rinde), cuántos faltan (o sobran) y cuánto es
      en pesos al precio promedio del taco, cuánto rindió de verdad el kilo,
      la carne de cada taco en pesos y un veredicto:
        FALTA   faltan más de 3 tacos y más del 3 %
        SOBRA   rindió de más por lo mismo
        NORMAL  lo demás
   2  sugerencias: una carne que en sus últimos conteos (5 o más) rindió en
      promedio un 3 % o más distinto de su número, con el número sugerido
      (redondeado a medio taco). */
CREATE OR ALTER PROCEDURE dbo.sp_rendimiento_dia
    @closure_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH k AS (
        SELECT k.*, ROW_NUMBER() OVER (PARTITION BY k.carne_id ORDER BY k.contado_en DESC, k.id DESC) AS rn
          FROM dbo.rendimiento_conteos k
         WHERE @closure_id IS NULL OR k.closure_id = @closure_id),
    c AS (
        SELECT k.id, k.carne_id, p.nombre, k.contado_en, k.rinde, k.vendidos, k.precio_taco,
               k.tenia / 1000.0 AS tenia_kg, k.quedo / 1000.0 AS quedo_kg, k.usado / 1000.0 AS usado_kg,
               k.usado * k.costo_g AS costo,
               k.usado / 1000.0 * k.rinde AS esperados
          FROM k JOIN dbo.products p ON p.id = k.carne_id
         WHERE k.rn = 1)
    SELECT id AS conteo_id, carne_id, nombre, contado_en, rinde,
           CAST(tenia_kg AS DECIMAL(12, 3)) AS tenia_kg, CAST(quedo_kg AS DECIMAL(12, 3)) AS quedo_kg,
           CAST(usado_kg AS DECIMAL(12, 3)) AS usado_kg,
           CAST(vendidos AS DECIMAL(12, 2)) AS vendidos,
           CAST(ROUND(esperados, 0) AS DECIMAL(12, 0)) AS esperados,
           CAST(ROUND(esperados - vendidos, 0) AS DECIMAL(12, 0)) AS faltan,
           CAST(ROUND(ROUND(esperados - vendidos, 0) * ISNULL(precio_taco, 0), 2) AS DECIMAL(12, 2)) AS valor_faltante,
           CAST(vendidos / NULLIF(usado_kg, 0) AS DECIMAL(8, 2)) AS rinde_real,
           CAST(costo / NULLIF(vendidos, 0) AS DECIMAL(10, 2)) AS costo_taco,
           precio_taco,
           CAST(costo AS DECIMAL(12, 2)) AS costo_carne,
           CASE WHEN esperados - vendidos > 3 AND esperados - vendidos > esperados * 0.03 THEN 'FALTA'
                WHEN vendidos - esperados > 3 AND vendidos - esperados > esperados * 0.03 THEN 'SOBRA'
                ELSE 'NORMAL' END AS veredicto
      FROM c
     ORDER BY CASE WHEN esperados - vendidos > 3 THEN 0 ELSE 1 END, nombre;

    ;WITH ult AS (
        SELECT k.carne_id, k.vendidos / NULLIF(k.usado / 1000.0, 0) AS real_,
               ROW_NUMBER() OVER (PARTITION BY k.carne_id ORDER BY k.contado_en DESC, k.id DESC) AS rn
          FROM dbo.rendimiento_conteos k
         WHERE k.usado > 0 AND k.vendidos > 0),
    prom AS (
        SELECT carne_id, AVG(real_) AS promedio, COUNT(*) AS conteos FROM ult WHERE rn <= 6 GROUP BY carne_id)
    SELECT c.product_id AS carne_id, p.nombre, c.rinde, x.conteos,
           CAST(x.promedio AS DECIMAL(8, 2)) AS promedio,
           CAST(ROUND(x.promedio * 2, 0) / 2 AS DECIMAL(6, 2)) AS sugerido
      FROM prom x
      JOIN dbo.rendimiento_carnes c ON c.product_id = x.carne_id AND c.activo = 1
      JOIN dbo.products p ON p.id = c.product_id
     WHERE x.conteos >= 5
       AND ABS(x.promedio - c.rinde) >= c.rinde * 0.03
       AND ROUND(x.promedio * 2, 0) / 2 <> c.rinde;
END;
GO
