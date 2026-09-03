/**
 * Extrae a Git el esquema estructural: tablas, columnas, claves, constraints
 * e indices.
 *
 * SOLO LECTURA contra la base. Escribe unicamente archivos del repositorio.
 *
 *     node scripts/db/extraer-esquema.mjs [--dry] [--base Wybix_Production]
 *
 * Complementa a `extraer.mjs`, que se ocupa de procedures y tipos. Los dos
 * escriben en el mismo `sql/manifest.json`, en secciones separadas, para que
 * no haya dos inventarios que puedan contradecirse.
 *
 * Base autoritativa: Wybix_Production. Verificado que su esquema es IDENTICO
 * al de installer/template.bak (31 tablas, 284 columnas, 31 PK, 5 UNIQUE,
 * 23 FK, 1 CHECK, 68 DEFAULT, 25 indices).
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { leerEsquema, ddlTabla, huellaTabla } from './lib/esquema.mjs';

const DRY = process.argv.includes('--dry');
const iBase = process.argv.indexOf('--base');
const BASE = iBase > 0 ? process.argv[iBase + 1] : 'Wybix_Production';
const DESTINO = join('sql', 'schema', 'tables');

/**
 * Tablas que NO forman parte del producto y no deben versionarse como esquema
 * propio. `schema_migrations` la crea la migracion 0001: versionarla aqui
 * duplicaria su definicion en dos sitios.
 */
const EXCLUIDAS = new Set(['schema_migrations']);

const esquema = leerEsquema(BASE).filter(t => !EXCLUIDAS.has(t.nombre));
const excluidas = leerEsquema(BASE).filter(t => EXCLUIDAS.has(t.nombre)).map(t => t.nombre);

console.log(`Base autoritativa: ${BASE}`);
console.log(`Tablas: ${esquema.length}${excluidas.length ? `  (excluidas: ${excluidas.join(', ')})` : ''}`);

if (!DRY) {
  if (existsSync(DESTINO)) rmSync(DESTINO, { recursive: true, force: true });
  mkdirSync(DESTINO, { recursive: true });
}

const objetos = [];
let col = 0, pk = 0, uq = 0, fk = 0, ck = 0, df = 0, ix = 0;

for (const t of esquema) {
  const archivo = join(DESTINO, `${t.nombre}.sql`);
  const ddl = ddlTabla(t);
  if (!DRY) writeFileSync(archivo, ddl, 'utf8');

  col += t.columnas.length;
  if (t.pk) pk++;
  uq += t.unicas.length; fk += t.foraneas.length;
  ck += t.chequeos.length; df += t.predet.length; ix += t.indices.length;

  objetos.push({
    nombre: t.nombre,
    tipo: 'TABLE',
    archivo: archivo.split('\\').join('/'),
    origen: BASE,
    columnas: t.columnas.length,
    pk: t.pk ? t.pk.name : null,
    unicas: t.unicas.length,
    foraneas: t.foraneas.length,
    chequeos: t.chequeos.length,
    predeterminados: t.predet.length,
    indices: t.indices.length,
    // Huella ESTRUCTURAL, no del texto: es lo que compara la deteccion de
    // deriva. Ignora formato y comentarios a proposito.
    checksum: createHash('sha256').update(huellaTabla(t), 'utf8').digest('hex').slice(0, 16),
  });
}

// ------------------------------------------------- manifiesto compartido
const RUTA_MANIFIESTO = 'sql/manifest.json';
if (!DRY) {
  const m = existsSync(RUTA_MANIFIESTO)
    ? JSON.parse(readFileSync(RUTA_MANIFIESTO, 'utf8'))
    : { objetos: [] };

  m.esquema = {
    generado: new Date().toISOString(),
    base: BASE,
    excluidas,
    resumen: { tablas: esquema.length, columnas: col, pk, unicas: uq, foraneas: fk, chequeos: ck, predeterminados: df, indices: ix },
    objetos,
  };
  writeFileSync(RUTA_MANIFIESTO, JSON.stringify(m, null, 2) + '\n', 'utf8');
}

console.log(`\n${DRY ? '[dry] ' : ''}archivos: ${esquema.length}`);
console.log(`  columnas ${col}  PK ${pk}  UNIQUE ${uq}  FK ${fk}  CHECK ${ck}  DEFAULT ${df}  INDEX ${ix}`);
