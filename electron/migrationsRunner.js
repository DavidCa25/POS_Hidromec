const fs = require('fs');
const path = require('path');

/**
 * Aplicador de migraciones.
 *
 * Cada archivo se ejecuta ENTERO dentro de una transaccion: o entra todo, o
 * no entra nada. Por eso una migracion fallida no deja la base a medias.
 *
 * SOBRE LOS ERRORES
 * `mssql/msnodesqlv8` reporta el error EXTERNO y esconde la causa en
 * `precedingErrors`. Con SQL Server eso significa recibir
 *
 *     Could not create constraint or index. See previous errors.
 *
 * cuando lo que realmente paso fue otra cosa, por ejemplo un 1088 por falta
 * de permisos. Depurar eso a ciegas cuesta horas, asi que aqui se despliega
 * la cadena completa y se dice en que migracion y en que lote ocurrio.
 */

function splitSqlByGo(sqlText) {
  return sqlText
    .replace(/\r\n/g, '\n')
    .split(/\n\s*GO\s*\n/gi)
    .map(s => s.trim())
    .filter(Boolean);
}

async function ensureMigrationsTable(pool, sql) {
  await pool.request().batch(`
    IF OBJECT_ID('dbo.schema_migrations', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.schema_migrations (
        id INT IDENTITY(1,1) PRIMARY KEY,
        filename NVARCHAR(255) NOT NULL UNIQUE,
        applied_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
      );
    END
  `);
}

async function getApplied(pool, sql) {
  const r = await pool.request().query(`SELECT filename FROM dbo.schema_migrations;`);
  return new Set((r.recordset || []).map(x => x.filename));
}

/** Aplana la cadena de errores de mssql en una lista legible. */
function cadenaDeErrores(e, salida = []) {
  if (!e) return salida;
  salida.push({
    numero: e.number ?? e.code ?? null,
    mensaje: String(e.message || '').replace(/^\[Microsoft\]\[[^\]]+\]\[SQL Server\]/, ''),
    linea: e.lineNumber ?? null,
  });
  for (const p of (e.precedingErrors || [])) cadenaDeErrores(p, salida);
  if (e.originalError && e.originalError !== e) cadenaDeErrores(e.originalError, salida);
  return salida;
}

/** La primera linea util del lote: sirve para reconocerlo de un vistazo. */
function resumenLote(sqlTexto) {
  const l = sqlTexto
    .split('\n')
    .map(x => x.trim())
    .find(x => x && !x.startsWith('/*') && !x.startsWith('*') && !x.startsWith('--'));
  return (l || sqlTexto.trim().split('\n')[0] || '').slice(0, 120);
}

/**
 * Traduce los fallos conocidos a algo accionable.
 *
 * Sin esto, "Could not create constraint or index" no dice que lo que falta
 * es un permiso, y quien lo lea empezara a buscar el problema en los datos.
 */
function pistaDe(errores) {
  const nums = errores.map(e => Number(e.numero));
  const textos = errores.map(e => e.mensaje).join(' ');

  if (nums.includes(1088) || /does not exist or you do not have permissions/i.test(textos)) {
    return 'La cuenta con la que la aplicacion se conecta no tiene permiso REFERENCES sobre el esquema dbo, ' +
           'que es obligatorio para crear una clave foranea (incluso hacia una tabla recien creada). ' +
           'Lo concede setupServer.ensureSchemaPermissions() al arrancar, con la conexion de Windows. ' +
           'En una caja secundaria hay que concederlo en el servidor: GRANT REFERENCES ON SCHEMA::dbo TO [ocus_app_full_role];';
  }
  if (nums.includes(2627) || nums.includes(2601)) {
    return 'Hay datos existentes que violan una restriccion UNIQUE nueva. Revisa los duplicados antes de reintentar; ' +
           'no se borra ninguna fila automaticamente.';
  }
  if (nums.includes(547)) {
    return 'Hay datos existentes que violan una clave foranea o un CHECK nuevo. La migracion necesita un backfill previo.';
  }
  if (nums.includes(1934)) {
    return 'Las SET OPTIONS de la conexion no permiten crear este objeto (indice filtrado, vista indexada o indice sobre ' +
           'columna computada). Revisa ARITHABORT / QUOTED_IDENTIFIER del driver.';
  }
  return null;
}

async function applyOne(pool, sql, filename, fullpath) {
  const raw = fs.readFileSync(fullpath, 'utf8');
  const batches = splitSqlByGo(raw);

  const tx = new sql.Transaction(pool);
  await tx.begin();

  let indice = -1;
  try {
    for (let i = 0; i < batches.length; i++) {
      indice = i;
      await new sql.Request(tx).batch(batches[i]);
    }

    await new sql.Request(tx)
      .input('filename', sql.NVarChar(255), filename)
      .query(`INSERT INTO dbo.schema_migrations(filename) VALUES (@filename);`);

    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch { /* la transaccion ya estaba abortada */ }

    const errores = cadenaDeErrores(e);
    const pista = pistaDe(errores);

    console.error('');
    console.error('==================================================================');
    console.error('  MIGRACION FALLIDA');
    console.error('==================================================================');
    console.error(`  MIGRATION : ${filename}`);
    console.error(`  BATCH     : ${indice + 1} de ${batches.length}`);
    console.error(`  STATEMENT : ${resumenLote(batches[indice] || '')}`);
    for (const [i, err] of errores.entries()) {
      console.error(`  ${i === 0 ? 'SQL ERROR ' : 'CAUSA     '}: [${err.numero ?? '?'}] ${err.mensaje}`);
    }
    if (pista) console.error(`  QUE HACER : ${pista}`);
    console.error('  ESTADO    : rollback completo, la base queda como estaba.');
    console.error('==================================================================');
    console.error('');

    // El error que sube lleva ya lo esencial, para que quien lo muestre en un
    // dialogo no tenga que abrir el log.
    const causa = errores.find(x => Number(x.numero) !== 1750) || errores[0] || {};
    const err = new Error(
      `Migracion ${filename}, lote ${indice + 1}/${batches.length}: ` +
      `[${causa.numero ?? '?'}] ${causa.mensaje}` + (pista ? `\n\n${pista}` : ''));
    err.migration = filename;
    err.batchIndex = indice;
    err.batchSql = batches[indice] || null;
    err.sqlErrors = errores;
    err.hint = pista;
    throw err;
  }
}

async function runMigrations({ pool, sql, migrationsDir }) {
  await ensureMigrationsTable(pool, sql);

  const applied = await getApplied(pool, sql);

  if (!fs.existsSync(migrationsDir)) {
    return { ok: true, applied: [], pending: [] };
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const pending = files.filter(f => !applied.has(f));
  const appliedNow = [];

  for (const f of pending) {
    const fullpath = path.join(migrationsDir, f);
    await applyOne(pool, sql, f, fullpath);
    appliedNow.push(f);
    console.log(`[MIGRACION] aplicada: ${f}`);
  }

  return { ok: true, applied: appliedNow, pending };
}

module.exports = { runMigrations };
