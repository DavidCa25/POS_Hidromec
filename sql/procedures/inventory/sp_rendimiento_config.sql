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
