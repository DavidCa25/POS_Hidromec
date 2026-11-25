/* ============================================================
   0092 — compras con memoria

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0092_compras-con-memoria.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0092_compras-con-memoria.sql ========== */
/* 0092 · Compras que aprenden
 *
 *   purchase_order_sent   el pedido sugerido que se mando (WhatsApp) o se
 *                         copio para un proveedor. La compra de ese proveedor
 *                         que llega despues (14 dias o menos) dice cuanto
 *                         tarda en surtir, y el pedido sugerido lo suma.
 *
 * Lo demas de 0092 son procedimientos que solo leen el historial de compras
 * (docs/auditorias/compras-que-aprenden-20261124.md).
 */
IF OBJECT_ID(N'dbo.purchase_order_sent', 'U') IS NULL
BEGIN
CREATE TABLE dbo.purchase_order_sent (
    id INT IDENTITY(1, 1) NOT NULL,
    supplier_id INT NOT NULL,
    sent_at DATETIME2(0) NOT NULL CONSTRAINT DF_purchase_order_sent_sent_at DEFAULT (sysdatetime()),
    via VARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL,
    lineas INT NOT NULL CONSTRAINT DF_purchase_order_sent_lineas DEFAULT ((0)),
    user_id INT NULL,
    CONSTRAINT PK_purchase_order_sent PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_purchase_order_sent_supplier', 'F') IS NULL
ALTER TABLE dbo.purchase_order_sent WITH CHECK ADD CONSTRAINT FK_purchase_order_sent_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.CAT_suppliers (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_purchase_order_sent_supplier' AND object_id = OBJECT_ID(N'dbo.purchase_order_sent'))
CREATE NONCLUSTERED INDEX IX_purchase_order_sent_supplier ON dbo.purchase_order_sent (supplier_id, sent_at);
GO

/* ---------- sp_alertas_costos (SQL_STORED_PROCEDURE) ---------- */
/* sp_alertas_costos
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0092 · COSTOS Y MARGENES: lo que la ultima compra dejo mal parado.

   sp_register_purchase reescribe el costo y el precio de la PIEZA, pero no
   el de los paquetes de venta (0089), y un precio editado a mano en
   Inventario no se vuelve a revisar. Tres avisos, una fila cada uno:

     PERDIDA        el precio de la pieza no cubre costo + IVA.
     PAQUETE        una presentacion de venta no cubre costo + IVA de las
                    piezas que trae.
     SUBIO          entre las dos ultimas compras el costo por unidad base
                    subio @subida_pct o mas (compras de los ultimos @dias).

   costo por unidad base sin IVA; precio y minimo con IVA, como en la caja.
   Solo lee. */
CREATE OR ALTER PROCEDURE dbo.sp_alertas_costos
    @dias       INT = 60,
    @subida_pct DECIMAL(6, 2) = 5
AS
BEGIN
    SET NOCOUNT ON;
    IF @dias IS NULL OR @dias <= 0 SET @dias = 60;
    IF @subida_pct IS NULL OR @subida_pct <= 0 SET @subida_pct = 5;

    ;WITH prod AS (
        SELECT p.id, p.nombre, p.base_uom, CAST(p.cost AS DECIMAL(14, 4)) AS costo, CAST(p.price AS DECIMAL(12, 2)) AS precio,
               CAST(1 + CASE WHEN ISNULL(p.objeto_impuesto, '02') <> '02' THEN 0 ELSE ISNULL(p.tasa_iva, 0.16) END AS DECIMAL(8, 4)) AS iva
          FROM dbo.products p
         WHERE p.active = 1 AND p.sellable = 1 AND p.inventory_mode = 'DIRECT' AND p.cost > 0
    ),
    compras AS (
        SELECT pd.product_id, pu.supplier_id, pu.datee AS fecha,
               CAST(pd.unitary_price / NULLIF(pd.factor_to_base, 0) AS DECIMAL(14, 4)) AS costo_base,
               ROW_NUMBER() OVER (PARTITION BY pd.product_id ORDER BY pu.datee DESC, pd.id DESC) AS k
          FROM dbo.purchase_detail pd
          JOIN dbo.purchase pu ON pu.id = pd.puchase_id
         WHERE pd.unitary_price > 0
    )
    SELECT 'PERDIDA' AS tipo, p.id AS product_id, p.nombre AS product_name, p.base_uom,
           CAST(NULL AS NVARCHAR(100)) AS detalle,
           CAST(NULL AS DECIMAL(14, 4)) AS costo_antes, p.costo AS costo_ahora,
           p.precio, CAST(ROUND(p.costo * p.iva, 2) AS DECIMAL(12, 2)) AS minimo,
           CAST(ROUND((p.precio / (p.costo * p.iva) - 1) * 100, 1) AS DECIMAL(8, 1)) AS pct,
           CAST(NULL AS DATETIME) AS fecha
      FROM prod p
     WHERE p.precio < ROUND(p.costo * p.iva, 2)

    UNION ALL
    SELECT 'PAQUETE', p.id, p.nombre, p.base_uom, pp.name,
           NULL, p.costo,
           pp.sale_price, CAST(ROUND(p.costo * p.iva * pp.factor_to_base, 2) AS DECIMAL(12, 2)),
           CAST(ROUND((pp.sale_price / (p.costo * p.iva * pp.factor_to_base) - 1) * 100, 1) AS DECIMAL(8, 1)),
           NULL
      FROM prod p
      JOIN dbo.product_presentations pp ON pp.product_id = p.id AND pp.active = 1 AND pp.sale_price > 0
     WHERE pp.sale_price < ROUND(p.costo * p.iva * pp.factor_to_base, 2)

    UNION ALL
    SELECT 'SUBIO', p.id, p.nombre, p.base_uom, s.nombre,
           a.costo_base, n.costo_base,
           p.precio, NULL,
           CAST(ROUND((n.costo_base / a.costo_base - 1) * 100, 1) AS DECIMAL(8, 1)),
           n.fecha
      FROM prod p
      JOIN compras n ON n.product_id = p.id AND n.k = 1
      JOIN compras a ON a.product_id = p.id AND a.k = 2
      LEFT JOIN dbo.CAT_suppliers s ON s.id = n.supplier_id
     WHERE n.fecha >= DATEADD(DAY, -@dias, GETDATE())
       AND a.costo_base > 0
       AND n.costo_base >= a.costo_base * (1 + @subida_pct / 100.0)

     ORDER BY tipo, pct, product_name;
END
GO

/* ---------- sp_compra_memoria (SQL_STORED_PROCEDURE) ---------- */
/* sp_compra_memoria
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0092 · LA MEMORIA DE COMPRA, POR PROVEEDOR.

   Registrar compra la lee al elegir proveedor. Por cada producto que se le
   ha comprado a alguien devuelve:

     presentation_id,  la ultima compra a ESTE proveedor; si nunca se le
     unit_price,       compro, la ultima a cualquiera (de_este = 0). El
     factor, fecha     precio es el de esa presentacion (lo que dice el ticket).
     costo_base        ese precio por unidad base, sin IVA.
     profit_percent    la ultima ganancia > 0 que alguien fijo, de cualquier
                       proveedor: la decision es del producto, no del proveedor.
     qty_tipica,       en unidad base, de las ultimas 6 compras del producto:
     qty_max, compras  sirven para avisar de un 240 escrito en vez de 24.
     mejor_*           otro proveedor que en 90 dias lo dio al menos 3 % mas
                       barato por unidad base que la ultima compra a este.

   Solo lee. Nada se escribe hasta que la persona registra la compra. */
CREATE OR ALTER PROCEDURE dbo.sp_compra_memoria
    @supplier_id INT
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH d AS (
        SELECT pd.product_id, pu.supplier_id, pu.datee AS fecha, pd.presentation_id,
               CAST(pd.factor_to_base AS DECIMAL(14, 4)) AS factor,
               CAST(pd.unitary_price AS DECIMAL(12, 4)) AS unit_price,
               CAST(pd.unitary_price / NULLIF(pd.factor_to_base, 0) AS DECIMAL(14, 4)) AS costo_base,
               CAST(pd.quantity * pd.factor_to_base AS DECIMAL(18, 4)) AS qty_base,
               pd.profit_percent, pd.id
          FROM dbo.purchase_detail pd
          JOIN dbo.purchase pu ON pu.id = pd.puchase_id
         WHERE pd.unitary_price > 0
    ),
    ult AS (   -- la ultima compra: primero a este proveedor, si no a cualquiera
        SELECT d.*, CASE WHEN d.supplier_id = @supplier_id THEN 1 ELSE 0 END AS de_este,
               ROW_NUMBER() OVER (PARTITION BY d.product_id
                                  ORDER BY CASE WHEN d.supplier_id = @supplier_id THEN 0 ELSE 1 END, d.fecha DESC, d.id DESC) AS k
          FROM d
    ),
    gan AS (
        SELECT product_id, profit_percent,
               ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY fecha DESC, id DESC) AS k
          FROM d WHERE profit_percent > 0
    ),
    rec AS (
        SELECT product_id, qty_base,
               ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY fecha DESC, id DESC) AS k
          FROM d
    ),
    cant AS (
        SELECT product_id, AVG(qty_base) AS qty_tipica, MAX(qty_base) AS qty_max, COUNT(*) AS compras
          FROM rec WHERE k <= 6 GROUP BY product_id
    ),
    otro AS (   -- el mas barato de otro proveedor en 90 dias
        SELECT d.product_id, d.supplier_id, d.costo_base, d.fecha,
               ROW_NUMBER() OVER (PARTITION BY d.product_id ORDER BY d.costo_base, d.fecha DESC) AS k
          FROM d
         WHERE d.supplier_id <> @supplier_id AND d.supplier_id IS NOT NULL
           AND d.fecha >= DATEADD(DAY, -90, GETDATE())
    )
    SELECT u.product_id, u.de_este, u.presentation_id, pp.name AS presentation_name, u.factor,
           u.unit_price, u.costo_base, u.fecha,
           g.profit_percent,
           CAST(c.qty_tipica AS DECIMAL(18, 2)) AS qty_tipica, CAST(c.qty_max AS DECIMAL(18, 2)) AS qty_max, c.compras,
           CASE WHEN u.de_este = 1 AND o.costo_base <= u.costo_base * 0.97 THEN o.supplier_id END AS mejor_supplier_id,
           CASE WHEN u.de_este = 1 AND o.costo_base <= u.costo_base * 0.97 THEN s.nombre END AS mejor_supplier,
           CASE WHEN u.de_este = 1 AND o.costo_base <= u.costo_base * 0.97 THEN o.costo_base END AS mejor_costo_base,
           CASE WHEN u.de_este = 1 AND o.costo_base <= u.costo_base * 0.97 THEN o.fecha END AS mejor_fecha
      FROM ult u
      JOIN dbo.products p ON p.id = u.product_id AND p.active = 1
      LEFT JOIN dbo.product_presentations pp ON pp.id = u.presentation_id AND pp.active = 1
      LEFT JOIN gan g ON g.product_id = u.product_id AND g.k = 1
      LEFT JOIN cant c ON c.product_id = u.product_id
      LEFT JOIN otro o ON o.product_id = u.product_id AND o.k = 1
      LEFT JOIN dbo.CAT_suppliers s ON s.id = o.supplier_id
     WHERE u.k = 1
       /* Una presentacion dada de baja no se propone: la linea queda por pieza. */
       AND (u.presentation_id IS NULL OR pp.id IS NOT NULL);
END
GO

/* ---------- sp_purchase_order_suggestions (SQL_STORED_PROCEDURE) ---------- */
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
