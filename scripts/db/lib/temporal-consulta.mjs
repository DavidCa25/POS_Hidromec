/**
 * Ejecuta SQL con escritura y DEVUELVE filas (EXEC de procedures incluidos).
 *
 * `consultar()` de sql.mjs rechaza EXEC a proposito (solo lectura). Las
 * pruebas funcionales necesitan invocar procedures y leer lo que devuelven,
 * asi que aqui se permite, pero UNICAMENTE sobre una base temporal:
 * `exigirTemporal` rechaza cualquier otro nombre.
 */
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SERVIDOR } from './sql.mjs';
import { exigirTemporal } from './temporal.mjs';

const rutaPs = (p) => p.split('\\').join('\\\\');

/**
 * Prepara los archivos temporales del lote. Se separo de la ejecucion para
 * poder correr varias consultas DE VERDAD en paralelo (ver `enParalelo`): una
 * carrera no se demuestra ejecutando una llamada despues de otra.
 */
function preparar(db, sql) {
  exigirTemporal(db);
  const dir = mkdtempSync(join(tmpdir(), 'wxqt-'));
  const fSql = join(dir, 'q.sql');
  const fOut = join(dir, 'r.json');
  const fPs = join(dir, 'q.ps1');
  writeFileSync(fSql, sql, 'utf8');
  const ps = [
    "$ErrorActionPreference='Stop'",
    `$cs = 'Server=${SERVIDOR};Database=${db};Integrated Security=True;TrustServerCertificate=True'`,
    '$c = New-Object System.Data.SqlClient.SqlConnection $cs',
    '$c.Open()',
    '$cmd = $c.CreateCommand()',
    '$cmd.CommandTimeout = 300',
    `$cmd.CommandText = [System.IO.File]::ReadAllText('${rutaPs(fSql)}')`,
    '$da = New-Object System.Data.SqlClient.SqlDataAdapter $cmd',
    '$ds = New-Object System.Data.DataSet',
    '[void]$da.Fill($ds)',
    '$c.Close()',
    '$tablas = New-Object System.Collections.ArrayList',
    'foreach ($dt in $ds.Tables) {',
    '  $filas = New-Object System.Collections.ArrayList',
    '  foreach ($r in $dt.Rows) {',
    '    $o = [ordered]@{}',
    '    foreach ($col in $dt.Columns) {',
    '      $v = $r[$col.ColumnName]',
    '      if ($v -is [System.DBNull]) { $o[$col.ColumnName] = $null }',
    '      elseif ($v -is [byte[]]) { $o[$col.ColumnName] = [Convert]::ToBase64String($v) }',
    '      else { $o[$col.ColumnName] = $v }',
    '    }',
    '    [void]$filas.Add($o)',
    '  }',
    '  [void]$tablas.Add(@{ filas = $filas.ToArray() })',
    '}',
    '$json = ConvertTo-Json -InputObject @{ sets = $tablas.ToArray() } -Depth 8 -Compress',
    `[System.IO.File]::WriteAllText('${rutaPs(fOut)}', $json, (New-Object System.Text.UTF8Encoding $false))`,
  ].join('\n');
  writeFileSync(fPs, ps, 'utf8');
  return { dir, fPs, fOut };
}

const ARGS_PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];

function leerSalida(fOut) {
  const txt = readFileSync(fOut, 'utf8');
  if (!txt.trim()) return { ok: true, sets: [] };
  const j = JSON.parse(txt);
  // ConvertTo-Json colapsa arreglos de un solo elemento: normalizar.
  const lista = (x) => (x == null ? [] : (Array.isArray(x) ? x : [x]));
  return { ok: true, sets: lista(j.sets).map(t => lista(t && t.filas)) };
}

function comoError(e) {
  const bruto = (e && e.stderr ? e.stderr.toString() : '') || (e && e.message) || String(e);
  return { ok: false, error: bruto.split(String.fromCharCode(10)).slice(0, 6).join(String.fromCharCode(10)), sets: [] };
}

export function consultarTemporal(db, sql) {
  const { dir, fPs, fOut } = preparar(db, sql);
  try {
    execFileSync('powershell', [...ARGS_PS, fPs],
      { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024 });
    return leerSalida(fOut);
  } catch (e) {
    return comoError(e);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

/**
 * Varias consultas a la vez, cada una en su propio proceso y su propia
 * conexion. Es la unica forma honesta de probar una carrera: encadenarlas
 * desde un solo proceso solo demuestra que lo secuencial funciona.
 *
 * Quien la use debe sincronizar el disparo dentro del propio SQL -por ejemplo
 * con WAITFOR TIME-, porque arrancar N procesos de PowerShell nunca es
 * simultaneo: tardan cientos de milisegundos distintos en levantar.
 */
export function enParalelo(db, sqls) {
  const trabajos = sqls.map(s => preparar(db, s));
  return Promise.all(trabajos.map(({ fPs, fOut }) => new Promise((resolve) => {
    execFile('powershell', [...ARGS_PS, fPs], { maxBuffer: 128 * 1024 * 1024 }, (err) => {
      if (err) return resolve(comoError(err));
      try { resolve(leerSalida(fOut)); } catch (e) { resolve(comoError(e)); }
    });
  }))).finally(() => {
    for (const { dir } of trabajos) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });
}
