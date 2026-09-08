/**
 * Compone una migracion a partir de los archivos canonicos.
 *
 *     node scripts/db/generar-migracion.mjs 0007 nombre-descriptivo obj1 obj2 ...
 *     node scripts/db/generar-migracion.mjs 0002 nombre --ddl sql/schema/changes/0002_x.sql obj1 ...
 *
 * Por que generarla y no escribirla a mano: el cuerpo de cada objeto sale del
 * archivo canonico, asi que la migracion no puede divergir de Git. Si manana
 * se corrige un procedure, se regenera y no hay que copiar y pegar.
 *
 * ORDEN: primero el bloque de esquema (--ddl), despues los tipos de tabla y
 * al final los procedures. Un procedure que recibe un tipo o lee una columna
 * nueva no compila si el tipo o la columna no existen todavia.
 *
 * El bloque de esquema (tablas, columnas, seed) se escribe a mano y se
 * versiona en sql/schema/changes/: SQL Server no guarda el texto de un
 * CREATE TABLE, asi que no hay de donde generarlo. Cada paso de ese bloque
 * debe comprobar su existencia (IF COL_LENGTH(...) IS NULL, etc.).
 *
 * El runner (`electron/migrationsRunner.js`) parte el archivo por lineas `GO`
 * y ejecuta cada lote dentro de UNA transaccion. `CREATE OR ALTER` debe ser la
 * primera sentencia de su lote, de ahi que cada objeto lleve su propio `GO`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dominioDe } from './lib/catalogo.mjs';

const argv = process.argv.slice(2);
const iDdl = argv.indexOf('--ddl');
const ddlArchivo = iDdl >= 0 ? argv[iDdl + 1] : null;
if (iDdl >= 0) argv.splice(iDdl, 2);
const [numero, nombre, ...objetos] = argv;
if (!numero || !nombre || (!objetos.length && !ddlArchivo)) {
  console.error('Uso: node scripts/db/generar-migracion.mjs <numero> <nombre> [--ddl sql/schema/changes/x.sql] <objeto>...');
  process.exit(1);
}
if (ddlArchivo && !existsSync(ddlArchivo)) { console.error('No existe el DDL', ddlArchivo); process.exit(1); }

const barras = (p) => String(p).split('\\').join('/');

const manifiesto = JSON.parse(readFileSync('sql/manifest.json', 'utf8'));
const porNombre = new Map(manifiesto.objetos.map(o => [o.nombre, o]));

// Un objeto NUEVO todavia no esta en el manifiesto (lo escribe db:extract
// despues de aplicarlo a una base). Se resuelve por su archivo canonico:
// sql/types/<nombre>.sql o sql/procedures/<dominio>/<nombre>.sql.
const faltan = [];
for (const n of objetos) {
  if (porNombre.has(n)) continue;
  const tipo = join('sql', 'types', `${n}.sql`);
  const proc = join('sql', 'procedures', dominioDe(n), `${n}.sql`);
  if (existsSync(tipo)) porNombre.set(n, { nombre: n, tipo: 'USER_TABLE_TYPE', archivo: tipo });
  else if (existsSync(proc)) porNombre.set(n, { nombre: n, tipo: 'SQL_STORED_PROCEDURE', archivo: proc });
  else faltan.push(n);
}
if (faltan.length) {
  console.error('No estan en el manifiesto ni tienen archivo canonico:', faltan.join(', '));
  process.exit(1);
}

// Tipos primero: son dependencia de los procedures que los reciben.
const orden = [...objetos].sort((a, b) => {
  const t = o => (porNombre.get(o).tipo === 'USER_TABLE_TYPE' ? 0 : 1);
  return t(a) - t(b) || a.localeCompare(b);
});

const partes = [
  '/* ============================================================',
  `   ${numero} — ${nombre.replace(/-/g, ' ')}`,
  '',
  '   Generada con scripts/db/generar-migracion.mjs desde los archivos',
  '   canonicos de sql/. No editar a mano: regenerar.',
  '',
  '   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos',
  '   comprueban su existencia antes de crearse. Se puede reejecutar.',
  '',
  ...(ddlArchivo
    ? [`   Incluye el bloque de esquema ${barras(ddlArchivo)} (tablas,`,
       '   columnas, seed). Cada paso de ese bloque comprueba su existencia.']
    : ['   NO toca tablas ni datos. Solo objetos programables.']),
  '   ============================================================ */',
  '',
];

if (ddlArchivo) {
  partes.push(`/* ========== ESQUEMA: ${barras(ddlArchivo)} ========== */`);
  partes.push(readFileSync(ddlArchivo, 'utf8').split('\r\n').join('\n').trimEnd());
  partes.push('GO');
  partes.push('');
}

for (const n of orden) {
  const o = porNombre.get(n);
  if (!existsSync(o.archivo)) { console.error('Falta el archivo', o.archivo); process.exit(1); }
  const texto = readFileSync(o.archivo, 'utf8').split('\r\n').join('\n').trimEnd();
  partes.push(`/* ---------- ${n} (${o.tipo}) ---------- */`);
  // El archivo canonico ya trae sus SET y sus GO en el sitio correcto.
  partes.push(texto);
  partes.push('');
}

const destino = join('electron', 'migrations', `${numero}_${nombre}.sql`);
writeFileSync(destino, partes.join('\n'), 'utf8');

console.log(`${destino}`);
console.log(`  objetos: ${orden.length}`);
console.log(`  tipos  : ${orden.filter(n => porNombre.get(n).tipo === 'USER_TABLE_TYPE').join(', ') || '(ninguno)'}`);
console.log(`  bytes  : ${readFileSync(destino).length}`);
