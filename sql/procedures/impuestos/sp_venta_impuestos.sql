/* sp_venta_impuestos
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_venta_impuestos (0083) ======================
   La foto de los impuestos que NO son IVA de una venta, renglón por renglón.
   La llaman sp_register_sale y sp_update_sale justo después de fijar el IVA
   del renglón. Es idempotente: borra la foto anterior de esa venta.

   El precio incluye todo. Con P el importe cobrado del renglón, q las piezas,
   v la tasa de IVA (0 si no es objeto '02'):
     Te = Σ tasas que van en la base del IVA (IEPS)
     Tl = Σ tasas que no (impuestos locales)
     Ce = Σ cuota × cantidad × q que van en la base del IVA
     Cl = Σ cuota × cantidad × q que no
     P  = (B·(1+Te) + Ce)·(1+v) + B·Tl + Cl
     B  = (P − Ce·(1+v) − Cl) / ((1+Te)·(1+v) + Tl)
   Si el precio no alcanza ni para las cuotas (B <= 0), el renglón se deja
   sin foto: los reportes usan la cuenta de antes y nada se inventa.
   Un renglón de un producto sin otros impuestos no se toca (base_neta NULL).
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_venta_impuestos
    @sale_id INT
AS
BEGIN
    SET NOCOUNT ON;

    DELETE x FROM dbo.sale_detail_impuestos x
      JOIN dbo.sale_detail d ON d.id = x.sale_detail_id
     WHERE d.sale_id = @sale_id;
    UPDATE dbo.sale_detail SET base_neta = NULL, otros_impuestos = NULL
     WHERE sale_id = @sale_id AND (base_neta IS NOT NULL OR otros_impuestos IS NOT NULL);

    /* Los impuestos activos de cada renglón, con su valor de hoy. */
    SELECT d.id AS sale_detail_id, d.quantity AS q, CAST(d.subtotal AS DECIMAL(14, 4)) AS p,
           CASE WHEN ISNULL(d.tax_object, '02') = '02' THEN ISNULL(d.tax_rate, 0) ELSE 0 END AS v,
           i.id AS impuesto_id, i.nombre, i.clase, i.factor, i.tasa, i.cuota, i.en_base_iva,
           CAST(CASE WHEN i.factor = 'Cuota' THEN ISNULL(pi.cantidad, 1) * d.quantity END AS DECIMAL(14, 4)) AS unidades
      INTO #l
      FROM dbo.sale_detail d
      JOIN dbo.product_impuestos pi ON pi.product_id = d.product_id
      JOIN dbo.CAT_impuestos i ON i.id = pi.impuesto_id AND i.activo = 1
     WHERE d.sale_id = @sale_id AND d.quantity > 0;

    IF NOT EXISTS (SELECT 1 FROM #l) RETURN;

    SELECT sale_detail_id, MAX(p) AS p, MAX(v) AS v,
           SUM(CASE WHEN factor = 'Tasa' AND en_base_iva = 1 THEN tasa ELSE 0 END) AS te,
           SUM(CASE WHEN factor = 'Tasa' AND en_base_iva = 0 THEN tasa ELSE 0 END) AS tl,
           SUM(CASE WHEN factor = 'Cuota' AND en_base_iva = 1 THEN cuota * unidades ELSE 0 END) AS ce,
           SUM(CASE WHEN factor = 'Cuota' AND en_base_iva = 0 THEN cuota * unidades ELSE 0 END) AS cl
      INTO #r
      FROM #l GROUP BY sale_detail_id;

    ALTER TABLE #r ADD b DECIMAL(14, 4) NULL;
    UPDATE #r SET b = CAST((p - ce * (1 + v) - cl) / ((1 + te) * (1 + v) + tl) AS DECIMAL(14, 4));
    DELETE FROM #r WHERE b IS NULL OR b <= 0;

    INSERT INTO dbo.sale_detail_impuestos (sale_detail_id, impuesto_id, nombre, clase, factor, tasa, cuota, cantidad, base, importe)
    SELECT l.sale_detail_id, l.impuesto_id, l.nombre, l.clase, l.factor, l.tasa, l.cuota, l.unidades, r.b,
           CAST(CASE WHEN l.factor = 'Tasa' THEN r.b * l.tasa ELSE l.cuota * l.unidades END AS DECIMAL(14, 4))
      FROM #l l JOIN #r r ON r.sale_detail_id = l.sale_detail_id;

    UPDATE d SET base_neta = r.b,
                 otros_impuestos = (SELECT SUM(x.importe) FROM dbo.sale_detail_impuestos x WHERE x.sale_detail_id = d.id)
      FROM dbo.sale_detail d JOIN #r r ON r.sale_detail_id = d.id;
END
GO
