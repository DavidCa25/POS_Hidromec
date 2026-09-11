/**
 * Lectura de definiciones SQL — SOLO LECTURA.
 *
 * Por que PowerShell y no el driver de la aplicacion:
 *   - `mssql/msnodesqlv8` se cuelga al conectar desde un script suelto fuera
 *     de Electron (se probo: la promesa nunca resuelve).
 *   - `sqlcmd` de ODBC 17 no acepta `-y`, asi que trunca las columnas de texto
 *     largo, y las definiciones de procedure pasan de 4 000 caracteres.
 *
 * SqlClient de .NET viene con Windows, devuelve NVARCHAR(MAX) completo y no
 * necesita instalar nada.
 *
 * Este modulo NO ejecuta escrituras: hay una barrera explicita que rechaza
 * cualquier sentencia que no sea de lectura.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const SERVIDOR = process.env.WYBIX_DB_SERVER || 'localhost';

const ESCRITURA = /(^|[;\s(])(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|EXEC|EXECUTE|GRANT|REVOKE|DENY|BACKUP|RESTORE)\s/i;

/**
 * Quita literales y comentarios antes de buscar sentencias de escritura.
 *
 * Sin esto, una consulta legitima como
 *   SELECT ... WHERE definition LIKE '%CREATE OR ALTER%'
 * se rechazaria por contener la palabra dentro de una cadena.
 */
function soloCodigo(sql) {
  return String(sql)
    .replace(/'(?:[^']|'')*'/g, "''")   // literales
    .replace(/\/\*[\s\S]*?\*\//g, ' ')  // comentarios de bloque
    .replace(/--[^\n]*/g, ' ');         // comentarios de linea
}

/** Escapa una ruta de Windows para incrustarla en una cadena de PowerShell. */
function rutaPs(p) {
  return p.split('\\').join('\\\\');
}

/**
 * Ejecuta una consulta de lectura y devuelve las filas como objetos.
 *
 * El resultado viaja por un archivo temporal en JSON: asi no depende del ancho
 * de la consola ni de la codificacion de la tuberia, que es justo lo que
 * rompia con sqlcmd.
 */
export function consultar(baseDatos, sql) {
  if (ESCRITURA.test(soloCodigo(sql))) {
    throw new Error('sql.mjs es de solo lectura: la consulta contiene una sentencia de escritura.');
  }

  const dir = mkdtempSync(join(tmpdir(), 'wxdb-'));
  const fSql = join(dir, 'q.sql');
  const fOut = join(dir, 'r.json');
  writeFileSync(fSql, sql, 'utf8');

  const ps = [
    "$ErrorActionPreference='Stop'",
    `$cs = 'Server=${SERVIDOR};Database=${baseDatos};Integrated Security=True;TrustServerCertificate=True'`,
    '$c = New-Object System.Data.SqlClient.SqlConnection $cs',
    '$c.Open()',
    '$cmd = $c.CreateCommand()',
    '$cmd.CommandTimeout = 180',
    `$cmd.CommandText = [System.IO.File]::ReadAllText('${rutaPs(fSql)}')`,
    '$da = New-Object System.Data.SqlClient.SqlDataAdapter $cmd',
    '$dt = New-Object System.Data.DataTable',
    '[void]$da.Fill($dt)',
    '$c.Close()',
    '$filas = @()',
    'foreach ($r in $dt.Rows) {',
    '  $o = [ordered]@{}',
    '  foreach ($col in $dt.Columns) {',
    '    $v = $r[$col.ColumnName]',
    '    if ($v -is [System.DBNull]) { $o[$col.ColumnName] = $null } else { $o[$col.ColumnName] = $v }',
    '  }',
    '  $filas += ,$o',
    '}',
    '$json = ConvertTo-Json -InputObject @($filas) -Depth 6 -Compress',
    `[System.IO.File]::WriteAllText('${rutaPs(fOut)}', $json, (New-Object System.Text.UTF8Encoding $false))`,
  ].join('\n');

  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024 });
    const txt = readFileSync(fOut, 'utf8');
    if (!txt.trim()) return [];
    const j = JSON.parse(txt);
    return Array.isArray(j) ? j : [j];
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

/** Definicion completa de un objeto programable (procedure, vista, funcion, trigger). */
export function definicion(baseDatos, nombre) {
  const r = consultar(baseDatos, `
    SELECT m.definition AS d
      FROM sys.sql_modules m
      JOIN sys.objects o ON o.object_id = m.object_id
     WHERE o.name = '${String(nombre).replace(/'/g, "''")}'
       AND o.schema_id = SCHEMA_ID('dbo');`);
  return r.length ? r[0].d : null;
}
