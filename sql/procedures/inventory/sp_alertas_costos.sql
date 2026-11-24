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
