/**
 * Aplica TODAS las migraciones sobre un respaldo, en una base TEMPORAL.
 *
 *     node scripts/db/probar-migracion.mjs [--bak <ruta.bak>] [--conservar]
 *
 * QUE PRUEBA, SEGUN DE DONDE PARTA
 * --------------------------------
 * Este script no decide el camino: lo decide el `.bak` que se le pase.
 *
 *   --bak <baseline anterior>   ACTUALIZACION. Parte de un esquema previo y
 *                               comprueba que las migraciones lo llevan al
 *                               estado actual. Es el camino de una instalacion
 *                               que ya existia.
 *
 *   (sin --bak)                 IDEMPOTENCIA. Parte de installer/template.bak,
 *                               que YA trae las migraciones aplicadas y
 *                               registradas, y comprueba que reaplicarlas no
 *                               rompe ni cambia nada.
 *
 * Para la INSTALACION LIMPIA, que es otra pregunta -que trae el template y que
 * queda pendiente al restaurarlo-, el script es `probar-instalacion.mjs`.
 *
 * QUE HACE
 *   1. Restaura el .bak en una base nueva (Wybix_MigTest). Es una base que no
 *      existia: no toca ninguna de las de trabajo.
 *   2. Fotografia el estado inicial (objetos y filas de las tablas con datos).
 *   3. Aplica en orden todas las migraciones de electron/migrations.
 *   4. Compara contra el manifiesto canonico y contra la foto inicial.
 *   5. Borra la base temporal, salvo que se pase --conservar.
 *
 * Es el unico script del arbol que escribe en SQL Server, y solo sobre la base
 * temporal que el mismo crea.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync, copyFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { consultar } from './lib/sql.mjs';
import { checksum, desenvolver } from './lib/canonico.mjs';

const CONSERVAR = process.argv.includes('--conservar');
const TEMP_DB = 'Wybix_MigTest';
// Por defecto el baseline: es el punto de partida real de una instalacion
// nueva. Con --bak se puede apuntar a otro respaldo.
const iBak = process.argv.indexOf('--bak');
const BAK = resolve(iBak > 0 ? process.argv[iBak + 1] : 'installer/template.bak');
const SERVIDOR = process.env.WYBIX_DB_SERVER || 'localhost';

if (!existsSync(BAK)) { console.error('No existe', BAK); process.exit(1); }

/** Ejecuta SQL con permiso de escritura. Solo lo usa este script de prueba. */
/**
 * Cuantas veces se ha tenido que repetir un lote porque mataron al proceso.
 * Se cuenta para poder decirlo al final: un pase limpio y un pase con seis
 * reintentos no son la misma noticia.
 */
let reintentos = 0;

function ejecutar(db, sql, opciones = {}) {
  const r = ejecutarUnaVez(db, sql, opciones);
  /*
   * Un fallo SIN mensaje de SQL significa que powershell murio antes de
   * hablar con la base: en esta maquina aparece como codigo 143 y cae en
   * lotes grandes, de forma intermitente y en una migracion distinta cada
   * vez. Las migraciones aplicadas a mano pasan siempre.
   *
   * Se repite UNA vez, y solo en ese caso. Un error de SQL no se reintenta:
   * volver a ejecutarlo daria exactamente el mismo error y esconderia
   * cuantas veces ha pasado.
   */
  if (!r.ok && r.procesoMuerto) {
    reintentos++;
    console.log(`   …      lote repetido: mataron al proceso (codigo ${r.codigo})`);
    return ejecutarUnaVez(db, sql, opciones);
  }
  return r;
}

