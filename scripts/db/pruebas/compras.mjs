/**
 * La compra: lo que cuesta, lo que vale y de donde sale el dinero.
 *
 *     node scripts/db/pruebas/compras.mjs [--conservar]
 *
 * QUE SE ROMPIO
 * -------------
 * Tres cosas distintas, todas visibles en la VM al comprar cafe y leche:
 *
 *   LA TABLA EN BLANCO   `sp_get_purchases` devolvia dos columnas llamadas
 *                        `nombre` -el producto y el proveedor-. Un recordset
 *                        no puede tener dos columnas iguales: el driver se
 *                        queda con una y la otra desaparece. La pantalla
 *                        pedia `product_name` y `supplier_name`, que no
 *                        existian, y pintaba las dos celdas vacias.
 *
 *   EL PRECIO INVENTADO  la compra recalcula el precio de venta desde el
 *                        costo. A un INGREDIENTE eso no le aplica: comprar
 *                        leche en cajas de 1 L dejaba la leche a "$0.06" en
 *                        el inventario, que es el mililitro. Un insumo no se
 *                        cobra en caja.
 *
 *   EL DINERO SIN RASTRO toda compra nacia PENDIENTE. Pagarla en efectivo
 *                        obligaba a ir a Venta y hacer una salida a mano, sin
 *                        nada que la atara a la compra; y el pago a proveedor
 *                        restaba de la caja SIEMPRE, tambien por
 *                        transferencia, con lo que el arqueo salia corto por
 *                        dinero que nunca estuvo en el cajon.
 *
 * QUE COMPRUEBA
 * -------------
 * Contra SQL de verdad, con las cifras del caso real (Nescafe en bolsa de
 * 400 g a $95, 10% de ganancia):
 *
 *   costo = 95 / 400 = 0.2375 por gramo, no 95
 *   el ingrediente conserva su precio; el producto vendible lo recalcula
 *   CREDITO deja saldo, EFECTIVO exige turno y entra al corte,
 *   TRANSFERENCIA paga sin tocar el cajon
 *
 * Corre sobre una restauracion del baseline, no sobre ninguna base de trabajo.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const BAK = join('installer', 'template.bak');
const DIR_MIG = join('electron', 'migrations');
const DB = 'Wybix_TmpCompras';
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const q = (sql) => {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(limpiar(r.error));
  return r.sets.length ? r.sets[0] : [];
};
const uno = (sql) => q(sql)[0] ?? null;
const escalar = (sql) => { const f = uno(sql); return f ? f[Object.keys(f)[0]] : null; };
const falla = (sql, frag) => {
  const r = consultarTemporal(DB, sql);
  if (r.ok) return { ok: false, error: null };
  const msg = limpiar(r.error);
  return { ok: frag ? msg.includes(frag) : true, error: msg };
};
const cerca = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) < eps;

try {
  console.log(`\nLA COMPRA: COSTO, PRECIO Y CAJA   (${DB})`);

  if (!existsSync(BAK)) {
    console.log(`   ----   falta ${BAK}: es un artefacto derivado (npm run db:baseline).`);
    process.exit(0);
  }
  restaurar(DB, BAK);
  const aplicadas = new Set(q('SELECT filename FROM dbo.schema_migrations;').map(r => r.filename));
  for (const f of readdirSync(DIR_MIG, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.sql'))
      .map(d => d.name).sort((a, b) => a.localeCompare(b, 'en'))
      .filter(f => !aplicadas.has(f))) {
    // MISMA regla que electron/migrationsRunner.js: con un separador mas
    // permisivo, un archivo que el runner rechaza pasaria aqui.
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8')
        .replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) {
      if (lote.trim()) q(lote);
    }
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }

  // --------------------------------------------------------------- base
  q(`
    INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
    VALUES (N'qa', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'secreta1'), 2), N'admin', 1, GETDATE());
    INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA');
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Insumos');
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'Bebidas');
    INSERT INTO dbo.CAT_suppliers (nombre, activo) VALUES (N'Abarrotes del Centro', 1);`);
  const userId  = Number(escalar(`SELECT TOP 1 id FROM dbo.users ORDER BY id;`));
  const brand   = Number(escalar(`SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC;`));
  const catIns  = Number(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'Insumos';`));
  const catBeb  = Number(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'Bebidas';`));
  const prov    = Number(escalar(`SELECT TOP 1 id FROM dbo.CAT_suppliers ORDER BY id DESC;`));

  const alta = (o) => Number(escalar(`
    EXEC dbo.sp_add_product
      @brand=${brand}, @part_number=N'${o.pn}', @name=N'${o.name}',
      @price=${o.price ?? 0}, @stock=${o.stock ?? 0}, @category=${o.cat},
      @inventory_mode='${o.mode ?? 'DIRECT'}', @sellable=${o.sellable ?? 1},
      @base_uom='${o.uom ?? 'pza'}', @allow_decimal_qty=${o.dec ?? 0},
      @cost=${o.cost ?? 'NULL'};`));

  const presentacion = (productId, nombre, factor) => Number(escalar(`
    EXEC dbo.sp_save_product_presentation
      @product_id=${productId}, @name=N'${nombre}', @factor_to_base=${factor}, @is_default=1;
    SELECT TOP 1 id FROM dbo.product_presentations
    WHERE product_id = ${productId} AND name = N'${nombre}' ORDER BY id DESC;`));

  /**
   * Registra una compra por la MISMA via que el proceso principal: la v2 del
   * tipo, que es la unica que manda `presentation_id`.
   */
  const comprar = (o) => {
    const lineas = o.lineas.map((l, i) =>
      `(${l.product}, ${l.qty}, ${l.precio}, ${l.ganancia ?? 0}, ${l.presentacion ?? 'NULL'})`).join(', ');
    const sql = `
      DECLARE @d1 dbo.PurchaseDetailType; DECLARE @d2 dbo.PurchaseDetailType2;
      INSERT INTO @d2 (product_id, quantity, unit_price, profit_percent, presentation_id)
      VALUES ${lineas};
      EXEC dbo.sp_register_purchase
        @user_id=${userId}, @supplier_id=${o.proveedor ?? prov},
        @subtotal=${o.subtotal}, @tax_rate=${o.tasa ?? 0.16}, @tax_amount=${o.iva},
        @total=${o.total}, @PurchaseDetails=@d1, @PurchaseDetails2=@d2,
        @payment_method=N'${o.pago ?? 'CREDITO'}', @register_id=1;`;
    const r = consultarTemporal(DB, sql);
    if (!r.ok) return { ok: false, error: limpiar(r.error) };
    const fila = (r.sets.find(s => s.length && 'purchase_id' in s[0]) ?? [])[0] ?? {};
    return { ok: true, ...fila };
  };

  const producto = (id) => uno(`SELECT stock, cost, price, sellable FROM dbo.products WHERE id = ${id};`);

  // El Nescafe es INSUMO: entra por compra, no se cobra en caja.
  const cafe = alta({ pn: 'NFE', name: 'Nescafe Dark', cat: catIns, uom: 'g', dec: 1,
                      sellable: 0, stock: 4, price: 120, cost: 0.5 });
  // El refresco SI se vende, y se compra por caja de 12.
  const refresco = alta({ pn: 'REF', name: 'Refresco 355 ml', cat: catBeb, uom: 'pza',
                          sellable: 1, stock: 0, price: 15, cost: 8 });

  const bolsa = presentacion(cafe, 'Bolsa 400g', 400);
  const caja  = presentacion(refresco, 'Caja 12', 12);
  check(bolsa > 0 && caja > 0, 'las dos presentaciones se crean', `bolsa #${bolsa}, caja #${caja}`);

  // =============================================================== 1
  seccion('1. El costo es POR UNIDAD BASE, no por bulto');
  const c1 = comprar({
    lineas: [{ product: cafe, qty: 4, precio: 95, ganancia: 10, presentacion: bolsa }],
    subtotal: 380, iva: 60.80, total: 440.80, pago: 'CREDITO',
  });
  check(c1.ok, 'la compra se registra', c1.error ?? `folio ${c1.purchase_id}`);

  const pCafe = producto(cafe);
  check(cerca(pCafe.cost, 0.2375, 0.0001),
    'el costo queda en 0.2375 por gramo, no en 95', `cost = ${pCafe.cost}`);
  check(Number(pCafe.stock) === 4 + 1600,
    'y entran 1600 g al inventario, no 4', `stock = ${pCafe.stock}`);

  // =============================================================== 2
  seccion('2. Al ingrediente no se le inventa un precio de venta');
  check(Number(pCafe.price) === 120,
    'el Nescafe conserva su precio: no se cobra en caja', `price = ${pCafe.price}`);

  const c2 = comprar({
    lineas: [{ product: refresco, qty: 2, precio: 96, ganancia: 10, presentacion: caja }],
    subtotal: 192, iva: 30.72, total: 222.72, pago: 'CREDITO',
  });
  check(c2.ok, 'se compran 2 cajas de refresco', c2.error ?? `folio ${c2.purchase_id}`);

  const pRef = producto(refresco);
  // 96 / 12 = 8 por pieza; 8 * 1.16 * 1.10 = 10.21
  check(cerca(pRef.cost, 8), 'el refresco cuesta 8 la pieza', `cost = ${pRef.cost}`);
  check(cerca(pRef.price, 10.21),
    'y su precio de venta sale de la PIEZA, no de la caja', `price = ${pRef.price} (esperado 10.21)`);
  check(Number(pRef.stock) === 24, 'entran 24 piezas', `stock = ${pRef.stock}`);

  // =============================================================== 3
  seccion('3. La tabla de compras devuelve cada columna con su nombre');
  const listado = consultarTemporal(DB, 'EXEC dbo.sp_get_purchases;');
  check(listado.ok, 'sp_get_purchases corre', listado.ok ? '' : limpiar(listado.error));
  const filas = listado.ok ? (listado.sets[0] ?? []) : [];
  const columnas = filas.length ? Object.keys(filas[0]) : [];
  const repetidas = columnas.filter((c, i) => columnas.indexOf(c) !== i);
  check(repetidas.length === 0,
    'ninguna columna viene repetida', repetidas.length ? repetidas.join(', ') : `${columnas.length} columnas`);
  check(columnas.includes('product_name') && columnas.includes('supplier_name'),
    'trae product_name y supplier_name, que es lo que pide la pantalla');
  const conNombre = filas.filter(f => f.product_name && f.supplier_name);
  check(filas.length > 0 && conNombre.length === filas.length,
    'y ninguna fila los trae en blanco', `${conNombre.length}/${filas.length}`);
  const lineaCafe = filas.find(f => f.product_name === 'Nescafe Dark');
  check(lineaCafe && Number(lineaCafe.base_quantity) === 1600 && lineaCafe.presentation_name === 'Bolsa 400g',
    'el detalle dice en que se compro y cuanto entro', lineaCafe
      ? `${lineaCafe.quantity} ${lineaCafe.presentation_name} -> ${lineaCafe.base_quantity} ${lineaCafe.base_uom}`
      : 'sin fila');

  // Compra ANTERIOR a "una compra, un proveedor": el proveedor solo esta en
  // la linea. Se inserta a mano porque el procedimiento de hoy ya no permite
  // crearla asi, y es exactamente la forma del historial de una instalacion
  // vieja: sin respaldo en la consulta, todas esas compras salen sin
  // proveedor.
  q(`
    INSERT INTO dbo.purchase (datee, useer_id, total, tax_rate, tax_amount, supplier_id, balance, payment_status)
    VALUES (DATEADD(DAY, -30, GETDATE()), ${userId}, 100, 0.16, 13.79, NULL, 100, N'PENDIENTE');
    DECLARE @vieja INT = SCOPE_IDENTITY();
    INSERT INTO dbo.purchase_detail (puchase_id, product_id, supplier_id, quantity, unitary_price, profit_percent)
    VALUES (@vieja, ${refresco}, ${prov}, 1, 86.21, 10);`);
  const vieja = Number(escalar(`SELECT MAX(id) FROM dbo.purchase WHERE supplier_id IS NULL;`));
  const filaVieja = filas.length
    ? (consultarTemporal(DB, 'EXEC dbo.sp_get_purchases;').sets[0] ?? []).find(f => Number(f.purchase_id) === vieja)
    : null;
  check(!!filaVieja && filaVieja.supplier_name === 'Abarrotes del Centro',
    'una compra vieja, con el proveedor solo en la linea, tambien lo muestra',
    filaVieja ? String(filaVieja.supplier_name) : 'sin fila');

  // =============================================================== 4
  seccion('4. A credito la compra no toca la caja');
  const cab1 = uno(`SELECT balance, payment_status FROM dbo.purchase WHERE id = ${c1.purchase_id};`);
  check(cerca(cab1.balance, 440.80) && cab1.payment_status === 'PENDIENTE',
    'queda como cuenta por pagar', `saldo ${cab1.balance} · ${cab1.payment_status}`);
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.cash_movements;`)) === 0,
    'y no hay ni un movimiento de caja');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.supplier_payments;`)) === 0,
    'ni un pago al proveedor');

  // =============================================================== 5
  seccion('5. En efectivo hace falta turno abierto');
  check(!uno(`SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL;`),
    'la caja parte sin turno');
  const comprasAntes = Number(escalar(`SELECT COUNT(*) FROM dbo.purchase;`));
  const stockAntes = Number(producto(refresco).stock);
  const sinTurno = comprar({
    lineas: [{ product: refresco, qty: 1, precio: 96, ganancia: 10, presentacion: caja }],
    subtotal: 96, iva: 15.36, total: 111.36, pago: 'EFECTIVO',
  });
  check(!sinTurno.ok && /turno/i.test(String(sinTurno.error)),
    'sin turno, la compra en efectivo se rechaza', String(sinTurno.error).slice(0, 70));
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.purchase;`)) === comprasAntes,
    'y no quedo registrada a medias', `${comprasAntes} compras antes y despues`);
  // El rechazo ocurre ANTES de abrir la transaccion, pero el inventario es lo
  // que se veria corrompido si algun dia dejara de ser asi.
  check(Number(producto(refresco).stock) === stockAntes,
    'ni le subio el stock al producto', `${stockAntes} piezas, sin cambio`);

  // =============================================================== 6
  seccion('6. Con turno, el efectivo sale de la caja y entra al corte');
  const turno = Number(uno(`EXEC dbo.sp_open_shift @user_id=${userId}, @opening_cash=1000, @register_id=1;`)?.closure_id);
  check(turno > 0, `turno abierto (#${turno}) con 1000 de fondo`);

  const c3 = comprar({
    lineas: [{ product: refresco, qty: 1, precio: 96, ganancia: 10, presentacion: caja }],
    subtotal: 96, iva: 15.36, total: 111.36, pago: 'EFECTIVO',
  });
  check(c3.ok, 'la compra en efectivo pasa', c3.error ?? `folio ${c3.purchase_id}`);

  const cab3 = uno(`SELECT balance, payment_status FROM dbo.purchase WHERE id = ${c3.purchase_id};`);
  check(Number(cab3.balance) === 0 && cab3.payment_status === 'PAGADO',
    'queda pagada, sin saldo', `${cab3.payment_status}`);

  const mov = uno(`
    SELECT amount, typee, closure_id, register_id
    FROM dbo.cash_movements WHERE typee = 'SUPPLIER_PAYMENT';`);
  check(mov && cerca(mov.amount, -111.36),
    'deja una salida de caja por el total', mov ? `${mov.amount}` : 'sin movimiento');
  check(mov && Number(mov.closure_id) === turno && Number(mov.register_id) === 1,
    'colgada del turno abierto y de su caja', mov ? `turno ${mov.closure_id} · caja ${mov.register_id}` : '');

  const pago = uno(`SELECT purchase_id, amount, payment_method, cash_movement_id FROM dbo.supplier_payments;`);
  check(pago && Number(pago.purchase_id) === Number(c3.purchase_id) && pago.payment_method === 'EFECTIVO',
    'y un pago al proveedor atado a esa compra', pago ? `compra ${pago.purchase_id}` : 'sin pago');
  check(pago && pago.cash_movement_id != null,
    'con su movimiento de caja referenciado');

  // =============================================================== 7
  seccion('7. Transferencia y tarjeta pagan, pero no mueven el cajon');
  const c4 = comprar({
    lineas: [{ product: refresco, qty: 1, precio: 96, ganancia: 10, presentacion: caja }],
    subtotal: 96, iva: 15.36, total: 111.36, pago: 'TRANSFERENCIA',
  });
  check(c4.ok, 'la compra por transferencia pasa', c4.error ?? `folio ${c4.purchase_id}`);
  const cab4 = uno(`SELECT balance, payment_status FROM dbo.purchase WHERE id = ${c4.purchase_id};`);
  check(Number(cab4.balance) === 0 && cab4.payment_status === 'PAGADO', 'queda pagada');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.supplier_payments WHERE purchase_id = ${c4.purchase_id};`)) === 1,
    'con su pago al proveedor registrado');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.cash_movements WHERE typee = 'SUPPLIER_PAYMENT';`)) === 1,
    'y SIN movimiento de caja: el dinero salio del banco',
    `${escalar(`SELECT COUNT(*) FROM dbo.cash_movements WHERE typee = 'SUPPLIER_PAYMENT';`)} movimiento(s)`);

  // =============================================================== 8
  seccion('8. El corte descuenta la compra pagada en efectivo');
  const corte = uno(`
    EXEC dbo.sp_close_shift @closure_id=${turno}, @user_id=${userId},
      @cash_delivered=888.64, @register_id=1;`);
  // 1000 de fondo - 111.36 de la compra = 888.64 esperados en el cajon.
  check(corte && cerca(corte.cash_expected, 888.64),
    'lo esperado en caja baja por la compra', corte ? `esperado ${corte.cash_expected}` : 'sin corte');
  check(corte && cerca(corte.difference, 0),
    'y el arqueo cuadra sin diferencia', corte ? `diferencia ${corte.difference}` : '');

  // =============================================================== 9
  seccion('9. Pagar un saldo por transferencia tampoco toca la caja');
  const antesMov = Number(escalar(`SELECT COUNT(*) FROM dbo.cash_movements;`));
  const pagoTransf = falla(`
    EXEC dbo.sp_register_supplier_payment @user_id=${userId}, @supplier_id=${prov},
      @purchase_id=${c1.purchase_id}, @amount=440.80, @payment_method=N'TRANSFERENCIA',
      @note=N'Pago del saldo', @register_id=1;`);
  check(pagoTransf.error === null, 'el pago del saldo pasa', pagoTransf.error ?? 'sin error');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.cash_movements;`)) === antesMov,
    'no aparecio ningun movimiento de caja nuevo');
  const saldado = uno(`SELECT balance, payment_status FROM dbo.purchase WHERE id = ${c1.purchase_id};`);
  check(Number(saldado.balance) === 0 && saldado.payment_status === 'PAGADO',
    'y la compra queda saldada', `${saldado.payment_status}`);

  const enEfectivoSinTurno = falla(`
    EXEC dbo.sp_register_supplier_payment @user_id=${userId}, @supplier_id=${prov},
      @purchase_id=NULL, @amount=50, @payment_method=N'EFECTIVO', @register_id=1;`, 'turno');
  check(enEfectivoSinTurno.ok,
    'y con el turno cerrado no se puede pagar en efectivo', String(enEfectivoSinTurno.error).slice(0, 70));

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
