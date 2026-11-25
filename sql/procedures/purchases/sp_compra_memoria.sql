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
