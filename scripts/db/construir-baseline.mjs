/**
 * Construye WYBIX DATABASE BASELINE V1 desde Git.
 *
 *     node scripts/db/construir-baseline.mjs [--conservar] [--salida <ruta.bak>]
 *
 * Levanta una base temporal VACIA y la llena unicamente con lo que hay en el
 * repositorio, en este orden:
 *
 *     sql/schema/tables/          tablas -> CHECK -> FK -> indices
 *     sql/types/                  tipos de tabla
 *     sql/procedures/             procedures desplegables (current + incierto)
 *     sql/baseline/v1/00_*.sql    schema_migrations + database_metadata
 *     sql/baseline/v1/01_seed.sql seed estructural
 *
 * y solo si todo verifica, saca un `.bak`.
 *
 * El baseline NUNCA se genera copiando una base existente. `Wybix_Production`,
 * `Hidromec_DataBase` y `Wybix_Template` arrastran historial de desarrollo:
 * filas en `schema_migrations`, procedures de pruebas y objetos que ya nadie
 * invoca. Partir de una base vacia es lo que hace que el `.bak` resultante sea
 * un derivado de Git, y no al reves.
 *
 * `lib/temporal.mjs` rechaza cualquier nombre que no sea claramente temporal,
 * asi que este script no puede escribir sobre una base viva ni por error.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { crearVacia, eliminar, ejecutarVarios, respaldar } from './lib/temporal.mjs';
import { consultar } from './lib/sql.mjs';
import { leerEsquema, huellaTabla } from './lib/esquema.mjs';
import { checksum, desenvolver } from './lib/canonico.mjs';
import { fases, ORDEN } from './lib/fases.mjs';
import { repartirPorClase, lineasDeClase } from './lib/catalogo.mjs';

const VERSION = 1;
const TMP = 'Wybix_TmpBaseline';
const CONSERVAR = process.argv.includes('--conservar');
const iSal = process.argv.indexOf('--salida');
// Escribe directamente sobre el template oficial. Solo puede haber UNO: es
// el unico archivo que `setupServer.js` consume y el unico que viaja en el
// instalador (package.json -> extraResources). Dos artefactos equivalentes
// solo sirven para divergir. El BACKUP se ejecuta al final y unicamente si
// la verificacion paso, asi que un fallo nunca deja el template a medias.
const SALIDA = iSal > 0 ? process.argv[iSal + 1] : join('installer', 'template.bak');
const DIR_BASELINE = join('sql', 'baseline', `v${VERSION}`);

let fallos = 0;
const mal = (t) => { console.log(`   FALLA  ${t}`); fallos++; };
const bien = (t) => console.log(`   ok     ${t}`);
const paso = (t) => console.log(`\n-- ${t}`);
const corto = (e) => String(e).split('\n')[0].replace(/^Excepci.n al llamar a "\w+" con los argumentos "\d+": /, '').slice(0, 120);

const manifiesto = JSON.parse(readFileSync('sql/manifest.json', 'utf8'));
const procesos = manifiesto.objetos.filter(o => o.tipo === 'SQL_STORED_PROCEDURE');

/** Parte un archivo `.sql` en los lotes que separa GO. */
const lotesDe = (texto) =>
  texto.replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n?/gi).map(s => s.trim()).filter(Boolean);

/** Aplica un archivo y devuelve el primer error, si lo hubo. */
function aplicarArchivo(ruta) {
  const r = ejecutarVarios(TMP, lotesDe(readFileSync(ruta, 'utf8')));
  const primerFallo = r.find(x => !x.ok);
  return primerFallo ? { ok: false, error: corto(primerFallo.error) } : { ok: true };
}

