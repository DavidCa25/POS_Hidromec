/**
 * Ejecuta SQL con escritura y DEVUELVE filas (EXEC de procedures incluidos).
 *
 * `consultar()` de sql.mjs rechaza EXEC a proposito (solo lectura). Las
 * pruebas funcionales necesitan invocar procedures y leer lo que devuelven,
 * asi que aqui se permite, pero UNICAMENTE sobre una base temporal:
 * `exigirTemporal` rechaza cualquier otro nombre.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SERVIDOR } from './sql.mjs';
import { exigirTemporal } from './temporal.mjs';

const rutaPs = (p) => p.split('\\').join('\\\\');

export function consultarTemporal(db, sql) {
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
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fPs],
      { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024 });
    const txt = readFileSync(fOut, 'utf8');
    if (!txt.trim()) return { ok: true, sets: [] };
    const j = JSON.parse(txt);
    // ConvertTo-Json colapsa arreglos de un solo elemento: normalizar.
    const lista = (x) => (x == null ? [] : (Array.isArray(x) ? x : [x]));
    const sets = lista(j.sets).map(t => lista(t && t.filas));
    return { ok: true, sets };
  } catch (e) {
    const msg = (e.stderr?.toString() || e.message).split('\n').slice(0, 6).join('\n');
    return { ok: false, error: msg, sets: [] };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}
