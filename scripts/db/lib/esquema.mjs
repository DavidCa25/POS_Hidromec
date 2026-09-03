/**
 * Lectura del esquema estructural desde `sys.*` — SOLO LECTURA.
 *
 * POR QUE SE RECONSTRUYE Y NO SE COPIA
 * SQL Server no guarda el texto de un `CREATE TABLE`. Solo guarda el resultado
 * en catalogos (`sys.tables`, `sys.columns`, `sys.indexes`...). Por eso no hay
 * un "definition" que extraer como con los procedures: hay que reconstruir el
 * DDL, y esa reconstruccion debe ser DETERMINISTA para que el checksum sirva.
 *
 * Determinista significa: mismo esquema -> mismo texto, siempre. De ahi que
 * todo se ordene explicitamente (columnas por posicion, constraints por
 * nombre, columnas de indice por clave) y que no se dependa nunca del orden en
 * que el motor devuelva las filas.
 *
 * Se compara ESTRUCTURA, no formato.
 */
import { consultar } from './sql.mjs';

/** Tipo de una columna, con longitud/precision, tal y como se escribiria. */
export function tipoSql(c) {
  const t = c.tipo.toLowerCase();
  if (['decimal', 'numeric'].includes(t)) return `${c.tipo.toUpperCase()}(${c.prec}, ${c.esc})`;
  if (['varchar', 'char', 'varbinary', 'binary'].includes(t)) {
    return `${c.tipo.toUpperCase()}(${c.len === -1 ? 'MAX' : c.len})`;
  }
  if (['nvarchar', 'nchar'].includes(t)) {
    return `${c.tipo.toUpperCase()}(${c.len === -1 ? 'MAX' : c.len / 2})`;
  }
  if (['datetime2', 'time', 'datetimeoffset'].includes(t)) return `${c.tipo.toUpperCase()}(${c.esc})`;
  if (t === 'float') return c.prec === 53 ? 'FLOAT' : `FLOAT(${c.prec})`;
  return c.tipo.toUpperCase();
}

