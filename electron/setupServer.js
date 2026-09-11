const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const sql = require('mssql/msnodesqlv8');
const { app } = require('electron');
const DB_NAME = 'Wybix_POS';


function log(msg) { console.log(`[SETUP] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Ubica los recursos empaquetados (prod) o de desarrollo
function resolvePaths() {
  const isDev = !app.isPackaged;
  const base = isDev
    ? path.join(__dirname, '..', 'installer')
    : process.resourcesPath;

  return {
    setupExe:   path.join(base, 'sqlexpress', 'setup.exe'),
    configFile: path.join(base, 'ConfigurationFile.ini'),
    psScript:   path.join(base, 'setup-sqlserver.ps1'),
    // Solo la parte de RED, sin instalar nada. `setup-sqlserver.ps1` la hace
    // tambien, pero unicamente cuando Wybix instala el motor: si SQL ya
    // respondia, se salta entero y con el se saltan el puerto, el Browser y
    // el firewall. Este script existe para ese caso.
    psRed:      path.join(base, 'preparar-red.ps1'),
    // Definicion canonica del rol con el que opera la aplicacion. Viaja con
    // el instalador igual que las migraciones: sin ella no se puede dar de
    // alta una caja secundaria en una base que no lo traiga. En desarrollo
    // sale del arbol de Git; empaquetada, de resources/permissions/.
    permisos: isDev
      ? path.join(__dirname, '..', 'sql', 'permissions', 'ocus_app_full_role.sql')
      : path.join(base, 'permissions', 'ocus_app_full_role.sql'),
    templateBak: path.join(base, 'template.bak'),
    servicing:  path.join(base, 'sql-servicing.json'),
    sqlUpdates: path.join(base, 'sqlupdates')
  };
}

/**
 * Contrato del motor: que build trae el medio, que actualizacion de seguridad
 * se aplica encima y que se exige al arrancar.
 *
 * Vive en installer/sql-servicing.json para que cambiar de parche en un
 * release futuro no obligue a tocar codigo.
 */
function leerServicing(paths) {
  try {
    return JSON.parse(fs.readFileSync(paths.servicing, 'utf8'));
  } catch {
    return null;
  }
}

/** Compara builds de SQL Server ('15.0.2180.2') numero a numero. */
function compararBuild(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** La version mayor ('15.0' de '15.0.2180.2'). */
function majorDe(build) {
  const p = String(build).split('.');
  return `${p[0]}.${p[1] ?? 0}`;
}

/**
 * En que rama de mantenimiento esta un build de SQL Server 2019.
 *
 * El numero por si solo no lo dice: un CU tiene un build mucho mayor que el
 * GDR mas reciente (15.0.4xxx frente a 15.0.2xxx) sin pertenecer a la rama que
 * Wybix eligio. Quien lo sabe de verdad es SERVERPROPERTY('ProductUpdateLevel'),
 * que devuelve 'CUxx' o 'GDR'; cuando no esta disponible se usa el tercer
 * componente del build, que en SQL Server 2019 separa las dos ramas.
 */
function ramaDe(build, productUpdateLevel) {
  const nivel = String(productUpdateLevel || '').trim().toUpperCase();
  if (nivel.startsWith('CU')) return 'CU';
  if (nivel === 'GDR') return 'GDR';

  const tercero = Number(String(build).split('.')[2] || 0);
  if (!tercero) return 'DESCONOCIDA';
  return tercero >= 4000 ? 'CU' : 'GDR';   // 15.0.4xxx = CU; 15.0.2xxx = RTM/GDR
}

/** Lo que el motor dice de si mismo: build y rama de mantenimiento. */
async function buildDelMotor(server) {
  const pool = await connectMaster(server);
  try {
    const r = await pool.request().query(`
      SELECT CAST(SERVERPROPERTY('ProductVersion')     AS NVARCHAR(64)) AS build,
             CAST(SERVERPROPERTY('ProductUpdateLevel') AS NVARCHAR(64)) AS nivel`);
    const f = r.recordset?.[0];
    return f?.build ? { build: f.build, nivel: f.nivel || null } : null;
  } finally {
    try { await pool.close(); } catch { /* noop */ }
  }
}

// Conexion a master por Windows Auth (para instalar/restaurar)
async function connectMaster(server) {
  const cfg = {
    server,
    database: 'master',
    options: { trustedConnection: true, trustServerCertificate: true, enableArithAbort: true },
    connectionTimeout: 6000
  };
  const pool = new sql.ConnectionPool(cfg);
  await pool.connect();
  return pool;
}

// Conexion a una base especifica por Windows Auth
async function connectDb(server, database) {
  const cfg = {
    server,
    database,
    options: { trustedConnection: true, trustServerCertificate: true, enableArithAbort: true },
    connectionTimeout: 6000
  };
  const pool = new sql.ConnectionPool(cfg);
  await pool.connect();
  return pool;
}

async function sqlServerReachable(server, attempts = 3, delayMs = 3000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const pool = await connectMaster(server);
      await pool.close();
      return true;
    } catch {
      if (i < attempts) await sleep(delayMs);
    }
  }
  return false;
}

// Corre el .ps1 elevado (UAC) y espera su codigo de salida
function runElevated(psScript, params) {
  return new Promise((resolve, reject) => {
    const tmp = os.tmpdir();
    const stamp = Date.now();
 
    const paramsFile = path.join(tmp, `wybix_setup_params_${stamp}.json`);
    const launcher   = path.join(tmp, `wybix_setup_launch_${stamp}.ps1`);
    const exitFile   = path.join(tmp, `wybix_setup_exit_${stamp}.txt`);
    const logFile    = path.join(tmp, `wybix_setup_log_${stamp}.txt`);
 
    const limpiar = () => {
      for (const f of [paramsFile, launcher, exitFile]) {
        try { fs.unlinkSync(f); } catch { /* noop */ }
      }
    };
 
    // Funcion auxiliar para inyectar strings en el script de PowerShell
    const psString = (str) => `'${String(str).replace(/'/g, "''")}'`;
 
    try {
      fs.writeFileSync(paramsFile, JSON.stringify(params), 'utf8');
 
      // EL TRUCO: Pasamos variables limpias y armamos $argsList como un 
      // SOLO string con comillas dobles (`") para el ArgumentList.
      const content = `
        $ErrorActionPreference = "Stop"
        
        $scriptPath = ${psString(psScript)}
        $jsonPath   = ${psString(paramsFile)}
        $logPath    = ${psString(logFile)}
        $exitPath   = ${psString(exitFile)}
 
        $argsList = "-ExecutionPolicy Bypass -NoProfile -File \`"$scriptPath\`" -ParamsFile \`"$jsonPath\`" -LogFile \`"$logPath\`""
 
        try {
          $p = Start-Process powershell -Verb RunAs -PassThru -Wait -ArgumentList $argsList
          Set-Content -Path $exitPath -Value $p.ExitCode
          exit $p.ExitCode
        } catch {
          Set-Content -Path $exitPath -Value 9999
          exit 9999
        }
      `.trim();
 
      fs.writeFileSync(launcher, content, 'utf8');
    } catch (e) {
      limpiar();
      return reject(new Error(`No se pudo preparar la instalacion: ${e.message}`));
    }
 
    const child = spawn('powershell.exe',
      ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', launcher],
      { windowsHide: true });
 
    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });
 
    child.on('close', (code) => {
      let realCode = code;
      try {
        if (fs.existsSync(exitFile)) {
          realCode = parseInt(fs.readFileSync(exitFile, 'utf8').trim(), 10);
        }
      } catch { /* noop */ }
 
      let scriptLog = '';
      try {
        if (fs.existsSync(logFile)) scriptLog = fs.readFileSync(logFile, 'utf8');
      } catch { /* noop */ }
 
      limpiar();
 
      // Se devuelve el codigo, no un booleano: 0 y 3010 son dos exitos
      // distintos y quien llama necesita distinguirlos. 3010 significa que
      // Windows tiene operaciones pendientes hasta el reinicio.
      if (realCode === 0 || realCode === 3010) {
        console.log(`[SETUP] Script PS ok (codigo ${realCode}). Log:\n${scriptLog}`);
        return resolve({ ok: true, code: realCode });
      }
 
      const detalle = scriptLog || stderr || '(sin detalle)';
      reject(new Error(`La configuracion de SQL fallo (codigo ${realCode}).\n${detalle}`));
    });
 
    child.on('error', (err) => {
      limpiar();
      reject(err);
    });
  });
}

function psLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

async function databaseExists(masterPool, dbName) {
  const rs = await masterPool.request()
    .input('name', sql.NVarChar(128), dbName)
    .query('SELECT DB_ID(@name) AS id');
  return rs.recordset?.[0]?.id != null;
}

async function restoreTemplate(masterPool, dbName, bakPath) {
  log(`Restaurando plantilla en ${dbName}...`);

  const fl = await masterPool.request()
    .input('bak', sql.NVarChar(4000), bakPath)
    .query('RESTORE FILELISTONLY FROM DISK = @bak');

  const paths = await masterPool.request().query(`
    SELECT
      CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS NVARCHAR(4000)) AS dataPath,
      CAST(SERVERPROPERTY('InstanceDefaultLogPath')  AS NVARCHAR(4000)) AS logPath`);

  const dataPath = paths.recordset[0].dataPath;
  const logPath = paths.recordset[0].logPath;

  const moves = fl.recordset.map(f => {
    const isLog = f.Type === 'L';
    const target = (isLog ? logPath : dataPath) +
      dbName + (isLog ? '_log.ldf' : '.mdf');
    return `MOVE '${f.LogicalName.replace(/'/g, "''")}' TO '${target.replace(/'/g, "''")}'`;
  });

  const restoreSql =
    `RESTORE DATABASE [${dbName}] FROM DISK = @bak WITH REPLACE, RECOVERY, STATS = 5, ` +
    moves.join(', ');

  await masterPool.request()
    .input('bak', sql.NVarChar(4000), bakPath)
    .query(restoreSql);

  log('Plantilla restaurada.');
}

