/**
 * Extrae a Git la definicion canonica de todos los objetos SQL de Wybix.
 *
 * SOLO LECTURA contra la base. Escribe unicamente archivos del repositorio.
 *
 *     node scripts/db/extraer.mjs [--dry]
 *
 * DE DONDE SALE CADA DEFINICION
 * Hay tres bases y no todas tienen todo, asi que se recorre una lista de
 * preferencia y gana la primera que contenga el objeto:
 *
 *     Wybix_Production   instalacion limpia + los procedures anadidos a mano.
 *                        Es lo mas parecido al estado CURRENT esperado.
 *     Hidromec_DataBase  base de trabajo. Aporta lo que solo existe alli.
 *     Wybix_Template     baseline del instalador. Ultimo recurso.
 *
 * El origen de cada objeto queda registrado en el manifiesto, para que nunca
 * haya duda de donde vino una definicion.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { consultar } from './lib/sql.mjs';
import { envolver, checksum, normalizar } from './lib/canonico.mjs';
import { dominioDe, esCritico, NO_INVOCADOS, CRITICOS, TIPOS_CRITICOS } from './lib/catalogo.mjs';
import { SOLO_REPO, extraerDeArchivo } from './lib/solo-repo.mjs';

const DRY = process.argv.includes('--dry');
const RAIZ = 'sql';
const PREFERENCIA = ['Wybix_Production', 'Hidromec_DataBase', 'Wybix_Template'];

const TIPO_CARPETA = {
  SQL_STORED_PROCEDURE: 'procedures',
  VIEW: 'views',
  SQL_SCALAR_FUNCTION: 'functions',
  SQL_INLINE_TABLE_VALUED_FUNCTION: 'functions',
  SQL_TABLE_VALUED_FUNCTION: 'functions',
  SQL_TRIGGER: 'triggers',
};

// ---------------------------------------------------------------- inventario
function modulos(db) {
  return consultar(db, `
    SELECT o.name, o.type_desc, m.definition AS def,
           m.uses_ansi_nulls AS ansi, m.uses_quoted_identifier AS quoted
      FROM sys.sql_modules m
      JOIN sys.objects o ON o.object_id = m.object_id
     WHERE o.schema_id = SCHEMA_ID('dbo')
     ORDER BY o.name;`);
}

/** Tipos de tabla definidos por el usuario, con sus columnas. */
function tiposTabla(db) {
  const tipos = consultar(db, `
    SELECT t.name, t.type_table_object_id AS oid
      FROM sys.table_types t
     WHERE t.schema_id = SCHEMA_ID('dbo')
     ORDER BY t.name;`);
  return tipos.map(t => ({
    nombre: t.name,
    columnas: consultar(db, `
      SELECT c.name, TYPE_NAME(c.user_type_id) AS tipo, c.max_length AS len,
             c.precision AS prec, c.scale AS esc, c.is_nullable AS nulo
        FROM sys.columns c
       WHERE c.object_id = ${t.oid}
       ORDER BY c.column_id;`),
  }));
}

