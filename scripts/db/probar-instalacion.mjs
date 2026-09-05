/**
 * ¿Que recibe un cliente nuevo?
 *
 *     node scripts/db/probar-instalacion.mjs [--bak <ruta>] [--conservar]
 *
 * Restaura el `.bak` del baseline en una base temporal y comprueba lo mismo
 * que comprobaria la aplicacion al arrancar por primera vez:
 *
 *   1. la base restaura;
 *   2. no queda ninguna migracion productiva pendiente;
 *   3. los objetos criticos de `electron/objetos-criticos.json` estan todos;
 *   4. el esquema coincide con Git;
 *   5. no viajan datos de demo ni de usuario;
 *   6. `database_metadata.baseline_version` dice de donde nacio la base.
 *
 * Es la contraparte de `construir-baseline.mjs`: uno produce el artefacto, este
 * lo abre como lo abriria una caja recien instalada.
 *
 * La lista de migraciones pendientes se calcula con la MISMA regla que
 * `electron/migrationsRunner.js`: los `.sql` del directorio raiz, ignorando
 * subdirectorios. Lo que no se puede hacer aqui es invocar el runner de
 * verdad: usa `mssql/msnodesqlv8`, que fuera de Electron se cuelga.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { restaurar, eliminar } from './lib/temporal.mjs';
import { consultar } from './lib/sql.mjs';
import { leerEsquema, huellaTabla } from './lib/esquema.mjs';
import { repartirPorClase, lineasDeClase } from './lib/catalogo.mjs';

const iBak = process.argv.indexOf('--bak');
const BAK = iBak > 0 ? process.argv[iBak + 1] : join('installer', 'template.bak');
const CONSERVAR = process.argv.includes('--conservar');
const TMP = 'Wybix_TmpInstall';
const DIR_MIG = join('electron', 'migrations');

let fallos = 0;
const mal = (t) => { console.log(`   FALLA  ${t}`); fallos++; };
const bien = (t) => console.log(`   ok     ${t}`);
const paso = (t) => console.log(`\n-- ${t}`);

try {
  console.log(`\nINSTALACION LIMPIA DESDE ${BAK}`);

  paso('1. Restaurar el respaldo en una base nueva');
  restaurar(TMP, BAK);
  const kb = Math.round(readFileSync(BAK).length / 1024);
  bien(`${TMP} restaurada desde un .bak de ${kb} KB`);

  paso('2. Migraciones productivas pendientes');
  const aplicadas = new Set(
    consultar(TMP, `SELECT filename FROM dbo.schema_migrations;`).map(r => r.filename));
  const archivos = existsSync(DIR_MIG)
    ? readdirSync(DIR_MIG, { withFileTypes: true })
        .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.sql'))
        .map(d => d.name).sort((a, b) => a.localeCompare(b, 'en'))
    : [];
  const pendientes = archivos.filter(f => !aplicadas.has(f));
  console.log(`   ${archivos.length} migraciones en ${DIR_MIG}, ${aplicadas.size} registradas como aplicadas`);
  if (pendientes.length) mal(`quedan pendientes: ${pendientes.join(', ')}`);
  else bien('0 pendientes: el arranque no tiene nada que aplicar');

  paso('3. Validacion de arranque (electron/verificarObjetos.js)');
  const lista = JSON.parse(readFileSync(join('electron', 'objetos-criticos.json'), 'utf8')).objetos || [];
  // Una lista vacia no es un aprobado: `verificarObjetos.js` deja pasar el
  // arranque cuando no puede leerla, asi que si aqui no hay nada que
  // comprobar, la prueba no esta probando nada.
  if (!lista.length) mal('objetos-criticos.json no trae objetos: la comprobacion no verifica nada');

  const modulos = lista.filter(o => o.tipo === 'modulo').map(o => o.nombre);
  const tiposCriticos = lista.filter(o => o.tipo === 'tipo').map(o => o.nombre);
  const hayModulos = new Set(consultar(TMP, `
    SELECT name FROM sys.objects
     WHERE schema_id = SCHEMA_ID('dbo') AND type IN ('P','V','FN','IF','TF');`).map(r => r.name));
  const hayTipos = new Set(consultar(TMP,
    `SELECT name FROM sys.table_types WHERE schema_id = SCHEMA_ID('dbo');`).map(r => r.name));
  const faltan = [
    ...modulos.filter(n => !hayModulos.has(n)),
    ...tiposCriticos.filter(n => !hayTipos.has(n)),
  ];
  if (faltan.length) mal(`la aplicacion se detendria: faltan ${faltan.join(', ')}`);
  else if (lista.length) bien(`los ${lista.length} objetos criticos responden (${modulos.length} modulos + ${tiposCriticos.length} tipos): el arranque pasaria`);

  paso('4. Conjunto desplegable');
  const manifiesto = JSON.parse(readFileSync('sql/manifest.json', 'utf8'));
  // El conjunto lo define `lib/catalogo.mjs`; aqui solo se comprueba contra la
  // base restaurada. Ningun script vuelve a decidir por su cuenta que entra.
  const clases = repartirPorClase(manifiesto.objetos.filter(o => o.tipo === 'SQL_STORED_PROCEDURE'));
  console.log(lineasDeClase(clases));
  const enBase = new Set(consultar(TMP,
    `SELECT name FROM sys.procedures WHERE schema_id = SCHEMA_ID('dbo');`).map(r => r.name));
  const sinDesplegar = clases.desplegables.filter(o => !enBase.has(o.nombre)).map(o => o.nombre);
  const coladosDentro = clases.noDesplegables.filter(o => enBase.has(o.nombre)).map(o => o.nombre);
  if (sinDesplegar.length) mal(`faltan por desplegar: ${sinDesplegar.join(', ')}`);
  else bien(`${clases.desplegables.length}/${clases.desplegables.length} procedures desplegados`);
  if (coladosDentro.length) mal(`objetos no desplegables presentes: ${coladosDentro.join(', ')}`);
  else bien(`FUTURE (${clases.futuro.length}) y LEGACY (${clases.legacy.length}) correctamente excluidos`);

  const tiposEnBase = consultar(TMP,
    `SELECT name FROM sys.table_types WHERE schema_id = SCHEMA_ID('dbo');`);
  const tiposGit = manifiesto.objetos.filter(o => o.tipo === 'USER_TABLE_TYPE');
  const tiposFaltan = tiposGit.filter(o => !tiposEnBase.some(t => t.name === o.nombre)).map(o => o.nombre);
  if (tiposFaltan.length) mal(`tipos ausentes: ${tiposFaltan.join(', ')}`);
  else bien(`${tiposGit.length}/${tiposGit.length} tipos de tabla presentes`);

  paso('5. Esquema contra Git');
  const esq = new Map(leerEsquema(TMP).map(t => [t.nombre, t]));
  let ok = 0;
  const dif = [];
  const falta = [];
  for (const o of manifiesto.esquema.objetos) {
    const t = esq.get(o.nombre);
    if (!t) { falta.push(o.nombre); continue; }
    const h = createHash('sha256').update(huellaTabla(t), 'utf8').digest('hex').slice(0, 16);
    if (h === o.checksum) ok++; else dif.push(o.nombre);
  }
  if (falta.length) mal(`tablas ausentes: ${falta.join(', ')}`);
  if (dif.length) mal(`tablas distintas: ${dif.join(', ')}`);
  if (!falta.length && !dif.length) bien(`${ok} tablas identicas a Git`);

  paso('6. Contenido');
  const filas = consultar(TMP, `
    SELECT t.name AS tabla, SUM(p.rows) AS filas
      FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
     WHERE t.schema_id = SCHEMA_ID('dbo')
     GROUP BY t.name HAVING SUM(p.rows) > 0 ORDER BY t.name;`);
  for (const f of filas) console.log(`          ${String(f.filas).padStart(3)}  ${f.tabla}`);
  const SEMBRADAS = { registers: 1, WA_Configuracion: 1, database_metadata: 1 };
  const sobra = filas.filter(f => SEMBRADAS[f.tabla] !== Number(f.filas));
  if (sobra.length) mal(`datos que no deberian viajar: ${sobra.map(f => `${f.tabla}(${f.filas})`).join(', ')}`);
  else bien('solo seed estructural');

  // Sin usuarios, el primer arranque obliga a pasar por `sp_setup_inicial`: no
  // se entrega ninguna credencial por defecto.
  const u = consultar(TMP, `SELECT COUNT(*) AS n FROM dbo.users;`)[0].n;
  if (Number(u) === 0) bien('0 usuarios: el alta del administrador la hace el cliente');
  else mal(`el respaldo trae ${u} usuarios`);

  paso('7. Procedencia');
  const bv = consultar(TMP, `
    SELECT valor FROM dbo.database_metadata WHERE clave = 'baseline_version';`);
  if (bv[0]) bien(`nacio de Baseline V${bv[0].valor}`);
  else mal('la base no declara de que baseline nacio');
} finally {
  if (!CONSERVAR) {
    try { eliminar(TMP); console.log(`\nBase temporal ${TMP} eliminada.`); }
    catch (e) { console.log('\nNo se pudo eliminar:', e.message); }
  } else console.log(`\nBase temporal ${TMP} conservada.`);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: PASS - instalacion limpia correcta');
process.exit(fallos ? 1 : 0);
