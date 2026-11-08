/**
 * Pago con una parte a crédito (0081), en SQL Server.
 *
 *     node scripts/db/pruebas/credito-parcial.mjs [--conservar]
 *
 * «El cliente trae $100 y son $150: los otros $50, a crédito.» La venta es
 * una venta A CRÉDITO con una parte pagada al momento (enganche):
 *
 *   · queda payment_method CREDITO, paid_amount = lo pagado, balance = lo fiado;
 *   · lo pagado queda en sale_payments por su método; lo fiado, no;
 *   · el efectivo del enganche entra al cajón (cash_movements);
 *   · el límite del cliente se mide con lo FIADO, no con el total;
 *   · sin cliente no hay parte a crédito, y nada se descuenta;
 *   · los abonos, la devolución y la edición la tratan como a cualquier venta
 *     a crédito con una parte pagada;
 *   · el corte cuenta en «ventas a crédito» solo lo fiado (el enganche ya
 *     cuenta en su método), y el resumen de la nube igual;
 *   · la venta a crédito de siempre (todo fiado) no cambia.
 *
 * Corre sobre una restauración del baseline, no sobre ninguna base de trabajo.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { consultarTemporal } from '../lib/temporal-consulta.mjs';
import { limpiar } from './lib.mjs';

const BAK = join('installer', 'template.bak');
const DIR_MIG = join('electron', 'migrations');
const DB = 'Wybix_TmpCreditoParcial';
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);
const todo = (sql) => { const r = consultarTemporal(DB, sql); if (!r.ok) throw new Error(limpiar(r.error)); return r.sets; };
const q = (sql) => todo(sql)[0] ?? [];
const uno = (sql) => q(sql)[0] ?? null;
const n = (v) => Number(v ?? 0);
const intentar = (sql) => { const r = consultarTemporal(DB, sql); return r.ok ? { ok: true, sets: r.sets } : { ok: false, error: limpiar(r.error) }; };

try {
  console.log(`\nPAGO CON UNA PARTE A CRÉDITO (0081)   (${DB})`);
  if (!existsSync(BAK)) { console.log(`   ----   falta ${BAK}: es un artefacto derivado (npm run db:baseline).`); process.exit(0); }
  restaurar(DB, BAK);
  const aplicadas = new Set(q('SELECT filename FROM dbo.schema_migrations;').map(r => r.filename));
  for (const f of readdirSync(DIR_MIG).filter(x => x.toLowerCase().endsWith('.sql')).sort((a, b) => a.localeCompare(b, 'en')).filter(f => !aplicadas.has(f))) {
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) if (lote.trim()) q(lote);
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }

  const USER = n(uno(`INSERT INTO dbo.users (usuario, password_hash, rol, active) VALUES (N'qa.credito', N'x', N'admin', 1); SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;`).id);
  const BRAND = n(uno(`INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA'); SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;`).id);
  const CAT = n(uno(`INSERT INTO dbo.CAT_categories (namee) VALUES (N'QA'); SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;`).id);
  const PROD = n(uno(`EXEC dbo.sp_add_product @brand=${BRAND}, @part_number=N'QA-150', @name=N'Producto de 150', @price=150, @stock=100, @category=${CAT}, @cost=60;`).id);
  const cliente = (nombre, limite, plazo = 15) => n(uno(`INSERT INTO dbo.customers (customerName, credit_limit, terms_days, grace_days)
    VALUES (N'${nombre}', ${limite}, ${plazo}, 3); SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;`).id);
  const ANA = cliente('Ana QA', 1000);
  const LUIS = cliente('Luis QA', 40);
  const TURNO = n(uno(`EXEC dbo.sp_open_shift @user_id=${USER}, @opening_cash=200, @register_id=1;`).closure_id);

  const stock = () => n(uno(`SELECT stock FROM dbo.products WHERE id=${PROD};`).stock);
  const vender = ({ pagos = null, metodo = 'MIXTO', cliente = null, piezas = 1 } = {}) => intentar(`
    DECLARE @a dbo.SaleDetailType, @b dbo.SaleDetailType2, @m dbo.SaleModifierType;
    INSERT @b VALUES (1, ${PROD}, ${piezas}, 150, NULL);
    EXEC dbo.sp_register_sale @user_id=${USER}, @payment_method=N'${metodo}', @register_id=1, @customer_id=${cliente ?? 'NULL'},
         @SaleDetails=@a, @SaleDetails2=@b, @SaleModifiers=@m,
         @payments_json=${pagos ? `N'${JSON.stringify(pagos)}'` : 'NULL'};`);
  const venta = (id) => uno(`SELECT payment_method, total, paid_amount, balance, customer_id,
    DATEDIFF(DAY, CAST(GETDATE() AS DATE), due_date) AS dias FROM dbo.sales WHERE id=${id};`);
  const pagosDe = (id) => q(`SELECT payment_method, amount, received FROM dbo.sale_payments WHERE sale_id=${id} ORDER BY payment_method;`);
  const efectivoDe = (id) => n(uno(`SELECT ISNULL(SUM(amount),0) AS v FROM dbo.cash_movements WHERE typee='SALE' AND reference_id=${id};`).v);
  const idDe = (r) => n(r.sets[0][0].sale_id);

  seccion('efectivo y el resto a crédito («trae $100 de $150»)');
  const r1 = vender({ cliente: ANA, pagos: [{ method: 'EFECTIVO', amount: 100, received: 100 }, { method: 'CREDITO', amount: 50 }] });
  check(r1.ok, 'se registra', r1.error);
  const V1 = idDe(r1);
  const v1 = venta(V1);
  check(v1.payment_method === 'CREDITO' && n(v1.paid_amount) === 100 && n(v1.balance) === 50 && n(v1.customer_id) === ANA,
    'es una venta a crédito: pagado 100, saldo 50, de Ana', JSON.stringify(v1));
  check(n(v1.dias) === 15, 'vence a los días de plazo del cliente', String(v1.dias));
  const p1 = pagosDe(V1);
  check(p1.length === 1 && p1[0].payment_method === 'EFECTIVO' && n(p1[0].amount) === 100, 'lo pagado queda en sale_payments; lo fiado no');
  check(efectivoDe(V1) === 100, 'los 100 en efectivo entran al cajón');
  check(stock() === 99, 'se descuenta el inventario');

  seccion('con cambio y con tarjeta');
  const r2 = vender({ cliente: ANA, pagos: [{ method: 'EFECTIVO', amount: 100, received: 200 }, { method: 'CREDITO', amount: 50 }] });
  const V2 = idDe(r2);
  check(r2.ok && efectivoDe(V2) === 100 && n(pagosDe(V2)[0].received) === 200, 'recibe 200: al cajón entran 100 (el cambio no es venta)');
  const r3 = vender({ cliente: ANA, pagos: [{ method: 'TARJETA', amount: 120 }, { method: 'CREDITO', amount: 30 }] });
  const V3 = idDe(r3);
  check(r3.ok && efectivoDe(V3) === 0 && pagosDe(V3)[0].payment_method === 'TARJETA' && n(venta(V3).balance) === 30,
    'tarjeta 120 + crédito 30: nada al cajón, saldo 30');

  seccion('el límite se mide con lo fiado');
  const r4 = vender({ cliente: LUIS, pagos: [{ method: 'EFECTIVO', amount: 110 }, { method: 'CREDITO', amount: 40 }] });
  check(r4.ok, 'Luis (límite 40) se lleva 40 fiados de una venta de 150', r4.error);
  const antes = stock();
  const r5 = vender({ cliente: LUIS, pagos: [{ method: 'EFECTIVO', amount: 140 }, { method: 'CREDITO', amount: 10 }] });
  check(!r5.ok && /Lo que queda a credito \(\$10\.00\) supera/.test(r5.error), 'pero ya no le cabe ni 10 más', r5.error);
  check(stock() === antes, 'y el rechazo no descuenta nada');

  seccion('lo que no se acepta');
  const r6 = vender({ pagos: [{ method: 'EFECTIVO', amount: 100 }, { method: 'CREDITO', amount: 50 }] });
  check(!r6.ok && /necesita el cliente/.test(r6.error), 'sin cliente no hay parte a crédito', r6.error);
  const r7 = vender({ cliente: ANA, pagos: [{ method: 'CREDITO', amount: 50 }, { method: 'CREDITO', amount: 100 }] });
  check(!r7.ok, 'crédito repetido');
  const r8 = vender({ cliente: ANA, pagos: [{ method: 'EFECTIVO', amount: 100 }, { method: 'CREDITO', amount: 40 }] });
  check(!r8.ok && /cubrir exactamente/.test(r8.error), 'los pagos tienen que cubrir exactamente la venta', r8.error);
  check(stock() === antes, 'ninguno descuenta inventario');

  seccion('todo a crédito, por las dos vías');
  const r9 = vender({ cliente: ANA, pagos: [{ method: 'CREDITO', amount: 150 }] });
  const V9 = idDe(r9);
  check(r9.ok && n(venta(V9).paid_amount) === 0 && n(venta(V9).balance) === 150 && pagosDe(V9).length === 0 && efectivoDe(V9) === 0,
    'un solo pago CREDITO es una venta a crédito entera');
  const r10 = vender({ cliente: ANA, metodo: 'CREDITO' });
  const V10 = idDe(r10);
  check(r10.ok && venta(V10).payment_method === 'CREDITO' && n(venta(V10).balance) === 150 && pagosDe(V10).length === 0,
    'la venta a crédito de siempre no cambia');

  seccion('abonos, edición y devolución');
  const ab = intentar(`EXEC dbo.sp_register_customer_payment @customer_id=${ANA}, @sale_id=${V1}, @amount=50, @user_id=${USER}, @payment_method=N'EFECTIVO', @register_id=1;`);
  check(ab.ok && n(venta(V1).balance) === 0 && n(venta(V1).paid_amount) === 150, 'el saldo de 50 se liquida con un abono', ab.error);
  const ed = intentar(`DECLARE @d dbo.SaleDetailType; INSERT @d VALUES (${PROD}, 2, 150);
    EXEC dbo.sp_update_sale @sale_id=${V2}, @user_id=${USER}, @SaleDetails=@d, @register_id=1;`);
  check(!ed.ok && /pagos registrados/.test(ed.error), 'una venta a crédito con parte pagada no se edita (igual que con abonos)', ed.error);
  const dev = intentar(`DECLARE @d dbo.SaleDetailType; INSERT @d VALUES (${PROD}, 1, 150);
    EXEC dbo.sp_refund_sale @sale_id=${V2}, @user_id=${USER}, @payment_method=N'EFECTIVO', @RefundDetails=@d, @register_id=1, @reason=N'DEVOLUCION';`);
  const v2d = venta(V2);
  check(dev.ok && n(v2d.balance) === 0, 'devolverla cancela primero el saldo fiado', dev.error ?? JSON.stringify(v2d));
  const salidaDev = n(uno(`SELECT ISNULL(SUM(amount),0) AS v FROM dbo.cash_movements WHERE reference_id=${V2} AND typee<>'SALE';`).v);
  check(Math.abs(salidaDev) === 100, 'y regresa en efectivo solo lo que sí se pagó', String(salidaDev));

  seccion('corte y resumen');
  const sets = todo(`EXEC dbo.sp_get_cash_movements @closure_id=${TURNO}, @register_id=1;`);
  const resumen = sets.map(s => s[0]).find(f => f && 'ventas_credito' in f);
  /* Lo fiado del turno: V1 50 + V2 50 + V3 30 + Luis 40 + V9 150 + V10 150. La devolución
     no cambia lo que se fió al vender. */
  const fiado = 50 + 50 + 30 + 40 + 150 + 150;
  check(resumen && n(resumen.ventas_credito) === fiado, `«ventas a crédito» del corte es solo lo fiado (${fiado})`, String(resumen?.ventas_credito));
  check(resumen && n(resumen.ventas_efectivo) >= 100 + 100 + 110, 'el enganche en efectivo cuenta como venta en efectivo', String(resumen?.ventas_efectivo));
  const nube = uno(`EXEC dbo.sp_cloud_daily_summary;`);
  check(nube && n(nube.total_credito) === fiado, 'el resumen diario de la nube cuenta igual', String(nube?.total_credito));
} catch (e) {
  check(false, 'la prueba se interrumpió', e.message);
} finally {
  if (!CONSERVAR) try { eliminar(DB); } catch { /* noop */ }
}
console.log(`\n${fallos ? 'HAY FALLOS' : 'TODO BIEN'} · ${pasos - fallos}/${pasos}\n`);
process.exit(fallos ? 1 : 0);