/** Reconstruye el DDL de un tipo de tabla (SQL Server no guarda su texto). */
function ddlTipoTabla(t) {
  const col = c => {
    const n = c.tipo.toLowerCase();
    let tipo = c.tipo.toUpperCase();
    if (['decimal', 'numeric'].includes(n)) tipo += `(${c.prec}, ${c.esc})`;
    else if (['varchar', 'char', 'varbinary', 'binary'].includes(n)) {
      tipo += `(${c.len === -1 ? 'MAX' : c.len})`;
    } else if (['nvarchar', 'nchar'].includes(n)) {
      tipo += `(${c.len === -1 ? 'MAX' : c.len / 2})`;
    }
    return `    ${c.name} ${tipo}${c.nulo ? ' NULL' : ' NOT NULL'}`;
  };
  return [
    `/* ${t.nombre}`,
    ' * Tipo de tabla. SQL Server no conserva el texto original de un tipo, asi',
    ' * que este DDL se reconstruye desde sys.columns. Es equivalente, no literal.',
    ' * Un tipo NO admite CREATE OR ALTER: se comprueba antes de crearlo.',
    ' */',
    `IF TYPE_ID(N'dbo.${t.nombre}') IS NULL`,
    'BEGIN',
    `  CREATE TYPE dbo.${t.nombre} AS TABLE (`,
    t.columnas.map(col).join(',\n'),
    '  );',
    'END;',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- extraccion
console.log(`Servidor de lectura: ${PREFERENCIA.join(' > ')}\n`);

const inventario = {};
for (const db of PREFERENCIA) {
  inventario[db] = { mods: modulos(db), tipos: tiposTabla(db) };
  console.log(`  ${db.padEnd(20)} modulos: ${inventario[db].mods.length}  tipos: ${inventario[db].tipos.length}`);
}

/** Union de nombres, con la base preferida que lo contiene. */
const elegido = new Map();
for (const db of PREFERENCIA) {
  for (const m of inventario[db].mods) if (!elegido.has(m.name)) elegido.set(m.name, { db, m });
}
const tipoElegido = new Map();
for (const db of PREFERENCIA) {
  for (const t of inventario[db].tipos) if (!tipoElegido.has(t.nombre)) tipoElegido.set(t.nombre, { db, t });
}

console.log(`\nObjetos distintos: ${elegido.size} modulos, ${tipoElegido.size} tipos de tabla`);

if (!DRY) {
  // Arbol limpio en cada extraccion: asi un objeto renombrado no deja huerfano.
  for (const sub of ['procedures', 'types', 'views', 'functions', 'triggers']) {
    const p = join(RAIZ, sub);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
}

// Se conserva la seccion de esquema si ya existe: la escribe extraer-esquema.mjs
// y sobrescribirla aqui borraria el inventario de tablas sin avisar.
const previo = existsSync('sql/manifest.json')
  ? JSON.parse(readFileSync('sql/manifest.json', 'utf8')) : {};
const manifiesto = {
  generado: new Date().toISOString(),
  servidor: PREFERENCIA,
  objetos: [],
  ...(previo.esquema ? { esquema: previo.esquema } : {}),
};
const sinClasificar = [];
let escritos = 0;

for (const [nombre, { db, m }] of [...elegido].sort((a, b) => a[0].localeCompare(b[0]))) {
  const carpetaTipo = TIPO_CARPETA[m.type_desc] || 'procedures';
  const dominio = carpetaTipo === 'procedures' ? dominioDe(nombre) : '';
  if (dominio === 'sin-clasificar') sinClasificar.push(nombre);

  const dir = join(RAIZ, carpetaTipo, dominio);
  const archivo = join(dir, `${nombre}.sql`);
  const contenido = envolver({
    nombre, definicion: m.def, ansiNulls: !!m.ansi, quotedIdentifier: !!m.quoted,
  });

  if (!DRY) { mkdirSync(dir, { recursive: true }); writeFileSync(archivo, contenido, 'utf8'); }
  escritos++;

  manifiesto.objetos.push({
    nombre,
    tipo: m.type_desc,
    archivo: archivo.replace(/\\/g, '/'),
    origen: db,
    critico: esCritico(nombre),
    clasificacion: NO_INVOCADOS[nombre] || 'current',
    checksum: checksum(m.def),
  });
}

// Objetos que solo existen en el repositorio: se promueven al arbol canonico
// desde su archivo suelto, porque ninguna base los tiene todavia.
for (const [nombre, meta] of Object.entries(SOLO_REPO)) {
  if (elegido.has(nombre)) continue;   // ya vino de una base: no hace falta
  if (!existsSync(meta.fuente)) {
    console.log(`  AVISO: no se encontro ${meta.fuente} para ${nombre}`);
    continue;
  }
  const def = extraerDeArchivo(readFileSync(meta.fuente, 'utf8'), nombre);
  if (!def) { console.log(`  AVISO: no se pudo aislar ${nombre} en ${meta.fuente}`); continue; }

  const dir = join(RAIZ, 'procedures', meta.dominio);
  const archivo = join(dir, `${nombre}.sql`);
  // Sin dato de sys.sql_modules se asume el valor por defecto de SQL Server,
  // que es el que tendrian al aplicarse desde una sesion normal.
  const contenido = envolver({ nombre, definicion: def, ansiNulls: true, quotedIdentifier: true });
  if (!DRY) { mkdirSync(dir, { recursive: true }); writeFileSync(archivo, contenido, 'utf8'); }
  escritos++;
  manifiesto.objetos.push({
    nombre,
    tipo: 'SQL_STORED_PROCEDURE',
    archivo: archivo.split('\\').join('/'),
    origen: `repo:${meta.fuente}`,
    critico: esCritico(nombre),
    clasificacion: 'current',
    ausenteEnBase: true,
    nota: meta.nota,
    checksum: checksum(def),
  });
}

for (const [nombre, { db, t }] of [...tipoElegido].sort((a, b) => a[0].localeCompare(b[0]))) {
  const archivo = join(RAIZ, 'types', `${nombre}.sql`);
  const ddl = ddlTipoTabla(t);
  if (!DRY) { mkdirSync(join(RAIZ, 'types'), { recursive: true }); writeFileSync(archivo, ddl, 'utf8'); }
  escritos++;
  manifiesto.objetos.push({
    nombre,
    tipo: 'USER_TABLE_TYPE',
    archivo: archivo.replace(/\\/g, '/'),
    origen: db,
    critico: TIPOS_CRITICOS.includes(nombre),
    clasificacion: 'current',
    checksum: checksum(normalizar(ddl)),
  });
}

// La aplicacion empaquetada NO incluye sql/ (ver build.files en package.json),
// asi que la lista de objetos criticos se emite dentro de electron/, que si
// viaja. Es lo unico que necesita la comprobacion de arranque.
if (!DRY) {
  const criticos = manifiesto.objetos
    .filter(o => o.critico)
    .map(o => ({ nombre: o.nombre, tipo: o.tipo === 'USER_TABLE_TYPE' ? 'tipo' : 'modulo' }));
  writeFileSync(join('electron', 'objetos-criticos.json'),
    JSON.stringify({
      generado: manifiesto.generado,
      nota: 'Generado por scripts/db/extraer.mjs. No editar a mano.',
      objetos: criticos,
    }, null, 2) + '\n', 'utf8');
}

if (!DRY) writeFileSync(join(RAIZ, 'manifest.json'), JSON.stringify(manifiesto, null, 2) + '\n', 'utf8');

// ---------------------------------------------------------------- resumen
const porOrigen = {};
for (const o of manifiesto.objetos) porOrigen[o.origen] = (porOrigen[o.origen] || 0) + 1;
const porClase = {};
for (const o of manifiesto.objetos) porClase[o.clasificacion] = (porClase[o.clasificacion] || 0) + 1;

console.log(`\n${DRY ? '[dry] ' : ''}archivos: ${escritos}`);
console.log('  por origen     :', Object.entries(porOrigen).map(([k, v]) => `${k}=${v}`).join('  '));
console.log('  por clasificacion:', Object.entries(porClase).map(([k, v]) => `${k}=${v}`).join('  '));
console.log('  criticos       :', manifiesto.objetos.filter(o => o.critico).length, `de ${CRITICOS.length + TIPOS_CRITICOS.length} esperados`);

if (sinClasificar.length) {
  console.log('\n  SIN CLASIFICAR (anadir a lib/catalogo.mjs):');
  sinClasificar.forEach(n => console.log('   ', n));
}
