/**
 * Pruebas funcionales de la transaccion de venta (migracion 0003).
 *
 *     npm run db:test-migration -- --conservar
 *     node scripts/db/pruebas/dominio-hospitality.mjs      (deja el catalogo)
 *     node scripts/db/pruebas/venta-hospitality.mjs
 *
 * Cubre lo exigido por el plan: regresion Retail (contrato v1 intacto),
 * DIRECT, NONE, RECIPE, modificadores ADD / SUBSTITUTE / REMOVE / SIZE,
 * ingrediente insuficiente con rollback total, costo historico congelado y
 * devolucion que repone lo que la venta consumio REALMENTE.
 */
import { q, rows, row, scalar, fails, check, seccion, resumen, cerca, fixtureCafe, DB } from './lib.mjs';

console.log(`Base de pruebas: ${DB}`);
const f = fixtureCafe();

/** Ids de opciones y recetas creadas por dominio-hospitality.mjs. */
const opt = (nombre) => scalar(`SELECT TOP 1 id FROM dbo.modifier_options WHERE name = N'${nombre}' AND active = 1 ORDER BY id`);
const optGrande = opt('Grande');
const optChico = opt('Chico');
const optShot = opt('Extra shot');
const optAlm = opt('Leche de almendra');
const optSinAz = opt('Sin azucar');
check(optGrande && optShot && optAlm && optSinAz, 'catalogo de modificadores disponible (corre antes dominio-hospitality.mjs)');

/** Turno abierto en la caja 1: sin el, una venta en efectivo se rechaza. */
function abrirTurno() {
  const abierto = scalar(`SELECT TOP 1 id FROM dbo.cash_closures WHERE register_id = 1 AND closed_at IS NULL ORDER BY id DESC`);
  if (abierto) return abierto;
  return row(`EXEC dbo.sp_open_shift @user_id=${f.userId}, @opening_cash=500, @register_id=1;`).closure_id;
}
const turno = abrirTurno();

const stock = (id) => Number(scalar(`SELECT stock FROM dbo.products WHERE id = ${id}`));
/**
 * Movimientos de una VENTA.
 *
 * `reference` guarda el id como texto y no dice de que documento viene: la
 * compra #1 y la venta #1 comparten '1'. Lo que distingue a una venta es
 * `source` (SALE / RECIPE / REFUND) y `sold_product_id`, que solo escriben
 * sp_register_sale y sp_refund_sale. sp_refund_sale filtra igual.
 */
const movs = (saleId) => rows(`
  SELECT m.product_id, p.nombre, m.typee, m.quantity, m.source, m.sold_product_id, m.units, m.unit_cost
  FROM dbo.inventory_movements m JOIN dbo.products p ON p.id = m.product_id
  WHERE m.reference = '${saleId}' AND m.source IN ('SALE', 'RECIPE', 'REFUND') ORDER BY m.id`);
const detalle = (saleId) => rows(`SELECT id, product_id, quantity, unitary_price, unit_cost, line_cost, inventory_mode, note FROM dbo.sale_detail WHERE sale_id = ${saleId} ORDER BY id`);
const costo = (id) => Number(scalar(`SELECT cost FROM dbo.products WHERE id = ${id}`));
/**
 * Costo esperado de un Latte base, calculado con los costos VIGENTES.
 *
 * No se fija un numero: las compras de las pruebas anteriores cambian el
 * costo del cafe y del vaso, y un valor constante estaria comprobando el
 * fixture en vez de la formula (suma de ingredientes por unidad).
 */
const costoLatteBase = () => 18 * costo(f.cafe) + 200 * costo(f.leche) + 8 * costo(f.azucar) + costo(f.vaso) + costo(f.tapa);

/** Venta con el contrato V2 (lineas + modificadores). */
function vender({ lineas, mods = [], metodo = 'EFECTIVO', register = 1, serviceMode = null, customer = null, due = null }) {
  const l = lineas.map((x, i) => `(${x.line ?? i + 1}, ${x.product}, ${x.qty}, ${x.price}, ${x.note ? `N'${x.note}'` : 'NULL'})`).join(',');
  const m = mods.length ? mods.map(x => `(${x.line}, ${x.option}, ${x.qty ?? 1})`).join(',') : null;
  return row(`
    DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
    INSERT INTO @d2 (line_no, product_id, quantity, unit_price, note) VALUES ${l};
    ${m ? `INSERT INTO @mo (line_no, modifier_option_id, quantity) VALUES ${m};` : ''}
    EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'${metodo}', @SaleDetails=@d1,
      @customer_id=${customer ?? 'NULL'}, @due_date=${due ? `'${due}'` : 'NULL'}, @register_id=${register},
      @SaleDetails2=@d2, @SaleModifiers=@mo, @service_mode=${serviceMode ? `'${serviceMode}'` : 'NULL'};`);
}

