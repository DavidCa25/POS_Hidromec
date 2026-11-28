/* ============================================================
   0095 — carne por rendimiento

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0095_carne-por-rendimiento.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0095_carne-por-rendimiento.sql ========== */
/* 0095 · Carne por rendimiento
 *
 * Una taquería no pesa 70 g por taco: sabe cuántos kilos compró y cuánto le
 * quedó al cerrar. Con eso y un número a ojo («1 kg de pastor ≈ 14 tacos»)
 * Wybix calcula cuánto rindió cada kilo y cuánta carne se fue sin cobrarse.
 * Sin recetas.
 *
 *   rendimiento_carnes     el insumo (products, en gramos) que se lleva por
 *                          rendimiento y cuántos tacos rinde un kilo.
 *   rendimiento_platillos  qué platillo vendido cuenta tacos de qué carne y
 *                          cuántos (la «Orden de 5» cuenta 5). Lo llena
 *                          sp_rendimiento_mapear por el nombre; `manual` = lo
 *                          fijó una persona y el mapeo no lo toca.
 *   rendimiento_conteos    cada «¿cuánta carne te quedó?» del corte: lo que
 *                          había, lo que quedó, lo que se usó (salida de
 *                          inventario RENDIMIENTO, a su costo) y los tacos
 *                          vendidos desde el conteo anterior.
 *
 * El costo de la carne usada lo reparte sp_income_statement entre los tacos
 * vendidos de ese periodo: sale como costo de ventas, no como ajuste.
 */
IF OBJECT_ID(N'dbo.rendimiento_carnes', 'U') IS NULL
BEGIN
CREATE TABLE dbo.rendimiento_carnes (
    product_id INT NOT NULL,
    rinde DECIMAL(6, 2) NOT NULL,
    activo BIT NOT NULL CONSTRAINT DF_rendimiento_carnes_activo DEFAULT ((1)),
    desde DATETIME2(3) NOT NULL CONSTRAINT DF_rendimiento_carnes_desde DEFAULT (sysdatetime()),
    actualizado DATETIME2(0) NOT NULL CONSTRAINT DF_rendimiento_carnes_actualizado DEFAULT (sysdatetime()),
    CONSTRAINT PK_rendimiento_carnes PRIMARY KEY CLUSTERED (product_id)
);
END;

IF OBJECT_ID(N'dbo.FK_rendimiento_carnes_product', 'F') IS NULL
ALTER TABLE dbo.rendimiento_carnes WITH CHECK ADD CONSTRAINT FK_rendimiento_carnes_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.CK_rendimiento_carnes_rinde', 'C') IS NULL
ALTER TABLE dbo.rendimiento_carnes WITH CHECK ADD CONSTRAINT CK_rendimiento_carnes_rinde CHECK ([rinde] >= 1 AND [rinde] <= 60);

IF OBJECT_ID(N'dbo.rendimiento_platillos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.rendimiento_platillos (
    product_id INT NOT NULL,
    carne_id INT NOT NULL,
    tacos DECIMAL(6, 2) NOT NULL,
    manual BIT NOT NULL CONSTRAINT DF_rendimiento_platillos_manual DEFAULT ((0)),
    CONSTRAINT PK_rendimiento_platillos PRIMARY KEY CLUSTERED (product_id, carne_id)
);
END;

IF OBJECT_ID(N'dbo.FK_rendimiento_platillos_product', 'F') IS NULL
ALTER TABLE dbo.rendimiento_platillos WITH CHECK ADD CONSTRAINT FK_rendimiento_platillos_product FOREIGN KEY (product_id) REFERENCES dbo.products (id);

IF OBJECT_ID(N'dbo.FK_rendimiento_platillos_carne', 'F') IS NULL
ALTER TABLE dbo.rendimiento_platillos WITH CHECK ADD CONSTRAINT FK_rendimiento_platillos_carne FOREIGN KEY (carne_id) REFERENCES dbo.rendimiento_carnes (product_id);

IF OBJECT_ID(N'dbo.CK_rendimiento_platillos_tacos', 'C') IS NULL
ALTER TABLE dbo.rendimiento_platillos WITH CHECK ADD CONSTRAINT CK_rendimiento_platillos_tacos CHECK ([tacos] > 0 AND [tacos] <= 100);