const ROL_APP = 'ocus_app_full_role';

/**
 * El rol con el que opera la aplicacion, garantizado.
 *
 * POR QUE HACE FALTA GARANTIZARLO
 * -------------------------------
 * `ocus_app_full_role` vivia UNICAMENTE dentro del template.bak heredado.
 * `sql/permissions/ocus_app_full_role.sql` es su definicion canonica, pero
 * nadie lo ejecutaba: ni el baseline, ni el setup, ni una migracion. Mientras
 * el template fue el artefacto hecho a mano nadie lo noto; en cuanto se
 * reconstruyo desde Git, el rol dejo de existir.
 *
 * Y `ensureLogin` lo daba por hecho:
 *
 *     IF EXISTS (... 'ocus_app_full_role') ALTER ROLE ... ADD MEMBER
 *
 * Sin rol, esa linea no hace NADA y no dice nada. El login se creaba, el
 * usuario se creaba, y la caja secundaria conectaba con una cuenta que solo
 * podia hacer CONNECT: cada pantalla fallaba por su cuenta con un error de
 * permisos que no menciona la causa.
 *
 * LA DEFINICION NO SE DUPLICA
 * ---------------------------
 * Se ejecuta el ARCHIVO canonico, no una copia de los GRANT en JavaScript.
 * Dos listas de permisos en dos lenguajes divergen; la unica pregunta seria
 * cual de las dos manda.
 *
 * Idempotente: el archivo comprueba la existencia del rol y los GRANT
 * repetidos no fallan ni duplican nada.
 */
