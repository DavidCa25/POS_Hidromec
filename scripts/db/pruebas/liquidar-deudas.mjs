/**
 * LIQUIDAR DEUDAS CON UN ABONO, contra SQL Server de verdad.
 *
 *     node scripts/db/pruebas/liquidar-deudas.mjs [--conservar]
 *
 * Corre electron/lib/liquidar-deudas.js (el mismo código que usa la caja) sobre
 * una restauración del baseline con todas las migraciones, con clientes que
 * deben muchas notas a crédito de $10 a $10,000 (con centavos), y comprueba en
 * la base, después de cada abono:
 *
 *   · cada nota quedó con el saldo que dice el reparto, al centavo;
 *   · la deuda bajó exactamente lo abonado; nada queda negativo;
 *   · un customer_payment por nota tocada y suman el abono;
 *   · el efectivo entra al turno de la caja; tarjeta y transferencia no;
 *   · paga primero lo más vencido;
 *   · más de lo que debe se rechaza sin tocar nada;
 *   · si una parte falla a la mitad, NO queda aplicada ninguna (todo o nada).
 */
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { SERVIDOR } from '../lib/sql.mjs';

const require = createRequire(import.meta.url);
const sql = require('mssql/msnodesqlv8');
const { runMigrations } = require('../../../electron/migrationsRunner.js');
const { liquidarDeudas } = require('../../../electron/lib/liquidar-deudas.js');
const { repartirAbono } = require('../../../electron/lib/repartir-abono.js');

const DB = 'Wybix_TmpLiquidarDeudas';
const BAK = join('installer', 'template.bak');
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);
const c = (n) => Math.round(Number(n) * 100);

