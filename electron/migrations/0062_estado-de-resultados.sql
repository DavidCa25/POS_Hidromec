/* ============================================================
   0062 — estado de resultados

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   NO toca tablas ni datos. Solo objetos programables.
   ============================================================ */

/* ---------- sp_cloud_daily_profit (SQL_STORED_PROCEDURE) ---------- */
/* sp_cloud_daily_profit
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_cloud_daily_profit
AS
BEGIN
    SET NOCOUNT ON;

    /* 0062: la misma utilidad que Estadísticas y el Estado de resultados.
       Antes restaba `products.last_cost`, columna que no existe, a un precio
       con IVA. Ahora: venta SIN IVA menos el costo congelado del renglón. */
    SELECT
        ISNULL(SUM(x.base - x.costo), 0) AS utilidad,
        -- Venta sin IVA: base del margen %
        ISNULL(SUM(x.base), 0)           AS venta_bruta
    FROM dbo.sales s
    JOIN dbo.sale_detail sd ON sd.sale_id = s.id
    JOIN dbo.products p ON p.id = sd.product_id
    CROSS APPLY (SELECT
        CASE WHEN ISNULL(sd.tax_object, '02') = '02'
             THEN sd.subtotal / (1 + ISNULL(sd.tax_rate, ISNULL(p.tasa_iva, 0)))
             ELSE sd.subtotal END AS base,
        sd.quantity * COALESCE(sd.unit_cost, p.cost, 0) AS costo) x
    WHERE s.datee >= CAST(GETDATE() AS DATE)
      AND s.datee <  DATEADD(DAY, 1, CAST(GETDATE() AS DATE));
END
GO

/* ---------- sp_get_profit_overview (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_profit_overview
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- Utilidad por día (pestaña "Caja y utilidad" de Estadísticas).
-- Utilidad = (precio cobrado SIN IVA) - (costo del renglón).
-- 0062: el costo es el CONGELADO al vender (sale_detail.unit_cost), no el
-- costo de hoy: cambiar un costo ya no reescribe la utilidad de días pasados.
-- La tasa de IVA también es la congelada del renglón. Los renglones viejos
-- sin costo o sin tasa usan los del producto (misma regla que
-- sp_income_statement).
CREATE OR ALTER PROCEDURE dbo.sp_get_profit_overview
    @from_date DATE = NULL,
    @to_date   DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @from_date IS NULL SET @from_date = DATEADD(DAY, -6, CAST(GETDATE() AS DATE));
    IF @to_date   IS NULL SET @to_date   = CAST(GETDATE() AS DATE);

    SELECT
        CAST(s.datee AS DATE) AS datee,
        SUM(
            CASE WHEN ISNULL(sd.tax_object, '02') = '02'
                 THEN sd.subtotal / (1 + ISNULL(sd.tax_rate, ISNULL(p.tasa_iva, 0)))
                 ELSE sd.subtotal END
          - sd.quantity * COALESCE(sd.unit_cost, p.cost, 0)
        ) AS profit
    FROM dbo.sales s
    INNER JOIN dbo.sale_detail sd ON sd.sale_id = s.id
    INNER JOIN dbo.products p     ON p.id = sd.product_id
    WHERE s.datee >= @from_date
      AND s.datee <  DATEADD(DAY, 1, @to_date)
    GROUP BY CAST(s.datee AS DATE)
    ORDER BY CAST(s.datee AS DATE);
END;
GO

/* ---------- sp_get_weekly_profit (SQL_STORED_PROCEDURE) ---------- */
/* sp_get_weekly_profit
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
-- =============================================
-- Author:		<David Casillas>
-- Create date: <06-12-2025>
-- Description:	<Obtener una utilidad por semana>
-- =============================================
CREATE OR ALTER PROCEDURE dbo.sp_get_weekly_profit
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @from DATE = DATEADD(DAY, -6, CAST(GETDATE() AS DATE));
    DECLARE @to   DATE = DATEADD(DAY,  1, CAST(GETDATE() AS DATE));

    ;WITH daily AS (
        SELECT
            CAST(s.datee AS DATE)                           AS sale_date,
            /* 0062: venta sin IVA y costo CONGELADO del renglón (antes: venta con
               IVA contra el costo de hoy del producto). */
            SUM(CASE WHEN ISNULL(d.tax_object, '02') = '02'
                     THEN d.subtotal / (1 + ISNULL(d.tax_rate, ISNULL(p.tasa_iva, 0)))
                     ELSE d.subtotal END)                  AS total_sales,
            SUM(d.quantity * COALESCE(d.unit_cost, p.cost, 0)) AS total_cost
        FROM sales        AS s
        JOIN sale_detail  AS d ON d.sale_id   = s.id
        JOIN products     AS p ON p.id        = d.product_id
        WHERE s.datee >= @from
          AND s.datee <  @to
        GROUP BY CAST(s.datee AS DATE)
    )
    SELECT
        sale_date,
        total_sales,
        total_cost,
        (total_sales - total_cost) AS profit
    FROM daily
    ORDER BY sale_date;
