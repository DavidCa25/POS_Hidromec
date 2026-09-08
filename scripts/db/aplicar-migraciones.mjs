/**
 * Aplica las migraciones pendientes de electron/migrations/ a una base DADA.
 *
 *     node scripts/db/aplicar-migraciones.mjs --base Wybix_Production --si
 *
 * Es el mismo algoritmo que `electron/migrationsRunner.js` (la aplicacion lo
 * ejecuta al arrancar): lee `schema_migrations`, aplica en orden los `.sql`
 * que falten, cada archivo en UNA transaccion, y registra el nombre.
 *
 * Para que sirve: llevar la base de referencia del desarrollador al mismo
 * punto que dejaria la aplicacion, sin abrir Electron, y poder extraer el
 * manifiesto (`db:extract`, `db:extract-schema`) con los objetos ya
 * migrados. NO es para clientes: la caja se migra sola.
 *
 * Escribe en la base que se le indique, asi que exige `--si` explicito.
 * Las bases temporales de prueba tienen su propio script (`db:test-migration`).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { consultar, SERVIDOR } from './lib/sql.mjs';

const args = process.argv.slice(2);
const iBase = args.indexOf('--base');
const BASE = iBase >= 0 ? args[iBase + 1] : null;
const SI = args.includes('--si');
const DIR = join('electron', 'migrations');

if (!BASE || !SI) {
  console.error('Uso: node scripts/db/aplicar-migraciones.mjs --base <BaseDeDatos> --si');
  process.exit(1);
}

/** Ejecuta un archivo completo (lotes GO) dentro de una transaccion. */
function aplicarArchivo(db, filename, texto) {
  const lotes = texto.replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi).map(s => s.trim()).filter(Boolean);
  const dir = mkdtempSync(join(tmpdir(), 'wxapply-'));
  const fIn = join(dir, 'lotes.json');
  const fPs = join(dir, 'aplicar.ps1');
  writeFileSync(fIn, JSON.stringify({ filename, lotes }), 'utf8');
  const ruta = (f) => f.split('\\').join('\\\\');
  const ps = [
    "$ErrorActionPreference='Stop'",
    `$cs = 'Server=${SERVIDOR};Database=${db};Integrated Security=True;TrustServerCertificate=True'`,
    `$in = [System.IO.File]::ReadAllText('${ruta(fIn)}') | ConvertFrom-Json`,
    '$c = New-Object System.Data.SqlClient.SqlConnection $cs',
    '$c.Open()',
    '$tx = $c.BeginTransaction()',
    'try {',
    '  foreach ($s in $in.lotes) {',
    '    $cmd = $c.CreateCommand(); $cmd.Transaction = $tx; $cmd.CommandTimeout = 600; $cmd.CommandText = $s',
    '    [void]$cmd.ExecuteNonQuery()',
    '  }',
    '  $cmd = $c.CreateCommand(); $cmd.Transaction = $tx',
    "  $cmd.CommandText = 'INSERT INTO dbo.schema_migrations(filename) VALUES (@f)'",
    "  [void]$cmd.Parameters.AddWithValue('@f', [string]$in.filename)",
    '  [void]$cmd.ExecuteNonQuery()',
    '  $tx.Commit()',
    '} catch {',
    '  $tx.Rollback()',
    '  throw',
    '} finally { $c.Close() }',
  ].join('\n');
  writeFileSync(fPs, ps, 'utf8');
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fPs],
      { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e.stderr?.toString() || e.message).split('\n').slice(0, 8).join('\n') };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

console.log(`Base: ${BASE}  (servidor ${SERVIDOR})`);

const existe = consultar('master', `SELECT DB_ID('${BASE.replace(/'/g, "''")}') AS id;`)[0]?.id;
if (!existe) { console.error('La base no existe.'); process.exit(1); }

const tabla = consultar(BASE, `SELECT OBJECT_ID('dbo.schema_migrations', 'U') AS id;`)[0]?.id;
if (!tabla) { console.error('La base no tiene schema_migrations: no es una base Wybix versionada.'); process.exit(1); }

const aplicadas = new Set(consultar(BASE, `SELECT filename FROM dbo.schema_migrations;`).map(r => r.filename));
const archivos = existsSync(DIR)
  ? readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.sql')).sort((a, b) => a.localeCompare(b, 'en'))
  : [];
const pendientes = archivos.filter(f => !aplicadas.has(f));

console.log(`Migraciones en disco: ${archivos.length}  aplicadas: ${aplicadas.size}  pendientes: ${pendientes.length}`);
let fallos = 0;
for (const f of pendientes) {
  const r = aplicarArchivo(BASE, f, readFileSync(join(DIR, f), 'utf8'));
  if (r.ok) console.log(`   ok     ${f}`);
  else { console.log(`   FALLA  ${f}\n${r.error.split('\n').map(l => '            ' + l).join('\n')}`); fallos++; break; }
}
console.log(fallos ? '\nRESULTADO: FALLO (se detuvo en la primera migracion con error)' : '\nRESULTADO: OK');
process.exit(fallos ? 1 : 0);
