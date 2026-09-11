/**
 * ¿Se puede levantar una base de Wybix SOLO desde Git?
 *
 *     node scripts/db/probar-reconstruccion.mjs [--conservar]
 *
 * Crea una base temporal VACIA y aplica, en orden:
 *
 *     sql/schema/tables/   tablas -> CHECK -> FK -> indices
 *     sql/types/           tipos de tabla
 *     sql/procedures/      procedures
 *
 * y despues compara el resultado contra el manifiesto.
 *
 * NO cambia el instalador. Es una comprobacion de que el arbol canonico esta
 * completo: si esto funciona, `template.bak` ha dejado de ser la unica fuente
 * de verdad de la estructura.
 *
 * Nunca toca una base existente: `lib/temporal.mjs` rechaza cualquier nombre
 * que no sea claramente temporal.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { crearVacia, eliminar, ejecutarVarios } from './lib/temporal.mjs';
import { consultar } from './lib/sql.mjs';
import { leerEsquema, huellaTabla } from './lib/esquema.mjs';
import { checksum, desenvolver } from './lib/canonico.mjs';
import { fases, ORDEN } from './lib/fases.mjs';
import { repartirPorClase, lineasDeClase } from './lib/catalogo.mjs';

/** Parte un archivo `.sql` en los lotes que separa GO. */
const lotesDe = (texto) =>
  texto.replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n?/gi).map(x => x.trim()).filter(Boolean);

const CONSERVAR = process.argv.includes('--conservar');
const TMP = 'Wybix_RebuildTest';

let fallos = 0;
const mal = (t) => { console.log(`   FALLA  ${t}`); fallos++; };
const bien = (t) => console.log(`   ok     ${t}`);
const paso = (t) => console.log(`\n── ${t}`);