END;
GO

/* ---------- sp_income_statement (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_income_statement (0062) =====================
   ESTADO DE RESULTADOS de un periodo: cuánto ganó de verdad el negocio.

       Ventas netas (sin IVA, menos devoluciones)
     − Costo de lo vendido (el costo CONGELADO de cada renglón al venderse)
     = Utilidad bruta
     − Mermas de producto terminado (lo que se tiró)
     − Faltantes de inventario por conteo (valuados al costo actual)
     − Egresos (renta, luz, servicios...) y pagos al personal
     = Utilidad de operación

   Lo que NO es gasto aquí, a propósito:
     · Las COMPRAS: son inventario. Se vuelven costo cuando se venden.
     · Los pagos a proveedores: pagan esas compras.
     · La merma DE PRODUCCIÓN: ya está dentro del costo de cada pieza buena
       (sp_production_finish reparte el costo de la tanda entre las buenas).
   Las ventas a crédito cuentan el día que se venden, no el día que se cobran.

   Precio con IVA: sale_detail guarda el precio cobrado (con IVA si el
   producto es objeto '02'). La base sin IVA se saca con la tasa congelada
   del renglón; los renglones viejos sin tasa usan la del producto.
   Costo: sale_detail.unit_cost (congelado al vender). Los renglones viejos
   sin costo usan el costo actual del producto y se cuentan aparte para que
   el dueño sepa cuánto de la utilidad es estimado.

     1  resumen          periodo pedido y periodo anterior del mismo largo
     2  egresos          por concepto (GENERAL / PERSONAL)
     3  categorías       ventas, costo, utilidad y margen por categoría
     4  días             serie diaria (ventas netas, costo, gastos, utilidad)
     5  productos        los 15 que más utilidad dejaron
     6  productos        los que se vendieron por debajo del costo
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_income_statement
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

    /* --------- Renglones vendidos de los DOS periodos, ya con base y costo -------- */
    SELECT CAST(s.datee AS DATE) AS dia,
           CASE WHEN s.datee >= @desde THEN 1 ELSE 0 END AS actual,
           s.id AS sale_id, d.product_id, d.quantity,
           CAST(d.subtotal AS DECIMAL(14, 4)) AS cobrado,
           CAST(CASE WHEN ISNULL(d.tax_object, '02') = '02'
                     THEN d.subtotal / (1 + ISNULL(d.tax_rate, ISNULL(p.tasa_iva, 0)))
                     ELSE d.subtotal END AS DECIMAL(14, 4)) AS base,
           CAST(d.quantity * COALESCE(d.unit_cost, p.cost, 0) AS DECIMAL(14, 4)) AS costo,
           CASE WHEN d.unit_cost IS NULL THEN 1 ELSE 0 END AS costo_estimado,
           TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(s.commercial_snapshot, '$.discount')) AS descuento_venta
      INTO #v
      FROM dbo.sales s
      JOIN dbo.sale_detail d ON d.sale_id = s.id
      JOIN dbo.products p ON p.id = d.product_id
     WHERE s.datee >= @ant_desde AND s.datee < DATEADD(DAY, 1, @hasta);

    /* --------- Devoluciones (por la fecha en que se devolvió) -------- */
    CREATE TABLE #r (dia DATE NOT NULL, actual BIT NOT NULL, cobrado DECIMAL(14, 4) NOT NULL,
                     base DECIMAL(14, 4) NOT NULL, costo DECIMAL(14, 4) NOT NULL, product_id INT NULL, quantity DECIMAL(12, 2) NULL);
    INSERT INTO #r (dia, actual, cobrado, base, costo, product_id, quantity)
    SELECT CAST(f.datee AS DATE) AS dia,
           CASE WHEN f.datee >= @desde THEN 1 ELSE 0 END AS actual,
           CAST(COALESCE(rd.commercial_amount, rd.quantity * rd.unitary_price) AS DECIMAL(14, 4)) AS cobrado,
           CAST(COALESCE(rd.commercial_amount, rd.quantity * rd.unitary_price)
                / CASE WHEN ISNULL(o.tax_object, '02') = '02' THEN 1 + ISNULL(o.tax_rate, ISNULL(p.tasa_iva, 0)) ELSE 1 END AS DECIMAL(14, 4)) AS base,
           CAST(rd.quantity * COALESCE(o.unit_cost, p.cost, 0) AS DECIMAL(14, 4)) AS costo,
           rd.product_id, rd.quantity
      FROM dbo.sale_refunds f
      JOIN dbo.sale_refund_detail rd ON rd.refund_id = f.id
      JOIN dbo.products p ON p.id = rd.product_id
      OUTER APPLY (SELECT TOP 1 d.unit_cost, d.tax_rate, d.tax_object
                     FROM dbo.sale_detail d WHERE d.sale_id = f.sale_id AND d.product_id = rd.product_id
                    ORDER BY d.id) o
     WHERE f.datee >= @ant_desde AND f.datee < DATEADD(DAY, 1, @hasta);

    /* Devoluciones sin detalle por producto (las muy viejas): solo importe. */
    INSERT INTO #r (dia, actual, cobrado, base, costo, product_id, quantity)
    SELECT CAST(f.datee AS DATE), CASE WHEN f.datee >= @desde THEN 1 ELSE 0 END,
           f.refund_total, f.refund_total / 1.16, 0, NULL, NULL
      FROM dbo.sale_refunds f
     WHERE f.datee >= @ant_desde AND f.datee < DATEADD(DAY, 1, @hasta)
       AND NOT EXISTS (SELECT 1 FROM dbo.sale_refund_detail rd WHERE rd.refund_id = f.id);

    /* --------- Mermas de producto terminado -------- */
    SELECT w.waste_date AS dia, CASE WHEN w.waste_date >= @desde THEN 1 ELSE 0 END AS actual,
           CAST(w.qty * COALESCE(w.unit_cost, p.cost, 0) AS DECIMAL(14, 4)) AS costo
      INTO #w
      FROM dbo.production_waste w
      JOIN dbo.products p ON p.id = w.product_id
     WHERE w.waste_date BETWEEN @ant_desde AND @hasta;

    /* --------- Ajustes por conteo físico (faltante +, sobrante -) -------- */
    SELECT CAST(m.datee AS DATE) AS dia, CASE WHEN m.datee >= @desde THEN 1 ELSE 0 END AS actual,
           CAST(CASE WHEN m.typee = 'salida' THEN 1 ELSE -1 END * m.quantity * COALESCE(m.unit_cost, p.cost, 0) AS DECIMAL(14, 4)) AS costo
      INTO #a
      FROM dbo.inventory_movements m
      JOIN dbo.products p ON p.id = m.product_id
     WHERE m.reference = 'CONTEO'
       AND m.datee >= @ant_desde AND m.datee < DATEADD(DAY, 1, @hasta);

    /* --------- Egresos (no cancelados) -------- */
    SELECT e.expense_date AS dia, CASE WHEN e.expense_date >= @desde THEN 1 ELSE 0 END AS actual,
           ISNULL(c.kind, 'GENERAL') AS kind, ISNULL(c.name, N'Sin concepto') AS concepto, e.amount
      INTO #e
      FROM dbo.expenses e
      LEFT JOIN dbo.expense_categories c ON c.id = e.category_id
     WHERE e.voided_at IS NULL
       AND e.expense_date BETWEEN @ant_desde AND @hasta;

    /* =============================== 1 resumen =============================== */
    ;WITH per AS (SELECT 1 AS actual UNION ALL SELECT 0),
    x AS (
        SELECT per.actual,
               (SELECT ISNULL(SUM(cobrado), 0) FROM #v WHERE actual = per.actual) AS ventas_cobradas,
               (SELECT COUNT(DISTINCT sale_id) FROM #v WHERE actual = per.actual) AS tickets,
               (SELECT ISNULL(SUM(d), 0) FROM (SELECT MAX(descuento_venta) d FROM #v WHERE actual = per.actual GROUP BY sale_id) q) AS descuentos,
               (SELECT ISNULL(SUM(base), 0) FROM #v WHERE actual = per.actual) AS ventas_base,
               (SELECT ISNULL(SUM(cobrado), 0) FROM #r WHERE actual = per.actual) AS devoluciones_cobradas,
               (SELECT ISNULL(SUM(base), 0) FROM #r WHERE actual = per.actual) AS devoluciones_base,
               (SELECT ISNULL(SUM(costo), 0) FROM #v WHERE actual = per.actual) AS costo_vendido,
               (SELECT ISNULL(SUM(costo), 0) FROM #r WHERE actual = per.actual) AS costo_devuelto,
               (SELECT COUNT(*) FROM #v WHERE actual = per.actual AND costo_estimado = 1) AS renglones_costo_estimado,
               (SELECT ISNULL(SUM(base), 0) FROM #v WHERE actual = per.actual AND (costo_estimado = 1 OR costo = 0)) AS ventas_sin_costo_congelado,
               (SELECT ISNULL(SUM(costo), 0) FROM #w WHERE actual = per.actual) AS mermas,
               (SELECT ISNULL(SUM(costo), 0) FROM #a WHERE actual = per.actual) AS ajustes_inventario,
               (SELECT ISNULL(SUM(amount), 0) FROM #e WHERE actual = per.actual AND kind <> 'PERSONAL') AS egresos_generales,
               (SELECT ISNULL(SUM(amount), 0) FROM #e WHERE actual = per.actual AND kind = 'PERSONAL') AS pagos_personal
          FROM per)
    SELECT CASE WHEN actual = 1 THEN 'ACTUAL' ELSE 'ANTERIOR' END AS periodo,
           CASE WHEN actual = 1 THEN @desde ELSE @ant_desde END AS desde,
           CASE WHEN actual = 1 THEN @hasta ELSE @ant_hasta END AS hasta,
           tickets, descuentos,
           ventas_cobradas, devoluciones_cobradas,
           CAST((ventas_cobradas - devoluciones_cobradas) - (ventas_base - devoluciones_base) AS DECIMAL(14, 2)) AS iva_trasladado,
           CAST(ventas_base - devoluciones_base AS DECIMAL(14, 2)) AS ventas_netas,
           CAST(costo_vendido - costo_devuelto AS DECIMAL(14, 2)) AS costo_ventas,
           CAST((ventas_base - devoluciones_base) - (costo_vendido - costo_devuelto) AS DECIMAL(14, 2)) AS utilidad_bruta,
           CAST(mermas AS DECIMAL(14, 2)) AS mermas,
           CAST(ajustes_inventario AS DECIMAL(14, 2)) AS ajustes_inventario,
           CAST(egresos_generales AS DECIMAL(14, 2)) AS egresos_generales,
           CAST(pagos_personal AS DECIMAL(14, 2)) AS pagos_personal,
           CAST((ventas_base - devoluciones_base) - (costo_vendido - costo_devuelto)
                - mermas - ajustes_inventario - egresos_generales - pagos_personal AS DECIMAL(14, 2)) AS utilidad_operacion,
           renglones_costo_estimado,
           CAST(ventas_sin_costo_congelado AS DECIMAL(14, 2)) AS ventas_sin_costo
      FROM x
     ORDER BY actual DESC;

    /* =============================== 2 egresos =============================== */
    SELECT kind, concepto, CAST(SUM(amount) AS DECIMAL(14, 2)) AS total, COUNT(*) AS movimientos,
           CAST(ISNULL((SELECT SUM(a.amount) FROM #e a WHERE a.actual = 0 AND a.kind = e.kind AND a.concepto = e.concepto), 0) AS DECIMAL(14, 2)) AS total_anterior
      FROM #e e
     WHERE actual = 1
     GROUP BY kind, concepto
     ORDER BY SUM(amount) DESC;

    /* ============================== 3 categorías ============================= */
    SELECT ISNULL(c.namee, N'Sin categoría') AS categoria,
           CAST(SUM(v.base) AS DECIMAL(14, 2)) AS ventas_netas,
           CAST(SUM(v.costo) AS DECIMAL(14, 2)) AS costo,
           CAST(SUM(v.base - v.costo) AS DECIMAL(14, 2)) AS utilidad,
           CAST(CASE WHEN SUM(v.base) > 0 THEN 100 * SUM(v.base - v.costo) / SUM(v.base) END AS DECIMAL(7, 2)) AS margen
      FROM #v v
      JOIN dbo.products p ON p.id = v.product_id
      LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
     WHERE v.actual = 1
     GROUP BY c.namee
     ORDER BY SUM(v.base - v.costo) DESC;

    /* ================================ 4 días ================================= */
    ;WITH n AS (SELECT TOP (@dias) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS i FROM sys.all_objects),
    f AS (SELECT DATEADD(DAY, i, @desde) AS dia FROM n)
    SELECT f.dia,
           CAST(ISNULL(v.base, 0) - ISNULL(r.base, 0) AS DECIMAL(14, 2)) AS ventas_netas,
           CAST(ISNULL(v.costo, 0) - ISNULL(r.costo, 0) AS DECIMAL(14, 2)) AS costo_ventas,
           CAST(ISNULL(w.costo, 0) + ISNULL(a.costo, 0) + ISNULL(e.total, 0) AS DECIMAL(14, 2)) AS gastos,
           CAST(ISNULL(v.base, 0) - ISNULL(r.base, 0) - ISNULL(v.costo, 0) + ISNULL(r.costo, 0)
                - ISNULL(w.costo, 0) - ISNULL(a.costo, 0) - ISNULL(e.total, 0) AS DECIMAL(14, 2)) AS utilidad
      FROM f
      LEFT JOIN (SELECT dia, SUM(base) base, SUM(costo) costo FROM #v WHERE actual = 1 GROUP BY dia) v ON v.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(base) base, SUM(costo) costo FROM #r WHERE actual = 1 GROUP BY dia) r ON r.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(costo) costo FROM #w WHERE actual = 1 GROUP BY dia) w ON w.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(costo) costo FROM #a WHERE actual = 1 GROUP BY dia) a ON a.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(amount) total FROM #e WHERE actual = 1 GROUP BY dia) e ON e.dia = f.dia
     ORDER BY f.dia;

    /* ============================== 5-6 productos ============================ */
    SELECT p.id, p.nombre AS producto, CAST(SUM(v.quantity) AS DECIMAL(14, 2)) AS cantidad,
           CAST(SUM(v.base) AS DECIMAL(14, 2)) AS ventas_netas, CAST(SUM(v.costo) AS DECIMAL(14, 2)) AS costo,
           CAST(SUM(v.base - v.costo) AS DECIMAL(14, 2)) AS utilidad,
           CAST(CASE WHEN SUM(v.base) > 0 THEN 100 * SUM(v.base - v.costo) / SUM(v.base) END AS DECIMAL(7, 2)) AS margen,
           MAX(v.costo_estimado) AS costo_estimado
      INTO #p
      FROM #v v JOIN dbo.products p ON p.id = v.product_id
     WHERE v.actual = 1
     GROUP BY p.id, p.nombre;

    SELECT TOP (15) * FROM #p ORDER BY utilidad DESC, producto;
    SELECT TOP (15) * FROM #p WHERE utilidad < 0 ORDER BY utilidad ASC, producto;
END;
GO