function ejecutarUnaVez(db, sql, { permitirFallo = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wxmig-'));
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
    /*
     * Cuando SQL Server rechaza algo, el error viene por stderr y ese es el
     * mensaje util. Pero si el que falla es PowerShell -no arranca, lo matan,
     * se queda sin recursos- stderr llega VACIO, y entonces `e.message` es
     * solo el eco del comando: media pantalla de conexion y ni una palabra
     * sobre la causa. Tres ejecuciones se fueron en descubrir que el fallo no
     * estaba en el SQL. Si stderr no dice nada, se dice al menos con que
     * codigo murio y que se estaba ejecutando.
     */
    const err = (e.stderr?.toString() || '').trim();
    const msg = err
      ? err.split('\n').slice(0, 6).join('\n')
      : [
          `powershell termino con codigo ${e.status ?? '?'} sin escribir ningun error.`,
          'Eso apunta al proceso, no al SQL: no llego a hablar con la base.',
          (e.stdout?.toString() || '').trim().split('\n').slice(0, 3).join('\n'),
          `--- primeras lineas del lote (${sql.length} caracteres) ---`,
          sql.split('\n').slice(0, 4).join('\n'),
        ].filter(Boolean).join('\n');
    if (!permitirFallo) throw new Error(msg);
    return { ok: false, error: msg, procesoMuerto: !err, codigo: e.status ?? '?' };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

const paso = (t) => console.log(`\n── ${t}`);
let fallos = 0;
let bakTemporal = null;
const mal = (t) => { console.log(`   FALLA  ${t}`); fallos++; };
const bien = (t) => console.log(`   ok     ${t}`);

try {
  // ------------------------------------------------------------ 1. restaurar
  // Lo que se prueba depende del punto de partida, asi que se dice en voz alta.
  const partidaConocida = BAK.endsWith(join('installer', 'template.bak'));
  console.log(partidaConocida
    ? '\nCAMINO: IDEMPOTENCIA — se parte del template actual, que ya trae las migraciones aplicadas.'
    : `\nCAMINO: ACTUALIZACION — se parte de un respaldo anterior:\n        ${BAK}`);

  paso('1. Restaurar el respaldo en una base temporal');
  ejecutar('master', `
    IF DB_ID('${TEMP_DB}') IS NOT NULL
    BEGIN
      ALTER DATABASE [${TEMP_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${TEMP_DB}];
    END;`);

  const files = consultar('master', `SELECT 1 AS x;`) && null; // fuerza conexion previa
  // La cuenta de servicio de SQL Server no puede leer la carpeta del
  // repositorio (error 5: acceso denegado), y este proceso no puede escribir
  // en Program Files. Se usa C:\POS_Backups, que es la carpeta que el propio
  // backupManager ya configura para que SQL Server escriba sus respaldos: por
  // definicion los dos lados tienen acceso.
  const dataDir = consultar('master',
    `SELECT CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS NVARCHAR(400)) AS p;`)[0].p;
  const zonaComun = process.env.WYBIX_BACKUP_DIR || 'C:\\POS_Backups';
  if (!existsSync(zonaComun)) mkdirSync(zonaComun, { recursive: true });
  bakTemporal = join(zonaComun, '_wybix_migtest.bak');
  copyFileSync(BAK, bakTemporal);

  const lista = JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', `
    $cs='Server=${SERVIDOR};Database=master;Integrated Security=True;TrustServerCertificate=True'
    $c=New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
    $cmd=$c.CreateCommand(); $cmd.CommandText="RESTORE FILELISTONLY FROM DISK = N'${bakTemporal}'"
    $da=New-Object System.Data.SqlClient.SqlDataAdapter $cmd; $dt=New-Object System.Data.DataTable
    [void]$da.Fill($dt); $c.Close()
    $r=@(); foreach($x in $dt.Rows){ $r += ,@{ n=$x['LogicalName']; t=$x['Type'] } }
    ConvertTo-Json -InputObject @($r) -Compress
  `], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));

  const mueve = lista.map(f =>
    `MOVE N'${f.n}' TO N'${dataDir}${TEMP_DB}_${f.n}.${f.t === 'L' ? 'ldf' : 'mdf'}'`).join(', ');

  ejecutar('master',
    `RESTORE DATABASE [${TEMP_DB}] FROM DISK = N'${bakTemporal}' WITH ${mueve}, REPLACE, RECOVERY;`);
  bien(`base temporal ${TEMP_DB} creada desde ${BAK}`);

  // ------------------------------------------------------ 2. estado inicial
  paso('2. Estado del que se parte');
  const contar = (db) => consultar(db, `SELECT COUNT(*) AS n FROM sys.procedures;`)[0].n;
  const antes = contar(TEMP_DB);
  const tablasAntes = consultar(TEMP_DB, `
    SELECT t.name, SUM(p.rows) AS filas
      FROM sys.tables t JOIN sys.partitions p
        ON p.object_id = t.object_id AND p.index_id IN (0,1)
     GROUP BY t.name ORDER BY t.name;`);
  console.log(`   procedures: ${antes}`);
  console.log(`   tablas con datos: ${tablasAntes.filter(t => t.filas > 0).map(t => `${t.name}=${t.filas}`).join(', ') || '(ninguna)'}`);

  // -------------------------------------------------------- 3. migraciones
  paso('3. Aplicar migraciones en orden');
  const dir = 'electron/migrations';
  const archivos = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of archivos) {
    const raw = readFileSync(join(dir, f), 'utf8');
    if (!raw.trim()) { console.log(`   —      ${f} (vacia)`); continue; }
    const lotes = raw.replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n/gi).map(s => s.trim()).filter(Boolean);
    let err = null;
    for (const lote of lotes) {
      const r = ejecutar(TEMP_DB, lote, { permitirFallo: true });
      if (!r.ok) { err = r.error; break; }
    }
    if (err) { mal(`${f}\n${err.split('\n').map(l => '            ' + l).join('\n')}`); }
    else bien(`${f} (${lotes.length} lotes)`);
  }

  // ------------------------------------------------------- 4. comprobaciones
  paso('4. Estado final');
  const despues = contar(TEMP_DB);
  console.log(`   procedures: ${antes} -> ${despues}`);

  const manifiesto = JSON.parse(readFileSync('sql/manifest.json', 'utf8'));
  const modsBase = new Map(consultar(TEMP_DB, `
    SELECT o.name, m.definition AS def FROM sys.sql_modules m
      JOIN sys.objects o ON o.object_id = m.object_id
     WHERE o.schema_id = SCHEMA_ID('dbo');`).map(r => [r.name, r.def]));
  const tiposBase = new Set(consultar(TEMP_DB,
    `SELECT name FROM sys.table_types WHERE schema_id = SCHEMA_ID('dbo');`).map(r => r.name));

  const criticos = manifiesto.objetos.filter(o => o.critico);
  const criticosMal = criticos.filter(o =>
    o.tipo === 'USER_TABLE_TYPE' ? !tiposBase.has(o.nombre) : !modsBase.has(o.nombre));
  if (criticosMal.length) mal(`objetos criticos ausentes: ${criticosMal.map(o => o.nombre).join(', ')}`);
  else bien(`los ${criticos.length} objetos criticos estan presentes`);

  if (tiposBase.has('ProductImportType')) bien('ProductImportType creado');
  else mal('ProductImportType no se creo');

  // Todo objeto que toque una migracion debe quedar igual que en Git: una
  // migracion que deja la base en un estado que el repositorio no describe es
  // deriva recien creada. Con el historial productivo en cero no hay ninguna,
  // y la comprobacion queda vacia hasta que exista la primera.
  const tocados = [];
  for (const f of archivos) {
    const texto = readFileSync(join(dir, f), 'utf8');
    for (const m of texto.matchAll(/^\/\* -+ (\S+) \(/gm)) tocados.push(m[1]);
  }
  let iguales = 0;
  for (const n of [...new Set(tocados)]) {
    const o = manifiesto.objetos.find(x => x.nombre === n);
    if (!o || o.tipo === 'USER_TABLE_TYPE') continue;
    const enBase = modsBase.get(n);
    const git = desenvolver(readFileSync(o.archivo, 'utf8'));
    if (enBase && git && checksum(enBase) === checksum(git)) iguales++;
    else mal(`la migracion no dejo ${n} igual que Git`);
  }
  bien(tocados.length
    ? `${iguales} objetos tocados por migraciones coinciden con su definicion canonica`
    : 'ninguna migracion pendiente que comprobar: el baseline ya trae todo');

  // Datos intactos.
  paso('5. Datos conservados');
  const tablasDespues = new Map(consultar(TEMP_DB, `
    SELECT t.name, SUM(p.rows) AS filas
      FROM sys.tables t JOIN sys.partitions p
        ON p.object_id = t.object_id AND p.index_id IN (0,1)
     GROUP BY t.name;`).map(r => [r.name, r.filas]));
  let perdidas = 0;
  for (const t of tablasAntes) {
    if (t.name === 'schema_migrations') continue;
    const d = tablasDespues.get(t.name);
    if (d === undefined) { mal(`tabla desaparecida: ${t.name}`); perdidas++; }
    else if (d < t.filas) { mal(`${t.name}: ${t.filas} -> ${d} filas`); perdidas++; }
  }
  if (!perdidas) bien(`${tablasAntes.length} tablas conservadas, sin perdida de filas`);

  const migs = consultar(TEMP_DB, `SELECT filename FROM schema_migrations ORDER BY filename;`);
  console.log(`   schema_migrations: ${migs.length} registradas`);
  console.log(`     ${migs.map(m => m.filename).join('\n     ')}`);

} finally {
  if (bakTemporal) {
    try { unlinkSync(bakTemporal); } catch { /* noop */ }
  }
  if (!CONSERVAR) {
    try {
      ejecutar('master', `
        IF DB_ID('${TEMP_DB}') IS NOT NULL
        BEGIN
          ALTER DATABASE [${TEMP_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
          DROP DATABASE [${TEMP_DB}];
        END;`);
      console.log(`\nBase temporal ${TEMP_DB} eliminada.`);
    } catch (e) { console.log(`\nNo se pudo eliminar ${TEMP_DB}: ${e.message}`); }
  } else {
    console.log(`\nBase temporal ${TEMP_DB} conservada (--conservar).`);
  }
}

// Un pase limpio y un pase con seis lotes repetidos no son la misma
// noticia, aunque los dos acaben en OK.
if (reintentos) {
  console.log(`\nAVISO: ${reintentos} lote(s) hubo que repetirlos porque mataron al ` +
    'proceso de powershell (codigo 143). No fue SQL: la base no llego a responder.');
}
console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S)` : '\nRESULTADO: OK');
process.exit(fallos ? 1 : 0);
