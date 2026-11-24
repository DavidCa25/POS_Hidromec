/* sp_purchase_order_suggestions
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0090 · EL PEDIDO SUGERIDO, POR PROVEEDOR.
   0092 · ...CON LO QUE ENSENAN LAS COMPRAS.

   Que productos y su consumo de 30 dias salen de sp_reorder_suggestions
   (mismas reglas: solo DIRECT se compra; una receta se repone comprando su
   ingrediente). Aqui se decide a quien, cuanto y cuando:

     ritmo       consumo / DIAS CON EXISTENCIA, no / 30. Se descuentan los
                 dias agotado (de la ultima salida a hoy, si hoy no hay) y los
                 dias antes de su primera entrada (producto nuevo). Minimo 7
                 dias, para que dos dias de venta no se vuelvan tendencia.
     proveedor   el ligado al producto (is_default, luego el primero activo);
                 si no tiene, el de la ULTIMA COMPRA. Sin ninguno, NULL y la
                 pantalla lo junta en «Sin proveedor».
     presentacion la de la ultima compra a ese proveedor (si sigue activa y
                 es de mas de una pieza); si no, la predeterminada.
     costo       por UNIDAD BASE: el de la ultima compra a ese proveedor; si
                 no, products.cost; si no, el apuntado al ligar el proveedor.
     ciclo       cada cuantos dias se le compra (3 o mas dias de compra en
                 120). El pedido cubre hasta su siguiente visita, no 7 dias
                 fijos, y entra lo que se acaba antes de que vuelva.
     entrega     cuanto tarda en surtir: de un pedido mandado o copiado
                 (purchase_order_sent) a la compra que llega despues, 14 dias
                 o menos. Se suma a la cobertura.
     pedir       lo que falta para la cobertura, redondeado hacia arriba a la
                 presentacion.

   Solo lee. No crea pedidos ni compras: eso lo hace la persona en Compras. */
CREATE OR ALTER PROCEDURE dbo.sp_purchase_order_suggestions
    @dias_alerta   INT = 7,
    @dias_objetivo INT = 7