seccion('REGRESION RETAIL — el contrato v1 sigue intacto');
const cocaAntes = stock(f.coca);
// Exactamente la misma llamada que hace Wybix hoy: solo SaleDetailType.
let r = row(`
  DECLARE @d dbo.SaleDetailType;
  INSERT INTO @d (product_id, quantity, unit_price) VALUES (${f.coca}, 2, 20);
  EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d, @customer_id=NULL, @due_date=NULL, @register_id=1;`);
const ventaV1 = r.sale_id;
check(ventaV1 > 0 && cerca(r.total, 40), `venta v1 registrada (#${ventaV1}, total ${r.total})`);
check(stock(f.coca) === cocaAntes - 2, `stock descontado: ${cocaAntes} -> ${stock(f.coca)}`);
let mv = movs(ventaV1);
check(mv.length === 1 && mv[0].product_id === f.coca && mv[0].typee === 'salida' && mv[0].source === 'SALE', 'un movimiento de salida, source SALE');
check(cerca(mv[0].units, 2) && mv[0].sold_product_id === f.coca, 'el movimiento queda ligado al producto vendido y a las unidades');
let det = detalle(ventaV1);
check(det.length === 1 && cerca(det[0].unit_cost, 10) && cerca(det[0].line_cost, 20), `costo congelado: unit_cost 10, line_cost 20 (${det[0].unit_cost} / ${det[0].line_cost})`);
const caja = row(`SELECT typee, amount, closure_id, register_id FROM dbo.cash_movements WHERE reference_id = ${ventaV1} AND typee = 'SALE'`);
check(caja && cerca(caja.amount, 40) && caja.closure_id === turno && caja.register_id === 1, 'movimiento de caja en el turno de la caja 1');

// Tarjeta: sin movimiento de caja.
r = row(`
  DECLARE @d dbo.SaleDetailType;
  INSERT INTO @d (product_id, quantity, unit_price) VALUES (${f.coca}, 1, 20);
  EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'TARJETA', @SaleDetails=@d, @register_id=1;`);
check(scalar(`SELECT COUNT(*) FROM dbo.cash_movements WHERE reference_id = ${r.sale_id}`) === 0, 'tarjeta no genera movimiento de caja');

// Credito: paid 0, balance total.
const cliente = scalar(`
  IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE customerName = N'Cliente Credito')
    INSERT INTO dbo.customers (code, customerName, credit_limit, terms_days, active) VALUES (N'C-TEST', N'Cliente Credito', 5000, 30, 1);
  SELECT id FROM dbo.customers WHERE customerName = N'Cliente Credito';`);
r = row(`
  DECLARE @d dbo.SaleDetailType;
  INSERT INTO @d (product_id, quantity, unit_price) VALUES (${f.coca}, 1, 20);
  EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'CREDITO', @SaleDetails=@d, @customer_id=${cliente}, @due_date='2026-12-31', @register_id=1;`);
const ventaCred = row(`SELECT paid_amount, balance, customer_id, due_date FROM dbo.sales WHERE id = ${r.sale_id}`);
check(cerca(ventaCred.paid_amount, 0) && cerca(ventaCred.balance, 20) && ventaCred.customer_id === cliente, 'credito: paid 0, balance total, cliente asignado');
check(scalar(`SELECT COUNT(*) FROM dbo.cash_movements WHERE reference_id = ${r.sale_id}`) === 0, 'credito no genera movimiento de caja');

seccion('DIRECT / NONE');
const antesServicio = stock(f.servicio);
r = vender({ lineas: [{ product: f.coca, qty: 1, price: 20 }, { product: f.servicio, qty: 1, price: 30 }] });
const ventaMix = r.sale_id;
mv = movs(ventaMix);
check(mv.length === 1 && mv[0].product_id === f.coca, 'NONE no genera movimiento de inventario');
check(stock(f.servicio) === antesServicio, 'NONE no descuenta stock');
det = detalle(ventaMix);
const detServicio = det.find(d => d.product_id === f.servicio);
check(detServicio.inventory_mode === 'NONE' && cerca(det.find(d => d.product_id === f.coca).unit_cost, 10), 'sale_detail guarda inventory_mode por linea');

