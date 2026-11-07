/* sp_socios_calcular
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================== sp_socios_calcular (0079) =======================
   Los numeros de cada socio en un periodo [@desde, @hasta] (fechas
   incluidas). Llena la tabla temporal #res que CREA QUIEN LLAMA
   (sp_socios_resumen, sp_socios_liquidar):

       CREATE TABLE #res (socio_id INT PRIMARY KEY, vendido, costo, ganancia,
                          gastos, anticipos, aportaciones, retiros, faltantes
                          DECIMAL(18, 6) NOT NULL DEFAULT 0);

   vendido       lo que vendio como dueno del producto (informativo)
   costo         el costo de sus insumos que se vendieron: se le devuelve
   ganancia      su parte de la ganancia
   gastos        su parte de los gastos (de el, divididos o comunes)
   anticipos     lo suyo que se compro con dinero del negocio
   aportaciones  gastos que pago de su bolsa y dinero que metio
   retiros       lo que se llevo (retiros y pagos de saldo)
   faltantes     su parte del faltante (o sobrante, en negativo) de los cortes

   resultado = costo + ganancia - gastos - anticipos + aportaciones
               - retiros - faltantes

   Lo vendido se lee de socios_reparto (congelado). Los gastos COMUNES se
   reparten con la regla de HOY sobre el periodo: por eso una liquidacion se
   cierra y ya no cambia.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_calcular
    @desde DATE,
    @hasta DATE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @inicio DATE, @gasto_regla VARCHAR(8), @faltante_regla VARCHAR(8);
    SELECT @inicio = inicio, @gasto_regla = gasto_regla, @faltante_regla = faltante_regla
      FROM dbo.socios_config WHERE id = 1;
    IF @inicio IS NULL RETURN;
    IF @desde < @inicio SET @desde = @inicio;
    DECLARE @fin DATETIME2(0) = DATEADD(DAY, 1, CAST(@hasta AS DATETIME2(0)));
    DECLARE @ini DATETIME2(0) = CAST(@desde AS DATETIME2(0));

    EXEC dbo.sp_socios_asignar;

    /* Todo socio activo sale, aunque no tenga movimientos; uno inactivo solo
       si tiene algo en el periodo. */
    INSERT INTO #res (socio_id) SELECT id FROM dbo.socios WHERE activo = 1;

    DECLARE @n INT = (SELECT COUNT(*) FROM dbo.socios WHERE activo = 1);

    /* --------------------------------------------------------- vendido */
    ;WITH v AS (
        SELECT socio_id, SUM(ingreso) AS ingreso, SUM(costo) AS costo, SUM(ganancia) AS ganancia
          FROM dbo.socios_reparto WHERE fecha >= @ini AND fecha < @fin
         GROUP BY socio_id
    )
    MERGE #res AS d USING v ON d.socio_id = v.socio_id
    WHEN MATCHED THEN UPDATE SET vendido = v.ingreso, costo = v.costo, ganancia = v.ganancia
    WHEN NOT MATCHED THEN INSERT (socio_id, vendido, costo, ganancia) VALUES (v.socio_id, v.ingreso, v.costo, v.ganancia);

    /* Pesos para lo que se reparte "por ventas": lo que vendio cada uno en el
       periodo. Sin ventas, partes iguales. */
    CREATE TABLE #peso (socio_id INT PRIMARY KEY, w DECIMAL(18, 8) NOT NULL);
    DECLARE @vt DECIMAL(18, 6) = (SELECT SUM(vendido) FROM #res WHERE vendido > 0);
    IF ISNULL(@vt, 0) > 0
        INSERT INTO #peso SELECT socio_id, vendido / @vt FROM #res WHERE vendido > 0;
    ELSE
        INSERT INTO #peso SELECT id, 1.0 / @n FROM dbo.socios WHERE activo = 1;

    /* Pesos de los gastos comunes. */
    CREATE TABLE #pg (socio_id INT PRIMARY KEY, w DECIMAL(18, 8) NOT NULL);
    IF @gasto_regla = 'VENTAS'
        INSERT INTO #pg SELECT socio_id, w FROM #peso;
    ELSE IF @gasto_regla = 'FIJO' AND (SELECT SUM(pct_fijo) FROM dbo.socios WHERE activo = 1) > 0
        INSERT INTO #pg SELECT id, pct_fijo / (SELECT SUM(pct_fijo) FROM dbo.socios WHERE activo = 1)
          FROM dbo.socios WHERE activo = 1 AND ISNULL(pct_fijo, 0) > 0;
    ELSE
        INSERT INTO #pg SELECT id, 1.0 / @n FROM dbo.socios WHERE activo = 1;

    /* ---------------------------------------------------------- gastos */
    ;WITH g AS (
        SELECT e.id, e.amount, sg.modo, sg.pagado_por_socio_id
          FROM dbo.expenses e
          LEFT JOIN dbo.socios_gasto sg ON sg.expense_id = e.id
         WHERE e.voided_at IS NULL AND e.expense_date >= @desde AND e.expense_date <= @hasta
    ),
    partes AS (
        SELECT l.socio_id, g.amount * l.pct / 100.0 AS m
          FROM g JOIN dbo.socios_gasto_lineas l ON l.expense_id = g.id
         WHERE g.modo = 'SOCIOS'
        UNION ALL
        SELECT p.socio_id, g.amount * p.w
          FROM g CROSS JOIN #pg p
         WHERE ISNULL(g.modo, 'COMUN') = 'COMUN'
    ),
    t AS (SELECT socio_id, SUM(m) AS m FROM partes GROUP BY socio_id)
    MERGE #res AS d USING t ON d.socio_id = t.socio_id
    WHEN MATCHED THEN UPDATE SET gastos = t.m
    WHEN NOT MATCHED THEN INSERT (socio_id, gastos) VALUES (t.socio_id, t.m);

    /* ------------------------------------------------------- anticipos
       Lo que pago el negocio de cada compra (no la que pago un socio de su
       bolsa): lo de contado en la fecha de la compra y cada abono en su
       fecha. Se reparte por renglon segun el dueno de cada producto. */
    CREATE TABLE #duenos (product_id INT NOT NULL, socio_id INT NOT NULL, pct DECIMAL(9, 6) NOT NULL,
                          PRIMARY KEY (product_id, socio_id));
    EXEC dbo.sp_socios_llenar_duenos;

    ;WITH compras AS (
        SELECT p.id, ISNULL(p.total, 0) AS total
          FROM dbo.purchase p
         WHERE NOT EXISTS (SELECT 1 FROM dbo.socios_compra c WHERE c.purchase_id = p.id)
    ),
    pagado AS (
        /* De contado: total - saldo - abonos. */
        SELECT c.id AS purchase_id,
               c.total - ISNULL(p.balance, 0) - ISNULL((SELECT SUM(sp.amount) FROM dbo.supplier_payments sp WHERE sp.purchase_id = c.id), 0) AS m
          FROM compras c JOIN dbo.purchase p ON p.id = c.id
         WHERE p.datee >= @ini AND p.datee < @fin
        UNION ALL
        SELECT sp.purchase_id, sp.amount
          FROM dbo.supplier_payments sp
          JOIN compras c ON c.id = sp.purchase_id
         WHERE sp.datee >= @ini AND sp.datee < @fin
    ),
    renglones AS (
        SELECT d.puchase_id AS purchase_id, d.product_id, d.quantity * d.unitary_price AS sub,
               SUM(d.quantity * d.unitary_price) OVER (PARTITION BY d.puchase_id) AS tot
          FROM dbo.purchase_detail d
         WHERE d.puchase_id IN (SELECT purchase_id FROM pagado)
    ),
    partes AS (
        SELECT o.socio_id, pg.m * r.sub / r.tot * o.pct AS m
          FROM pagado pg
          JOIN renglones r ON r.purchase_id = pg.purchase_id AND r.tot > 0
          JOIN #duenos o ON o.product_id = r.product_id
         WHERE pg.m > 0
    ),
    t AS (SELECT socio_id, SUM(m) AS m FROM partes GROUP BY socio_id)
    MERGE #res AS d USING t ON d.socio_id = t.socio_id
    WHEN MATCHED THEN UPDATE SET anticipos = t.m
    WHEN NOT MATCHED THEN INSERT (socio_id, anticipos) VALUES (t.socio_id, t.m);

    /* ----------------------------------- aportaciones y retiros */
    ;WITH a AS (
        SELECT sg.pagado_por_socio_id AS socio_id, e.amount AS ap, CAST(0 AS DECIMAL(18, 6)) AS re
          FROM dbo.expenses e JOIN dbo.socios_gasto sg ON sg.expense_id = e.id
         WHERE sg.pagado_por_socio_id IS NOT NULL AND e.voided_at IS NULL
           AND e.expense_date >= @desde AND e.expense_date <= @hasta
        UNION ALL
        SELECT socio_id, CASE WHEN tipo = 'APORTACION' THEN monto ELSE 0 END,
                         CASE WHEN tipo IN ('RETIRO', 'PAGO') THEN monto ELSE 0 END
          FROM dbo.socios_movimientos WHERE fecha >= @ini AND fecha < @fin
    ),
    t AS (SELECT socio_id, SUM(ap) AS ap, SUM(re) AS re FROM a GROUP BY socio_id)
    MERGE #res AS d USING t ON d.socio_id = t.socio_id
    WHEN MATCHED THEN UPDATE SET aportaciones = t.ap, retiros = t.re
    WHEN NOT MATCHED THEN INSERT (socio_id, aportaciones, retiros) VALUES (t.socio_id, t.ap, t.re);

    /* ------------------------------------------------------ faltantes
       difference = entregado - esperado: negativo es faltante. Por corte,
       en proporcion a lo que vendio cada socio EN ESE corte, o iguales. */
    ;WITH cortes AS (
        SELECT id, -difference AS falta FROM dbo.cash_closures
         WHERE closed_at >= @ini AND closed_at < @fin AND difference <> 0
    ),
    vend AS (
        SELECT s.closure_id, x.socio_id, SUM(x.ingreso) AS v
          FROM dbo.socios_reparto x JOIN dbo.sales s ON s.id = x.sale_id
         WHERE x.origen = 'VENTA' AND s.closure_id IN (SELECT id FROM cortes)
         GROUP BY s.closure_id, x.socio_id
    ),
    vt AS (SELECT closure_id, SUM(v) AS v FROM vend GROUP BY closure_id HAVING SUM(v) > 0),
    partes AS (
        SELECT v.socio_id, c.falta * v.v / t.v AS m
          FROM cortes c JOIN vt t ON t.closure_id = c.id JOIN vend v ON v.closure_id = c.id
         WHERE @faltante_regla = 'VENTAS'
        UNION ALL
        SELECT s.id, c.falta / @n
          FROM cortes c CROSS JOIN dbo.socios s
         WHERE s.activo = 1 AND (@faltante_regla = 'IGUALES' OR NOT EXISTS (SELECT 1 FROM vt WHERE vt.closure_id = c.id))
    ),
    t AS (SELECT socio_id, SUM(m) AS m FROM partes GROUP BY socio_id)
    MERGE #res AS d USING t ON d.socio_id = t.socio_id
    WHEN MATCHED THEN UPDATE SET faltantes = t.m
    WHEN NOT MATCHED THEN INSERT (socio_id, faltantes) VALUES (t.socio_id, t.m);
END
GO
