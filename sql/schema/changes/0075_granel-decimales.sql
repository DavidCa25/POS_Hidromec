/* 0075 · Venta a granel con decimales
 *
 * El importador solo marcaba `allow_decimal_qty` en los ingredientes. Un
 * producto en kg, g o L que se vende (jamón, queso, frijol a granel) entraba
 * como si fuera por pieza. Se corrige el importador (sp_import_execute_chunk)
 * y los productos que ya se cargaron así.
 *
 * Solo ENCIENDE la marca: no cambia unidades, precios ni existencias, y un
 * producto por pieza (`pza`) no se toca.
 */
UPDATE dbo.products
   SET allow_decimal_qty = 1
 WHERE allow_decimal_qty = 0
   AND base_uom IS NOT NULL
   AND base_uom <> N'pza';