seccion('RECIPE — un Latte descuenta todos sus ingredientes');
const s0 = { cafe: stock(f.cafe), leche: stock(f.leche), azucar: stock(f.azucar), vaso: stock(f.vaso), tapa: stock(f.tapa), latte: stock(f.latte) };
r = vender({ lineas: [{ product: f.latte, qty: 2, price: 55 }], mods: [{ line: 1, option: optChico }], serviceMode: 'TAKEAWAY' });
const ventaLatte = r.sale_id;
check(ventaLatte > 0 && r.service_mode === 'TAKEAWAY', `venta RECIPE registrada (#${ventaLatte}), service_mode TAKEAWAY`);
check(cerca(stock(f.cafe), s0.cafe - 36) && cerca(stock(f.leche), s0.leche - 400) && cerca(stock(f.azucar), s0.azucar - 16),
  `2 Lattes: -36 g cafe, -400 ml leche, -16 g azucar (cafe ${s0.cafe} -> ${stock(f.cafe)})`);
check(stock(f.vaso) === s0.vaso - 2 && stock(f.tapa) === s0.tapa - 2, '2 vasos y 2 tapas');
check(stock(f.latte) === s0.latte, 'el producto RECIPE no mueve stock propio');
mv = movs(ventaLatte);
check(mv.length === 5 && mv.every(x => x.source === 'RECIPE' && x.sold_product_id === f.latte && cerca(x.units, 2)),
  `5 movimientos RECIPE ligados al Latte, units = 2 (${mv.length})`);
det = detalle(ventaLatte);
const esperado = costoLatteBase();
check(cerca(det[0].unit_cost, esperado, 0.01) && cerca(det[0].line_cost, esperado * 2, 0.01),
  `unit_cost = suma de ingredientes de UNA unidad (${esperado.toFixed(4)}), line_cost = qty x unit_cost (${det[0].unit_cost} / ${det[0].line_cost})`);
check(scalar(`SELECT COUNT(*) FROM dbo.sale_detail_modifiers WHERE sale_detail_id = ${det[0].id}`) === 1, 'el modificador elegido queda registrado en la venta');

seccion('SIZE — la variante elige otra receta');
const s1 = { cafe: stock(f.cafe), leche: stock(f.leche) };
r = vender({ lineas: [{ product: f.latte, qty: 1, price: 65 }], mods: [{ line: 1, option: optGrande }] });
check(cerca(stock(f.cafe), s1.cafe - 24) && cerca(stock(f.leche), s1.leche - 300),
  `Latte Grande usa su receta: -24 g cafe, -300 ml leche (cafe ${s1.cafe} -> ${stock(f.cafe)})`);

seccion('MODIFIER ADD — agrega consumo');
const s2 = { cafe: stock(f.cafe), leche: stock(f.leche) };
r = vender({ lineas: [{ product: f.latte, qty: 1, price: 67 }], mods: [{ line: 1, option: optChico }, { line: 1, option: optShot }] });
check(cerca(stock(f.cafe), s2.cafe - 27), `18 g de receta + 9 g del shot = 27 g (${s2.cafe} -> ${stock(f.cafe)})`);
check(cerca(stock(f.leche), s2.leche - 200), 'el resto de la receta no cambia');
const detShot = detalle(r.sale_id)[0];
const esperadoShot = costoLatteBase() + 9 * costo(f.cafe);
check(cerca(detShot.unit_cost, esperadoShot, 0.01),
  `el costo incluye el extra: receta + 9 g de cafe = ${esperadoShot.toFixed(4)} (${detShot.unit_cost})`);

seccion('MODIFIER SUBSTITUTE — retira el original y agrega el reemplazo');
const s3 = { leche: stock(f.leche), almendra: stock(f.almendra) };
r = vender({ lineas: [{ product: f.latte, qty: 1, price: 63 }], mods: [{ line: 1, option: optChico }, { line: 1, option: optAlm }] });
check(cerca(stock(f.leche), s3.leche) && cerca(stock(f.almendra), s3.almendra - 200),
  `leche intacta (${s3.leche}), almendra -200 ml (${s3.almendra} -> ${stock(f.almendra)})`);