AS
BEGIN
    SET NOCOUNT ON;
    IF @dias_alerta   IS NULL OR @dias_alerta   < 0 SET @dias_alerta   = 7;
    IF @dias_objetivo IS NULL OR @dias_objetivo <= 0 SET @dias_objetivo = 7;

    DECLARE @hoy DATE = CAST(GETDATE() AS DATE);
    DECLARE @desde DATE = DATEADD(DAY, -30, @hoy);

    CREATE TABLE #r (
        id INT, nombre NVARCHAR(200), part_number NVARCHAR(100), inventory_mode NVARCHAR(20), base_uom NVARCHAR(10),
        stock DECIMAL(18, 2), vendido_ventana DECIMAL(18, 2), prom_diario DECIMAL(12, 2), dias_restantes INT,
        sugerido DECIMAL(18, 4), limita_nombre NVARCHAR(200), limita_stock DECIMAL(18, 4), limita_uom NVARCHAR(10), limita_necesita DECIMAL(18, 6));
    /* Todo lo que se consume: el horizonte se decide aqui, por proveedor. */
    INSERT INTO #r EXEC dbo.sp_reorder_suggestions @dias_ventana = 30, @dias_alerta = 36500, @dias_objetivo = @dias_objetivo;
    DELETE FROM #r WHERE inventory_mode <> 'DIRECT';

    /* ---- ritmo por dias con existencia ---- */
    SELECT r.id, r.stock, r.vendido_ventana,
           CASE WHEN r.stock <= 0 AND m.ult_salida IS NOT NULL
                THEN DATEDIFF(DAY, CAST(m.ult_salida AS DATE), @hoy) ELSE 0 END AS dias_sin,
           CASE WHEN m.primera > @desde THEN DATEDIFF(DAY, @desde, CAST(m.primera AS DATE)) ELSE 0 END AS dias_antes
      INTO #rit
      FROM #r r
      OUTER APPLY (
          SELECT MAX(CASE WHEN x.typee = 'salida' AND x.source IN ('SALE', 'RECIPE', 'APERTURA') THEN x.datee END) AS ult_salida,
                 MIN(CASE WHEN x.typee = 'entrada' THEN x.datee END) AS primera
            FROM dbo.inventory_movements x
           WHERE x.product_id = r.id
      ) m;

    /* ---- la ultima compra de cada producto (cualquier proveedor) ---- */
    SELECT pd.product_id, pu.supplier_id, pd.presentation_id, pu.datee,
           CAST(pd.unitary_price / NULLIF(pd.factor_to_base, 0) AS DECIMAL(14, 4)) AS costo_base,
           ROW_NUMBER() OVER (PARTITION BY pd.product_id, pu.supplier_id ORDER BY pu.datee DESC, pd.id DESC) AS k_prov,
           ROW_NUMBER() OVER (PARTITION BY pd.product_id ORDER BY pu.datee DESC, pd.id DESC) AS k
      INTO #ult
      FROM dbo.purchase_detail pd
      JOIN dbo.purchase pu ON pu.id = pd.puchase_id
      JOIN #r r ON r.id = pd.product_id
     WHERE pd.unitary_price > 0 AND pu.supplier_id IS NOT NULL;

    /* ---- a quien ---- */
    ;WITH prov AS (
        SELECT ps.product_id, ps.supplier_id, ps.last_cost,
               ROW_NUMBER() OVER (PARTITION BY ps.product_id ORDER BY ps.is_default DESC, ps.supplier_id) AS k
          FROM dbo.product_suppliers ps
          JOIN dbo.CAT_suppliers s ON s.id = ps.supplier_id AND ISNULL(s.activo, 1) = 1
         WHERE ps.active = 1
    )
    SELECT r.id, COALESCE(pv.supplier_id, u.supplier_id) AS supplier_id, pv.last_cost
      INTO #quien
      FROM #r r
      LEFT JOIN prov pv ON pv.product_id = r.id AND pv.k = 1
      LEFT JOIN #ult u ON u.product_id = r.id AND u.k = 1;
    /* Un proveedor aprendido que ya se dio de baja no se propone. */
    UPDATE q SET supplier_id = NULL
      FROM #quien q
      LEFT JOIN dbo.CAT_suppliers s ON s.id = q.supplier_id
     WHERE q.supplier_id IS NOT NULL AND (s.id IS NULL OR ISNULL(s.activo, 1) = 0);

    /* ---- ciclo y entrega de cada proveedor ---- */
    ;WITH visitas AS (
        SELECT DISTINCT supplier_id, CAST(datee AS DATE) AS dia
          FROM dbo.purchase
         WHERE supplier_id IS NOT NULL AND datee >= DATEADD(DAY, -120, @hoy)
    ),
    ciclo AS (
        SELECT supplier_id, COUNT(*) AS n, MIN(dia) AS primera, MAX(dia) AS ultima
          FROM visitas GROUP BY supplier_id HAVING COUNT(*) >= 3
    ),
    enviados AS (
        SELECT s.supplier_id, s.sent_at,
               (SELECT MIN(pu.datee) FROM dbo.purchase pu
                 WHERE pu.supplier_id = s.supplier_id AND pu.datee >= s.sent_at
                   AND pu.datee < DATEADD(DAY, 14, s.sent_at)) AS llego,
               ROW_NUMBER() OVER (PARTITION BY s.supplier_id ORDER BY s.sent_at DESC) AS k
          FROM dbo.purchase_order_sent s
         WHERE s.sent_at >= DATEADD(DAY, -180, @hoy)
    ),
    entrega AS (
        SELECT supplier_id, CAST(ROUND(AVG(DATEDIFF(HOUR, sent_at, llego) / 24.0), 0) AS INT) AS dias
          FROM enviados WHERE llego IS NOT NULL AND k <= 5 GROUP BY supplier_id
    )
    SELECT s.id AS supplier_id,
           CAST(CEILING(DATEDIFF(DAY, c.primera, c.ultima) * 1.0 / (c.n - 1)) AS INT) AS ciclo_dias,
           c.ultima, e.dias AS entrega_dias
      INTO #prov
      FROM dbo.CAT_suppliers s
      LEFT JOIN ciclo c ON c.supplier_id = s.id
      LEFT JOIN entrega e ON e.supplier_id = s.id
     WHERE c.supplier_id IS NOT NULL OR e.supplier_id IS NOT NULL;

    /* ---- cuanto ---- */
    ;WITH pres AS (
        SELECT pp.product_id, pp.id, pp.name, pp.factor_to_base,
               ROW_NUMBER() OVER (PARTITION BY pp.product_id ORDER BY pp.is_default DESC, pp.id) AS k
          FROM dbo.product_presentations pp
         WHERE pp.active = 1 AND pp.factor_to_base > 1
    ),
    calc AS (
        SELECT r.id, r.nombre, r.base_uom, r.stock, q.supplier_id,
               CASE WHEN dc.dias < 7 THEN 7 WHEN dc.dias > 30 THEN 30 ELSE dc.dias END AS dias_con,
               pv.ciclo_dias, pv.entrega_dias, pv.ultima,
               r.vendido_ventana,
               /* la presentacion de la ultima compra a ese proveedor, si sigue viva */
               COALESCE(ppu.id, pr.id) AS presentation_id,
               COALESCE(ppu.name, pr.name) AS presentation_name,
               COALESCE(ppu.factor_to_base, pr.factor_to_base) AS factor,
               COALESCE(NULLIF(uq.costo_base, 0), NULLIF(p.cost, 0), q.last_cost, 0) AS costo
          FROM #r r
          JOIN dbo.products p ON p.id = r.id
          JOIN #rit rt ON rt.id = r.id
          JOIN #quien q ON q.id = r.id
          CROSS APPLY (SELECT 30 - rt.dias_sin - rt.dias_antes AS dias) dc
          LEFT JOIN #prov pv ON pv.supplier_id = q.supplier_id
          LEFT JOIN #ult uq ON uq.product_id = r.id AND uq.supplier_id = q.supplier_id AND uq.k_prov = 1
          LEFT JOIN dbo.product_presentations ppu ON ppu.id = uq.presentation_id AND ppu.active = 1 AND ppu.factor_to_base > 1
          LEFT JOIN pres pr ON pr.product_id = r.id AND pr.k = 1
    ),
    plan_ AS (
        SELECT c.*,
               CAST(c.vendido_ventana / c.dias_con AS DECIMAL(18, 6)) AS prom,
               (CASE WHEN ISNULL(c.ciclo_dias, 0) > @dias_objetivo THEN c.ciclo_dias ELSE @dias_objetivo END)
                 + ISNULL(c.entrega_dias, 0) AS cobertura,
               CASE WHEN ISNULL(c.ciclo_dias, 0) + ISNULL(c.entrega_dias, 0) > @dias_alerta
                    THEN ISNULL(c.ciclo_dias, 0) + ISNULL(c.entrega_dias, 0) ELSE @dias_alerta END AS horizonte
          FROM calc c
    ),
    fin AS (
        SELECT pl.*,
               CAST(FLOOR(CASE WHEN pl.stock <= 0 THEN 0 ELSE pl.stock / pl.prom END) AS INT) AS dias_restantes,
               CEILING(pl.prom * pl.cobertura) - pl.stock AS falta
          FROM plan_ pl
    )
    SELECT f.supplier_id, s.nombre AS supplier_name, s.telefono AS supplier_phone,
           f.id AS product_id, f.nombre AS product_name, f.base_uom, f.stock,
           CAST(f.prom AS DECIMAL(12, 2)) AS prom_diario, f.dias_restantes,
           f.presentation_id, f.presentation_name, CAST(f.factor AS DECIMAL(18, 4)) AS presentation_factor,
           CAST(CASE WHEN f.factor > 1 THEN CEILING(f.falta / f.factor) * f.factor
                     ELSE CEILING(f.falta) END AS DECIMAL(18, 2)) AS pedir,
           CAST(f.costo AS DECIMAL(12, 4)) AS costo,
           /* 0092: lo que aprendio, para decirlo en pantalla */
           f.dias_con AS dias_con_existencia, f.ciclo_dias, f.entrega_dias, f.cobertura AS cobertura_dias,
           CASE WHEN f.ciclo_dias IS NOT NULL THEN DATEADD(DAY, f.ciclo_dias, f.ultima) END AS proxima_compra
      FROM fin f
      LEFT JOIN dbo.CAT_suppliers s ON s.id = f.supplier_id
     WHERE f.prom > 0 AND f.falta > 0 AND f.dias_restantes <= f.horizonte
     ORDER BY CASE WHEN f.supplier_id IS NULL THEN 1 ELSE 0 END, s.nombre, f.dias_restantes, f.nombre;
END
GO
