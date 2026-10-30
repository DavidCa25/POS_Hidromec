/**
 * Estado de resultados y utilidad con costo congelado (0062).
 *
 *     node scripts/db/pruebas/estado-resultados.mjs [--conservar]
 *
 * QUE COMPRUEBA
 * -------------
 * Arma un mes con numeros redondos y revisa cada renglon: ventas sin IVA,
 * devoluciones, IVA, costo CONGELADO (no el de hoy), renglones viejos sin
 * costo (estimados), mermas, faltantes por conteo, egresos y pagos al
 * personal (sin los cancelados), periodo anterior, categorias, serie diaria
 * y productos vendidos bajo costo. Y que sp_get_profit_overview y
 * sp_cloud_daily_profit usen el mismo costo.
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
const DB = 'Wybix_TmpResultados';
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
const cerca = (a, b) => Math.abs(Number(a) - b) < 0.005;

try {
  console.log(`\nESTADO DE RESULTADOS   (${DB})`);

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

  q(`INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date) VALUES (N'qa_dueno', N'x', N'admin', 1, GETDATE());`);
  const u = Number(escalar(`SELECT id FROM dbo.users WHERE usuario = N'qa_dueno';`));
  q(`INSERT INTO dbo.CAT_categories (namee) VALUES (N'QA Filtros');`);
  const cat = Number(escalar(`SELECT id FROM dbo.CAT_categories WHERE namee = N'QA Filtros';`));
  const prod = (pn, nombre, precio, costo, categoria, obj, tasa) => {
    q(`INSERT INTO dbo.products (part_number, nombre, price, stock, category_id, cost, objeto_impuesto, tasa_iva, active, registrated_date)
       VALUES (N'${pn}', N'${nombre}', ${precio}, 100, ${categoria ?? 'NULL'}, ${costo}, '${obj}', ${tasa}, 1, GETDATE());`);
    return Number(escalar(`SELECT id FROM dbo.products WHERE part_number = N'${pn}';`));
  };
  const A = prod('QA-A', 'QA Filtro A', 116, 50, cat, '02', 0.16);   // costo HOY 50; se vendio a 40
  const B = prod('QA-B', 'QA Granel B', 30, 20, null, '01', 0);      // exento; renglon viejo sin costo
  const C = prod('QA-C', 'QA Oferta C', 11.6, 15, cat, '02', 0.16);  // se vende bajo costo
  const venta = (fecha, total, lineas) => {
    q(`INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance)
       VALUES ('${fecha}', ${u}, ${total}, 'EFECTIVO', ${total}, 0);`);
    const id = Number(escalar('SELECT MAX(id) FROM dbo.sales;'));
    for (const [p, cant, precio, costo, obj, tasa] of lineas)
      q(`INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, tax_object, tax_rate)
         VALUES (${id}, ${p}, ${cant}, ${precio}, ${costo ?? 'NULL'}, ${obj ? `'${obj}'` : 'NULL'}, ${tasa ?? 'NULL'});`);
    return id;
  };
  const v1 = venta('2026-09-10T12:00:00', 243.6, [[A, 2, 116, 40, '02', 0.16], [C, 1, 11.6, 15, '02', 0.16]]);
  venta('2026-09-11T12:00:00', 30, [[B, 1, 30, null, null, null]]);
  venta('2026-08-20T12:00:00', 116, [[A, 1, 116, 40, '02', 0.16]]);       // periodo anterior
  q(`INSERT INTO dbo.sale_refunds (sale_id, user_id, datee, payment_method, refund_total) VALUES (${v1}, ${u}, '2026-09-12T10:00:00', 'EFECTIVO', 116);
     INSERT INTO dbo.sale_refund_detail (refund_id, product_id, quantity, unitary_price) VALUES (SCOPE_IDENTITY(), ${A}, 1, 116);`);
  q(`INSERT INTO dbo.production_waste (uuid, product_id, waste_date, qty, reason, unit_cost, created_by, created_at)
     VALUES (NEWID(), ${B}, '2026-09-15', 2, N'Caduco', 20, ${u}, SYSDATETIME());`);
  q(`INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn)
     VALUES (${A}, 'salida', 'CONTEO', 1, '2026-09-20T09:00:00', N'Ajuste por conteo fisico (dif -1)');`);
  q(`INSERT INTO dbo.expense_categories (name, kind) VALUES (N'QA Renta', 'GENERAL'), (N'QA Sueldos', 'PERSONAL');`);
  const renta = Number(escalar(`SELECT id FROM dbo.expense_categories WHERE name = N'QA Renta';`));
  const sueldos = Number(escalar(`SELECT id FROM dbo.expense_categories WHERE name = N'QA Sueldos';`));
  q(`INSERT INTO dbo.expenses (expense_date, category_id, amount, payment_method, user_id) VALUES
       ('2026-09-05', ${renta}, 300, 'TRANSFERENCIA', ${u}), ('2026-09-28', ${sueldos}, 100, 'TRANSFERENCIA', ${u}),
       ('2026-08-05', ${renta}, 250, 'TRANSFERENCIA', ${u});
     INSERT INTO dbo.expenses (expense_date, category_id, amount, payment_method, user_id, voided_at, voided_by, void_reason)
       VALUES ('2026-09-06', ${renta}, 999, 'TRANSFERENCIA', ${u}, SYSDATETIME(), ${u}, N'duplicado');`);

  // =============================================================== 1
  seccion('1. El resumen del mes');
  const r = consultarTemporal(DB, `EXEC dbo.sp_income_statement @desde='2026-09-01', @hasta='2026-09-30';`);
  check(r.ok && r.sets.length === 7, 'devuelve los siete resultados (0069: por canal)', r.ok ? String(r.sets.length) : limpiar(r.error));
  if (!r.ok) throw new Error(limpiar(r.error));
  const [res, egr, cats, dias, top, perdidas] = r.sets;
  const act = res[0], ant = res[1];
  const igual = (k, esperado, fila = act) => check(cerca(fila[k], esperado), `${k} = ${esperado}`, String(fila[k]));
  igual('ventas_cobradas', 273.6); igual('tickets', 2); igual('devoluciones_cobradas', 116);
  igual('ventas_netas', 140); igual('iva_trasladado', 17.6);
  igual('costo_ventas', 75);           // 80 + 20 + 15 - 40 devuelto; con el costo de HOY (50) serian 95
  igual('utilidad_bruta', 65); igual('mermas', 40); igual('ajustes_inventario', 50);
  igual('egresos_generales', 300);     // sin el cancelado de 999
  igual('pagos_personal', 100); igual('utilidad_operacion', -425);
  igual('renglones_costo_estimado', 1); igual('ventas_sin_costo', 30);

  // =============================================================== 2
  seccion('2. El periodo anterior (mismo largo)');
  check(act.periodo === 'ACTUAL' && ant.periodo === 'ANTERIOR', 'trae los dos periodos', JSON.stringify([ant.desde, ant.hasta]));
  igual('ventas_netas', 100, ant); igual('costo_ventas', 40, ant); igual('egresos_generales', 250, ant); igual('utilidad_operacion', -190, ant);

  // =============================================================== 3
  seccion('3. Desgloses');
  check(egr.length === 2 && egr.some(e => e.concepto === 'QA Renta' && cerca(e.total, 300) && cerca(e.total_anterior, 250)),
    'egresos por concepto con el periodo anterior', JSON.stringify(egr.map(e => [e.concepto, e.total, e.total_anterior])));
  check(cats.some(c => c.categoria === 'QA Filtros' && cerca(c.utilidad, 115)) && cats.some(c => c.categoria === 'Sin categoría'),
    'utilidad por categoria', JSON.stringify(cats.map(c => [c.categoria, c.utilidad])));
  // sqlcmd/JSON entrega las fechas como /Date(ms)/ (medianoche local).
  const fechaDe = (v) => { const ms = /Date\((-?\d+)\)/.exec(String(v)); const d = ms ? new Date(Number(ms[1])) : new Date(v); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dia10 = dias.find(d => fechaDe(d.dia) === '2026-09-10');
  check(dias.length === 30 && cerca(dia10?.utilidad, 115), 'serie diaria completa (30 dias)', `${dias.length} · ${dia10?.utilidad}`);
  check(top[0]?.producto === 'QA Filtro A', 'el producto que mas utilidad dejo', top[0]?.producto);
  check(perdidas.length === 1 && perdidas[0].producto === 'QA Oferta C' && cerca(perdidas[0].utilidad, -5),
    'el que se vendio bajo costo', JSON.stringify(perdidas.map(p => [p.producto, p.utilidad])));
  let m = falla(`EXEC dbo.sp_income_statement @desde='2026-09-30', @hasta='2026-09-01';`, 'posterior');
  check(m.ok, 'rechaza un periodo al reves', m.error?.slice(0, 60));
  m = falla(`EXEC dbo.sp_income_statement @desde='2024-01-01', @hasta='2026-09-01';`, 'maximo');
  check(m.ok, 'y uno de mas de un ano', m.error?.slice(0, 60));

  // =============================================================== 4
  seccion('4. La utilidad de Estadisticas usa el costo congelado');
  const ov = q(`EXEC dbo.sp_get_profit_overview @from_date='2026-09-10', @to_date='2026-09-11';`);
  check(ov.length === 2 && cerca(ov[0].profit, 115) && cerca(ov[1].profit, 10),
    'sp_get_profit_overview: 115 y 10', JSON.stringify(ov.map(x => x.profit)));
  q(`UPDATE dbo.products SET cost = 999 WHERE id = ${A};`);
  const ov2 = q(`EXEC dbo.sp_get_profit_overview @from_date='2026-09-10', @to_date='2026-09-10';`);
  check(cerca(ov2[0].profit, 115), 'cambiar el costo hoy no reescribe el pasado', String(ov2[0].profit));
  const nube = consultarTemporal(DB, 'EXEC dbo.sp_cloud_daily_profit;');
  check(nube.ok, 'sp_cloud_daily_profit corre (antes pedia products.last_cost)', nube.ok ? JSON.stringify(nube.sets[0][0]) : limpiar(nube.error));
  const sem = consultarTemporal(DB, 'EXEC dbo.sp_get_weekly_profit;');
  check(sem.ok, 'sp_get_weekly_profit corre', sem.ok ? String(sem.sets[0].length) : limpiar(sem.error));

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
} finally {
  if (!CONSERVAR) { try { eliminar(DB); } catch { /* noop */ } }
  else console.log(`\n(${DB} conservada)`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