mv = movs(r.sale_id);
check(!mv.some(x => x.product_id === f.leche) && mv.some(x => x.product_id === f.almendra), 'los movimientos reflejan la sustitucion');

seccion('MODIFIER REMOVE — elimina el ingrediente');
const s4 = { azucar: stock(f.azucar), cafe: stock(f.cafe) };
r = vender({ lineas: [{ product: f.latte, qty: 1, price: 55 }], mods: [{ line: 1, option: optChico }, { line: 1, option: optSinAz }] });
check(cerca(stock(f.azucar), s4.azucar) && cerca(stock(f.cafe), s4.cafe - 18), 'sin azucar: el azucar no se descuenta, el resto si');

seccion('INGREDIENTE INSUFICIENTE — rollback total');
const antes = { vaso: stock(f.vaso), cafe: stock(f.cafe), ventas: scalar(`SELECT COUNT(*) FROM dbo.sales`), movs: scalar(`SELECT COUNT(*) FROM dbo.inventory_movements`) };
q(`UPDATE dbo.products SET stock = 1 WHERE id = ${f.vaso};`);
const fallo = fails(`
  DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
  INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${f.latte}, 5, 55);
  INSERT INTO @mo (line_no, modifier_option_id, quantity) VALUES (1, ${optChico}, 1);
  EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d1, @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`,
  'No hay stock suficiente');
check(fallo.ok, 'la venta se rechaza cuando falta UN ingrediente', fallo.error);
check(stock(f.vaso) === 1 && stock(f.cafe) === antes.cafe, 'ningun ingrediente se descuenta (ni el que si alcanzaba)');
check(scalar(`SELECT COUNT(*) FROM dbo.sales`) === antes.ventas && scalar(`SELECT COUNT(*) FROM dbo.inventory_movements`) === antes.movs,
  'no queda venta ni movimiento a medias: rollback total');
q(`UPDATE dbo.products SET stock = 500 WHERE id = ${f.vaso};`);

seccion('Validaciones del contrato');
check(fails(`DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
  INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${f.latte}, 1, 55);
  EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d1, @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`,
  'Falta elegir').ok, 'exige el grupo obligatorio (Tamano) en una linea v2');
check(fails(`DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
  INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${f.coca}, 1, 20);
  INSERT INTO @mo (line_no, modifier_option_id, quantity) VALUES (1, ${optShot}, 1);
  EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d1, @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`,
  'no corresponde al producto').ok, 'rechaza un modificador que no pertenece al producto');
check(fails(`DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
  INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${f.latte}, 1, 55);
  INSERT INTO @mo (line_no, modifier_option_id, quantity) VALUES (1, ${optChico}, 1), (1, ${optGrande}, 1);
  EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d1, @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo;`,
  'mas opciones de las permitidas').ok, 'rechaza dos tamanos en la misma linea (max_select = 1)');
check(fails(`DECLARE @d1 dbo.SaleDetailType; DECLARE @d2 dbo.SaleDetailType2; DECLARE @mo dbo.SaleModifierType;
  INSERT INTO @d2 (line_no, product_id, quantity, unit_price) VALUES (1, ${f.coca}, 1, 20);
  EXEC dbo.sp_register_sale @user_id=${f.userId}, @payment_method=N'EFECTIVO', @SaleDetails=@d1, @register_id=1, @SaleDetails2=@d2, @SaleModifiers=@mo, @service_mode='MESA';`,
  'service_mode invalido').ok, 'rechaza un service_mode desconocido');
// Dos lineas del mismo producto con opciones distintas conviven.
r = vender({ lineas: [{ product: f.latte, qty: 1, price: 55 }, { product: f.latte, qty: 1, price: 65 }],
             mods: [{ line: 1, option: optChico }, { line: 2, option: optGrande }] });
det = detalle(r.sale_id);
check(det.length === 2 && det[0].id !== det[1].id, 'dos lineas del mismo producto con modificadores distintos son lineas separadas');
check(scalar(`SELECT COUNT(*) FROM dbo.sale_detail_modifiers m JOIN dbo.sale_detail d ON d.id = m.sale_detail_id WHERE d.sale_id = ${r.sale_id}`) === 2,
  'cada linea conserva su modificador');