/** Inventario completo del esquema de una base. */
export function leerEsquema(db) {
  const tablas = consultar(db, `
    SELECT t.object_id AS oid, t.name
      FROM sys.tables t
     WHERE t.schema_id = SCHEMA_ID('dbo') AND t.is_ms_shipped = 0
     ORDER BY t.name;`);

  const columnas = consultar(db, `
    SELECT c.object_id AS oid, c.column_id AS pos, c.name,
           TYPE_NAME(c.user_type_id) AS tipo, c.max_length AS len,
           c.precision AS prec, c.scale AS esc, c.is_nullable AS nulo,
           c.is_identity AS ident, c.is_computed AS calc,
           c.collation_name AS colacion,
           ic.seed_value AS semilla, ic.increment_value AS incremento,
           cc.definition AS calcDef, cc.is_persisted AS persistida
      FROM sys.columns c
      JOIN sys.tables t ON t.object_id = c.object_id AND t.schema_id = SCHEMA_ID('dbo')
      LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
     ORDER BY c.object_id, c.column_id;`);

  const claves = consultar(db, `
    SELECT k.parent_object_id AS oid, k.name, k.type AS tipo,
           k.is_system_named AS autoNombre,
           i.type_desc AS clase, i.is_unique AS unica,
           c.name AS columna, ic.key_ordinal AS orden, ic.is_descending_key AS desc_
      FROM sys.key_constraints k
      JOIN sys.tables t ON t.object_id = k.parent_object_id AND t.schema_id = SCHEMA_ID('dbo')
      JOIN sys.indexes i ON i.object_id = k.parent_object_id AND i.index_id = k.unique_index_id
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
     ORDER BY k.name, ic.key_ordinal;`);

  const foraneas = consultar(db, `
    SELECT f.parent_object_id AS oid, f.name, f.is_system_named AS autoNombre,
           OBJECT_NAME(f.referenced_object_id) AS refTabla,
           f.delete_referential_action_desc AS alBorrar,
           f.update_referential_action_desc AS alActualizar,
           f.is_disabled AS desactivada, f.is_not_trusted AS noConfiable,
           pc.name AS columna, rc.name AS refColumna, fc.constraint_column_id AS orden
      FROM sys.foreign_keys f
      JOIN sys.tables t ON t.object_id = f.parent_object_id AND t.schema_id = SCHEMA_ID('dbo')
      JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = f.object_id
      JOIN sys.columns pc ON pc.object_id = fc.parent_object_id AND pc.column_id = fc.parent_column_id
      JOIN sys.columns rc ON rc.object_id = fc.referenced_object_id AND rc.column_id = fc.referenced_column_id
     ORDER BY f.name, fc.constraint_column_id;`);

  const chequeos = consultar(db, `
    SELECT ck.parent_object_id AS oid, ck.name, ck.definition AS def,
           ck.is_system_named AS autoNombre,
           ck.is_disabled AS desactivada, ck.is_not_trusted AS noConfiable,
           COL_NAME(ck.parent_object_id, ck.parent_column_id) AS columna
      FROM sys.check_constraints ck
      JOIN sys.tables t ON t.object_id = ck.parent_object_id AND t.schema_id = SCHEMA_ID('dbo')
     ORDER BY ck.name;`);

  const predet = consultar(db, `
    SELECT d.parent_object_id AS oid, d.name, d.definition AS def,
           d.is_system_named AS autoNombre,
           COL_NAME(d.parent_object_id, d.parent_column_id) AS columna
      FROM sys.default_constraints d
      JOIN sys.tables t ON t.object_id = d.parent_object_id AND t.schema_id = SCHEMA_ID('dbo')
     ORDER BY d.name;`);

  // Indices que NO respaldan una PK o UNIQUE constraint (esos ya salen arriba).
  const indices = consultar(db, `
    SELECT i.object_id AS oid, i.name, i.type_desc AS clase, i.is_unique AS unica,
           i.filter_definition AS filtro,
           c.name AS columna, ic.key_ordinal AS orden,
           ic.is_included_column AS incluida, ic.is_descending_key AS desc_
      FROM sys.indexes i
      JOIN sys.tables t ON t.object_id = i.object_id AND t.schema_id = SCHEMA_ID('dbo')
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
     WHERE i.is_primary_key = 0 AND i.is_unique_constraint = 0 AND i.type <> 0
     ORDER BY i.name, ic.is_included_column, ic.key_ordinal, c.name;`);

  const porTabla = new Map();
  for (const t of tablas) {
    porTabla.set(t.oid, {
      nombre: t.name,
      columnas: [], pk: null, unicas: [], foraneas: [], chequeos: [], predet: [], indices: [],
    });
  }

  for (const c of columnas) porTabla.get(c.oid)?.columnas.push(c);

  // Claves: agrupar por nombre y repartir entre PK y UNIQUE.
  const agrupar = (filas, campos) => {
    const m = new Map();
    for (const f of filas) {
      if (!m.has(f.name)) m.set(f.name, { ...f, cols: [] });
      m.get(f.name).cols.push(campos(f));
    }
    return [...m.values()];
  };

  for (const k of agrupar(claves, f => ({ c: f.columna, desc: !!f.desc_ }))) {
    const t = porTabla.get(k.oid); if (!t) continue;
    if (k.tipo.trim() === 'PK') t.pk = k; else t.unicas.push(k);
  }
  for (const f of agrupar(foraneas, r => ({ c: r.columna, ref: r.refColumna }))) {
    porTabla.get(f.oid)?.foraneas.push(f);
  }
  for (const c of chequeos) porTabla.get(c.oid)?.chequeos.push(c);
  for (const d of predet) porTabla.get(d.oid)?.predet.push(d);
  for (const i of agrupar(indices, r => ({ c: r.columna, incluida: !!r.incluida, desc: !!r.desc_ }))) {
    porTabla.get(i.oid)?.indices.push(i);
  }

  // Orden estable en todo.
  for (const t of porTabla.values()) {
    t.columnas.sort((a, b) => a.pos - b.pos);
    t.unicas.sort((a, b) => a.name.localeCompare(b.name));
    t.foraneas.sort((a, b) => a.name.localeCompare(b.name));
    t.chequeos.sort((a, b) => a.name.localeCompare(b.name));
    t.predet.sort((a, b) => a.name.localeCompare(b.name));
    t.indices.sort((a, b) => a.name.localeCompare(b.name));
  }

  return [...porTabla.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * Representacion canonica de UNA tabla, como DDL revisable.
 *
 * FK e indices van en el mismo archivo, al final y como `ALTER TABLE`
 * separados. Se probo ponerlos en carpetas aparte y complica mas de lo que
 * ordena: para entender una tabla hay que ver sus llaves, y separarlas obliga
 * a abrir tres archivos. El orden de dependencias se resuelve al aplicar
 * (primero todas las tablas, luego todas las FK), no al leer.
 */
export function ddlTabla(t) {
  const L = [];
  L.push(`/* ${t.nombre}`);
  L.push(' * Definicion canonica del esquema. Reconstruida desde sys.* con');
  L.push(' * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del');
  L.push(' * CREATE TABLE original, asi que esto es equivalente, no literal.');
  L.push(' */');
  L.push(`IF OBJECT_ID(N'dbo.${t.nombre}', 'U') IS NULL`);
  L.push('BEGIN');
  L.push(`CREATE TABLE dbo.${t.nombre} (`);

  const partes = [];
  for (const c of t.columnas) {
    if (c.calc) {
      partes.push(`    ${c.name} AS ${c.calcDef}${c.persistida ? ' PERSISTED' : ''}`);
      continue;
    }
    let s = `    ${c.name} ${tipoSql(c)}`;
    if (c.colacion) s += ` COLLATE ${c.colacion}`;
    if (c.ident) s += ` IDENTITY(${c.semilla}, ${c.incremento})`;
    s += c.nulo ? ' NULL' : ' NOT NULL';
    const d = t.predet.find(x => x.columna === c.name);
    // Si en origen no tenia nombre propio, aqui tampoco: que SQL Server lo
    // invente otra vez. Fijar el nombre inventado haria que la copia dejara
    // de ser "autonombrada" y la huella ya no coincidiria con el original.
    if (d) s += d.autoNombre ? ` DEFAULT ${d.def}` : ` CONSTRAINT ${d.name} DEFAULT ${d.def}`;
    partes.push(s);
  }
  if (t.pk) {
    const clase = t.pk.clase === 'CLUSTERED' ? 'CLUSTERED' : 'NONCLUSTERED';
    partes.push(`    ${t.pk.autoNombre ? '' : `CONSTRAINT ${t.pk.name} `}PRIMARY KEY ${clase} ` +
      `(${t.pk.cols.map(c => c.c + (c.desc ? ' DESC' : '')).join(', ')})`);
  }
  for (const u of t.unicas) {
    partes.push(`    ${u.autoNombre ? '' : `CONSTRAINT ${u.name} `}UNIQUE ${u.clase === 'CLUSTERED' ? 'CLUSTERED' : 'NONCLUSTERED'} ` +
      `(${u.cols.map(c => c.c + (c.desc ? ' DESC' : '')).join(', ')})`);
  }
  L.push(partes.join(',\n'));
  L.push(');');
  L.push('END;');

  // CHECK: van aparte porque pueden referirse a varias columnas.
  for (const c of t.chequeos) {
    L.push('');
    if (!c.autoNombre) L.push(`IF OBJECT_ID(N'dbo.${c.name}', 'C') IS NULL`);
    L.push(`ALTER TABLE dbo.${t.nombre} WITH ${c.noConfiable ? 'NOCHECK' : 'CHECK'} ` +
      `ADD ${c.autoNombre ? '' : `CONSTRAINT ${c.name} `}CHECK ${c.def};`);
    if (c.desactivada) L.push(`ALTER TABLE dbo.${t.nombre} NOCHECK CONSTRAINT ${c.name};`);
  }

  // FK al final: dependen de que exista la tabla referenciada.
  for (const f of t.foraneas) {
    L.push('');
    if (!f.autoNombre) L.push(`IF OBJECT_ID(N'dbo.${f.name}', 'F') IS NULL`);
    L.push(`ALTER TABLE dbo.${t.nombre} WITH ${f.noConfiable ? 'NOCHECK' : 'CHECK'} ` +
      `ADD ${f.autoNombre ? '' : `CONSTRAINT ${f.name} `}FOREIGN KEY (${f.cols.map(c => c.c).join(', ')}) ` +
      `REFERENCES dbo.${f.refTabla} (${f.cols.map(c => c.ref).join(', ')})` +
      (f.alBorrar !== 'NO_ACTION' ? ` ON DELETE ${f.alBorrar.replace('_', ' ')}` : '') +
      (f.alActualizar !== 'NO_ACTION' ? ` ON UPDATE ${f.alActualizar.replace('_', ' ')}` : '') + ';');
    if (f.desactivada) L.push(`ALTER TABLE dbo.${t.nombre} NOCHECK CONSTRAINT ${f.name};`);
  }

  for (const i of t.indices) {
    const clave = i.cols.filter(c => !c.incluida);
    const incl = i.cols.filter(c => c.incluida);
    L.push('');
    L.push(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'${i.name}' AND object_id = OBJECT_ID(N'dbo.${t.nombre}'))`);
    L.push(`CREATE ${i.unica ? 'UNIQUE ' : ''}${i.clase} INDEX ${i.name} ON dbo.${t.nombre} ` +
      `(${clave.map(c => c.c + (c.desc ? ' DESC' : '')).join(', ')})` +
      (incl.length ? ` INCLUDE (${incl.map(c => c.c).join(', ')})` : '') +
      (i.filtro ? ` WHERE ${i.filtro}` : '') + ';');
  }

  L.push('');
  return L.join('\n');
}

/**
 * Huella estructural de una tabla: lo que se compara para detectar deriva.
 * Deliberadamente NO incluye formato ni comentarios, solo estructura.
 */
/**
 * Nombre estable para comparar.
 *
 * SQL Server inventa el nombre de una constraint sin nombre explicito, y le
 * pone un sufijo distinto en CADA base: `PK__security__3213E83F996354FB` aqui
 * y `...45CC39F1` alla, para la MISMA estructura. Compararlos daria deriva en
 * todas las instalaciones. `is_system_named` dice cuales son inventados.
 *
 * El nombre real SI se conserva en el archivo DDL: alli interesa para que una
 * reconstruccion sea reproducible.
 */
const nombreEstable = (o) => (o.autoNombre ? '<auto>' : o.name);

export function huellaTabla(t) {
  const col = c => [
    c.name, c.calc ? `AS:${(c.calcDef || '').replace(/\s+/g, '')}` : tipoSql(c),
    c.nulo ? 'NULL' : 'NOTNULL',
    c.ident ? `IDENT(${c.semilla},${c.incremento})` : '',
    c.colacion || '',
  ].filter(Boolean).join(' ');

  return [
    `TABLA ${t.nombre}`,
    ...t.columnas.map((c, i) => `  COL ${i + 1} ${col(c)}`),
    ...t.predet.map(d => `  DEF ${nombreEstable(d)} ${d.columna} ${d.def.replace(/\s+/g, '')}`),
    t.pk ? `  PK ${nombreEstable(t.pk)} ${t.pk.clase} ${t.pk.cols.map(c => c.c + (c.desc ? ':desc' : '')).join(',')}` : '  PK (ninguna)',
    ...t.unicas.map(u => `  UQ ${nombreEstable(u)} ${u.cols.map(c => c.c).join(',')}`),
    ...t.chequeos.map(c => `  CK ${nombreEstable(c)} ${c.def.replace(/\s+/g, '')}${c.desactivada ? ' OFF' : ''}${c.noConfiable ? ' NOTRUST' : ''}`),
    ...t.foraneas.map(f => `  FK ${nombreEstable(f)} (${f.cols.map(c => c.c).join(',')}) -> ${f.refTabla}(${f.cols.map(c => c.ref).join(',')}) DEL:${f.alBorrar} UPD:${f.alActualizar}${f.desactivada ? ' OFF' : ''}${f.noConfiable ? ' NOTRUST' : ''}`),
    ...t.indices.map(i => `  IX ${i.name} ${i.clase}${i.unica ? ' UNIQUE' : ''} (${i.cols.filter(c => !c.incluida).map(c => c.c).join(',')})` +
      (i.cols.some(c => c.incluida) ? ` INC(${i.cols.filter(c => c.incluida).map(c => c.c).join(',')})` : '') +
      (i.filtro ? ` WHERE ${i.filtro.replace(/\s+/g, '')}` : '')),
  ].join('\n');
}
