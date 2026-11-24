/**
 * 0089 · MAYOREO: presentación de venta (el cartón) y lista de precios por
 * cliente, de la base al cobro.
 *
 *     node scripts/db/pruebas/mayoreo.mjs [--conservar]
 *
 * Restaura installer/template.bak en una base temporal, aplica la 0089 con el
 * runner de la app (y otra vez a mano: es idempotente) y comprueba:
 *
 *   1. La ficha guarda el código y el precio del cartón; Compras no los borra.
 *      Un código repetido o un contenido fraccionario se rechazan.
 *   2. La cotización (electron/comercial/servicio.cjs, la misma de la caja)
 *      cobra el cartón a su precio desde la base, y sp_register_sale lo
 *      registra en piezas: inventario −12 por cartón, total exacto.
 *   3. Si el precio del cartón cambia entre cotizar y cobrar, no se cobra.
 *   4. Una lista «solo clientes» solo se cotiza para el cliente que la tiene,
 *      y la venta queda atada a él.
 *
 * Solo escribe en la base temporal Wybix_TmpMayoreo, que borra al final.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { restaurar, eliminar } from '../lib/temporal.mjs';
import { SERVIDOR } from '../lib/sql.mjs';

const require = createRequire(import.meta.url);
const sql = require('mssql/msnodesqlv8');
const { runMigrations } = require('../../../electron/migrationsRunner.js');
const servicio = require('../../../electron/comercial/servicio.cjs');

const DB = 'Wybix_TmpMayoreo';
const BAK = join('installer', 'template.bak');
const MIG = join('electron', 'migrations', '0089_mayoreo.sql');
const CONSERVAR = process.argv.includes('--conservar');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);
const lotes = (ruta) => readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi).map((s) => s.trim()).filter(Boolean);

let pool;
try {
  console.log(`\nMAYOREO   (${DB})`);
  restaurar(DB, BAK);
  pool = await new sql.ConnectionPool({ server: SERVIDOR, database: DB, options: { trustedConnection: true, trustServerCertificate: true } }).connect();
  const q = async (texto) => (await pool.request().query(texto)).recordset || [];
  const falla = async (texto) => { try { await q(texto); return null; } catch (e) { return String(e.message); } };

  // ============================================================ 0
  seccion('0. Migración 0089');
  const r = await runMigrations({ pool, sql, migrationsDir: join('electron', 'migrations') });
  check(r.applied.includes('0089_mayoreo.sql'), 'el runner aplica la 0089 sobre la plantilla', r.applied.join(', '));
  for (const l of lotes(MIG)) await q(l);
  check(true, 'reaplicarla a mano no rompe nada (idempotente)');

  const user = (await q("INSERT dbo.users(usuario,password_hash,rol,active,creation_date) OUTPUT INSERTED.id VALUES(N'qa-mayoreo',N'x',N'admin',1,GETDATE())"))[0].id;
  const brand = (await q("INSERT dbo.CAT_brands(namee) OUTPUT INSERTED.id VALUES(N'QA Cervecería')"))[0].id;
  const cat = (await q("INSERT dbo.CAT_categories(namee) OUTPUT INSERTED.id VALUES(N'QA Cerveza')"))[0].id;
  const chela = (await q(`EXEC dbo.sp_add_product @brand=${brand},@part_number=N'QA-MED',@name=N'Corona mediana QA',@price=20,@stock=100,@category=${cat},@bar_code=N'7501000000017',@cost=12`))[0].id;
  await q(`EXEC dbo.sp_open_shift @user_id=${user},@opening_cash=0,@register_id=1;`);
  const stock = async () => Number((await q(`SELECT stock FROM dbo.products WHERE id=${chela}`))[0].stock);

  // ============================================================ 1
  seccion('1. La ficha: código y precio del cartón');
  const guardar = (extra) => q(`EXEC dbo.sp_save_product_presentation @product_id=${chela},@name=N'Cartón 12',@factor_to_base=12,${extra}`);
  const pres = (await guardar("@con_venta=1,@bar_code=N'QA-CARTON-12',@sale_price=200"))[0].id;
  let fila = (await q(`EXEC dbo.sp_get_product_presentations @product_id=${chela}`))[0];
  check(fila.bar_code === 'QA-CARTON-12' && Number(fila.sale_price) === 200, 'se guardan código y precio de venta');
  await q(`EXEC dbo.sp_save_product_presentation @id=${pres},@product_id=${chela},@name=N'Cartón 12',@factor_to_base=12`);
  fila = (await q(`EXEC dbo.sp_get_product_presentations @product_id=${chela}`))[0];
  check(fila.bar_code === 'QA-CARTON-12' && Number(fila.sale_price) === 200, 'guardarla desde Compras (sin @con_venta) no borra el precio');
  let e = await falla(`EXEC dbo.sp_save_product_presentation @product_id=${chela},@name=N'Otra',@factor_to_base=6,@con_venta=1,@bar_code=N'7501000000017',@sale_price=100`);
  check(/otro producto/.test(e ?? ''), 'el código de barras de un producto no se reutiliza en un cartón', e ?? '');
  e = await falla(`EXEC dbo.sp_save_product_presentation @product_id=${chela},@name=N'Media',@factor_to_base=6.5,@con_venta=1,@sale_price=100`);
  check(/piezas enteras/.test(e ?? ''), 'un cartón de 6.5 piezas no se vende', e ?? '');
  e = await falla(`EXEC dbo.sp_save_product_presentation @product_id=${chela},@name=N'Sin precio',@factor_to_base=6,@con_venta=1,@bar_code=N'QA-SIN-PRECIO'`);
  check(/precio de venta/.test(e ?? ''), 'un código de cartón sin precio se rechaza', e ?? '');

  // ============================================================ 2
  seccion('2. Cotizar y cobrar el cartón');
  const version = async () => Number((await q('SELECT version FROM dbo.commercial_policy WHERE id=1'))[0].version);
  const cotizar = async (lines, extra = {}) => servicio.cotizacion(pool, { version: await version(), channel: 'LOCAL', registerId: 1, lines, ...extra }, user);
  /* Como la caja (electron/main.js, construirTvpsVenta): TVP y EXEC directo.
     Un lote con DECLARE + EXEC esconde el THROW tras «statement is not prepared». */
  const cobrar = async (quote, customerId = null) => {
    const d1 = new sql.Table('dbo.SaleDetailType');
    d1.columns.add('product_id', sql.Int, { nullable: true });
    d1.columns.add('quantity', sql.Decimal(12, 2), { nullable: true });
    d1.columns.add('unit_price', sql.Decimal(10, 2), { nullable: true });
    const d2 = new sql.Table('dbo.SaleDetailType2');
    d2.columns.add('line_no', sql.Int, { nullable: false });
    d2.columns.add('product_id', sql.Int, { nullable: false });
    d2.columns.add('quantity', sql.Decimal(12, 2), { nullable: false });
    d2.columns.add('unit_price', sql.Decimal(10, 2), { nullable: false });
    d2.columns.add('note', sql.NVarChar(200), { nullable: true });
    for (const l of quote.lines) d2.rows.add(l.line_no, l.productId, l.qty, l.unitPrice, l.note ?? null);
    const mo = new sql.Table('dbo.SaleModifierType');
    mo.columns.add('line_no', sql.Int, { nullable: false });
    mo.columns.add('modifier_option_id', sql.Int, { nullable: false });
    mo.columns.add('quantity', sql.Int, { nullable: false });
    const r = await pool.request().input('user_id', sql.Int, user).input('payment_method', sql.NVarChar(50), 'EFECTIVO')
      .input('SaleDetails', d1).input('customer_id', sql.Int, customerId).input('register_id', sql.Int, 1)
      .input('SaleDetails2', d2).input('SaleModifiers', mo).input('commercial_quote', sql.UniqueIdentifier, quote.id)
      .execute('sp_register_sale');
    return r.recordset ?? [];
  };
  let quote = await cotizar([{ key: '1', productId: chela, qty: 24, options: [], presentationId: pres }, { key: '2', productId: chela, qty: 3, options: [] }]);
  check(quote.total === '460.00', 'dos cartones y tres sueltas: 2 × $200 + 3 × $20', quote.total);
  check(quote.lines.filter((l) => l.audit.rule === `pres-${pres}`).every((l) => l.note === 'Cartón 12'), 'las piezas del cartón llevan su nombre en la nota del ticket');
  const venta = (await cobrar(quote))[0];
  check(Number(venta.total) === 460, 'sp_register_sale registra el total exacto', String(venta.total));
  check(await stock() === 73, 'el inventario baja en piezas: 100 − 27', String(await stock()));
  const det = await q(`SELECT SUM(quantity*unitary_price) t, SUM(quantity) n FROM dbo.sale_detail WHERE sale_id=${venta.sale_id}`);
  check(Number(det[0].t) === 460 && Number(det[0].n) === 27, 'el detalle cuadra en importe y piezas', `${det[0].t} / ${det[0].n}`);
  let err = null;
  try { await cotizar([{ key: '1', productId: chela, qty: 18, options: [], presentationId: pres }]); } catch (x) { err = x.message; }
  check(/paquetes completos/.test(err ?? ''), '18 piezas no son cartones completos', err ?? '');

  // ============================================================ 3
  seccion('3. El precio del cartón cambió antes de cobrar');
  quote = await cotizar([{ key: '1', productId: chela, qty: 12, options: [], presentationId: pres }]);
  await q(`UPDATE dbo.product_presentations SET sale_price=210 WHERE id=${pres}`);
  e = await cobrar(quote).then(() => null, (x) => x.message);
  check(/precio de una presentaci/.test(e ?? ''), 'la cotización vieja ya no se cobra', e ?? '');
  check(await stock() === 73, 'y no descuenta nada');
  await q(`UPDATE dbo.product_presentations SET active=0 WHERE id=${pres}`);
  err = null;
  try { await cotizar([{ key: '1', productId: chela, qty: 12, options: [], presentationId: pres }]); } catch (x) { err = x.message; }
  check(/ya no se vende/.test(err ?? ''), 'una presentación dada de baja no se cotiza', err ?? '');

  // ============================================================ 4
  seccion('4. Lista de precios de clientes (Mayoreo)');
  const uuid = (await q(`SELECT LOWER(CONVERT(VARCHAR(36),uuid)) u FROM dbo.products WHERE id=${chela}`))[0].u;
  const { policy } = await servicio.catalogo(pool);
  policy.channels.push({ id: 'MAYOREO', name: 'Mayoreo', active: true, inheritBase: true, customersOnly: true });
  policy.prices.push({ channel: 'MAYOREO', product: uuid, price: '17.00' });
  await pool.request().input('actor_id', sql.Int, user).input('expected_version', sql.Int, policy.version)
    .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(policy)).execute('sp_commercial_policy_save');
  const tienda = (await q("INSERT dbo.customers(customerName) OUTPUT INSERTED.id VALUES(N'Tiendita QA')"))[0].id;
  const otro = (await q("INSERT dbo.customers(customerName) OUTPUT INSERTED.id VALUES(N'Cliente de paso QA')"))[0].id;
  e = await falla(`EXEC dbo.sp_customer_price_list_set @customer_id=${tienda},@channel=N'NO-EXISTE'`);
  check(/no existe/.test(e ?? ''), 'una lista que no existe no se asigna', e ?? '');
  await q(`EXEC dbo.sp_customer_price_list_set @customer_id=${otro},@channel=N'LOCAL'`);
  check((await q(`SELECT price_channel FROM dbo.customers WHERE id=${otro}`))[0].price_channel === null, 'Mostrador es «sin lista»');
  await q(`EXEC dbo.sp_customer_price_list_set @customer_id=${tienda},@channel=N'MAYOREO'`);
  const linea = [{ key: '1', productId: chela, qty: 5, options: [] }];
  const intento = async (extra) => { try { await cotizar(linea, { channel: 'MAYOREO', ...extra }); return null; } catch (x) { return x.message; } };
  check(/asigna el cliente/.test(await intento({}) ?? ''), 'sin cliente, la lista de mayoreo no se cotiza');
  check(/no tiene la lista/.test(await intento({ priceCustomerId: otro }) ?? ''), 'un cliente sin la lista tampoco');
  quote = await cotizar(linea, { channel: 'MAYOREO', priceCustomerId: tienda });
  check(quote.total === '85.00' && quote.priceCustomerId === tienda, 'el cliente con la lista paga $17 la pieza', quote.total);
  e = await cobrar(quote, null).then(() => null, (x) => x.message);
  check(/otro cliente/.test(e ?? ''), 'cobrarla sin ese cliente en la venta se rechaza', e ?? '');
  const v2 = (await cobrar(quote, tienda))[0];
  check(Number(v2.total) === 85 && Number((await q(`SELECT customer_id FROM dbo.sales WHERE id=${v2.sale_id}`))[0].customer_id) === tienda, 'con el cliente, se cobra y queda a su nombre');
} catch (e) {
  fallos++;
  console.log(`\n   ERROR  ${e.stack || e.message}`);
} finally {
  try { await pool?.close(); } catch { /* noop */ }
  if (!CONSERVAR) { eliminar(DB); console.log(`\nBase temporal ${DB} eliminada.`); }
}

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S)` : 'todo bien'} (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
