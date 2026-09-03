/**
 * Compone una migracion a partir de los archivos canonicos.
 *
 *     node scripts/db/generar-migracion.mjs 0007 nombre-descriptivo obj1 obj2 ...
 *
 * Por que generarla y no escribirla a mano: el cuerpo de cada objeto sale del
 * archivo canonico, asi que la migracion no puede divergir de Git. Si manana
 * se corrige un procedure, se regenera y no hay que copiar y pegar.
 *
 * ORDEN: los tipos de tabla van primero. Un procedure que recibe un tipo no
 * compila si el tipo no existe todavia.
 *
 * El runner (`electron/migrationsRunner.js`) parte el archivo por lineas `GO`
 * y ejecuta cada lote dentro de UNA transaccion. `CREATE OR ALTER` debe ser la
 * primera sentencia de su lote, de ahi que cada objeto lleve su propio `GO`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [numero, nombre, ...objetos] = process.argv.slice(2);
if (!numero || !nombre || !objetos.length) {
  console.error('Uso: node scripts/db/generar-migracion.mjs <numero> <nombre> <objeto>...');
  process.exit(1);
}

const manifiesto = JSON.parse(readFileSync('sql/manifest.json', 'utf8'));
const porNombre = new Map(manifiesto.objetos.map(o => [o.nombre, o]));

const faltan = objetos.filter(n => !porNombre.has(n));
if (faltan.length) {
  console.error('No estan en el manifiesto:', faltan.join(', '));
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
  '   NO toca tablas ni datos. Solo objetos programables.',
  '   ============================================================ */',
  '',
];

for (const n of orden) {
  const o = porNombre.get(n);
  if (!existsSync(o.archivo)) { console.error('Falta el archivo', o.archivo); process.exit(1); }
  const texto = readFileSync(o.archivo, 'utf8').replace(/\r\n/g, '\n').trimEnd();
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