async function ensureRole(server, dbName) {
  const paths = resolvePaths();
  if (!fs.existsSync(paths.permisos)) {
    throw new Error(
      `No se encontro la definicion del rol de la aplicacion en: ${paths.permisos}. ` +
      'Sin ella no se puede dar de alta una caja secundaria.');
  }

  const dbPool = await connectDb(server, dbName);
  try {
    const lotes = fs.readFileSync(paths.permisos, 'utf8')
      .replace(/\r\n/g, '\n').split(/\n\s*GO\s*\n?/gi).map(s => s.trim()).filter(Boolean);
    for (const lote of lotes) await dbPool.request().batch(lote);

    // Se comprueba el resultado en vez de darlo por hecho: es justo lo que
    // fallaba en silencio.
    const r = await dbPool.request().query(`
      SELECT COUNT(*) AS n FROM sys.database_principals
       WHERE name = '${ROL_APP}' AND type = 'R';`);
    if (!Number(r.recordset?.[0]?.n)) {
      throw new Error(`No se pudo crear el rol ${ROL_APP} en ${dbName}.`);
    }
    log(`Rol ${ROL_APP} listo, con sus permisos.`);
    return { ok: true };
  } finally {
    await dbPool.close();
  }
}

// Crea el login ocus_app y lo remapea al usuario huerfano de la plantilla
async function ensureLogin(server, dbName, user, password) {
  log(`Configurando login ${user}...`);
  const p = password.replace(/'/g, "''");

  // El rol PRIMERO: sin el, el ALTER ROLE de mas abajo no haria nada y la
  // caja secundaria conectaria sin poder hacer nada.
  await ensureRole(server, dbName);

  const master = await connectMaster(server);
  try {
    await master.request().query(`
      IF SUSER_ID('${user}') IS NULL
        CREATE LOGIN [${user}] WITH PASSWORD = N'${p}', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
      ELSE
        ALTER LOGIN [${user}] WITH PASSWORD = N'${p}';`);
  } finally {
    await master.close();
  }

  // Usuario dentro de la base + remapeo de SID + rol
  const dbPool = await connectDb(server, dbName);
  try {
    await dbPool.request().query(`
      IF USER_ID('${user}') IS NULL
        CREATE USER [${user}] FOR LOGIN [${user}];
      ELSE
        ALTER USER [${user}] WITH LOGIN = [${user}];

      ALTER ROLE [${ROL_APP}] ADD MEMBER [${user}];`);

    /* Antes esto era `IF EXISTS (rol) ALTER ROLE ...`: sin rol no pasaba nada
       y nadie se enteraba. Ahora el rol esta garantizado arriba, asi que el
       ALTER ROLE va a secas -si fallara, se veria- y ademas se comprueba la
       membresia, que es lo unico que de verdad decide si la caja secundaria
       podra operar. */
    const m = await dbPool.request().query(`
      SELECT COUNT(*) AS n
        FROM sys.database_role_members rm
        JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
        JOIN sys.database_principals u ON u.principal_id = rm.member_principal_id
       WHERE r.name = '${ROL_APP}' AND u.name = '${user}';`);
    if (!Number(m.recordset?.[0]?.n)) {
      throw new Error(
        `${user} se creo pero no quedo dentro de ${ROL_APP}: conectaria sin permisos para operar.`);
    }
  } finally {
    await dbPool.close();
  }

  log(`Login listo: ${user} es miembro de ${ROL_APP}.`);
}

/**
 * Permisos que la aplicacion necesita para poder MIGRARSE a si misma.
 *
 * La app corre como `ocus_app`, miembro de `ocus_app_full_role`. Ese rol
 * nacio con lo justo para operar (SELECT/INSERT/UPDATE/DELETE/EXECUTE y
 * ALTER sobre dbo, CREATE TABLE/VIEW/PROCEDURE/FUNCTION/TYPE) pero SIN
 * REFERENCES.
 *
 * Sin REFERENCES, SQL Server rechaza CUALQUIER clave foranea, incluso hacia
 * una tabla que el propio usuario acaba de crear, con este error:
 *
 *     1750  Could not create constraint or index. See previous errors.
 *     1088  Cannot find the object "dbo.x" because it does not exist
 *           or you do not have permissions.
 *
 * Hasta ahora no se habia notado porque las claves foraneas de Wybix venian
 * dentro de `template.bak` (creadas por un administrador al construirlo), y
 * ninguna migracion productiva habia anadido una. La primera que lo hace es
 * `0002_hospitality-domain`.
 *
 * REFERENCES es estrictamente menos peligroso que el ALTER que el rol ya
 * tiene: permite apuntar a una tabla, no modificarla.
 *
 * Se ejecuta con la conexion de Windows del setup (la misma que instala y
 * restaura), porque `ocus_app` no puede concederse permisos a si mismo. Es
 * idempotente: GRANT repetido no falla ni duplica nada.
 */
async function ensureSchemaPermissions(server, dbName) {
  /** ¿Quien debe recibir el permiso? El rol si existe; si no, el usuario. */
  const SQL_DESTINO = `
    SELECT TOP 1 name, type_desc
    FROM sys.database_principals
    WHERE (name = 'ocus_app_full_role' AND type = 'R') OR (name = 'ocus_app' AND type IN ('S','U'))
    ORDER BY CASE WHEN type = 'R' THEN 0 ELSE 1 END;`;

  const sqlTiene = (destino) => `
    SELECT COUNT(*) AS n
    FROM sys.database_permissions p
    JOIN sys.database_principals g ON g.principal_id = p.grantee_principal_id
    WHERE g.name = '${destino.replace(/'/g, "''")}'
      AND p.class_desc = 'SCHEMA' AND p.major_id = SCHEMA_ID('dbo')
      AND p.permission_name = 'REFERENCES' AND p.state_desc = 'GRANT';`;

  const dbPool = await connectDb(server, dbName);
  try {
    const d = await dbPool.request().query(SQL_DESTINO);
    const destino = d.recordset?.[0]?.name;
    if (!destino) {
      log('Sin usuario ni rol de aplicacion en esta base: no hay permisos que revisar.');
      return { ok: true, destino: null, concedido: false };
    }

    const antes = (await dbPool.request().query(sqlTiene(destino))).recordset[0].n > 0;
    if (antes) {
      log(`Permisos de la aplicacion correctos (${destino} ya tiene REFERENCES sobre dbo).`);
      return { ok: true, destino, concedido: false };
    }

    await dbPool.request().batch(`GRANT REFERENCES ON SCHEMA::dbo TO [${destino}];`);

    // Se comprueba el resultado en vez de darlo por hecho: si el GRANT no
    // tuvo efecto, es mejor saberlo aqui que en mitad de una migracion.
    const despues = (await dbPool.request().query(sqlTiene(destino))).recordset[0].n > 0;
    if (despues) {
      log(`Permiso REFERENCES sobre dbo concedido a ${destino} (necesario para las claves foraneas de las migraciones).`);
      return { ok: true, destino, concedido: true };
    }

    log(`AVISO: no se pudo conceder REFERENCES sobre dbo a ${destino}. Las migraciones con claves foraneas fallaran.`);
    return { ok: false, destino, concedido: false };
  } finally {
    await dbPool.close();
  }
}

async function ensureServerReady(options = {}) {
  const role = options.role || 'principal';
  const server = options.server || 'localhost\\SQLEXPRESS';
  const dbName = options.dbName || DB_NAME;
  const saPassword = options.saPassword;
  const ocusPassword = options.ocusPassword;

  if (role === 'secundaria') {
    log('Maquina secundaria: no se instala SQL, solo se conecta por red.');
    return { ok: true, role, installed: false };
  }

  const paths = resolvePaths();

  // 1) Instalar SQL Express si no responde
  let reachable = await sqlServerReachable(server, 2, 2000);
  let installed = false;

  if (!reachable) {
    log('SQL no responde. Instalando SQL Express (requiere permisos de administrador)...');
    if (!fs.existsSync(paths.setupExe)) {
      throw new Error(`No se encontro el instalador de SQL Express en: ${paths.setupExe}`);
    }
    // La actualizacion de seguridad viaja con el instalador y se aplica en la
    // misma pasada elevada: es el unico momento sin datos, sin nadie vendiendo
    // y donde un reinicio no molesta a nadie.
    // Wybix instala una rama concreta -la GDR- y solo esa viaja en el
    // instalador. El objetivo de la rama CU se conoce, pero es para reconocer
    // instancias ajenas, no para instalarlo.
    const servicing = leerServicing(paths);
    const ramaWybix = servicing?.ramaQueInstalaWybix || 'GDR';
    const objetivo = servicing?.seguridad?.ramas?.[ramaWybix] || null;
    const parche = objetivo?.paquete
      ? path.join(paths.sqlUpdates, objetivo.paquete)
      : null;

    if (objetivo?.viajaEnElInstalador && !fs.existsSync(parche)) {
      throw new Error(
        'No se encontro la actualizacion de seguridad ' + objetivo.kb +
        ' en: ' + parche + '. El instalador esta incompleto: no se puede dejar ' +
        'el motor sin parchear.');
    }

    const r = await runElevated(paths.psScript, {
      SetupExe: paths.setupExe,
      ConfigFile: paths.configFile,
      SaPassword: saPassword,
      Servicing: objetivo?.viajaEnElInstalador ? {
        KB: objetivo.kb,
        Build: objetivo.buildMinimo,
        Paquete: parche,
        Sha256: objetivo.sha256,
      } : null
    });
    installed = true;

    // 3010: la actualizacion se aplico pero Windows tiene operaciones
    // pendientes hasta el reinicio. No hay documentacion de Microsoft que
    // garantice que el motor sea plenamente utilizable antes de reiniciar, asi
    // que no se crea ninguna base todavia.
    //
    // No hace falta ningun mecanismo de reanudacion: este flujo ya es
    // reentrante. Al reiniciar y volver a abrir Wybix, SQL responde, se salta
    // la instalacion, se verifica el build de verdad y se sigue donde tocaba.
    if (r?.code === 3010) {
      const e = new Error(
        'La actualizacion de seguridad de SQL Server se aplico correctamente, pero Windows ' +
        'necesita reiniciarse para terminar.\n\n' +
        'Reinicia el equipo y vuelve a abrir Wybix: la instalacion continuara sola.');
      e.reinicioPendiente = true;
      throw e;
    }

    reachable = await sqlServerReachable(server, 20, 3000);
    if (!reachable) throw new Error('SQL Express se instalo pero la instancia no respondio a tiempo.');
  } else {
    log('SQL ya esta disponible.');
  }

  // El motor -recien instalado o el que ya habia- tiene que cumplir el
  // contrato ANTES de que se cree o restaure ninguna base.
  //
  // `altaDeHost` distingue las dos politicas: estrenar una instalacion exige
  // el contrato completo; arrancar una que ya opera solo avisa.
  await comprobarMotor(server, paths, {
    altaDeHost: !!options.altaDeHost,
    loInstaloWybix: installed,
  });

  // 2) Restaurar la plantilla si la base no existe
  const master = await connectMaster(server);
  try {
    const exists = await databaseExists(master, dbName);
    if (!exists) {
      if (!fs.existsSync(paths.templateBak)) {
        throw new Error(`No se encontro template.bak en: ${paths.templateBak}`);
      }
      await restoreTemplate(master, dbName, paths.templateBak);
    } else {
      log(`La base ${dbName} ya existe. No se restaura.`);
    }
  } finally {
    await master.close();
  }

  // 3) El rol de la aplicacion, SIEMPRE.
  //
  // Va antes que el login y fuera del `if (ocusPassword)` a proposito. Una
  // base puede no traerlo -las creadas desde un baseline reconstruido antes
  // de que el rol formara parte de el- y entonces `ALTER ROLE ADD MEMBER` no
  // hacia nada, en silencio. Repararlo aqui significa que la instalacion se
  // arregla sola al arrancar, sin esperar a que alguien compre MultiCaja.
  //
  // Un fallo aqui no impide vender: la principal entra por autenticacion de
  // Windows y no necesita el rol. Se dice y se sigue.
  try {
    await ensureRole(server, dbName);
  } catch (e) {
    log(`No se pudo garantizar el rol de la aplicacion: ${e.message}`);
  }

  // 4) Login para las cajas secundarias
  if (ocusPassword) {
    await ensureLogin(server, dbName, 'ocus_app', ocusPassword);
  } else {
    log('Sin ocusPassword: se omite la configuracion del login (solo caja unica).');
  }

  // 5) Permisos que la aplicacion necesita para migrarse a si misma.
  //    Va SIEMPRE, no solo cuando hay ocusPassword: el login puede existir de
  //    una instalacion anterior y aun asi faltarle permisos (es el caso que
  //    rompio la actualizacion a Hospitality). Un fallo aqui no impide
  //    arrancar: si no se pudo conceder, la migracion lo dira con claridad.
  try {
    await ensureSchemaPermissions(server, dbName);
  } catch (e) {
    log(`No se pudieron revisar los permisos de la aplicacion: ${e.message}`);
  }

  return { ok: true, role, installed };
}
/**
 * Decide que hacer con el motor encontrado.
 *
 * Responde DOS preguntas que no son la misma y que mezclarlas confunde:
 *
 *   COMPATIBILIDAD  esta este release probado con esta version mayor?
 *       Es un contrato cerrado. SQL Server 2022 no se rechaza por ser peor,
 *       sino porque nadie ha comprobado que el esquema se comporte igual.
 *
 *   SEGURIDAD       tiene esta instancia los parches actuales?
 *       Se compara contra el objetivo de SU RAMA. Los builds de GDR y CU no
 *       forman una sola secuencia: 15.0.4430.1 es numericamente mayor que
 *       15.0.2180.2 y sin embargo NO tiene las correcciones de julio de 2026,
 *       porque en la rama CU esas correcciones llegan en 15.0.4480.2.
 *
 * Y lo hace segun DOS contextos:
 *
 *   ALTA DE HOST     se va a crear la base de un negocio. Se exige todo.
 *   ARRANQUE NORMAL  alguien va a vender. La seguridad avisa; la
 *                    incompatibilidad bloquea igual, salvo en desarrollo.
 *
 * Devuelve la decision en vez de imprimirla, para poder probarla.
 */
function decidirSobreMotor({ build, nivel, servicing, altaDeHost, loInstaloWybix, entorno }) {
  const compat = servicing.compatibilidad || {};
  const seguridad = servicing.seguridad || {};
  const ramaWybix = servicing.ramaQueInstalaWybix || 'GDR';
  const rama = ramaDe(build, nivel);
  const objetivo = seguridad.ramas?.[rama] || null;
  const esDesarrollo = String(entorno || '').toLowerCase() === 'development';

  // ---------------------------------------------------------- 1. COMPATIBILIDAD
  // Contrato cerrado: major exacto. Un major distinto no es "mas nuevo", es
  // "no certificado". En produccion se bloquea siempre -tambien al arrancar-,
  // porque seguir vendiendo sobre una combinacion sin probar no es un aviso.
  // En desarrollo se avisa, para no romper entornos de trabajo.
  if (majorDe(build) !== compat.major) {
    const texto = `Este SQL Server es ${build}. Wybix ${servicing.version || '1.2.0'} esta ` +
      `probado con ${compat.producto} (${compat.major}.x) y no se ha certificado con otras versiones.`;
    if (esDesarrollo) {
      return { accion: 'AVISA', rama, categoria: 'COMPATIBILIDAD',
        motivo: `${texto} Se continua porque es un entorno de desarrollo.` };
    }
    return { accion: 'BLOQUEA', rama, categoria: 'COMPATIBILIDAD',
      motivo: `${texto} ${altaDeHost
        ? 'Instala Wybix en una maquina sin SQL Server, o usa una instancia de SQL Server 2019.'
        : 'Conecta esta caja a un SQL Server 2019.'}` };
  }

  // ------------------------------------------------- 2. SEGURIDAD, POR RAMA
  if (!objetivo) {
    // No se sabe en que rama esta: no se inventa un veredicto.
    return { accion: altaDeHost ? 'BLOQUEA' : 'AVISA', rama, categoria: 'SEGURIDAD',
      motivo: `No se pudo determinar la rama de mantenimiento de ${build}. ` +
        'Comprueba el nivel de actualizacion del motor antes de continuar.' };
  }

  const alDia = compararBuild(build, objetivo.buildMinimo) >= 0;

  // El motor que instala Wybix tiene que quedar EXACTAMENTE en el build de la
  // rama que Wybix distribuye. Ni otro build ni otra rama.
  if (loInstaloWybix) {
    const esperado = seguridad.ramas?.[ramaWybix];
    if (rama !== ramaWybix || compararBuild(build, esperado.buildMinimo) !== 0) {
      return { accion: 'BLOQUEA', rama, categoria: 'SEGURIDAD',
        motivo: `El motor quedo en ${build} (rama ${rama}) y se esperaba ` +
          `${esperado.buildMinimo} (${esperado.kb}): la actualizacion de seguridad no se aplico. No se continua.` };
    }
    return { accion: 'CONTINUA', rama, categoria: 'SEGURIDAD',
      motivo: `motor ${build} (rama ${rama}, ${objetivo.kb}): al dia.` };
  }

  // Instancia preexistente: se evalua contra el objetivo de SU rama.
  if (!alDia) {
    const comoActualizar = rama === ramaWybix
      ? `Actualiza a ${objetivo.buildMinimo} (${objetivo.kb}).`
      : `Esta instancia esta en la rama ${rama}: actualiza a ${objetivo.buildMinimo} ` +
        `(${objetivo.kb}), la actualizacion de seguridad de SU rama. Wybix no la migra a ${ramaWybix}.`;
    if (altaDeHost) {
      return { accion: 'BLOQUEA', rama, categoria: 'SEGURIDAD',
        motivo: `Este SQL Server es ${build} y le faltan las actualizaciones de seguridad ` +
          `de ${seguridad.fecha}. ${comoActualizar} Wybix no parchea una instancia que no instalo.` };
    }
    return { accion: 'AVISA', rama, categoria: 'SEGURIDAD',
      motivo: `el motor esta en ${build} (rama ${rama}) y le faltan actualizaciones de ` +
        `seguridad. ${comoActualizar} Se continua.` };
  }

  const nota = rama === ramaWybix ? '' :
    ` Wybix distribuye la rama ${ramaWybix}, pero no se cambia de rama a una instancia existente.`;
  return { accion: 'CONTINUA', rama, categoria: 'SEGURIDAD',
    motivo: `motor ${build} (rama ${rama}, ${objetivo.kb}): al dia.${nota}` };
}

/** Aplica la decision al arranque real. */
async function comprobarMotor(server, paths, { altaDeHost = false, loInstaloWybix = false } = {}) {
  const servicing = leerServicing(paths);
  if (!servicing?.compatibilidad) return null;

  let motor = null;
  try {
    motor = await buildDelMotor(server);
  } catch (e) {
    log('No se pudo leer la version del motor: ' + e.message);
    return null;   // no se bloquea a nadie por no poder preguntar
  }
  if (!motor) return null;

  const r = decidirSobreMotor({
    build: motor.build, nivel: motor.nivel, servicing, altaDeHost, loInstaloWybix,
    entorno: app.isPackaged ? 'production' : (process.env.NODE_ENV || 'development'),
  });

  if (r.accion === 'BLOQUEA') throw new Error(r.motivo);
  if (r.accion === 'AVISA') log(`AVISO [${r.categoria}]: ${r.motivo}`);
  else log(r.motivo);
  return r;
}

module.exports = {
  ensureServerReady, ensureSchemaPermissions,
  // Reutilizados por electron/lib/red-principal.js para el paso
  // prueba/MonoCaja -> MultiCaja, que hace lo mismo que el asistente sin
  // reinstalar nada. Duplicar `ensureLogin` habria sido duplicar la regla de
  // que cuenta usan las cajas secundarias.
  resolvePaths, runElevated, ensureRole, ensureLogin, connectMaster, connectDb, sqlServerReachable,
  comprobarMotor, decidirSobreMotor, compararBuild, majorDe, ramaDe,
  leerServicing, buildDelMotor,
};