IF OBJECT_ID(N'dbo.rendimiento_conteos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.rendimiento_conteos (
    id INT IDENTITY(1, 1) NOT NULL,
    carne_id INT NOT NULL,
    closure_id INT NULL,
    desde DATETIME2(3) NOT NULL,
    contado_en DATETIME2(3) NOT NULL CONSTRAINT DF_rendimiento_conteos_contado_en DEFAULT (sysdatetime()),
    tenia DECIMAL(12, 2) NOT NULL,
    quedo DECIMAL(12, 2) NOT NULL,
    usado DECIMAL(12, 2) NOT NULL,
    vendidos DECIMAL(12, 2) NOT NULL,
    rinde DECIMAL(6, 2) NOT NULL,
    costo_g DECIMAL(14, 4) NOT NULL,
    precio_taco DECIMAL(10, 2) NULL,
    user_id INT NULL,
    CONSTRAINT PK_rendimiento_conteos PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_rendimiento_conteos_carne', 'F') IS NULL
ALTER TABLE dbo.rendimiento_conteos WITH CHECK ADD CONSTRAINT FK_rendimiento_conteos_carne FOREIGN KEY (carne_id) REFERENCES dbo.rendimiento_carnes (product_id);

IF OBJECT_ID(N'dbo.FK_rendimiento_conteos_closure', 'F') IS NULL
ALTER TABLE dbo.rendimiento_conteos WITH CHECK ADD CONSTRAINT FK_rendimiento_conteos_closure FOREIGN KEY (closure_id) REFERENCES dbo.cash_closures (id);

/* Un conteo por carne y por corte: reintentar el cierre no cuenta dos veces. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_rendimiento_conteos_corte' AND object_id = OBJECT_ID(N'dbo.rendimiento_conteos'))
CREATE UNIQUE NONCLUSTERED INDEX UX_rendimiento_conteos_corte ON dbo.rendimiento_conteos (carne_id, closure_id) WHERE closure_id IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_rendimiento_conteos_fecha' AND object_id = OBJECT_ID(N'dbo.rendimiento_conteos'))
CREATE NONCLUSTERED INDEX IX_rendimiento_conteos_fecha ON dbo.rendimiento_conteos (contado_en, carne_id);
GO

/* ---------- sp_income_statement (SQL_STORED_PROCEDURE) ---------- */
/* sp_income_statement
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
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
     − Comisiones de plataforma, sin IVA (0069)
     = Utilidad de operación

   0069 · Liquidaciones de plataforma. Lo que Uber Eats, Didi o Rappi
   descuentan del depósito entra por las liquidaciones CONFIRMADAS, repartido
   entre sus ventas (platform_settlement_allocations), en el día de la venta:
     · promociones pagadas por el negocio y reembolsos: bajan la venta neta
       (y su IVA baja el IVA trasladado);
     · comisión / tasa de servicio: gasto, sin IVA (el IVA es acreditable);
     · retenciones ISR / IVA: se informan, NO son gasto.
   El egreso de comisión que crea la liquidación (concepto PLATAFORMA) no se
   suma con los demás egresos: ya está en el reparto, contaría doble.

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
     7  canales          venta neta, costo, plataforma y utilidad por canal
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
           s.id AS sale_id, d.id AS detail_id, s.datee AS momento, d.product_id, d.quantity,
           CAST(d.subtotal AS DECIMAL(14, 4)) AS cobrado,
           /* 0083: con IEPS u otro impuesto, la base sin NINGÚN impuesto de la foto. */
           CAST(COALESCE(d.base_neta, CASE WHEN ISNULL(d.tax_object, '02') = '02'
                     THEN d.subtotal / (1 + ISNULL(d.tax_rate, ISNULL(p.tasa_iva, 0)))
                     ELSE d.subtotal END) AS DECIMAL(14, 4)) AS base,
           CAST(d.quantity * COALESCE(d.unit_cost, p.cost, 0) AS DECIMAL(14, 4)) AS costo,
           CASE WHEN d.unit_cost IS NULL THEN 1 ELSE 0 END AS costo_estimado,
           TRY_CONVERT(DECIMAL(12, 2), JSON_VALUE(s.commercial_snapshot, '$.discount')) AS descuento_venta,
           ISNULL(JSON_VALUE(s.commercial_snapshot, '$.channel'), N'LOCAL') AS canal,
           JSON_VALUE(s.commercial_snapshot, '$.channelName') AS canal_nombre
      INTO #v
      FROM dbo.sales s
      JOIN dbo.sale_detail d ON d.sale_id = s.id
      JOIN dbo.products p ON p.id = d.product_id
     WHERE s.datee >= @ant_desde AND s.datee < DATEADD(DAY, 1, @hasta);

    /* --------- Devoluciones (por la fecha en que se devolvió) -------- */
    CREATE TABLE #r (dia DATE NOT NULL, actual BIT NOT NULL, cobrado DECIMAL(14, 4) NOT NULL,
                     base DECIMAL(14, 4) NOT NULL, costo DECIMAL(14, 4) NOT NULL, product_id INT NULL, quantity DECIMAL(12, 2) NULL,
                     canal NVARCHAR(64) COLLATE DATABASE_DEFAULT NULL);
    INSERT INTO #r (dia, actual, cobrado, base, costo, product_id, quantity, canal)
    SELECT CAST(f.datee AS DATE) AS dia,
           CASE WHEN f.datee >= @desde THEN 1 ELSE 0 END AS actual,
           CAST(COALESCE(rd.commercial_amount, rd.quantity * rd.unitary_price) AS DECIMAL(14, 4)) AS cobrado,
           /* 0083: si el renglón vendido tiene foto, la misma proporción base/cobrado. */
           CAST(COALESCE(rd.commercial_amount, rd.quantity * rd.unitary_price)
                * COALESCE(o.base_neta / NULLIF(o.subtotal, 0),
                           1.0 / CASE WHEN ISNULL(o.tax_object, '02') = '02' THEN 1 + ISNULL(o.tax_rate, ISNULL(p.tasa_iva, 0)) ELSE 1 END) AS DECIMAL(14, 4)) AS base,
           CAST(rd.quantity * COALESCE(o.unit_cost, p.cost, 0) AS DECIMAL(14, 4)) AS costo,
           rd.product_id, rd.quantity,
           ISNULL(JSON_VALUE(vs.commercial_snapshot, '$.channel'), N'LOCAL')
      FROM dbo.sale_refunds f
      JOIN dbo.sale_refund_detail rd ON rd.refund_id = f.id
      LEFT JOIN dbo.sales vs ON vs.id = f.sale_id
      JOIN dbo.products p ON p.id = rd.product_id
      OUTER APPLY (SELECT TOP 1 d.unit_cost, d.tax_rate, d.tax_object, d.base_neta, d.subtotal
                     FROM dbo.sale_detail d WHERE d.sale_id = f.sale_id AND d.product_id = rd.product_id
                    ORDER BY d.id) o
     WHERE f.datee >= @ant_desde AND f.datee < DATEADD(DAY, 1, @hasta);

    /* Devoluciones sin detalle por producto (las muy viejas): solo importe. */
    INSERT INTO #r (dia, actual, cobrado, base, costo, product_id, quantity, canal)
    SELECT CAST(f.datee AS DATE), CASE WHEN f.datee >= @desde THEN 1 ELSE 0 END,
           f.refund_total, f.refund_total / 1.16, 0, NULL, NULL,
           ISNULL(JSON_VALUE(vs.commercial_snapshot, '$.channel'), N'LOCAL')
      FROM dbo.sale_refunds f
      LEFT JOIN dbo.sales vs ON vs.id = f.sale_id
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

    /* --------- 0095 · Carne por rendimiento -------- */
    /* La carne que se usó entre dos conteos del cierre es el costo de los
       tacos de esa carne vendidos en ese tiempo: se reparte entre esos
       renglones según los tacos que cuenta cada uno («Orden de 5» = 5). Así
       sale como costo de ventas, y por categoría, producto, canal y día. Lo
       que no tiene a quién repartirse (una noche sin ventas de esa carne)
       queda como ajuste de inventario de ese día. */
    SELECT k.id AS conteo_id, k.carne_id, k.desde, k.contado_en, CAST(k.usado * k.costo_g AS DECIMAL(14, 4)) AS costo
      INTO #rc
      FROM dbo.rendimiento_conteos k
     WHERE k.usado > 0
       AND k.contado_en >= @ant_desde AND k.desde < DATEADD(DAY, 1, @hasta);

    SELECT v.detail_id, rc.conteo_id, CAST(v.quantity * rp.tacos AS DECIMAL(14, 4)) AS tacos
      INTO #rt
      FROM #rc rc
      JOIN dbo.rendimiento_platillos rp ON rp.carne_id = rc.carne_id
      JOIN #v v ON v.product_id = rp.product_id AND v.momento >= rc.desde AND v.momento < rc.contado_en;

    ;WITH t AS (SELECT conteo_id, SUM(tacos) AS total FROM #rt GROUP BY conteo_id HAVING SUM(tacos) > 0),
    parte AS (
        SELECT rt.detail_id, SUM(rc.costo * rt.tacos / t.total) AS costo
          FROM #rt rt JOIN t ON t.conteo_id = rt.conteo_id JOIN #rc rc ON rc.conteo_id = rt.conteo_id
         GROUP BY rt.detail_id)
    UPDATE v SET costo = v.costo + parte.costo, costo_estimado = 0
      FROM #v v JOIN parte ON parte.detail_id = v.detail_id;

    INSERT INTO #a (dia, actual, costo)
    SELECT CAST(rc.contado_en AS DATE), CASE WHEN rc.contado_en >= @desde THEN 1 ELSE 0 END, rc.costo
      FROM #rc rc
     WHERE rc.contado_en < DATEADD(DAY, 1, @hasta)
       AND NOT EXISTS (SELECT 1 FROM #rt WHERE #rt.conteo_id = rc.conteo_id AND #rt.tacos > 0);

    /* --------- Plataformas: el reparto de las liquidaciones confirmadas (0069) -------- */
    SELECT a.alloc_date AS dia, CASE WHEN a.alloc_date >= @desde THEN 1 ELSE 0 END AS actual,
           ISNULL(a.channel_id, N'LOCAL') AS canal, a.sale_id,
           a.discount_base + a.refund_base AS descuento_base,
           a.discount_iva + a.refund_iva AS descuento_iva,
           a.fee_base, a.fee_iva, a.withheld
      INTO #pa
      FROM dbo.platform_settlement_allocations a
      JOIN dbo.platform_settlements t ON t.id = a.settlement_id AND t.status = 'CONFIRMADA'
     WHERE a.alloc_date BETWEEN @ant_desde AND @hasta;

    /* --------- Egresos (no cancelados) -------- */
    SELECT e.expense_date AS dia, CASE WHEN e.expense_date >= @desde THEN 1 ELSE 0 END AS actual,
           ISNULL(c.kind, 'GENERAL') AS kind, ISNULL(c.name, N'Sin concepto') AS concepto, e.amount
      INTO #e
      FROM dbo.expenses e
      LEFT JOIN dbo.expense_categories c ON c.id = e.category_id
     WHERE e.voided_at IS NULL
       AND ISNULL(c.kind, 'GENERAL') <> 'PLATAFORMA'
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
               (SELECT ISNULL(SUM(amount), 0) FROM #e WHERE actual = per.actual AND kind = 'PERSONAL') AS pagos_personal,
               (SELECT ISNULL(SUM(descuento_base), 0) FROM #pa WHERE actual = per.actual) AS plat_desc_base,
               (SELECT ISNULL(SUM(descuento_iva), 0) FROM #pa WHERE actual = per.actual) AS plat_desc_iva,
               (SELECT ISNULL(SUM(fee_base), 0) FROM #pa WHERE actual = per.actual) AS plat_comision,
               (SELECT ISNULL(SUM(fee_iva), 0) FROM #pa WHERE actual = per.actual) AS plat_comision_iva,
               (SELECT ISNULL(SUM(withheld), 0) FROM #pa WHERE actual = per.actual) AS plat_retenciones
          FROM per)
    SELECT CASE WHEN actual = 1 THEN 'ACTUAL' ELSE 'ANTERIOR' END AS periodo,
           CASE WHEN actual = 1 THEN @desde ELSE @ant_desde END AS desde,
           CASE WHEN actual = 1 THEN @hasta ELSE @ant_hasta END AS hasta,
           tickets, descuentos,
           ventas_cobradas, devoluciones_cobradas,
           CAST((ventas_cobradas - devoluciones_cobradas) - (ventas_base - devoluciones_base) - plat_desc_iva AS DECIMAL(14, 2)) AS iva_trasladado,
           CAST(plat_desc_base AS DECIMAL(14, 2)) AS descuentos_plataforma,
           CAST(ventas_base - devoluciones_base - plat_desc_base AS DECIMAL(14, 2)) AS ventas_netas,
           CAST(costo_vendido - costo_devuelto AS DECIMAL(14, 2)) AS costo_ventas,
           CAST((ventas_base - devoluciones_base - plat_desc_base) - (costo_vendido - costo_devuelto) AS DECIMAL(14, 2)) AS utilidad_bruta,
           CAST(mermas AS DECIMAL(14, 2)) AS mermas,
           CAST(ajustes_inventario AS DECIMAL(14, 2)) AS ajustes_inventario,
           CAST(egresos_generales AS DECIMAL(14, 2)) AS egresos_generales,
           CAST(pagos_personal AS DECIMAL(14, 2)) AS pagos_personal,
           CAST(plat_comision AS DECIMAL(14, 2)) AS comisiones_plataforma,
           CAST(plat_comision_iva AS DECIMAL(14, 2)) AS iva_comisiones_plataforma,
           CAST(plat_retenciones AS DECIMAL(14, 2)) AS retenciones_plataforma,
           CAST((ventas_base - devoluciones_base - plat_desc_base) - (costo_vendido - costo_devuelto)
                - mermas - ajustes_inventario - egresos_generales - pagos_personal - plat_comision AS DECIMAL(14, 2)) AS utilidad_operacion,
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
    /* 0069: lo que la plataforma descontó de una venta se reparte entre sus
       renglones según su venta sin IVA: la promoción baja la venta neta de
       la categoría y la comisión baja su utilidad. */
    ;WITH vp AS (
        SELECT v.product_id, v.base, v.costo,
               CASE WHEN SUM(v.base) OVER (PARTITION BY v.sale_id) <> 0
                    THEN v.base / SUM(v.base) OVER (PARTITION BY v.sale_id) ELSE 0 END AS parte,
               ps.descuento, ps.comision
          FROM #v v
          LEFT JOIN (SELECT sale_id, SUM(descuento_base) AS descuento, SUM(fee_base) AS comision
                       FROM #pa WHERE sale_id IS NOT NULL GROUP BY sale_id) ps ON ps.sale_id = v.sale_id
         WHERE v.actual = 1),
    vc AS (
        SELECT product_id, base - ISNULL(descuento, 0) * parte AS neto, costo, ISNULL(comision, 0) * parte AS comision FROM vp)
    SELECT ISNULL(c.namee, N'Sin categoría') AS categoria,
           CAST(SUM(v.neto) AS DECIMAL(14, 2)) AS ventas_netas,
           CAST(SUM(v.costo) AS DECIMAL(14, 2)) AS costo,
           CAST(SUM(v.comision) AS DECIMAL(14, 2)) AS comisiones_plataforma,
           CAST(SUM(v.neto - v.costo - v.comision) AS DECIMAL(14, 2)) AS utilidad,
           CAST(CASE WHEN SUM(v.neto) > 0 THEN 100 * SUM(v.neto - v.costo - v.comision) / SUM(v.neto) END AS DECIMAL(7, 2)) AS margen
      FROM vc v
      JOIN dbo.products p ON p.id = v.product_id
      LEFT JOIN dbo.CAT_categories c ON c.id = p.category_id
     GROUP BY c.namee
     ORDER BY SUM(v.neto - v.costo - v.comision) DESC;

    /* ================================ 4 días ================================= */
    ;WITH n AS (SELECT TOP (@dias) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS i FROM sys.all_objects),
    f AS (SELECT DATEADD(DAY, i, @desde) AS dia FROM n)
    SELECT f.dia,
           CAST(ISNULL(v.base, 0) - ISNULL(r.base, 0) - ISNULL(pa.descuento, 0) AS DECIMAL(14, 2)) AS ventas_netas,
           CAST(ISNULL(v.costo, 0) - ISNULL(r.costo, 0) AS DECIMAL(14, 2)) AS costo_ventas,
           CAST(ISNULL(w.costo, 0) + ISNULL(a.costo, 0) + ISNULL(e.total, 0) + ISNULL(pa.comision, 0) AS DECIMAL(14, 2)) AS gastos,
           CAST(ISNULL(v.base, 0) - ISNULL(r.base, 0) - ISNULL(pa.descuento, 0) - ISNULL(v.costo, 0) + ISNULL(r.costo, 0)
                - ISNULL(w.costo, 0) - ISNULL(a.costo, 0) - ISNULL(e.total, 0) - ISNULL(pa.comision, 0) AS DECIMAL(14, 2)) AS utilidad
      FROM f
      LEFT JOIN (SELECT dia, SUM(base) base, SUM(costo) costo FROM #v WHERE actual = 1 GROUP BY dia) v ON v.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(base) base, SUM(costo) costo FROM #r WHERE actual = 1 GROUP BY dia) r ON r.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(costo) costo FROM #w WHERE actual = 1 GROUP BY dia) w ON w.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(costo) costo FROM #a WHERE actual = 1 GROUP BY dia) a ON a.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(amount) total FROM #e WHERE actual = 1 GROUP BY dia) e ON e.dia = f.dia
      LEFT JOIN (SELECT dia, SUM(descuento_base) descuento, SUM(fee_base) comision FROM #pa WHERE actual = 1 GROUP BY dia) pa ON pa.dia = f.dia
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

    /* ============================== 7 canales (0069) ========================== */
    /* El nombre: el de la política vigente; si el canal ya no existe, el que
       quedó en la venta. La plataforma, la que tenga ligada hoy. */
    SELECT c.id, c.name INTO #cn FROM dbo.commercial_policy p
     CROSS APPLY OPENJSON(p.payload, '$.channels') WITH (id NVARCHAR(64), name NVARCHAR(120)) c
     WHERE p.id = 1;
    ;WITH canales AS (
        SELECT canal FROM #v WHERE actual = 1 UNION SELECT canal FROM #r WHERE actual = 1
        UNION SELECT canal FROM #pa WHERE actual = 1),
    x AS (
        SELECT k.canal,
               (SELECT COUNT(DISTINCT sale_id) FROM #v WHERE actual = 1 AND canal = k.canal) AS tickets,
               (SELECT ISNULL(SUM(base), 0) FROM #v WHERE actual = 1 AND canal = k.canal) AS vb,
               (SELECT ISNULL(SUM(costo), 0) FROM #v WHERE actual = 1 AND canal = k.canal) AS vc,
               (SELECT ISNULL(SUM(base), 0) FROM #r WHERE actual = 1 AND canal = k.canal) AS rb,
               (SELECT ISNULL(SUM(costo), 0) FROM #r WHERE actual = 1 AND canal = k.canal) AS rc,
               (SELECT ISNULL(SUM(descuento_base), 0) FROM #pa WHERE actual = 1 AND canal = k.canal) AS pd,
               (SELECT ISNULL(SUM(fee_base), 0) FROM #pa WHERE actual = 1 AND canal = k.canal) AS pf,
               (SELECT ISNULL(SUM(withheld), 0) FROM #pa WHERE actual = 1 AND canal = k.canal) AS pr
          FROM canales k)
    SELECT x.canal,
           CASE WHEN x.canal = N'LOCAL' THEN N'Mostrador'
                ELSE COALESCE(n.name, (SELECT MAX(canal_nombre) FROM #v WHERE canal = x.canal), x.canal) END AS nombre,
           pc.platform AS plataforma,
           x.tickets,
           CAST(x.vb - x.rb AS DECIMAL(14, 2)) AS ventas,
           CAST(x.pd AS DECIMAL(14, 2)) AS descuentos_plataforma,
           CAST(x.vb - x.rb - x.pd AS DECIMAL(14, 2)) AS ventas_netas,
           CAST(x.vc - x.rc AS DECIMAL(14, 2)) AS costo,
           CAST(x.pf AS DECIMAL(14, 2)) AS comisiones_plataforma,
           CAST(x.vb - x.rb - x.pd - (x.vc - x.rc) - x.pf AS DECIMAL(14, 2)) AS utilidad,
           CAST(CASE WHEN x.vb - x.rb - x.pd > 0 THEN 100 * (x.vb - x.rb - x.pd - (x.vc - x.rc) - x.pf) / (x.vb - x.rb - x.pd) END AS DECIMAL(7, 2)) AS margen,
           CAST(x.pr AS DECIMAL(14, 2)) AS retenciones_plataforma,
           /* Canal de plataforma con ventas y sin ninguna liquidación en el
              periodo: su utilidad todavía es la del ticket, no la real. */
           CAST(CASE WHEN pc.platform IS NOT NULL AND x.pd = 0 AND x.pf = 0 THEN 1 ELSE 0 END AS BIT) AS sin_liquidar
      FROM x
      LEFT JOIN #cn n ON n.id = x.canal
      LEFT JOIN dbo.platform_channels pc ON pc.channel_id = x.canal
     ORDER BY CASE WHEN x.canal = N'LOCAL' THEN 0 ELSE 1 END, x.vb - x.rb DESC;
END;
GO

/* ---------- sp_rendimiento_ajustar (SQL_STORED_PROCEDURE) ---------- */
/* sp_rendimiento_ajustar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0095 · CAMBIA CUÁNTOS TACOS RINDE UN KILO DE UNA CARNE.

   Lo usa «Ajustar a 13.5» cuando la carne lleva días rindiendo distinto. Los
   conteos ya hechos conservan el número con el que se contaron; los platillos
   que se venden por kilo se recalculan con el nuevo. */
CREATE OR ALTER PROCEDURE dbo.sp_rendimiento_ajustar
    @carne_id INT,
    @rinde DECIMAL(6, 2)
AS
BEGIN
    SET NOCOUNT ON;
    IF @rinde IS NULL OR @rinde < 1 OR @rinde > 60 THROW 51000, 'Los tacos por kilo van de 1 a 60.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.rendimiento_carnes WHERE product_id = @carne_id)
        THROW 51000, 'Esa carne no se lleva por rendimiento.', 1;

    UPDATE dbo.rendimiento_carnes SET rinde = @rinde, actualizado = SYSDATETIME() WHERE product_id = @carne_id;
    EXEC dbo.sp_rendimiento_mapear;

    SELECT product_id AS carne_id, rinde FROM dbo.rendimiento_carnes WHERE product_id = @carne_id;
END;
GO

/* ---------- sp_rendimiento_cierre (SQL_STORED_PROCEDURE) ---------- */
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

/* ---------- sp_rendimiento_config (SQL_STORED_PROCEDURE) ---------- */
/* sp_rendimiento_config
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0095 · LAS CARNES QUE SE LLEVAN POR RENDIMIENTO, Y LO QUE CUENTA CADA PLATILLO.

   1  carnes: el insumo, cuántos tacos rinde un kilo, si está activa, su
      clave (CARNE-<CLAVE>), existencia y costo por kilo, la presentación de
      compra «Kilo» y la última compra (precio por kilo y proveedor), que es
      lo que «Llegó la carne» ofrece ya escrito.
   2  platillos: qué producto vendido cuenta cuántos tacos de qué carne. */
CREATE OR ALTER PROCEDURE dbo.sp_rendimiento_config
AS
BEGIN
    SET NOCOUNT ON;

    SELECT c.product_id AS carne_id, p.nombre, p.part_number AS clave, c.rinde, c.activo, c.desde,
           CAST(p.stock / 1000.0 AS DECIMAL(12, 3)) AS existencia_kg,
           CAST(ISNULL(p.cost, 0) * 1000 AS DECIMAL(12, 2)) AS costo_kg,
           (SELECT TOP 1 pp.id FROM dbo.product_presentations pp
             WHERE pp.product_id = p.id AND pp.active = 1 AND pp.factor_to_base = 1000
             ORDER BY pp.is_default DESC, pp.id) AS presentacion_kilo,
           u.precio_kg AS ultimo_precio_kg, u.supplier_id AS ultimo_proveedor,
           (SELECT COUNT(*) FROM dbo.rendimiento_platillos rp WHERE rp.carne_id = c.product_id) AS platillos
      FROM dbo.rendimiento_carnes c
      JOIN dbo.products p ON p.id = c.product_id
      /* `puchase_id` y `unitary_price`: así se llaman las columnas desde siempre. */
      OUTER APPLY (SELECT TOP 1 CAST(d.unitary_price / NULLIF(ISNULL(d.factor_to_base, 1), 0) * 1000 AS DECIMAL(12, 2)) AS precio_kg,
                          pu.supplier_id
                     FROM dbo.purchase_detail d
                     JOIN dbo.purchase pu ON pu.id = d.puchase_id
                    WHERE d.product_id = p.id AND d.unitary_price > 0
                    ORDER BY pu.datee DESC, d.id DESC) u
     ORDER BY c.activo DESC, p.nombre;

    SELECT rp.product_id, p.nombre, rp.carne_id, rp.tacos, rp.manual
      FROM dbo.rendimiento_platillos rp
      JOIN dbo.products p ON p.id = rp.product_id
     ORDER BY rp.carne_id, p.nombre;
END;
GO

/* ---------- sp_rendimiento_contar (SQL_STORED_PROCEDURE) ---------- */
/* sp_rendimiento_contar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0095 · GUARDA LO QUE QUEDÓ DE CADA CARNE AL CERRAR.

   @conteos: [{"carne_id": 12, "quedo_kg": 2.5}, …]   (las que se contestaron)

   Por cada una, en UNA transacción:
     usado = lo que había − lo que quedó
       · sale del inventario como salida RENDIMIENTO, a su costo de hoy: el
         estado de resultados la reparte entre los tacos vendidos;
       · si quedó MÁS de lo que había (una compra que no se capturó), la
         diferencia entra como ajuste de CONTEO y lo usado es 0;
     la existencia queda en lo que quedó;
     se guarda el conteo con los tacos vendidos desde el anterior.

   Reintentar el mismo corte no cuenta dos veces: la carne ya contada en él
   se salta. Devuelve cómo rindió (sp_rendimiento_dia). */
CREATE OR ALTER PROCEDURE dbo.sp_rendimiento_contar
    @closure_id INT = NULL,
    @user_id INT = NULL,
    @conteos NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF ISJSON(@conteos) <> 1 THROW 51000, 'Los conteos no son válidos.', 1;
    IF @closure_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.cash_closures WHERE id = @closure_id)
        THROW 51000, 'El corte indicado no existe.', 1;

    DECLARE @l TABLE (carne_id INT PRIMARY KEY, quedo DECIMAL(12, 2));
    INSERT INTO @l (carne_id, quedo)
    SELECT carne_id, ROUND(MAX(quedo_kg) * 1000, 2)
      FROM OPENJSON(@conteos) WITH (carne_id INT, quedo_kg DECIMAL(12, 3))
     WHERE carne_id IS NOT NULL AND quedo_kg IS NOT NULL
     GROUP BY carne_id;

    IF EXISTS (SELECT 1 FROM @l WHERE quedo < 0 OR quedo > 100000000)
        THROW 51000, 'Lo que quedó tiene que ser de 0 kg en adelante.', 1;
    IF EXISTS (SELECT 1 FROM @l l WHERE NOT EXISTS (SELECT 1 FROM dbo.rendimiento_carnes c WHERE c.product_id = l.carne_id AND c.activo = 1))
        THROW 51000, 'Esa carne no se lleva por rendimiento.', 1;

    /* Lo que el cierre ve en este momento (tenía, vendidos, precio). */
    DECLARE @vista TABLE (carne_id INT, nombre NVARCHAR(100), rinde DECIMAL(6, 2), desde DATETIME2(3), tenia_kg DECIMAL(12, 3),
                          comprado_kg DECIMAL(12, 3), vendidos DECIMAL(12, 2), precio_taco DECIMAL(10, 2), costo_kg DECIMAL(12, 2),
                          contado BIT, quedo_kg DECIMAL(12, 3));

    BEGIN TRAN;

    /* Nadie más mueve estas carnes mientras se cuentan. */
    DECLARE @bloqueo INT = (SELECT COUNT(*) FROM dbo.products WITH (UPDLOCK, HOLDLOCK) WHERE id IN (SELECT carne_id FROM @l));

    INSERT INTO @vista EXEC dbo.sp_rendimiento_cierre @closure_id = @closure_id;

    DECLARE @ahora DATETIME2(3) = SYSDATETIME();

    ;WITH x AS (
        SELECT l.carne_id, l.quedo, p.stock AS tenia, ISNULL(p.cost, 0) AS costo_g, v.desde, v.vendidos, v.precio_taco, v.rinde
          FROM @l l
          JOIN @vista v ON v.carne_id = l.carne_id AND v.contado = 0
          JOIN dbo.products p ON p.id = l.carne_id)
    SELECT * INTO #x FROM x;

    /* Lo usado sale a su costo; lo que sobró de más entra como ajuste. */
    INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source, unit_cost)
    SELECT carne_id, 'salida', 'RENDIMIENTO', tenia - quedo, @ahora, N'Carne usada (cierre)', 'RENDIMIENTO', costo_g
      FROM #x WHERE tenia - quedo > 0
    UNION ALL
    SELECT carne_id, 'entrada', 'CONTEO', quedo - tenia, @ahora, N'Quedó más carne de la que había', 'RENDIMIENTO', costo_g
      FROM #x WHERE quedo - tenia > 0;

    UPDATE p SET stock = x.quedo
      FROM dbo.products p JOIN #x x ON x.carne_id = p.id;

    INSERT INTO dbo.rendimiento_conteos (carne_id, closure_id, desde, contado_en, tenia, quedo, usado, vendidos, rinde, costo_g, precio_taco, user_id)
    SELECT carne_id, @closure_id, desde, @ahora, tenia, quedo,
           CASE WHEN tenia > quedo THEN tenia - quedo ELSE 0 END, vendidos, rinde, costo_g, precio_taco, @user_id
      FROM #x;

    COMMIT;

    EXEC dbo.sp_rendimiento_dia @closure_id = @closure_id;
END;
GO

/* ---------- sp_rendimiento_dia (SQL_STORED_PROCEDURE) ---------- */
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

/* ---------- sp_rendimiento_guardar (SQL_STORED_PROCEDURE) ---------- */
/* sp_rendimiento_guardar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0095 · «¿QUÉ CARNES USAS Y CUÁNTOS TACOS TE SALEN POR KILO?»

   @carnes: [{"clave":"pastor","nombre":"Pastor","rinde":14,"activo":true}, …]

   Una carne que todavía no existe nace como insumo de verdad, por el mismo
   alta que Inventario (sp_add_product): en GRAMOS, no vendible, con su
   presentación de compra «Kilo» = 1000 g y clave CARNE-<CLAVE>. Así Compras,
   Inventario y el kárdex la ven como cualquier otro insumo.

   Apagar una carne no borra nada: deja de preguntarse al cierre. Volver a
   encenderla conserva su historia.

   Al final se recalcula qué platillo cuenta tacos de qué carne y se devuelve
   la configuración (sp_rendimiento_config). */
CREATE OR ALTER PROCEDURE dbo.sp_rendimiento_guardar
    @carnes NVARCHAR(MAX),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF ISJSON(@carnes) <> 1 THROW 51000, 'La lista de carnes no es válida.', 1;

    DECLARE @l TABLE (n INT IDENTITY(1, 1), clave NVARCHAR(40), nombre NVARCHAR(100), rinde DECIMAL(6, 2), activo BIT);
    INSERT INTO @l (clave, nombre, rinde, activo)
    SELECT UPPER(LTRIM(RTRIM(clave))), LTRIM(RTRIM(nombre)), rinde, ISNULL(activo, 1)
      FROM OPENJSON(@carnes) WITH (clave NVARCHAR(40), nombre NVARCHAR(100), rinde DECIMAL(6, 2), activo BIT);

    IF EXISTS (SELECT 1 FROM @l WHERE ISNULL(clave, N'') = N'' OR ISNULL(nombre, N'') = N'')
        THROW 51000, 'Cada carne necesita su nombre.', 1;
    IF EXISTS (SELECT 1 FROM @l WHERE activo = 1 AND (rinde IS NULL OR rinde < 1 OR rinde > 60))
        THROW 51000, 'Los tacos por kilo van de 1 a 60.', 1;
    IF EXISTS (SELECT clave FROM @l GROUP BY clave HAVING COUNT(*) > 1)
        THROW 51000, 'Una carne viene dos veces.', 1;

    BEGIN TRAN;

    DECLARE @cat INT = (SELECT TOP 1 id FROM dbo.CAT_categories WHERE namee = N'Carnes' ORDER BY id);
    DECLARE @marca INT = (SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id);
    DECLARE @salida TABLE (id DECIMAL(18, 0));

    DECLARE @i INT = 1, @n INT = (SELECT COUNT(*) FROM @l);
    WHILE @i <= @n
    BEGIN
        DECLARE @clave NVARCHAR(40), @nombre NVARCHAR(100), @rinde DECIMAL(6, 2), @activo BIT, @pn NVARCHAR(100), @pid INT;
        SELECT @clave = clave, @nombre = nombre, @rinde = rinde, @activo = activo FROM @l WHERE n = @i;
        SET @pn = N'CARNE-' + @clave;
        SET @pid = (SELECT id FROM dbo.products WHERE part_number = @pn);

        IF @pid IS NULL AND @activo = 1
        BEGIN
            IF @cat IS NULL
            BEGIN
                INSERT INTO dbo.CAT_categories (namee) VALUES (N'Carnes');
                SET @cat = SCOPE_IDENTITY();
            END;
            IF @marca IS NULL
            BEGIN
                INSERT INTO dbo.CAT_brands (namee) VALUES (N'Casa');
                SET @marca = SCOPE_IDENTITY();
            END;
            DELETE FROM @salida;
            INSERT INTO @salida (id)
            EXEC dbo.sp_add_product @brand = @marca, @part_number = @pn, @name = @nombre, @price = 0, @stock = 0,
                 @category = @cat, @objeto_impuesto = '02', @tasa_iva = 0, @inventory_mode = 'DIRECT',
                 @sellable = 0, @base_uom = 'g', @allow_decimal_qty = 1;
            SET @pid = (SELECT id FROM dbo.products WHERE part_number = @pn);
            DELETE FROM @salida;
            INSERT INTO @salida (id)
            EXEC dbo.sp_save_product_presentation @product_id = @pid, @name = N'Kilo', @factor_to_base = 1000, @is_default = 1;
        END;

        IF @pid IS NOT NULL
        BEGIN
            IF EXISTS (SELECT 1 FROM dbo.rendimiento_carnes WHERE product_id = @pid)
                UPDATE dbo.rendimiento_carnes
                   SET rinde = ISNULL(@rinde, rinde), activo = @activo, actualizado = SYSDATETIME()
                 WHERE product_id = @pid;
            ELSE IF @activo = 1
                INSERT INTO dbo.rendimiento_carnes (product_id, rinde, activo) VALUES (@pid, @rinde, 1);
        END;
        SET @i += 1;
    END;

    EXEC dbo.sp_rendimiento_mapear;
    COMMIT;

    EXEC dbo.sp_rendimiento_config;
END;
GO

/* ---------- sp_rendimiento_mapear (SQL_STORED_PROCEDURE) ---------- */
/* sp_rendimiento_mapear
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0095 · QUÉ PLATILLO CUENTA TACOS DE QUÉ CARNE.

   Sin que nadie lo configure: por el NOMBRE. Un producto que se vende y
   cuyo nombre lleva el de la carne («Taco al pastor», «Gringa al pastor»,
   «Orden de 5 al pastor») cuenta tacos de esa carne, sin importar acentos ni
   mayúsculas:

     «… kilo …» / «… kg …»      rinde × los kilos (½ y ¼ se entienden)
     «Orden de 5», «3 tacos»     el número
     lo demás                    1 taco

   Lo que una persona fijó a mano (`manual = 1`) no se toca. Se vuelve a
   calcular al guardar las carnes, al ajustar un rendimiento y antes de cada
   cierre, así un platillo nuevo del menú entra solo. */
CREATE OR ALTER PROCEDURE dbo.sp_rendimiento_mapear
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM dbo.rendimiento_platillos WHERE manual = 0;

    ;WITH cand AS (
        SELECT p.id AS product_id, c.product_id AS carne_id, c.rinde,
               LOWER(p.nombre) COLLATE Modern_Spanish_CI_AI AS nom,
               PATINDEX(N'%[0-9]%', p.nombre) AS pos, p.nombre
          FROM dbo.rendimiento_carnes c
          JOIN dbo.products ci ON ci.id = c.product_id
          JOIN dbo.products p
            ON p.sellable = 1 AND ISNULL(p.active, 1) = 1 AND p.id <> c.product_id
           AND p.nombre COLLATE Modern_Spanish_CI_AI LIKE N'%' + LTRIM(RTRIM(ci.nombre)) COLLATE Modern_Spanish_CI_AI + N'%'
         WHERE c.activo = 1
           AND NOT EXISTS (SELECT 1 FROM dbo.rendimiento_platillos m WHERE m.product_id = p.id AND m.carne_id = c.product_id)),
    num AS (
        SELECT cand.*,
               CASE WHEN pos > 0 THEN TRY_CONVERT(INT, SUBSTRING(nombre, pos,
                    ISNULL(NULLIF(PATINDEX(N'%[^0-9]%', SUBSTRING(nombre, pos, 10) + N'x'), 0), 1) - 1)) END AS n
          FROM cand)
    INSERT INTO dbo.rendimiento_platillos (product_id, carne_id, tacos, manual)
    SELECT product_id, carne_id,
           CASE WHEN nom LIKE N'%kilo%' OR nom LIKE N'% kg%'
                THEN rinde * CASE WHEN nom LIKE N'%1/2%' OR nom LIKE N'%medio%' THEN 0.5
                                  WHEN nom LIKE N'%1/4%' OR nom LIKE N'%cuarto%' THEN 0.25
                                  ELSE 1 END
                WHEN n BETWEEN 2 AND 50 AND (nom LIKE N'%orden%' OR nom LIKE N'%taco%') THEN n
                ELSE 1 END,
           0
      FROM num;
END;
GO

/* ---------- sp_rendimiento_mes (SQL_STORED_PROCEDURE) ---------- */
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
