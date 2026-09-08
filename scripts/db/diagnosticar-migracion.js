/**
 * Reproduce una migracion con el MISMO driver que usa la aplicacion
 * (mssql/msnodesqlv8, ODBC) y muestra el error SQL REAL.
 *
 *     npx electron scripts/db/diagnosticar-migracion.js 0002_hospitality-domain.sql
 *     npx electron scripts/db/diagnosticar-migracion.js 0002_hospitality-domain.sql --aplicar
 *
 * POR QUE HACE FALTA
 * Las pruebas (`db:test-migration`) usan SqlClient de .NET vía PowerShell.
 * La aplicacion usa ODBC. Los dos drivers NO conectan con las mismas SET
 * OPTIONS, y hay objetos de SQL Server (indices filtrados, indices sobre
 * columnas computadas, vistas indexadas) que EXIGEN ciertas opciones al
 * crearse. Una migracion puede pasar en la prueba y fallar en la aplicacion.
 * Este script cierra ese hueco: ejecuta como ejecuta la app.
 *
 * Por defecto es de DIAGNOSTICO: hace ROLLBACK siempre, no cambia nada.
 * Con `--aplicar` confirma la transaccion (mismo camino que el runner).
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const archivo = process.argv.find(a => a.endsWith('.sql'));
const APLICAR = process.argv.includes('--aplicar');

if (!archivo) {
  console.error('Uso: npx electron scripts/db/diagnosticar-migracion.js <archivo.sql> [--aplicar]');
  process.exit(1);
}

/** Todo lo que mssql sabe del error, incluida la cadena de errores previos. */
function detalle(e, prefijo = '') {
  const l = [];
  l.push(`${prefijo}message : ${e.message}`);
  if (e.number != null) l.push(`${prefijo}number  : ${e.number}`);
  if (e.state != null) l.push(`${prefijo}state   : ${e.state}`);
  if (e.class != null) l.push(`${prefijo}class   : ${e.class}`);
  if (e.lineNumber != null) l.push(`${prefijo}line    : ${e.lineNumber}`);
  if (e.serverName) l.push(`${prefijo}server  : ${e.serverName}`);
  if (e.procName) l.push(`${prefijo}proc    : ${e.procName}`);
  if (e.code) l.push(`${prefijo}code    : ${e.code}`);
  const previos = e.precedingErrors || e.originalError?.precedingErrors || [];
  for (const [i, p] of previos.entries()) {
    l.push(`${prefijo}--- error previo ${i + 1} ---`);
    l.push(detalle(p, prefijo + '  '));
  }
  if (e.originalError && e.originalError !== e) {
    l.push(`${prefijo}--- originalError ---`);
    l.push(detalle(e.originalError, prefijo + '  '));
  }
  return l.join('\n');
}

app.whenReady().then(async () => {
  const db = require(path.join(RAIZ, 'electron', 'db.js'));
  const sql = db.sql;
  const ruta = path.join(RAIZ, 'electron', 'migrations', archivo);
  const texto = fs.readFileSync(ruta, 'utf8');
  const lotes = texto.replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi).map(s => s.trim()).filter(Boolean);

  console.log(`\nMIGRACION : ${archivo}`);
  console.log(`LOTES     : ${lotes.length}`);
  console.log(`MODO      : ${APLICAR ? 'APLICAR (commit si todo pasa)' : 'DIAGNOSTICO (rollback siempre)'}`);

  const pool = await db.getPool();
  console.log(`BASE      : ${pool.config.database}`);

  // Las SET OPTIONS de la sesion: es justo lo que difiere entre drivers.
  try {
    const r = await pool.request().query(`
      SELECT
        CASE WHEN SESSIONPROPERTY('ANSI_NULLS') = 1 THEN 'ON' ELSE 'OFF' END AS ansi_nulls,
        CASE WHEN SESSIONPROPERTY('QUOTED_IDENTIFIER') = 1 THEN 'ON' ELSE 'OFF' END AS quoted_identifier,
        CASE WHEN SESSIONPROPERTY('ARITHABORT') = 1 THEN 'ON' ELSE 'OFF' END AS arithabort,
        CASE WHEN SESSIONPROPERTY('ANSI_WARNINGS') = 1 THEN 'ON' ELSE 'OFF' END AS ansi_warnings,
        CASE WHEN SESSIONPROPERTY('ANSI_PADDING') = 1 THEN 'ON' ELSE 'OFF' END AS ansi_padding,
        CASE WHEN SESSIONPROPERTY('CONCAT_NULL_YIELDS_NULL') = 1 THEN 'ON' ELSE 'OFF' END AS concat_null,
        CASE WHEN SESSIONPROPERTY('NUMERIC_ROUNDABORT') = 1 THEN 'ON' ELSE 'OFF' END AS numeric_roundabort;`);
    console.log('SET OPTIONS de la sesion (driver de la aplicacion):');
    console.log('  ' + JSON.stringify(r.recordset[0]));
  } catch (e) {
    console.log('No se pudieron leer las SET OPTIONS:', e.message);
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  let falloEn = -1;

  try {
    const TRAZA = process.argv.includes('--traza');
    for (let i = 0; i < lotes.length; i++) {
      try {
        await new sql.Request(tx).batch(lotes[i]);
        if (TRAZA) {
          const r = await new sql.Request(tx).query(`
            SELECT COUNT(*) AS n FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.uoms');`);
          const primera = lotes[i].split('\n').filter(l => l.trim() && !l.trim().startsWith('/*') && !l.trim().startsWith('*')).slice(0, 1).join(' ').slice(0, 90);
          console.log(`  lote ${String(i + 1).padStart(2)}  uoms=${r.recordset[0].n}  ${primera}`);
        }
      } catch (e) {
        falloEn = i;
        console.log('\n============================================================');
        console.log(`FALLA EN EL LOTE ${i + 1} de ${lotes.length}`);
        console.log('============================================================');
        console.log('--- SQL DEL LOTE ---');
        console.log(lotes[i]);
        console.log('--- ERROR ---');
        console.log(detalle(e));
        throw e;
      }
    }
    if (APLICAR) {
      await new sql.Request(tx)
        .input('filename', sql.NVarChar(255), archivo)
        .query('INSERT INTO dbo.schema_migrations(filename) VALUES (@filename);');
      await tx.commit();
      console.log(`\nRESULTADO: APLICADA Y REGISTRADA (${lotes.length} lotes)`);
    } else {
      await tx.rollback();
      console.log(`\nRESULTADO: los ${lotes.length} lotes se ejecutan sin error (rollback hecho, nada cambio)`);
    }
    app.exit(0);
  } catch (e) {
    try { await tx.rollback(); } catch { /* ya abortada */ }
    console.log(`\nRESULTADO: FALLO en el lote ${falloEn + 1}. Rollback hecho: la base queda como estaba.`);
    app.exit(1);
  }
});

app.on('window-all-closed', () => { /* sin ventanas: no salir por esto */ });
