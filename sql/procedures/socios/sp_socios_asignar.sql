/* sp_socios_asignar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ======================== sp_socios_asignar (0079) ========================
   Reparte entre los socios cada renglon vendido (y devuelto) que todavia no
   tiene reparto. Lo que reparte queda CONGELADO en socios_reparto.

   La llama la caja despues de cada venta (@sale_id) y todo resumen antes de
   leer (@sale_id NULL = todo lo pendiente). Es idempotente: un renglon ya
   repartido no se vuelve a tocar.

   POR RENGLON (docs/socios.md 1.3)
     R      ingreso = cantidad x precio cobrado.
     C(s)   costo de los insumos del socio s que gasto el renglon: los
            movimientos de inventario de ESA linea, al costo que guardo la
            venta. Sin movimientos (venta esencial, producto sin
            inventario) el costo del renglon es del dueno del producto.
     V(s)   % del socio s como dueno del producto vendido.
     A(s)   C(s) / costo total; sin costo, V(s).
     k      pct_vende / 100 (A = 1, B = 0, C = lo elegido).
     G(s)   (R - costo total) x (k V(s) + (1 - k) A(s)).
     s recibe C(s) + G(s). La suma de todos es R, al centavo de centavo: lo
     que deja el redondeo se le suma al que mas recibe.

   DEVOLUCION: el reparto de los renglones de ese producto en la venta
   original, en negativo, en proporcion a lo devuelto.

   Solo cuenta lo vendido desde socios_config.inicio.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_socios_asignar
    @sale_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'socios' AND enabled = 1)
        RETURN;
    DECLARE @inicio DATE, @k DECIMAL(9, 6);
    SELECT @inicio = inicio, @k = pct_vende / 100.0 FROM dbo.socios_config WHERE id = 1;
    IF @inicio IS NULL RETURN;
    IF NOT EXISTS (SELECT 1 FROM dbo.socios WHERE activo = 1) RETURN;

    /* ---------------------------------------------------------- renglones */
    CREATE TABLE #l (
        detail_id   INT NOT NULL PRIMARY KEY,
        sale_id     INT NOT NULL,
        fecha       DATETIME2(0) NOT NULL,
        register_id INT NULL,
        product_id  INT NOT NULL,
        r           DECIMAL(18, 6) NOT NULL,
        line_cost   DECIMAL(18, 6) NOT NULL
    );
    INSERT INTO #l (detail_id, sale_id, fecha, register_id, product_id, r, line_cost)
    SELECT d.id, s.id, CAST(s.datee AS DATETIME2(0)), s.register_id, d.product_id,
           d.quantity * d.unitary_price, ISNULL(d.quantity * d.unit_cost, 0)
      FROM dbo.sale_detail d
      JOIN dbo.sales s ON s.id = d.sale_id
     WHERE s.datee >= @inicio
       AND (@sale_id IS NULL OR s.id = @sale_id)
       AND NOT EXISTS (SELECT 1 FROM dbo.socios_reparto x WHERE x.sale_detail_id = d.id);

    CREATE TABLE #duenos (product_id INT NOT NULL, socio_id INT NOT NULL, pct DECIMAL(9, 6) NOT NULL,
                          PRIMARY KEY (product_id, socio_id));

    CREATE TABLE #rep (
        detail_id INT NOT NULL,
        socio_id  INT NOT NULL,
        ingreso   DECIMAL(18, 6) NOT NULL,
        costo     DECIMAL(18, 6) NOT NULL,
        ganancia  DECIMAL(18, 6) NOT NULL,
        PRIMARY KEY (detail_id, socio_id)
    );

    IF EXISTS (SELECT 1 FROM #l)
    BEGIN
        EXEC dbo.sp_socios_llenar_duenos;

        /* Costo de cada socio por renglon. */
        CREATE TABLE #c (detail_id INT NOT NULL, socio_id INT NOT NULL, costo DECIMAL(18, 6) NOT NULL,
                         PRIMARY KEY (detail_id, socio_id));
        INSERT INTO #c (detail_id, socio_id, costo)
        SELECT m.sale_detail_id, o.socio_id, SUM(m.quantity * ISNULL(m.unit_cost, 0) * o.pct)
          FROM dbo.inventory_movements m
          JOIN #l l ON l.detail_id = m.sale_detail_id
          JOIN #duenos o ON o.product_id = m.product_id
         WHERE m.source IN ('SALE', 'RECIPE')
         GROUP BY m.sale_detail_id, o.socio_id;

        INSERT INTO #c (detail_id, socio_id, costo)
        SELECT l.detail_id, o.socio_id, l.line_cost * o.pct
          FROM #l l
          JOIN #duenos o ON o.product_id = l.product_id
         WHERE NOT EXISTS (SELECT 1 FROM dbo.inventory_movements m
                            WHERE m.sale_detail_id = l.detail_id AND m.source IN ('SALE', 'RECIPE'));

        /* Todos los socios que tocan el renglon: vende o aporta. */
        ;WITH socios_linea AS (
            SELECT l.detail_id, o.socio_id FROM #l l JOIN #duenos o ON o.product_id = l.product_id
            UNION
            SELECT detail_id, socio_id FROM #c
        ),
        tot AS (
            SELECT l.detail_id, l.r, ISNULL(SUM(c.costo), 0) AS ctot
              FROM #l l LEFT JOIN #c c ON c.detail_id = l.detail_id
             GROUP BY l.detail_id, l.r
        )
        INSERT INTO #rep (detail_id, socio_id, ingreso, costo, ganancia)
        SELECT x.detail_id, x.socio_id,
               t.r * ISNULL(v.pct, 0),
               ISNULL(c.costo, 0),
               (t.r - t.ctot) * (@k * ISNULL(v.pct, 0)
                   + (1 - @k) * CASE WHEN t.ctot > 0 THEN ISNULL(c.costo, 0) / t.ctot ELSE ISNULL(v.pct, 0) END)
          FROM socios_linea x
          JOIN tot t ON t.detail_id = x.detail_id
          JOIN #l l ON l.detail_id = x.detail_id
          LEFT JOIN #duenos v ON v.product_id = l.product_id AND v.socio_id = x.socio_id
          LEFT JOIN #c c ON c.detail_id = x.detail_id AND c.socio_id = x.socio_id;

        /* A cuatro decimales, y lo que deja el redondeo al que mas recibe. */
        UPDATE #rep SET ingreso = ROUND(ingreso, 4), costo = ROUND(costo, 4), ganancia = ROUND(ganancia, 4);
        ;WITH dif AS (
            SELECT l.detail_id, ROUND(l.r, 4) - SUM(p.costo + p.ganancia) AS d,
                   ROUND(l.r, 4) - SUM(p.ingreso) AS di
              FROM #l l JOIN #rep p ON p.detail_id = l.detail_id
             GROUP BY l.detail_id, l.r
        ),
        mayor AS (
            SELECT detail_id, socio_id,
                   ROW_NUMBER() OVER (PARTITION BY detail_id ORDER BY costo + ganancia DESC, socio_id) AS n
              FROM #rep
        )
        UPDATE p SET ganancia = p.ganancia + d.d,
                     ingreso = CASE WHEN p.ingreso <> 0 OR d.di <> 0 THEN p.ingreso + d.di ELSE p.ingreso END
          FROM #rep p
          JOIN mayor m ON m.detail_id = p.detail_id AND m.socio_id = p.socio_id AND m.n = 1
          JOIN dif d ON d.detail_id = p.detail_id
         WHERE d.d <> 0 OR d.di <> 0;
    END

    /* -------------------------------------------------------- devoluciones */
    CREATE TABLE #dv (
        refund_detail_id INT NOT NULL PRIMARY KEY,
        sale_id     INT NOT NULL,
        product_id  INT NOT NULL,
        fecha       DATETIME2(0) NOT NULL,
        register_id INT NULL,
        monto       DECIMAL(18, 6) NOT NULL
    );
    INSERT INTO #dv (refund_detail_id, sale_id, product_id, fecha, register_id, monto)
    SELECT rd.id, r.sale_id, rd.product_id, r.datee, r.register_id,
           ISNULL(rd.commercial_amount, rd.quantity * rd.unitary_price)
      FROM dbo.sale_refund_detail rd
      JOIN dbo.sale_refunds r ON r.id = rd.refund_id
      JOIN dbo.sales s ON s.id = r.sale_id
     WHERE s.datee >= @inicio
       AND (@sale_id IS NULL OR r.sale_id = @sale_id)
       AND NOT EXISTS (SELECT 1 FROM dbo.socios_reparto x WHERE x.refund_detail_id = rd.id);

    CREATE TABLE #rdv (
        refund_detail_id INT NOT NULL,
        socio_id  INT NOT NULL,
        ingreso   DECIMAL(18, 6) NOT NULL,
        costo     DECIMAL(18, 6) NOT NULL,
        ganancia  DECIMAL(18, 6) NOT NULL,
        PRIMARY KEY (refund_detail_id, socio_id)
    );

    IF EXISTS (SELECT 1 FROM #dv)
    BEGIN
        /* Lo que ya estaba repartido de ese producto en la venta original
           (lo congelado y lo que se acaba de repartir arriba). */
        ;WITH orig AS (
            SELECT d.sale_id, d.product_id, x.socio_id, x.ingreso, x.costo, x.ganancia
              FROM dbo.socios_reparto x JOIN dbo.sale_detail d ON d.id = x.sale_detail_id
             WHERE x.origen = 'VENTA'
            UNION ALL
            SELECT l.sale_id, l.product_id, p.socio_id, p.ingreso, p.costo, p.ganancia
              FROM #rep p JOIN #l l ON l.detail_id = p.detail_id
        ),
        base AS (
            SELECT sale_id, product_id, SUM(costo + ganancia) AS r FROM orig GROUP BY sale_id, product_id
        )
        INSERT INTO #rdv (refund_detail_id, socio_id, ingreso, costo, ganancia)
        SELECT v.refund_detail_id, o.socio_id,
               -ROUND(SUM(o.ingreso) * v.monto / b.r, 4),
               -ROUND(SUM(o.costo) * v.monto / b.r, 4),
               -ROUND(SUM(o.ganancia) * v.monto / b.r, 4)
          FROM #dv v
          JOIN base b ON b.sale_id = v.sale_id AND b.product_id = v.product_id AND b.r > 0
          JOIN orig o ON o.sale_id = v.sale_id AND o.product_id = v.product_id
         GROUP BY v.refund_detail_id, o.socio_id, v.monto, b.r;

        ;WITH dif AS (
            SELECT v.refund_detail_id, -ROUND(v.monto, 4) - SUM(p.costo + p.ganancia) AS d
              FROM #dv v JOIN #rdv p ON p.refund_detail_id = v.refund_detail_id
             GROUP BY v.refund_detail_id, v.monto
        ),
        mayor AS (
            SELECT refund_detail_id, socio_id,
                   ROW_NUMBER() OVER (PARTITION BY refund_detail_id ORDER BY costo + ganancia, socio_id) AS n
              FROM #rdv
        )
        UPDATE p SET ganancia = p.ganancia + d.d
          FROM #rdv p
          JOIN mayor m ON m.refund_detail_id = p.refund_detail_id AND m.socio_id = p.socio_id AND m.n = 1
          JOIN dif d ON d.refund_detail_id = p.refund_detail_id
         WHERE d.d <> 0;
    END

    IF NOT EXISTS (SELECT 1 FROM #rep) AND NOT EXISTS (SELECT 1 FROM #rdv) RETURN;

    BEGIN TRAN;
        INSERT INTO dbo.socios_reparto (origen, sale_id, sale_detail_id, socio_id, fecha, register_id, ingreso, costo, ganancia)
        SELECT 'VENTA', l.sale_id, p.detail_id, p.socio_id, l.fecha, l.register_id, p.ingreso, p.costo, p.ganancia
          FROM #rep p JOIN #l l ON l.detail_id = p.detail_id
         WHERE NOT EXISTS (SELECT 1 FROM dbo.socios_reparto x WITH (UPDLOCK, HOLDLOCK)
                            WHERE x.sale_detail_id = p.detail_id);

        INSERT INTO dbo.socios_reparto (origen, sale_id, refund_detail_id, socio_id, fecha, register_id, ingreso, costo, ganancia)
        SELECT 'DEVOLUCION', v.sale_id, p.refund_detail_id, p.socio_id, v.fecha, v.register_id, p.ingreso, p.costo, p.ganancia
          FROM #rdv p JOIN #dv v ON v.refund_detail_id = p.refund_detail_id
         WHERE NOT EXISTS (SELECT 1 FROM dbo.socios_reparto x WITH (UPDLOCK, HOLDLOCK)
                            WHERE x.refund_detail_id = p.refund_detail_id);
    COMMIT;
END
GO
