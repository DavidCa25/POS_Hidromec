/**
 * Produccion por tandas (0060).
 *
 *     node scripts/db/pruebas/produccion.mjs [--conservar]
 *
 * QUE COMPRUEBA
 * -------------
 *   1. Formula: solo de un producto DIRECT, ingredientes DIRECT, unidades de la
 *      misma dimension; se convierte a la unidad base al guardar.
 *   2. Planear no mueve inventario; el tablero avisa lo que no alcanza.
 *   3. Empezar descuenta ingredientes (con movimiento PRODUCTION y lo
 *      consumido congelado); si no alcanza, no descuenta NADA; reintentar no
 *      descuenta dos veces.
 *   4. Terminar: entran las piezas buenas, la merma pide motivo, el costo por
 *      pieza buena absorbe la merma y pasa a ser el costo del producto.
 *   5. Cancelar solo una tanda planeada.
 *   6. La formula NO es una receta de venta: el producto sigue siendo DIRECT y
 *      la venta no la expande.
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
const DB = 'Wybix_TmpProduccion';
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
const todos = (sql) => {
  const r = consultarTemporal(DB, sql);
  if (!r.ok) throw new Error(limpiar(r.error));
  return r.sets;
};
const uno = (sql) => q(sql)[0] ?? null;
const escalar = (sql) => { const f = uno(sql); return f ? f[Object.keys(f)[0]] : null; };
const falla = (sql, frag) => {
  const r = consultarTemporal(DB, sql);
  if (r.ok) return { ok: false, error: null };
  const msg = limpiar(r.error);
  return { ok: frag ? msg.includes(frag) : true, error: msg };
};

try {
  console.log(`\nPRODUCCION POR TANDAS   (${DB})`);
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
    // MISMA regla que electron/migrationsRunner.js.
    for (const lote of readFileSync(join(DIR_MIG, f), 'utf8')
        .replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi)) {
      if (lote.trim()) q(lote);
    }
    q(`INSERT INTO dbo.schema_migrations (filename) VALUES (N'${f}');`);
  }

  q(`INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
       VALUES (N'oliver', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'x'), 2), N'cajero', 1, GETDATE());
     INSERT INTO dbo.CAT_brands (namee) VALUES (N'I Do Nut'); INSERT INTO dbo.CAT_categories (namee) VALUES (N'Donas');`);
  const oliver = Number(escalar(`SELECT id FROM dbo.users WHERE usuario = N'oliver'`));
  const marca = escalar('SELECT TOP 1 id FROM dbo.CAT_brands'), cat = escalar('SELECT TOP 1 id FROM dbo.CAT_categories');
  const prod = (pn, n, precio, stock, costo, uom = 'pza') => {
    q(`EXEC dbo.sp_add_product @brand=${marca}, @part_number=N'${pn}', @name=N'${n}', @price=${precio}, @stock=${stock}, @category=${cat}, @cost=${costo};`);
    const id = Number(escalar(`SELECT id FROM dbo.products WHERE part_number = N'${pn}'`));
    q(`UPDATE dbo.products SET base_uom = N'${uom}', inventory_mode = 'DIRECT' WHERE id = ${id};`);
    return id;
  };
  const harina = prod('ING-HAR', 'Harina', 0, 10000, 0.02, 'g');       // 10 kg a $0.02/g
  const azucar = prod('ING-AZU', 'Azucar', 0, 3000, 0.03, 'g');        // 3 kg
  const choco = prod('ING-CHO', 'Chocolate', 0, 1000, 0.16, 'g');      // 1 kg
  const dona = prod('DON-CHO', 'Dona de chocolate', 32, 0, 0);
  const latte = prod('CAF-LAT', 'Latte', 55, 0, 0);
  q(`UPDATE dbo.products SET inventory_mode = 'RECIPE' WHERE id = ${latte};`);

  const lineas = (filas) => `DECLARE @L dbo.RecipeLineType; INSERT INTO @L (ingredient_product_id, input_qty, input_uom, waste_pct, sort_order) VALUES ${filas};`;
  const guardar = (pid, rinde, filas) => `${lineas(filas)} EXEC dbo.sp_production_formula_save @product_id=${pid}, @yield_qty=${rinde}, @user_id=${oliver}, @Lines=@L;`;
  const plan = (pid, n) => Number(uno(`EXEC dbo.sp_production_plan @user_id=${oliver}, @product_id=${pid}, @planned_qty=${n};`).id);
  const stock = (id) => Number(escalar(`SELECT stock FROM dbo.products WHERE id = ${id}`));

  // =============================================================== 1
  seccion('1. La formula');
  let r = falla(guardar(latte, 1, `(${harina}, 10, N'g', 0, 1)`), 'inventario directo');
  check(r.ok, 'un producto RECIPE no lleva formula de produccion', r.error?.slice(0, 70));
  r = falla(guardar(dona, 1, `(${dona}, 10, N'g', 0, 1)`), 'si mismo');
  check(r.ok, 'ni puede ser ingrediente de si mismo', r.error?.slice(0, 60));
  r = falla(guardar(dona, 1, `(${harina}, 10, N'ml', 0, 1)`), 'unidad');
  check(r.ok, 'ni mezclar dimensiones (harina en ml)', r.error?.slice(0, 60));
  r = falla(guardar(dona, 1, `(${latte}, 1, N'pza', 0, 1)`), 'inventario directo');
  check(r.ok, 'ni usar una receta como ingrediente', r.error?.slice(0, 60));
  // Masa para 12 donas: 0.6 kg de harina, 120 g de azucar (5% merma), 150 g de chocolate.
  q(guardar(dona, 12, `(${harina}, 0.6, N'kg', 0, 1), (${azucar}, 120, N'g', 5, 2), (${choco}, 150, N'g', 0, 3)`));
  const f = todos(`EXEC dbo.sp_production_formula_get @product_id=${dona};`);
  check(Number(f[0][0].yield_qty) === 12 && f[1].length === 3, 'se guarda para 12 piezas con 3 ingredientes');
  check(Number(f[1].find(l => l.ingredient_product_id === harina).qty_base) === 600, 'los kg de harina se guardan como 600 g');
  check(escalar(`SELECT inventory_mode FROM dbo.products WHERE id = ${dona}`) === 'DIRECT' &&
        Number(escalar(`SELECT COUNT(*) FROM dbo.recipes WHERE product_id = ${dona}`)) === 0,
        'la dona sigue siendo DIRECT y sin receta de venta (no hay doble consumo)');

  // =============================================================== 2
  seccion('2. Planear');
  const t1 = plan(dona, 100);
  check(stock(harina) === 10000 && stock(choco) === 1000, 'planear no mueve inventario');
  let tab = todos('EXEC dbo.sp_production_board;');
  const ch = tab[1].find(x => x.ingredient_product_id === choco);
  check(ch && Number(ch.needed) === 1250 && Number(ch.missing) === 250, 'el tablero avisa: faltan 250 g de chocolate', JSON.stringify(ch));
  check(Number(tab[0].find(b => b.id === t1).faltantes) === 1, 'y la tanda dice que 1 ingrediente no alcanza');
  check(tab[2].some(p => p.product_id === dona), 'la dona aparece entre lo que se puede producir');
  const uuid = uno(`SELECT LOWER(CONVERT(VARCHAR(36), uuid)) AS u FROM dbo.production_batches WHERE id = ${t1}`).u;
  check(Number(uno(`EXEC dbo.sp_production_plan @user_id=${oliver}, @product_id=${dona}, @planned_qty=100, @uuid='${uuid}';`).id) === t1,
        'reintentar con el mismo uuid devuelve la misma tanda');

  // =============================================================== 3
  seccion('3. Empezar');
  r = falla(`EXEC dbo.sp_production_start @user_id=${oliver}, @batch_id=${t1};`, 'No alcanza Chocolate: necesitas 1250 g y hay 1000 g');
  check(r.ok, 'si no alcanza, no empieza y dice que falta', r.error?.slice(0, 90));
  check(stock(harina) === 10000 && stock(azucar) === 3000, 'y no descuenta NADA');
  q(`EXEC dbo.sp_production_plan @user_id=${oliver}, @batch_id=${t1}, @planned_qty=72;`);
  q(`EXEC dbo.sp_production_start @user_id=${oliver}, @batch_id=${t1}, @machine_name=N'CENTRO-1';`);
  check(stock(harina) === 6400 && stock(azucar) === 2244 && stock(choco) === 100,
        'con 72 planeadas salen 3.6 kg de harina, 756 g de azucar (con merma) y 900 g de chocolate',
        `${stock(harina)} / ${stock(azucar)} / ${stock(choco)}`);
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.inventory_movements WHERE source = 'PRODUCTION' AND typee = 'salida' AND reference = '${uuid}'`)) === 3,
        'cada ingrediente deja su movimiento PRODUCTION con el uuid de la tanda');
  const tc = Number(escalar(`SELECT total_cost FROM dbo.production_batches WHERE id = ${t1}`));
  check(Math.abs(tc - (3600 * 0.02 + 756 * 0.03 + 900 * 0.16)) < 0.01, 'el costo de lo consumido queda congelado', tc.toFixed(2));
  q(`EXEC dbo.sp_production_start @user_id=${oliver}, @batch_id=${t1};`);
  check(stock(harina) === 6400, 'empezar dos veces no descuenta dos veces');
  r = falla(`EXEC dbo.sp_production_plan @user_id=${oliver}, @batch_id=${t1}, @planned_qty=80;`, 'ya empezo');
  check(r.ok, 'lo planeado ya no se cambia una vez empezada');
  r = falla(`EXEC dbo.sp_production_cancel @user_id=${oliver}, @batch_id=${t1};`, 'Solo se cancela');
  check(r.ok, 'ni se cancela: sus ingredientes ya se usaron');

  // =============================================================== 4
  seccion('4. Terminar');
  r = falla(`EXEC dbo.sp_production_finish @user_id=${oliver}, @batch_id=${t1}, @good_qty=68;`, 'motivo');
  check(r.ok, 'si salen menos, pide el motivo de la merma');
  const fin = uno(`EXEC dbo.sp_production_finish @user_id=${oliver}, @batch_id=${t1}, @good_qty=68, @waste_reason=N'Se quemo';`);
  check(Number(fin.waste_qty) === 4 && stock(dona) === 68, 'entran 68 donas buenas y quedan 4 de merma');
  check(Math.abs(Number(fin.unit_cost) - tc / 68) < 0.001, 'el costo por dona buena absorbe la merma', Number(fin.unit_cost).toFixed(4));
  check(Math.abs(Number(escalar(`SELECT cost FROM dbo.products WHERE id = ${dona}`)) - tc / 68) < 0.001, 'y pasa a ser el costo del producto');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.inventory_movements WHERE source = 'PRODUCTION' AND typee = 'entrada' AND product_id = ${dona}`)) === 1,
        'la entrada de donas tiene su movimiento');
  r = falla(`EXEC dbo.sp_production_finish @user_id=${oliver}, @batch_id=${t1}, @good_qty=68, @waste_reason=N'x';`, 'ya se registro');
  check(r.ok, 'una tanda terminada no se registra dos veces');
  q(`UPDATE dbo.products SET stock = stock + 2000 WHERE id = ${choco};`);
  const t2 = plan(dona, 12);
  q(`EXEC dbo.sp_production_start @user_id=${oliver}, @batch_id=${t2};`);
  q(`EXEC dbo.sp_production_finish @user_id=${oliver}, @batch_id=${t2}, @good_qty=14;`);
  check(stock(dona) === 82 && Number(escalar(`SELECT waste_qty FROM dbo.production_batches WHERE id = ${t2}`)) === 0,
        'si la masa rinde de mas, entran todas y no hay merma');

  // =============================================================== 5
  seccion('5. Cancelar y quitar formula');
  const t3 = plan(dona, 24);
  r = falla(`EXEC dbo.sp_production_formula_delete @product_id=${dona};`, 'tandas planeadas');
  check(r.ok, 'no se quita la formula con tandas pendientes');
  q(`EXEC dbo.sp_production_cancel @user_id=${oliver}, @batch_id=${t3};`);
  tab = todos('EXEC dbo.sp_production_board;');
  check(!tab[0].some(b => b.id === t3) && tab[0].filter(b => b.status === 'DONE').length === 2,
        'la cancelada sale del tablero; las terminadas siguen');
  check(tab[0].find(b => b.id === t1).started_by_name === 'oliver', 'el tablero dice quien la empezo');

  // =============================================================== 6
  seccion('6. Merma de producto terminado (lo que no se vendio)');
  r = falla(`EXEC dbo.sp_production_waste @user_id=${oliver}, @product_id=${dona}, @qty=5, @reason=N'';`, 'motivo');
  check(r.ok, 'pide el motivo');
  r = falla(`EXEC dbo.sp_production_waste @user_id=${oliver}, @product_id=${dona}, @qty=500, @reason=N'No se vendio';`, 'Solo hay 82');
  check(r.ok, 'no tira mas de lo que hay', r.error?.slice(0, 60));
  const wuuid = '4b5c2d1e-0000-4000-8000-00000000c0de';
  q(`EXEC dbo.sp_production_waste @user_id=${oliver}, @product_id=${dona}, @qty=6, @reason=N'No se vendio', @uuid='${wuuid}';`);
  q(`EXEC dbo.sp_production_waste @user_id=${oliver}, @product_id=${dona}, @qty=6, @reason=N'No se vendio', @uuid='${wuuid}';`);
  check(stock(dona) === 76 && Number(escalar(`SELECT COUNT(*) FROM dbo.production_waste`)) === 1,
        'salen 6 del inventario, y reintentar no las saca dos veces');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.inventory_movements WHERE source = 'WASTE' AND reference = '${wuuid}'`)) === 1,
        'con su movimiento WASTE');

  // =============================================================== 7
  seccion('7. Cierre del dia');
  const cierre = todos('EXEC dbo.sp_day_close_report;');
  const fila = cierre[7]?.find(p => p.product_id === dona);
  check(cierre.length === 9, 'el reporte trae produccion y mermas al final (9 resultados)', String(cierre.length));
  check(fila && Number(fila.producidas) === 82 && Number(fila.merma_produccion) === 4 && Number(fila.merma_terminado) === 6 && Number(fila.existencia) === 76,
        'por producto: 82 producidas, 4 de merma al producir, 6 tiradas, quedan 76', JSON.stringify(fila));
  check(cierre[8]?.length === 1 && cierre[8][0].reason === 'No se vendio', 'y la merma del dia, una por una');

  // =============================================================== 8
  seccion('8. A la nube (outbox)');
  q('EXEC dbo.sp_sync_capture;');
  const ev = q(`SELECT aggregate_type, event_type, payload FROM dbo.sync_outbox WHERE aggregate_type IN ('PRODUCTION', 'WASTE')`);
  const fin8 = ev.find(e => e.aggregate_type === 'PRODUCTION' && e.event_type === 'PRODUCTION_FINISHED' && JSON.parse(e.payload).good_qty === '68.00');
  check(!!fin8 && JSON.parse(fin8.payload).consumption.length === 3, 'cada tanda terminada viaja con lo que consumio', fin8 ? '' : JSON.stringify(ev.map(e => e.event_type)));
  check(ev.some(e => e.event_type === 'PRODUCTION_CANCELLED'), 'la cancelada tambien');
  check(ev.some(e => e.aggregate_type === 'WASTE' && JSON.parse(e.payload).qty === '6.00'), 'y la merma de terminado');
  const antes = Number(escalar(`SELECT COUNT(*) FROM dbo.sync_outbox`));
  q('EXEC dbo.sp_sync_capture;');
  check(Number(escalar(`SELECT COUNT(*) FROM dbo.sync_outbox`)) === antes, 'capturar dos veces no duplica eventos');

  console.log(`\nRESULTADO: ${fallos ? 'FALLA' : 'OK'} (${pasos} comprobaciones${fallos ? `, ${fallos} fallas` : ''})`);
} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* ya no estaba */ } }
}
process.exit(fallos ? 1 : 0);