seccion('REFUND — repone lo que la venta consumio realmente');
// Se cambia la receta DESPUES de vender: la devolucion no debe usar la nueva.
const s5 = { cafe: stock(f.cafe), leche: stock(f.leche), vaso: stock(f.vaso), azucar: stock(f.azucar) };
r = vender({ lineas: [{ product: f.latte, qty: 2, price: 55 }], mods: [{ line: 1, option: optChico }] });
const ventaDevolver = r.sale_id;
q(`DECLARE @l dbo.RecipeLineType;
   INSERT INTO @l (ingredient_product_id, input_qty, input_uom) VALUES (${f.cafe}, 999, 'g'), (${f.vaso}, 1, 'pza');
   EXEC dbo.sp_save_recipe @product_id=${f.latte}, @Lines=@l;`);
const s6 = { cafe: stock(f.cafe), leche: stock(f.leche), vaso: stock(f.vaso), azucar: stock(f.azucar) };
r = row(`
  DECLARE @d dbo.SaleDetailType;
  INSERT INTO @d (product_id, quantity, unit_price) VALUES (${f.latte}, 1, 55);
  EXEC dbo.sp_refund_sale @sale_id=${ventaDevolver}, @user_id=${f.userId}, @payment_method=N'EFECTIVO', @RefundDetails=@d, @note=N'Prueba';`);
check(r.refund_id > 0 && cerca(r.refund_total, 55), `devolucion registrada (#${r.refund_id}, total ${r.refund_total})`);
check(cerca(stock(f.cafe), s6.cafe + 18) && cerca(stock(f.leche), s6.leche + 200) && cerca(stock(f.azucar), s6.azucar + 8) && stock(f.vaso) === s6.vaso + 1,
  `repone la receta ORIGINAL (18 g cafe, no 999): cafe ${s6.cafe} -> ${stock(f.cafe)}`);
const mvRef = movs(ventaDevolver).filter(x => x.typee === 'entrada');
check(mvRef.length === 5 && mvRef.every(x => x.source === 'REFUND' && x.sold_product_id === f.latte), '5 movimientos de entrada, source REFUND, ligados al Latte');
// Restaurar la receta original para no dejar la base rara.
q(`DECLARE @l dbo.RecipeLineType;
   INSERT INTO @l (ingredient_product_id, input_qty, input_uom, sort_order) VALUES (${f.cafe}, 18, 'g', 1), (${f.leche}, 0.2, 'L', 2), (${f.azucar}, 8, 'g', 3), (${f.vaso}, 1, 'pza', 4), (${f.tapa}, 1, 'pza', 5);
   EXEC dbo.sp_save_recipe @product_id=${f.latte}, @Lines=@l;`);

// Devolucion de un DIRECT: repone el propio producto.
const s7 = stock(f.coca);
r = row(`
  DECLARE @d dbo.SaleDetailType;
  INSERT INTO @d (product_id, quantity, unit_price) VALUES (${f.coca}, 1, 20);
  EXEC dbo.sp_refund_sale @sale_id=${ventaV1}, @user_id=${f.userId}, @payment_method=N'EFECTIVO', @RefundDetails=@d;`);
check(stock(f.coca) === s7 + 1, `devolucion DIRECT repone el producto (${s7} -> ${stock(f.coca)})`);
check(cerca(scalar(`SELECT amount FROM dbo.cash_movements WHERE reference_id = ${ventaV1} AND typee = 'REFUND'`), -20), 'la devolucion en efectivo sale de caja');

seccion('EDICION DE VENTA');
check(fails(`DECLARE @d dbo.SaleDetailType; INSERT INTO @d (product_id, quantity, unit_price) VALUES (${f.latte}, 1, 55);
  EXEC dbo.sp_update_sale @sale_id=${ventaLatte}, @user_id=${f.userId}, @SaleDetails=@d;`, 'Reembolso / Cambio').ok,
  'una venta con recetas no se edita: se corrige con Reembolso / Cambio');

seccion('Ticket y folio');
const ticket = q(`EXEC dbo.sp_get_sale_ticket @sale_id=${ventaLatte};`);
check(ticket[0][0].service_mode === 'TAKEAWAY', 'el ticket incluye service_mode');
check(ticket[1][0].modifiers === 'Chico', `el ticket lista los modificadores (${ticket[1][0].modifiers})`);
const folio = q(`EXEC dbo.sp_get_sale_by_folio @sale_id=${ventaLatte};`);
check(folio[1][0].modifiers === 'Chico' && folio[1][0].unit_cost != null && folio[1][0].sale_detail_id > 0,
  'sp_get_sale_by_folio devuelve modificadores, costo y el id de la linea');

resumen();
