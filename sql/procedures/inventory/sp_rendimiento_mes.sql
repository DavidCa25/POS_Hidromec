/* sp_rendimiento_mes
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0095 · LA CARNE DE UN PERIODO: CUÁNTO SE COMPRÓ, CUÁNTO RINDIÓ, CUÁNTO SE FUE.

   Por los conteos del cierre que caen en el periodo (por el día en que se
   contaron), y las compras por el día en que entraron.

   1  resumen, del periodo y del anterior del mismo largo: kilos y pesos
      comprados, tacos vendidos (las órdenes cuentan sus tacos), tacos que
      se fueron sin cobrar y cuánto es, la carne de cada taco y las noches
      cerradas sin contestar.
   2  por día de la semana (0 = lunes): tacos que se fueron y su valor.
   3  por carne: usada, vendidos, rindió contra su número, lo que se fue. */
CREATE OR ALTER PROCEDURE dbo.sp_rendimiento_mes
    @desde DATE = NULL,
    @hasta DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @hasta IS NULL SET @hasta = CAST(GETDATE() AS DATE);
    IF @desde IS NULL SET @desde = DATEFROMPARTS(YEAR(@hasta), MONTH(@hasta), 1);
    IF @desde > @hasta THROW 51000, 'La fecha inicial no puede ser posterior a la final.', 1;
    IF DATEDIFF(DAY, @desde, @hasta) > 366 THROW 51000, 'El periodo maximo es de un ano.', 1;

    DECLARE @dias INT = DATEDIFF(DAY, @desde, @hasta) + 1;
    DECLARE @ant_desde DATE = DATEADD(DAY, -@dias, @desde), @ant_hasta DATE = DATEADD(DAY, -1, @desde);

    SELECT k.carne_id, CAST(k.contado_en AS DATE) AS dia,
           CASE WHEN k.contado_en >= @desde THEN 1 ELSE 0 END AS actual,
           k.usado, k.vendidos, k.usado * k.costo_g AS costo,
           ROUND(k.usado / 1000.0 * k.rinde - k.vendidos, 0) AS faltan,
           ISNULL(k.precio_taco, 0) AS precio_taco
      INTO #k
      FROM dbo.rendimiento_conteos k
     WHERE k.contado_en >= @ant_desde AND k.contado_en < DATEADD(DAY, 1, @hasta);

    SELECT m.product_id AS carne_id, CASE WHEN m.datee >= @desde THEN 1 ELSE 0 END AS actual,
           m.quantity, m.quantity * ISNULL(m.unit_cost, 0) AS importe
      INTO #c
      FROM dbo.inventory_movements m
      JOIN dbo.rendimiento_carnes c ON c.product_id = m.product_id
     WHERE m.source = 'PURCHASE' AND m.typee = 'entrada'
       AND m.datee >= @ant_desde AND m.datee < DATEADD(DAY, 1, @hasta);

    ;WITH per AS (SELECT 1 AS actual UNION ALL SELECT 0)
    SELECT CASE WHEN per.actual = 1 THEN 'ACTUAL' ELSE 'ANTERIOR' END AS periodo,
           CASE WHEN per.actual = 1 THEN @desde ELSE @ant_desde END AS desde,
           CASE WHEN per.actual = 1 THEN @hasta ELSE @ant_hasta END AS hasta,
           CAST(ISNULL((SELECT SUM(quantity) FROM #c WHERE actual = per.actual), 0) / 1000.0 AS DECIMAL(12, 2)) AS comprado_kg,
           CAST(ISNULL((SELECT SUM(importe) FROM #c WHERE actual = per.actual), 0) AS DECIMAL(12, 2)) AS comprado,
           CAST(ISNULL((SELECT SUM(vendidos) FROM #k WHERE actual = per.actual), 0) AS DECIMAL(12, 0)) AS tacos,
           CAST(ISNULL((SELECT SUM(faltan) FROM #k WHERE actual = per.actual AND faltan > 0), 0) AS DECIMAL(12, 0)) AS se_fueron,
           CAST(ISNULL((SELECT SUM(faltan * precio_taco) FROM #k WHERE actual = per.actual AND faltan > 0), 0) AS DECIMAL(12, 2)) AS valor_se_fueron,
           CAST(ISNULL((SELECT SUM(costo) FROM #k WHERE actual = per.actual), 0) AS DECIMAL(12, 2)) AS costo_carne,
           CAST((SELECT SUM(costo) FROM #k WHERE actual = per.actual) / NULLIF((SELECT SUM(vendidos) FROM #k WHERE actual = per.actual), 0) AS DECIMAL(10, 2)) AS costo_taco,
           /* Qué parte de la carne usada se fue: tacos perdidos entre los que debieron salir. */
           CAST(100.0 * ISNULL((SELECT SUM(faltan) FROM #k WHERE actual = per.actual AND faltan > 0), 0)
                / NULLIF((SELECT SUM(vendidos + faltan) FROM #k WHERE actual = per.actual), 0) AS DECIMAL(8, 2)) AS pct_perdido,
           (SELECT COUNT(*) FROM dbo.cash_closures z
             WHERE z.closed_at IS NOT NULL
               AND z.closed_at >= CASE WHEN per.actual = 1 THEN @desde ELSE @ant_desde END
               AND z.closed_at < DATEADD(DAY, 1, CASE WHEN per.actual = 1 THEN @hasta ELSE @ant_hasta END)
               AND z.closed_at >= (SELECT MIN(desde) FROM dbo.rendimiento_carnes WHERE activo = 1)
               AND NOT EXISTS (SELECT 1 FROM dbo.rendimiento_conteos k WHERE k.closure_id = z.id)) AS noches_sin_contar
      FROM per
     ORDER BY per.actual DESC;

    /* 0 = lunes, sin depender de SET DATEFIRST: el 1900-01-01 fue lunes. */
    ;WITH d AS (SELECT 0 AS dow UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6)
    SELECT d.dow,
           CAST(ISNULL(SUM(CASE WHEN k.faltan > 0 THEN k.faltan END), 0) AS DECIMAL(12, 0)) AS se_fueron,
           CAST(ISNULL(SUM(CASE WHEN k.faltan > 0 THEN k.faltan * k.precio_taco END), 0) AS DECIMAL(12, 2)) AS valor
      FROM d
      LEFT JOIN #k k ON k.actual = 1 AND DATEDIFF(DAY, '19000101', k.dia) % 7 = d.dow
     GROUP BY d.dow
     ORDER BY d.dow;

    SELECT c.product_id AS carne_id, p.nombre, c.rinde, c.activo,
           CAST(ISNULL(SUM(k.usado), 0) / 1000.0 AS DECIMAL(12, 2)) AS usado_kg,
           CAST(ISNULL(SUM(k.vendidos), 0) AS DECIMAL(12, 0)) AS vendidos,
           CAST(SUM(k.vendidos) / NULLIF(SUM(k.usado) / 1000.0, 0) AS DECIMAL(8, 2)) AS rinde_real,
           CAST(ISNULL(SUM(CASE WHEN k.faltan > 0 THEN k.faltan END), 0) AS DECIMAL(12, 0)) AS se_fueron,
           CAST(ISNULL(SUM(CASE WHEN k.faltan > 0 THEN k.faltan * k.precio_taco END), 0) AS DECIMAL(12, 2)) AS valor
      FROM dbo.rendimiento_carnes c
      JOIN dbo.products p ON p.id = c.product_id
      LEFT JOIN #k k ON k.carne_id = c.product_id AND k.actual = 1
     GROUP BY c.product_id, p.nombre, c.rinde, c.activo
    HAVING c.activo = 1 OR SUM(k.usado) > 0
     ORDER BY ISNULL(SUM(CASE WHEN k.faltan > 0 THEN k.faltan * k.precio_taco END), 0) DESC, p.nombre;
END;
GO