try {
  console.log(`\nWYBIX DATABASE BASELINE V${VERSION}`);
  console.log(`Fuente: el arbol de Git.  Destino: ${SALIDA}`);

  paso('1. Base temporal limpia');
  crearVacia(TMP);
  bien(`${TMP} creada, vacia, con colacion Modern_Spanish_CI_AS`);

  paso('2. Esquema desde sql/schema/tables/');
  const dirT = join('sql', 'schema', 'tables');
  const todo = { tabla: [], check: [], fk: [], indice: [] };
  for (const f of readdirSync(dirT).filter(x => x.endsWith('.sql')).sort()) {
    const p = fases(readFileSync(join(dirT, f), 'utf8'));
    for (const k of ORDEN) todo[k].push(...p[k]);
  }
  for (const fase of ORDEN) {
    const r = ejecutarVarios(TMP, todo[fase]);
    const err = r.filter(x => !x.ok);
    if (err.length) {
      mal(`fase ${fase}: ${err.length} de ${todo[fase].length} fallaron`);
      console.log(`          ${corto(err[0].error)}`);
    } else bien(`fase ${fase}: ${todo[fase].length} sentencias`);
  }

  paso('3. Tipos de tabla desde sql/types/');
  const dirTy = join('sql', 'types');
  const tiposArch = readdirSync(dirTy).filter(x => x.endsWith('.sql')).sort();
  let errT = 0;
  for (const f of tiposArch) {
    const r = aplicarArchivo(join(dirTy, f));
    if (!r.ok) { errT++; console.log(`          ${f}: ${r.error}`); }
  }
  if (errT) mal(`${errT} tipos fallaron`); else bien(`${tiposArch.length} tipos creados`);

  paso('4. Procedures desplegables desde sql/procedures/');
  const clases = repartirPorClase(procesos);
  console.log(lineasDeClase(clases));
  const desplegables = clases.desplegables;
  const fallidos = [];
  const plan = [];   // una entrada por lote, con su procedure de origen
  for (const o of desplegables) {
    if (!existsSync(o.archivo)) { fallidos.push([o.nombre, 'sin archivo']); continue; }
    for (const l of lotesDe(readFileSync(o.archivo, 'utf8'))) plan.push({ nombre: o.nombre, sql: l });
  }
  const res = ejecutarVarios(TMP, plan.map(x => x.sql));

  // Ocho procedures de Wybix estan creados por error en la base `master`. Por
  // la resolucion especial de nombres `sp_`, un CREATE OR ALTER sobre una base
  // donde aun no existen resuelve contra la copia de master y falla con el
  // error 208. `CREATE` a secas no sufre esa resolucion. Se reintenta el
  // archivo entero, no solo el lote roto: las opciones SET del primer lote son
  // las que quedan grabadas con el procedure.
  const porMaster = new Set();
  const rotos = new Map();
  res.forEach((r, i) => {
    if (r.ok) return;
    const { nombre, sql } = plan[i];
    if (/Invalid object name .dbo\.sp_/i.test(r.error) && /CREATE OR ALTER\s+PROCEDURE/i.test(sql)) porMaster.add(nombre);
    else if (!rotos.has(nombre)) rotos.set(nombre, corto(r.error));
  });

  const enMaster = [];
  for (const nombre of porMaster) {
    const o = desplegables.find(x => x.nombre === nombre);
    const lotes = lotesDe(readFileSync(o.archivo, 'utf8'))
      .map(l => l.replace(/CREATE OR ALTER(\s+)PROCEDURE/i, 'CREATE$1PROCEDURE'));
    const r2 = ejecutarVarios(TMP, lotes);
    const f2 = r2.find(x => !x.ok);
    if (f2) rotos.set(nombre, corto(f2.error)); else enMaster.push(nombre);
  }
  for (const [n, e] of rotos) fallidos.push([n, e]);

  if (fallidos.length) {
    mal(`${fallidos.length} de ${desplegables.length} procedures no compilaron`);
    for (const [n, e] of fallidos) console.log(`          ${n}: ${e}`);
  } else bien(`${desplegables.length} de ${procesos.length} procedures desplegados`);
  if (enMaster.length) {
    console.log(`          AVISO: ${enMaster.length} exigieron CREATE en vez de CREATE OR ALTER porque`);
    console.log(`          tambien existen en master: ${enMaster.sort().join(', ')}`);
  }

  paso('5. Infraestructura de versionado');
  for (const f of readdirSync(DIR_BASELINE).filter(x => /^00_/.test(x) && x.endsWith('.sql')).sort()) {
    const r = aplicarArchivo(join(DIR_BASELINE, f));
    if (r.ok) bien(f); else mal(`${f}: ${r.error}`);
  }

  paso('6. Seed estructural');
  const rs = aplicarArchivo(join(DIR_BASELINE, '01_seed.sql'));
  if (rs.ok) bien('01_seed.sql'); else mal(`01_seed.sql: ${rs.error}`);

  paso('7. Verificacion');
  const esqBase = new Map(leerEsquema(TMP).map(t => [t.nombre, t]));
  let tOk = 0;
  const tDif = [];
  const tFalta = [];
  for (const o of manifiesto.esquema.objetos) {
    const t = esqBase.get(o.nombre);
    if (!t) { tFalta.push(o.nombre); continue; }
    const h = createHash('sha256').update(huellaTabla(t), 'utf8').digest('hex').slice(0, 16);
    if (h === o.checksum) tOk++; else tDif.push(o.nombre);
  }
  if (tFalta.length) mal(`tablas ausentes: ${tFalta.join(', ')}`);
  if (tDif.length) mal(`tablas con estructura distinta: ${tDif.join(', ')}`);
  if (!tFalta.length && !tDif.length) bien(`${tOk} tablas identicas a Git`);

  const mods = new Map(consultar(TMP, `
    SELECT o.name, m.definition AS def FROM sys.sql_modules m
      JOIN sys.objects o ON o.object_id = m.object_id
     WHERE o.schema_id = SCHEMA_ID('dbo');`).map(r => [r.name, r.def]));
  let pOk = 0;
  const pDif = [];
  for (const o of desplegables) {
    const b = mods.get(o.nombre);
    if (!b) { pDif.push(o.nombre); continue; }
    const g = desenvolver(readFileSync(o.archivo, 'utf8'));
    if (g && checksum(g) === checksum(b)) pOk++; else pDif.push(o.nombre);
  }
  if (pDif.length) mal(`procedures que no coinciden con Git: ${pDif.join(', ')}`);
  else bien(`${pOk} procedures identicos a Git`);

  const noDeben = clases.noDesplegables.filter(o => mods.has(o.nombre)).map(o => o.nombre);
  if (noDeben.length) mal(`objetos no desplegables presentes en la base: ${noDeben.join(', ')}`);
  else bien('ningun objeto futuro ni legacy se colo en el baseline');

  const criticos = manifiesto.objetos.filter(o => o.critico).map(o => o.nombre);
  const tipos = consultar(TMP, `SELECT name FROM sys.table_types WHERE schema_id = SCHEMA_ID('dbo');`);
  const ausentes = criticos.filter(n => !mods.has(n) && !tipos.some(t => t.name === n));
  if (ausentes.length) mal(`criticos ausentes: ${ausentes.join(', ')}`);
  else bien(`los ${criticos.length} objetos criticos estan presentes`);

  // Ninguna tabla puede traer datos salvo las que el seed siembra a proposito.
  const conFilas = consultar(TMP, `
    SELECT t.name AS tabla, SUM(p.rows) AS filas
      FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
     WHERE t.schema_id = SCHEMA_ID('dbo')
     GROUP BY t.name HAVING SUM(p.rows) > 0 ORDER BY t.name;`);
  const SEMBRADAS = { registers: 1, WA_Configuracion: 1, database_metadata: 1 };
  for (const f of conFilas) console.log(`          ${String(f.filas).padStart(3)}  ${f.tabla}`);
  const sobra = conFilas.filter(f => SEMBRADAS[f.tabla] !== Number(f.filas));
  if (sobra.length) mal(`filas inesperadas: ${sobra.map(f => `${f.tabla}(${f.filas})`).join(', ')}`);
  else bien('solo hay seed estructural: 0 datos de demo, 0 datos de usuario');

  const mig = consultar(TMP, `SELECT COUNT(*) AS n FROM dbo.schema_migrations;`)[0].n;
  if (Number(mig) === 0) bien('schema_migrations vacia: el historial productivo arranca en cero');
  else mal(`schema_migrations trae ${mig} filas`);

  const bv = consultar(TMP, `SELECT valor FROM dbo.database_metadata WHERE clave = 'baseline_version';`);
  if (bv[0] && bv[0].valor === String(VERSION)) bien(`database_metadata.baseline_version = ${VERSION}`);
  else mal(`baseline_version = ${bv[0] ? bv[0].valor : '(ausente)'}`);

  paso('8. Respaldo');
  if (fallos) {
    console.log('   omitido: la verificacion no paso, no se genera .bak');
  } else {
    respaldar(TMP, SALIDA, { nombreLogico: `Wybix Baseline V${VERSION}` });
    const kb = Math.round(readFileSync(SALIDA).length / 1024);
    bien(`${SALIDA} generado (${kb} KB)`);
  }
} finally {
  if (!CONSERVAR) {
    try { eliminar(TMP); console.log(`\nBase temporal ${TMP} eliminada.`); }
    catch (e) { console.log('\nNo se pudo eliminar:', e.message); }
  } else console.log(`\nBase temporal ${TMP} conservada.`);
}

console.log(fallos
  ? `\nRESULTADO: ${fallos} FALLO(S) - no hay baseline`
  : `\nRESULTADO: PASS - Baseline V${VERSION} construido solo desde Git`);
process.exit(fallos ? 1 : 0);