/* Semilla fija: el mismo caso vuelve a salir si algo falla. */
function azar(semilla) {
  let s = semilla >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r = azar(20261125);
const entre = (a, b) => a + Math.floor(r() * (b - a + 1));
/** De $10 a $10,000: redondos, con centavos y los extremos. */
const montoNota = () => { const t = r(); return (t < 0.1 ? 1000 : t < 0.2 ? 1_000_000 : t < 0.4 ? entre(10, 10000) * 100 : entre(1000, 1_000_000)) / 100; };

let pool;
try {
  console.log(`\nLIQUIDAR DEUDAS   (${DB})`);
  restaurar(DB, BAK);
  pool = await new sql.ConnectionPool({ server: SERVIDOR, database: DB, options: { trustedConnection: true, trustServerCertificate: true } }).connect();
  const q = async (texto) => { try { return (await pool.request().query(texto)).recordset || []; } catch (e) { throw new Error(`${e.message}
      en: ${texto.trim().slice(0, 160)}`); } };
  await runMigrations({ pool, sql, migrationsDir: join('electron', 'migrations') });

  const user = (await q("INSERT dbo.users(usuario,password_hash,rol,active,creation_date) OUTPUT INSERTED.id VALUES(N'qa-liquidar',N'x',N'admin',1,GETDATE())"))[0].id;
  const brand = (await q("INSERT dbo.CAT_brands(namee) OUTPUT INSERTED.id VALUES(N'QA')"))[0].id;
  const cat = (await q("INSERT dbo.CAT_categories(namee) OUTPUT INSERTED.id VALUES(N'QA')"))[0].id;
  const prod = (await q(`EXEC dbo.sp_add_product @brand=${brand},@part_number=N'QA-1',@name=N'QA uno',@price=1,@stock=100000,@category=${cat},@cost=0.5`))[0].id;
  const turno = (await q(`EXEC dbo.sp_open_shift @user_id=${user},@opening_cash=0,@register_id=1;`))[0].closure_id;
  const op = { registerId: 1, machineId: null, machineName: null };

  const cliente = async (nombre) => (await q(`INSERT dbo.customers(customerName, credit_limit, terms_days, grace_days)
    OUTPUT INSERTED.id VALUES (N'${nombre}', 99999999, 15, 0)`))[0].id;

  /** Una venta a crédito real (sp_register_sale) y luego su saldo al monto pedido y su vencimiento. */
  const notaCredito = async (cli, saldo, venceEnDias) => {
    /* Con una nota vencida la caja ya no le fía otra (así debe ser): para armar
       el escenario, las anteriores se corren al futuro mientras se registra la
       nueva y luego regresan a su fecha. */
    await q(`UPDATE dbo.sales SET due_date = DATEADD(DAY, 10000, due_date) WHERE customer_id=${cli} AND due_date IS NOT NULL`);
    const v = (await q(`DECLARE @a dbo.SaleDetailType, @b dbo.SaleDetailType2, @m dbo.SaleModifierType;
      INSERT @b VALUES (1, ${prod}, 1, 1, NULL);
      EXEC dbo.sp_register_sale @user_id=${user}, @payment_method=N'CREDITO', @register_id=1, @customer_id=${cli},
           @SaleDetails=@a, @SaleDetails2=@b, @SaleModifiers=@m;`))[0].sale_id;
    await q(`UPDATE dbo.sales SET due_date = DATEADD(DAY, -10000, due_date) WHERE customer_id=${cli} AND id<>${v} AND due_date IS NOT NULL`);
    await q(`UPDATE dbo.sales SET total=${saldo}, balance=${saldo}, paid_amount=0,
      due_date = DATEADD(DAY, ${venceEnDias}, CAST(GETDATE() AS DATE)) WHERE id=${v}`);
    return v;
  };
  const abiertas = async (cli) => (await pool.request().input('customer_id', sql.Int, cli).execute('sp_get_customer_open_credit_sales')).recordset
    .map((x) => ({ id: x.id, balance: Number(x.balance), atraso: Number(x.days_late) }));
  const saldos = async (cli) => Object.fromEntries((await q(`SELECT id, balance FROM dbo.sales WHERE customer_id=${cli}`)).map((x) => [x.id, c(x.balance)]));
  const deuda = async (cli) => (await q(`SELECT ISNULL(SUM(balance),0) AS d FROM dbo.sales WHERE customer_id=${cli} AND payment_method='CREDITO'`))[0].d;
  const pagos = async (cli) => (await q(`SELECT COUNT(*) AS n, ISNULL(SUM(amount),0) AS s FROM dbo.customer_payments WHERE customer_id=${cli}`))[0];
  const cajon = async () => (await q(`SELECT ISNULL(SUM(amount),0) AS s FROM dbo.cash_movements WHERE typee='PAYMENT' AND closure_id=${turno}`))[0].s;

  /** Un abono y todo lo que tiene que quedar en la base después. Devuelve si salió bien. */
  const abonarYRevisar = async (cli, monto, metodo, etiqueta, mostrar = false) => {
    const antes = { lista: await abiertas(cli), saldos: await saldos(cli), deuda: c(await deuda(cli)), pagos: await pagos(cli), cajon: c(await cajon()) };
    const esperado = repartirAbono(antes.lista, monto);
    const t0 = Date.now();
    const res = await liquidarDeudas({ pool, sql }, { customerId: cli, monto, metodo, nota: null, quien: user, op });
    const ms = Date.now() - t0;
    if (!res.success) { check(false, `${etiqueta}: se aplica`, res.error); return false; }
    const despues = { saldos: await saldos(cli), deuda: c(await deuda(cli)), pagos: await pagos(cli), cajon: c(await cajon()) };
    const tocadas = new Map(esperado.partidas.map((p) => [p.sale_id, p]));
    const malas = Object.entries(despues.saldos).filter(([id, s]) => {
      const p = tocadas.get(Number(id));
      return s !== (p ? c(p.queda) : antes.saldos[id]);
    });
    const ok = malas.length === 0
      && antes.deuda - despues.deuda === c(monto)
      && Object.values(despues.saldos).every((s) => s >= 0)
      && despues.pagos.n - antes.pagos.n === esperado.partidas.length
      && c(despues.pagos.s) - c(antes.pagos.s) === c(monto)
      && despues.cajon - antes.cajon === (metodo === 'EFECTIVO' ? c(monto) : 0);
    const liq = esperado.partidas.filter((p) => p.liquidada).length;
    const parcial = esperado.partidas.find((p) => !p.liquidada);
    if (!ok || mostrar) check(ok, `${etiqueta}: $${monto.toFixed(2)} ${metodo} → liquida ${liq}${parcial ? `, una queda con $${parcial.queda.toFixed(2)}` : ''}`,
      ok ? `${ms} ms` : JSON.stringify({ malas: malas.slice(0, 3), deuda: [antes.deuda, despues.deuda], pagos: [antes.pagos, despues.pagos], cajon: [antes.cajon, despues.cajon] }));
    return ok;
  };

  // ------------------------------------------------------------------
  seccion('1. El caso de siempre: debe $2,000 en 4 notas y abona $800');
  const ana = await cliente('Ana QA');
  for (const [saldo, dias] of [[500, -12], [250, -3], [750, 5], [500, 20]]) await notaCredito(ana, saldo, dias);
  await abonarYRevisar(ana, 800, 'EFECTIVO', 'Ana', true);
  const anaLista = await abiertas(ana);
  check(anaLista.length === 2 && c(anaLista[0].balance) === 70000 && c(anaLista[1].balance) === 50000,
    'quedan 2 notas: la de $750 con $700 y la de $500 intacta', JSON.stringify(anaLista.map((x) => x.balance)));

  // ------------------------------------------------------------------
  seccion('2. Paga primero lo más vencido, aunque esté más abajo en la lista');
  const beto = await cliente('Beto QA');
  const nueva = await notaCredito(beto, 300, 30);
  const vieja = await notaCredito(beto, 200, -40);
  await abonarYRevisar(beto, 250, 'EFECTIVO', 'Beto', true);
  const sb = await saldos(beto);
  check(sb[vieja] === 0 && sb[nueva] === 25000, 'la vencida (creada después) se liquida primero; la nueva queda con $250', JSON.stringify(sb));

  // ------------------------------------------------------------------
  seccion('3. Muchas notas de $10 a $10,000: 12 clientes, abonos al azar hasta deber cero');
  let abonos = 0, buenos = 0, notasTotales = 0;
  for (let k = 0; k < 12; k++) {
    const cli = await cliente(`Masivo QA ${k}`);
    const n = entre(5, 60);
    notasTotales += n;
    for (let i = 0; i < n; i++) await notaCredito(cli, montoNota(), entre(-90, 45));
    const metodos = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'];
    for (let vuelta = 0; vuelta < 40; vuelta++) {
      const d = c(await deuda(cli));
      if (d === 0) break;
      const t = r();
      // De todo: un centavo, montos chicos, la primera nota justa, una parte grande, o toda la deuda.
      const lista = await abiertas(cli);
      const monto = (t < 0.1 ? 1 : t < 0.35 ? entre(1, Math.min(d, 100000)) : t < 0.5 ? c(lista[0].balance)
        : t < 0.85 ? entre(1, d) : d) / 100;
      abonos++;
      if (await abonarYRevisar(cli, monto, metodos[entre(0, 2)], `cliente ${k} abono ${vuelta + 1}`)) buenos++;
    }
    const resto = c(await deuda(cli));
    if (resto > 0) { abonos++; if (await abonarYRevisar(cli, resto / 100, 'EFECTIVO', `cliente ${k} liquida todo`)) buenos++; }
    check(c(await deuda(cli)) === 0 && (await abiertas(cli)).length === 0, `cliente ${k}: ${n} notas, termina sin deber nada`);
  }
  check(buenos === abonos, `${abonos} abonos sobre ${notasTotales} notas: en cada uno la base cuadra al centavo`, `${buenos}/${abonos}`);

  // ------------------------------------------------------------------
  seccion('4. Lo que se rechaza no toca nada');
  const caro = await cliente('Caro QA');
  for (const s of [10, 10000, 0.5 + 99.49]) await notaCredito(caro, s, -1);
  const fotoCaro = JSON.stringify(await saldos(caro));
  const mas = await liquidarDeudas({ pool, sql }, { customerId: caro, monto: 10109.99 + 0.01, metodo: 'EFECTIVO', quien: user, op });
  check(!mas.success && /mayor a la deuda/.test(mas.error) && JSON.stringify(await saldos(caro)) === fotoCaro, 'un centavo más de lo que debe: rechazado, sin cambios', mas.error);
  const cero = await liquidarDeudas({ pool, sql }, { customerId: caro, monto: 0, metodo: 'EFECTIVO', quien: user, op });
  check(!cero.success && JSON.stringify(await saldos(caro)) === fotoCaro, 'monto cero: rechazado');
  const sinDeuda = await liquidarDeudas({ pool, sql }, { customerId: await cliente('Sin deuda QA'), monto: 50, metodo: 'EFECTIVO', quien: user, op });
  check(!sinDeuda.success && /no tiene ventas a crédito/.test(sinDeuda.error), 'cliente sin deuda: rechazado', sinDeuda.error);
  await abonarYRevisar(caro, 10109.99, 'TARJETA', 'Caro, la deuda exacta', true);

  // ------------------------------------------------------------------
  seccion('5. Todo o nada: si una parte falla a la mitad, no queda ninguna');
  const dora = await cliente('Dora QA');
  const d1 = await notaCredito(dora, 100, -10);
  const d2 = await notaCredito(dora, 200, -5);
  const d3 = await notaCredito(dora, 300, 10);
  await q(`CREATE TRIGGER dbo.trg_qa_falla_a_la_mitad ON dbo.customer_payments AFTER INSERT AS
    IF EXISTS (SELECT 1 FROM inserted WHERE sale_id = ${d2}) THROW 50001, N'QA: falla a la mitad', 1;`);
  const fotoDora = { saldos: JSON.stringify(await saldos(dora)), pagos: await pagos(dora), cajon: c(await cajon()) };
  const mitad = await liquidarDeudas({ pool, sql }, { customerId: dora, monto: 450, metodo: 'EFECTIVO', quien: user, op });
  const tras = { saldos: JSON.stringify(await saldos(dora)), pagos: await pagos(dora), cajon: c(await cajon()) };
  check(!mitad.success, 'la segunda parte falla y el abono se rechaza', mitad.error);
  check(tras.saldos === fotoDora.saldos, 'la primera nota (que sí había pasado) quedó como estaba', tras.saldos);
  check(tras.pagos.n === fotoDora.pagos.n && tras.cajon === fotoDora.cajon, 'ni un pago ni un peso en el cajón');
  await q('DROP TRIGGER dbo.trg_qa_falla_a_la_mitad');
  await abonarYRevisar(dora, 450, 'EFECTIVO', 'Dora, ya sin la falla', true);
  const sd = await saldos(dora);
  check(sd[d1] === 0 && sd[d2] === 0 && sd[d3] === 15000, 'y ahora sí: liquida 2 y la tercera queda con $150', JSON.stringify(sd));

  // ------------------------------------------------------------------
  seccion('6. Efectivo en una caja que no puede recibirlo: se rechaza completo');
  const eli = await cliente('Eli QA');
  await notaCredito(eli, 120, -2); await notaCredito(eli, 80, 3);
  const fotoEli = JSON.stringify(await saldos(eli));
  const otraCaja = await liquidarDeudas({ pool, sql }, { customerId: eli, monto: 150, metodo: 'EFECTIVO', quien: user, op: { registerId: 999, machineId: null, machineName: null } });
  check(!otraCaja.success && JSON.stringify(await saldos(eli)) === fotoEli, 'caja inexistente: rechazado y sin cambios', otraCaja.error);
  const conTarjeta = await liquidarDeudas({ pool, sql }, { customerId: eli, monto: 150, metodo: 'TARJETA', quien: user, op: { registerId: 999, machineId: null, machineName: null } });
  check(conTarjeta.success, 'con tarjeta sí pasa (no entra al cajón)', conTarjeta.error);

  // ------------------------------------------------------------------
  seccion('7. Un cliente con 150 notas y un solo abono que las liquida todas');
  const fer = await cliente('Fer QA');
  for (let i = 0; i < 150; i++) await notaCredito(fer, montoNota(), entre(-60, 30));
  const total = c(await deuda(fer)) / 100;
  await abonarYRevisar(fer, total, 'TRANSFERENCIA', `Fer, $${total.toFixed(2)} de golpe`, true);
  check((await abiertas(fer)).length === 0, 'las 150 quedan liquidadas');
} catch (e) {
  fallos++;
  console.log(`\n   ERROR  ${e.stack || e.message}`);
} finally {
  try { await pool?.close(); } catch { /* noop */ }
  if (!CONSERVAR) { try { eliminar(DB); console.log(`\nBase temporal ${DB} eliminada.`); } catch { /* noop */ } }
}

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S)` : 'todo bien'} (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
