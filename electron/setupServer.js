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
    templateBak: path.join(base, 'template.bak')
  };
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
 
      if (realCode === 0 || realCode === 3010) {
        console.log(`[SETUP] Script PS ok. Log:\n${scriptLog}`);
        return resolve(true);
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

// Crea el login ocus_app y lo remapea al usuario huerfano de la plantilla
async function ensureLogin(server, dbName, user, password) {
  log(`Configurando login ${user}...`);
  const p = password.replace(/'/g, "''");

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

      IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'ocus_app_full_role')
        ALTER ROLE [ocus_app_full_role] ADD MEMBER [${user}];`);
  } finally {
    await dbPool.close();
  }

  log('Login listo.');
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
    await runElevated(paths.psScript, {
      SetupExe: paths.setupExe,
      ConfigFile: paths.configFile,
      SaPassword: saPassword
    });
    installed = true;

    reachable = await sqlServerReachable(server, 20, 3000);
    if (!reachable) throw new Error('SQL Express se instalo pero la instancia no respondio a tiempo.');
  } else {
    log('SQL ya esta disponible.');
  }

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

  // 3) Login para las cajas secundarias
  if (ocusPassword) {
    await ensureLogin(server, dbName, 'ocus_app', ocusPassword);
  } else {
    log('Sin ocusPassword: se omite la configuracion del login (solo caja unica).');
  }

  return { ok: true, role, installed };
}

module.exports = { ensureServerReady };