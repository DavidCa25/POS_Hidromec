/**
 * Base de datos temporal para pruebas.
 *
 * Crea una base nueva, la usa y la borra. NUNCA toca una base existente: si el
 * nombre pedido ya existe con datos, se niega a continuar.
 *
 * Es el unico lugar del arbol de herramientas que escribe en SQL Server.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, copyFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { consultar, SERVIDOR } from './sql.mjs';

/**
 * Carpeta accesible para los dos lados.
 *
 * La cuenta de servicio de SQL Server no puede leer la carpeta del repositorio
 * (error 5, acceso denegado) y este proceso no puede escribir en Program
 * Files. `C:\POS_Backups` es la que el propio backupManager configura para que
 * SQL Server escriba respaldos, asi que por definicion ambos tienen acceso.
 */
export const ZONA_COMUN = process.env.WYBIX_BACKUP_DIR || 'C:\\POS_Backups';

/** Ejecuta SQL con permiso de escritura. Solo para bases temporales. */
export function ejecutar(db, sql, { permitirFallo = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wxtmp-'));
  const f = join(dir, 'q.sql');
  writeFileSync(f, sql, 'utf8');
  const ps = [
    "$ErrorActionPreference='Stop'",
    `$cs = 'Server=${SERVIDOR};Database=${db};Integrated Security=True;TrustServerCertificate=True'`,
    '$c = New-Object System.Data.SqlClient.SqlConnection $cs',
    '$c.Open()',
    '$cmd = $c.CreateCommand()',
    '$cmd.CommandTimeout = 300',
    `$cmd.CommandText = [System.IO.File]::ReadAllText('${f.split('\\').join('\\\\')}')`,
    '[void]$cmd.ExecuteNonQuery()',
    '$c.Close()',
  ].join('\n');
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    return { ok: true };
  } catch (e) {
    const msg = (e.stderr?.toString() || e.message).split('\n').slice(0, 8).join('\n');
    if (!permitirFallo) throw new Error(msg);
    return { ok: false, error: msg };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

/** Se niega a tocar una base que no sea claramente temporal. */
function exigirTemporal(nombre) {
  if (!/^Wybix_(MigTest|SchemaTest|RebuildTest|Tmp[A-Za-z0-9]*)$/.test(nombre)) {
    throw new Error(`"${nombre}" no parece una base temporal. Se rechaza por seguridad.`);
  }
}

export function eliminar(nombre) {
  exigirTemporal(nombre);
  ejecutar('master', `
    IF DB_ID('${nombre}') IS NOT NULL
    BEGIN
      ALTER DATABASE [${nombre}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${nombre}];
    END;`);
}

/** Restaura un .bak en una base temporal nueva. */
export function restaurar(nombre, bak) {
  exigirTemporal(nombre);
  if (!existsSync(bak)) throw new Error(`No existe ${bak}`);
  eliminar(nombre);

  if (!existsSync(ZONA_COMUN)) mkdirSync(ZONA_COMUN, { recursive: true });
  const copia = join(ZONA_COMUN, `_${nombre}.bak`);
  copyFileSync(bak, copia);

  try {
    const dataDir = consultar('master',
      `SELECT CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS NVARCHAR(400)) AS p;`)[0].p;

    const lista = JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', `
      $cs='Server=${SERVIDOR};Database=master;Integrated Security=True;TrustServerCertificate=True'
      $c=New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
      $cmd=$c.CreateCommand(); $cmd.CommandText="RESTORE FILELISTONLY FROM DISK = N'${copia}'"
      $da=New-Object System.Data.SqlClient.SqlDataAdapter $cmd; $dt=New-Object System.Data.DataTable
      [void]$da.Fill($dt); $c.Close()
      $r=@(); foreach($x in $dt.Rows){ $r += ,@{ n=$x['LogicalName']; t=$x['Type'] } }
      ConvertTo-Json -InputObject @($r) -Compress
    `], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));

    const mueve = lista.map(f =>
      `MOVE N'${f.n}' TO N'${dataDir}${nombre}_${f.n}.${f.t === 'L' ? 'ldf' : 'mdf'}'`).join(', ');
    ejecutar('master',
      `RESTORE DATABASE [${nombre}] FROM DISK = N'${copia}' WITH ${mueve}, REPLACE, RECOVERY;`);
  } finally {
    try { unlinkSync(copia); } catch { /* noop */ }
  }
}

/**
 * Crea una base temporal vacia.
 *
 * La colacion NO se deja por defecto: una base nueva hereda la del servidor
 * (`SQL_Latin1_General_CP1_CI_AS`) y las bases de Wybix usan
 * `Modern_Spanish_CI_AS`. Reconstruir con la colacion equivocada produce
 * conflictos al comparar cadenas y hace que las tablas no coincidan columna a
 * columna, aunque el DDL sea correcto.
 */
export function crearVacia(nombre, colacion = 'Modern_Spanish_CI_AS') {
  exigirTemporal(nombre);
  eliminar(nombre);
  ejecutar('master', `CREATE DATABASE [${nombre}] COLLATE ${colacion};`);
}