try {
  paso('1. Crear base temporal vacia');
  crearVacia(TMP);
  bien(`${TMP} creada`);

  // ------------------------------------------------------------- esquema
  paso('2. Esquema desde sql/schema/tables/');
  const dirT = join('sql', 'schema', 'tables');
  const archivos = readdirSync(dirT).filter(f => f.endsWith('.sql')).sort();
  const todo = { tabla: [], check: [], fk: [], indice: [] };
  for (const f of archivos) {
    const p = fases(readFileSync(join(dirT, f), 'utf8'));
    for (const k of Object.keys(todo)) todo[k].push(...p[k]);
  }
  for (const fase of ORDEN) {
    const r = ejecutarVarios(TMP, todo[fase]);
    const err = r.filter(x => !x.ok);
    if (err.length) {
      mal(`fase ${fase}: ${err.length} de ${todo[fase].length} sentencias fallaron`);
      console.log(`          ${err[0].error.split('\n')[0].slice(0, 130)}`);
    } else bien(`fase ${fase}: ${todo[fase].length} sentencias`);
  }

  // --------------------------------------------------------------- tipos
  paso('3. Tipos de tabla desde sql/types/');
  const dirTy = join('sql', 'types');
  let errT = 0;
  for (const f of readdirSync(dirTy).filter(f => f.endsWith('.sql')).sort()) {
    const r = ejecutarVarios(TMP, lotesDe(readFileSync(join(dirTy, f), 'utf8'))).find(x => !x.ok);
    if (r) { errT++; console.log(`          ${f}: ${r.error.split('\n')[0].slice(0, 120)}`); }
  }
  errT ? mal(`${errT} tipos fallaron`) : bien('3 tipos creados');

  // ---------------------------------------------------------- procedures
  paso('4. Procedures desde sql/procedures/');
  const manifiesto = JSON.parse(readFileSync('sql/manifest.json', 'utf8'));
  const todosProcs = manifiesto.objetos.filter(o => o.tipo === 'SQL_STORED_PROCEDURE');
  // El conjunto desplegable lo decide `lib/catalogo.mjs`, no este script. Antes
  // aqui se desplegaban los 108 del manifiesto sin mirar la clasificacion, y
  // por eso `sp_mig_test` —legacy— acababa dentro de la base reconstruida.
  const clases = repartirPorClase(todosProcs);
  const procs = clases.desplegables;
  console.log(lineasDeClase(clases));
  const fallidos = [];
  const enMaster = [];
  const plan = [];
  for (const o of procs) {
    if (!existsSync(o.archivo)) { fallidos.push([o.nombre, 'sin archivo']); continue; }
    // El archivo trae SET ... GO cuerpo GO: se aplica lote a lote.
    for (const l of lotesDe(readFileSync(o.archivo, 'utf8'))) plan.push({ nombre: o.nombre, sql: l });
  }
  const res = ejecutarVarios(TMP, plan.map(x => x.sql));

  // Ocho procedures de Wybix estan creados por error en la base `master`. Por
  // la resolucion especial de nombres `sp_`, un CREATE OR ALTER sobre una base
  // donde aun no existen resuelve contra la copia de master y falla con el
  // error 208. `CREATE` a secas no sufre esa resolucion. Se reintenta el
  // archivo entero: las opciones SET del primer lote son las que quedan
  // grabadas con el procedure.
  const porMaster = new Set();
  const rotos = new Map();
  res.forEach((r, i) => {
    if (r.ok) return;
    const { nombre, sql } = plan[i];
    if (/Invalid object name .dbo\.sp_/i.test(r.error) && /CREATE OR ALTER\s+PROCEDURE/i.test(sql)) porMaster.add(nombre);
    else if (!rotos.has(nombre)) rotos.set(nombre, r.error.split('\n')[0].slice(0, 120));
  });
  for (const nombre of porMaster) {
    const o = procs.find(x => x.nombre === nombre);
    const lotes = lotesDe(readFileSync(o.archivo, 'utf8'))
      .map(l => l.replace(/CREATE OR ALTER(\s+)PROCEDURE/i, 'CREATE$1PROCEDURE'));
    const f2 = ejecutarVarios(TMP, lotes).find(x => !x.ok);
    if (f2) rotos.set(nombre, f2.error.split('\n')[0].slice(0, 120));
    else enMaster.push(nombre);
  }
  for (const [n, e] of rotos) fallidos.push([n, e]);
  if (fallidos.length) {
    mal(`${fallidos.length} de ${procs.length} procedures no compilaron`);
    for (const [n, e] of fallidos) console.log(`          ${n}: ${e}`);
  } else bien(`${procs.length} de ${todosProcs.length} procedures desplegados`);
  if (enMaster.length) {
    console.log(`          AVISO: ${enMaster.length} exigieron CREATE en vez de CREATE OR ALTER`);
    console.log(`          porque tambien existen en master: ${enMaster.join(', ')}`);
  }

  // ------------------------------------------------------------ resultado
  paso('5. Comparacion contra el manifiesto');
  const esqBase = new Map(leerEsquema(TMP).map(t => [t.nombre, t]));
  let tOk = 0, tDif = [], tFalta = [];
  for (const o of manifiesto.esquema.objetos) {
    const t = esqBase.get(o.nombre);
    if (!t) { tFalta.push(o.nombre); continue; }
    const h = createHash('sha256').update(huellaTabla(t), 'utf8').digest('hex').slice(0, 16);
    if (h === o.checksum) tOk++; else tDif.push(o.nombre);
  }
  console.log(`   tablas: ${tOk} iguales, ${tDif.length} distintas, ${tFalta.length} ausentes`);
  if (tFalta.length) mal(`tablas ausentes: ${tFalta.join(', ')}`);
  if (tDif.length) mal(`tablas distintas: ${tDif.join(', ')}`);
  if (!tFalta.length && !tDif.length) bien(`las ${tOk} tablas coinciden con Git`);

  const mods = new Map(consultar(TMP, `
    SELECT o.name, m.definition AS def FROM sys.sql_modules m
      JOIN sys.objects o ON o.object_id = m.object_id
     WHERE o.schema_id = SCHEMA_ID('dbo');`).map(r => [r.name, r.def]));
  let pOk = 0, pDif = [];
  for (const o of procs) {
    const b = mods.get(o.nombre);
    if (!b) continue;   // no compilo: ya se reporto arriba
    const g = desenvolver(readFileSync(o.archivo, 'utf8'));
    if (g && checksum(g) === checksum(b)) pOk++; else pDif.push(o.nombre);
  }
  console.log(`   procedures: ${mods.size} creados, ${pOk} coinciden con Git`);
  if (pDif.length) mal(`procedures con checksum distinto: ${pDif.slice(0, 5).join(', ')}${pDif.length > 5 ? '…' : ''}`);

  const tipos = consultar(TMP, `SELECT name FROM sys.table_types WHERE schema_id = SCHEMA_ID('dbo');`);
  console.log(`   tipos de tabla: ${tipos.length}`);

  const noDeben = clases.noDesplegables.filter(o => mods.has(o.nombre)).map(o => o.nombre);
  noDeben.length ? mal(`objetos no desplegables presentes en la base: ${noDeben.join(', ')}`)
                 : bien(`FUTURE (${clases.futuro.length}) y LEGACY (${clases.legacy.length}) correctamente excluidos`);

  const criticos = [
    ...manifiesto.objetos.filter(o => o.critico).map(o => o.nombre),
  ];
  const ausentes = criticos.filter(n => !mods.has(n) && !tipos.some(t => t.name === n));
  ausentes.length ? mal(`criticos ausentes: ${ausentes.join(', ')}`)
                  : bien(`los ${criticos.length} objetos criticos estan presentes`);

} finally {
  if (!CONSERVAR) { try { eliminar(TMP); console.log(`\nBase temporal ${TMP} eliminada.`); } catch (e) { console.log('\nNo se pudo eliminar:', e.message); } }
  else console.log(`\nBase temporal ${TMP} conservada.`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: OK — la base se reconstruye completa desde Git');
process.exit(fallos ? 1 : 0);
