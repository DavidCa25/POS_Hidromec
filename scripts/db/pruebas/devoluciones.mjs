/**
 * Devoluciones (0065).
 *
 *     node scripts/db/pruebas/devoluciones.mjs [--conservar]
 *
 * QUE COMPRUEBA
 * -------------
 *   1. Sin motivo no hay devolución; con motivo, queda guardado con su caja.
 *   2. Venta a CRÉDITO sin abonos: lo devuelto baja lo que debe y NO sale
 *      efectivo del cajón (antes salía todo en efectivo).
 *   3. Venta a crédito con abonos: primero baja la deuda; lo que ya había
 *      pagado de más sale en efectivo.
 *   4. Devolución a tarjeta: no toca el cajón, pero queda en el turno.
 *   5. El corte enseña las devoluciones del turno (4º resultado de
 *      sp_get_cash_movements) y el correo lleva el motivo.
 *   6. Ventas para devolver: las de hoy de la caja, las de un cliente y por
 *      folio, con lo ya devuelto.
 *   7. Cambio: lleva algo más caro (paga la diferencia), más barato (se le
 *      regresa la diferencia), el apartado no se reusa y el corte lo separa.
 *   8. El comprobante de la devolución.
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
const DB = 'Wybix_TmpDevoluciones';
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
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
};
const sets = (sql) => { const r = consultarTemporal(DB, sql); if (!r.ok) throw new Error(limpiar(r.error)); return r.sets; };
const uno = (sql) => q(sql)[0] ?? null;
const escalar = (sql) => { const f = uno(sql); return f ? f[Object.keys(f)[0]] : null; };
const n = (v) => Number(v ?? 0);
const falla = (sql, frag) => {
  const r = consultarTemporal(DB, sql);
  if (r.ok) return { ok: false, error: null };
  const msg = limpiar(r.error);
  return { ok: frag ? msg.includes(frag) : true, error: msg };
};

try {
  console.log(`\nDEVOLUCIONES   (${DB})`);
  if (!existsSync(BAK)) { console.log(`   ----   falta ${BAK}`); process.exit(0); }
  restaurar(DB, BAK);
  const aplicadas = new Set(q('SELECT filename FROM dbo.schema_migrations;').map(r => r.filename));
  for (const f of readdirSync(DIR_MIG, { withFileTypes: true }).filter(d => d.isFile() && d.name.toLowerCase().endsWith('.sql'))
      .map(d => d.name).sort((a, b) => a.localeCompare(b, 'en')).filter(f => !aplicadas.has(f))) {
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) if (lote.trim()) q(lote);
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }

  /* ---------------------------------------------------- el mundo */
  q(`INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date) VALUES (N'qa_karla', N'x', N'admin', 1, GETDATE());
     INSERT INTO dbo.CAT_categories (namee) VALUES (N'QA Dev'); INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA');
     INSERT INTO dbo.products (part_number, nombre, price, stock, category_id, brand_id, cost, objeto_impuesto, tasa_iva, active, registrated_date, inventory_mode)
     VALUES (N'QA-DEV', N'Taza de cerámica', 100, 50, (SELECT id FROM dbo.CAT_categories WHERE namee = N'QA Dev'), (SELECT id FROM dbo.CAT_brands WHERE namee = N'QA'),
             40, '02', 0.16, 1, GETDATE(), 'DIRECT');
     INSERT INTO dbo.customers (code, customerName, phone, credit_limit, terms_days, active) VALUES (N'C-DEV', N'Taller Ruiz', N'477 100 2000', 5000, 30, 1);`);
  const u = n(escalar(`SELECT id FROM dbo.users WHERE usuario = N'qa_karla'`));
  const taza = n(escalar(`SELECT id FROM dbo.products WHERE part_number = N'QA-DEV'`));
  const cliente = n(escalar(`SELECT id FROM dbo.customers WHERE code = N'C-DEV'`));
  q(`EXEC dbo.sp_open_shift @user_id=${u}, @opening_cash=500, @register_id=1;`);
  const turno = n(escalar(`SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC`));

  const vender = (metodo, qty, extra = '') => n(uno(`DECLARE @d dbo.SaleDetailType; INSERT @d VALUES (${taza}, ${qty}, 100);
     EXEC dbo.sp_register_sale @user_id=${u}, @payment_method=N'${metodo}', @SaleDetails=@d, @register_id=1${extra};`).sale_id);
  const devolver = (venta, qty, { metodo = 'EFECTIVO', motivo = 'Mal estado' } = {}) =>
    `DECLARE @r dbo.SaleDetailType; INSERT @r VALUES (${taza}, ${qty}, 100);
     EXEC dbo.sp_refund_sale @sale_id=${venta}, @user_id=${u}, @payment_method=N'${metodo}', @RefundDetails=@r,
          @apply_net_update=0, @register_id=1${motivo === null ? '' : `, @reason=N'${motivo}'`};`;
  const efectivoCaja = () => n(escalar(`SELECT ISNULL(SUM(amount), 0) FROM dbo.cash_movements WHERE closure_id = ${turno}`));

  // =============================================================== 1
  seccion('1. El motivo');
  const v1 = vender('EFECTIVO', 2);
  let r = falla(devolver(v1, 1, { motivo: null }), 'motivo');
  check(r.ok, 'sin motivo no se devuelve', r.error?.slice(0, 60));
  r = falla(devolver(v1, 1, { motivo: '  ' }), 'motivo');
  check(r.ok, 'un motivo en blanco tampoco cuenta');
  const caja0 = efectivoCaja();
  q(devolver(v1, 1, { motivo: 'Se equivocó de producto' }));
  const d1 = uno(`SELECT TOP 1 * FROM dbo.sale_refunds WHERE sale_id = ${v1} ORDER BY id DESC`);
  check(d1.reason === 'Se equivocó de producto' && n(d1.register_id) === 1 && n(d1.closure_id) === turno,
    'se guarda el motivo, la caja y el turno', JSON.stringify({ m: d1.reason, c: d1.register_id, t: d1.closure_id }));
  check(efectivoCaja() === caja0 - 100, 'una venta en efectivo devuelve $100 del cajón');

  // =============================================================== 2
  seccion('2. Crédito sin abonos');
  const v2 = vender('CREDITO', 3, `, @customer_id=${cliente}, @due_date='2026-12-31'`);
  check(n(escalar(`SELECT balance FROM dbo.sales WHERE id = ${v2}`)) === 300, 'Taller Ruiz debe $300');
  const caja2 = efectivoCaja();
  q(devolver(v2, 1));
  check(efectivoCaja() === caja2, 'devolver de una venta a crédito no saca efectivo del cajón', `${caja2} -> ${efectivoCaja()}`);
  check(n(escalar(`SELECT balance FROM dbo.sales WHERE id = ${v2}`)) === 200, 'y ahora debe $200');
  const d2 = uno(`SELECT TOP 1 * FROM dbo.sale_refunds WHERE sale_id = ${v2} ORDER BY id DESC`);
  check(d2.payment_method === 'CREDITO' && n(escalar(`SELECT amount FROM dbo.refund_payments WHERE refund_id = ${d2.id} AND payment_method = N'CREDITO'`)) === 100,
    'la devolución queda como CREDITO, $100 descontados del saldo');

  // =============================================================== 3
  seccion('3. Crédito con abonos');
  q(`EXEC dbo.sp_register_customer_payment @customer_id=${cliente}, @sale_id=${v2}, @amount=150, @user_id=${u}, @payment_method=N'EFECTIVO';`);
  check(n(escalar(`SELECT balance FROM dbo.sales WHERE id = ${v2}`)) === 50, 'abonó $150: debe $50');
  const caja3 = efectivoCaja();
  q(devolver(v2, 2));
  check(n(escalar(`SELECT balance FROM dbo.sales WHERE id = ${v2}`)) === 0, 'devolver $200: primero se cancela lo que debía ($50)');
  check(efectivoCaja() === caja3 - 150, 'y los $150 que ya había pagado salen en efectivo', `${caja3} -> ${efectivoCaja()}`);
  check(escalar(`SELECT TOP 1 payment_method FROM dbo.sale_refunds WHERE sale_id = ${v2} ORDER BY id DESC`) === 'MIXTO', 'la devolución queda como MIXTO');

  // =============================================================== 4
  seccion('4. Tarjeta');
  const v4 = vender('TARJETA', 1);
  const caja4 = efectivoCaja();
  q(devolver(v4, 1, { metodo: 'TARJETA', motivo: 'No lo quiso' }));
  const d4 = uno(`SELECT TOP 1 * FROM dbo.sale_refunds WHERE sale_id = ${v4}`);
  check(efectivoCaja() === caja4 && n(d4.closure_id) === turno, 'a tarjeta: el cajón no se mueve, pero queda en el turno');

  // =============================================================== 5
  seccion('5. El corte');
  const mov = sets(`EXEC dbo.sp_get_cash_movements @closure_id=${turno};`);
  const devs = mov[3] || [];
  check(devs.length === 4, 'el corte del turno lista sus 4 devoluciones', String(devs.length));
  check(devs.some(x => x.reason === 'No lo quiso' && n(x.efectivo) === 0) && devs.some(x => n(x.efectivo) === 150),
    'cada una con su motivo y lo que salió en efectivo');
  check(devs.some(x => x.cliente === 'Taller Ruiz'), 'y el cliente cuando lo hay');
  const hoy = escalar(`SELECT CONVERT(VARCHAR(10), CAST(GETDATE() AS DATE), 23)`);
  const dia = sets(`EXEC dbo.sp_get_cash_movements @start_date='${hoy}', @end_date='${hoy}', @register_id=1;`);
  check((dia[3] || []).length === 4, 'también por día, para el corte de varios turnos');
  q(`EXEC dbo.sp_close_shift @closure_id=${turno}, @cash_delivered=${efectivoCaja()}, @user_id=${u};`);
  const correo = sets(`EXEC dbo.sp_cash_closure_email_data @closure_id=${turno};`)[3] || [];
  check(correo.length === 4 && correo.some(x => String(x.note).startsWith('No lo quiso')), 'el correo del corte lleva las 4, con el motivo en la nota');

  // =============================================================== 6
  seccion('6. Ventas para devolver');
  const hoyCaja = q(`EXEC dbo.sp_refund_candidates @register_id=1;`);
  check(hoyCaja.length === 3 && hoyCaja[0].id === v4, 'las de hoy de la caja, la más reciente primero', String(hoyCaja.length));
  const f4 = hoyCaja.find(x => x.id === v4);
  check(f4.devuelta === true && n(f4.devuelto) === 100, 'la de tarjeta ya está devuelta completa');
  check(hoyCaja.find(x => x.id === v1).devuelta === false && /Taza/.test(hoyCaja[0].resumen), 'la primera aún tiene qué devolver, con su resumen');
  check(q(`EXEC dbo.sp_refund_candidates @customer_id=${cliente};`).every(x => n(x.customer_id) === cliente), 'por cliente: solo las suyas');
  check(q(`EXEC dbo.sp_refund_candidates @folio=${v1};`).length === 1, 'por folio: esa venta');

  // =============================================================== 7
  seccion('7. Cambio');
  q(`EXEC dbo.sp_open_shift @user_id=${u}, @opening_cash=500, @register_id=1;
     INSERT INTO dbo.products (part_number, nombre, price, stock, category_id, brand_id, cost, objeto_impuesto, tasa_iva, active, registrated_date, inventory_mode)
     VALUES (N'QA-TAZ2', N'Taza grande', 150, 20, (SELECT id FROM dbo.CAT_categories WHERE namee = N'QA Dev'), (SELECT id FROM dbo.CAT_brands WHERE namee = N'QA'), 60, '02', 0.16, 1, GETDATE(), 'DIRECT'),
            (N'QA-VAS', N'Vaso', 60, 20, (SELECT id FROM dbo.CAT_categories WHERE namee = N'QA Dev'), (SELECT id FROM dbo.CAT_brands WHERE namee = N'QA'), 20, '02', 0.16, 1, GETDATE(), 'DIRECT');`);
  const turno2 = n(escalar(`SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC`));
  const grande = n(escalar(`SELECT id FROM dbo.products WHERE part_number = N'QA-TAZ2'`));
  const vaso = n(escalar(`SELECT id FROM dbo.products WHERE part_number = N'QA-VAS'`));
  const caja = () => n(escalar(`SELECT ISNULL(SUM(amount), 0) FROM dbo.cash_movements WHERE closure_id = ${turno2}`));
  const cambiar = (venta, lleva, extra = '') => uno(`DECLARE @r dbo.SaleDetailType; INSERT @r VALUES (${taza}, 1, 100);
     EXEC dbo.sp_exchange_sale @sale_id=${venta}, @user_id=${u}, @RefundDetails=@r, @new_lines_json=N'${JSON.stringify(lleva)}',
          @reason=N'Se equivocó de producto', @register_id=1${extra};`);

  const v7 = vender('EFECTIVO', 1);
  r = falla(`DECLARE @r dbo.SaleDetailType; INSERT @r VALUES (${taza}, 1, 100);
     EXEC dbo.sp_exchange_sale @sale_id=${v7}, @user_id=${u}, @RefundDetails=@r, @new_lines_json=N'[{"productId":${grande},"qty":1}]', @reason=N'X', @register_id=1;`, 'diferencia');
  check(r.ok, 'si lleva algo más caro, hay que decir cómo paga la diferencia', r.error?.slice(0, 60));
  check(n(escalar(`SELECT COUNT(*) FROM dbo.sale_refunds WHERE sale_id = ${v7}`)) === 0, 'y si falla, no queda ni la devolución');
  const c0 = caja();
  const x1 = cambiar(v7, [{ productId: grande, qty: 1 }], `, @diff_method=N'EFECTIVO', @received=100`);
  check(n(x1.lleva) === 150 && n(x1.paga) === 50 && n(x1.regresa) === 0, 'taza de $100 por una de $150: paga $50', JSON.stringify(x1));
  check(caja() === c0 + 50, 'al cajón solo entran los $50 de la diferencia', `${c0} -> ${caja()}`);
  const nueva = uno(`SELECT * FROM dbo.sales WHERE id = ${x1.sale_id}`);
  check(n(nueva.total) === 150 && n(escalar(`SELECT amount FROM dbo.sale_payments WHERE sale_id = ${x1.sale_id} AND payment_method = N'CAMBIO'`)) === 100,
    'la venta nueva: $150, $100 pagados con el cambio');
  check(n(escalar(`SELECT exchange_sale_id FROM dbo.sale_refunds WHERE id = ${x1.refund_id}`)) === n(x1.sale_id), 'la devolución sabe qué venta usó su cambio');
  check(n(escalar(`SELECT stock FROM dbo.products WHERE id = ${grande}`)) === 19, 'sale una taza grande del inventario');
  r = falla(`EXEC dbo.sp_register_sale @user_id=${u}, @payment_method=N'MIXTO', @SaleDetails=@d, @register_id=1,
     @payments_json=N'[{"method":"CAMBIO","amount":100,"reference":"${x1.refund_id}"}]';`.replace('@SaleDetails=@d', '@SaleDetails=@d').replace('EXEC', `DECLARE @d dbo.SaleDetailType; INSERT @d VALUES (${taza}, 1, 100); EXEC`), 'ya se us');
  check(r.ok, 'el mismo cambio no paga otra venta', r.error?.slice(0, 60));

  const v8 = vender('TARJETA', 1);
  const c1 = caja();
  const x2 = cambiar(v8, [{ productId: vaso, qty: 1 }]);
  check(n(x2.paga) === 0 && n(x2.regresa) === 40, 'taza de $100 por un vaso de $60: le regresan $40', JSON.stringify(x2));
  check(caja() === c1 && n(escalar(`SELECT amount FROM dbo.refund_payments WHERE refund_id = ${x2.refund_id} AND payment_method = N'TARJETA'`)) === 40,
    'los $40 regresan a la tarjeta (como se pagó); el cajón no se mueve');

  const mov2 = sets(`EXEC dbo.sp_get_cash_movements @closure_id=${turno2};`);
  check(n(mov2[1][0].ventas_cambio) === 160, 'el corte separa lo cobrado con cambio ($100 + $60)', String(mov2[1][0].ventas_cambio));
  check((mov2[3] || []).filter(x => x.payment_method === 'CAMBIO' || x.payment_method === 'MIXTO').length === 2, 'y lista los dos cambios en Devoluciones');

  // =============================================================== 8
  seccion('8. Comprobante');
  const doc = JSON.parse(escalar(`EXEC dbo.sp_refund_ticket @refund_id=${x1.refund_id};`));
  check(doc.reason === 'Se equivocó de producto' && doc.lines.length === 1 && doc.exchange_lines?.[0]?.nombre === 'Taza grande',
    'el comprobante trae motivo, lo devuelto y lo que se llevó');
  check(doc.payments.some(p => p.payment_method === 'CAMBIO' && n(p.amount) === 100), 'y cómo regresó el dinero');
} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}
console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
