// backupManager.js
// Respaldos automaticos de SQL Server desde el proceso principal.
// No depende del Programador de Tareas de Windows: usa un catch-up al
// arranque para cubrir las noches con la tienda cerrada.
//
// QUIEN RESPALDA
// --------------
// Solo el HOST, la caja que tiene el SQL Server de la sucursal. Las cajas
// secundarias se conectan por LAN y no respaldan: pedirlo obligaria a darles
// privilegios administrativos sobre la base de toda la sucursal, y no hay
// motivo para que una caja de mostrador pueda respaldarla o restaurarla.
//
// CON QUE PERMISOS
// ----------------
// BACKUP DATABASE exige db_backupoperator, db_owner o sysadmin. El login de
// la aplicacion (ocus_app) no los tiene ni debe tenerlos: solo hace
// operaciones de negocio. En el host se ordena el respaldo con la conexion de
// Windows del usuario que ejecuta Wybix, que en una instalacion normal ya
// administra su SQL Express local. Asi ninguna caja gana permisos nuevos.

const path = require('path');
const fs = require('fs');
// El mismo driver que db.js y setupServer.js: msnodesqlv8 (ODBC nativo). Es el
// unico que habla Windows Auth, que es como el host ordena el respaldo. Cargar
// ademas `mssql` a secas -que usa tedious- rompe el arranque del proceso.
const sql = require('mssql/msnodesqlv8');
const { app } = require('electron');
const { poolPromise } = require('./db');
const { servidorEsLocal } = require('./lib/host');

const DEFAULTS = {
  enabled: false,
  time: '23:00',            // hora programada HH:MM (24h)
  retentionDays: 14,
  folder: 'C:\\POS_Backups',
  copyToFolder: ''          // opcional: carpeta sincronizada (OneDrive/Drive) para sacar el .bak de la maquina
};

let timer = null;
let running = false;

function configPath() {
  return path.join(app.getPath('userData'), 'backup-config.json');
}

function loadBackupConfig() {
  try {
    const p = configPath();
    if (fs.existsSync(p)) {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
    }
  } catch (e) {
    console.error('[BACKUP] error leyendo backup-config.json:', e);
  }
  return { ...DEFAULTS };
}

function saveBackupConfig(partial = {}) {
  const merged = { ...loadBackupConfig(), ...partial };
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function escSql(s) {
  return String(s ?? '').replace(/'/g, "''");
}


/** A que servidor y base apunta la conexion de la aplicacion. */
async function conexionDeLaApp() {
  const pool = await poolPromise;
  return {
    server: pool?.config?.server || '',
    database: pool?.config?.database || 'Hidromec_DataBase'
  };
}

/** Esta caja es el host de la sucursal? */
async function esHost() {
  try {
    const { server } = await conexionDeLaApp();
    return servidorEsLocal(server);
  } catch {
    return false;
  }
}

/**
 * Conexion privilegiada al servidor local, por identidad de Windows.
 *
 * Solo se abre en el host y solo para respaldar: no se guarda, no se reutiliza
 * para operaciones de negocio y no viaja a ninguna caja secundaria.
 */
async function conexionPrivilegiadaLocal(server) {
  const pool = new sql.ConnectionPool({
    server,
    database: 'master',
    options: { trustedConnection: true, trustServerCertificate: true, enableArithAbort: true },
    connectionTimeout: 8000,
    requestTimeout: 15 * 60 * 1000   // un respaldo grande tarda
  });
  await pool.connect();
  return pool;
}

/**
 * Traduce el error de SQL a algo accionable.
 *
 * "BACKUP DATABASE is terminating abnormally" no le dice nada a nadie: casi
 * siempre es la carpeta -que el servicio de SQL no puede escribir- o los
 * permisos del usuario de Windows.
 */
function explicar(err) {
  const m = String(err?.message || err);
  if (/operating system error 5|Access is denied|acceso denegado/i.test(m)) {
    return 'SQL Server no puede escribir en la carpeta de respaldos. Elige una carpeta a la ' +
           'que el servicio de SQL Server tenga acceso (por ejemplo C:\\POS_Backups) o dale ' +
           'permiso de escritura a ese servicio.';
  }
  if (/operating system error 3|no se encuentra la ruta|cannot find the path/i.test(m)) {
    return 'La carpeta de respaldos no existe para SQL Server. Revisa la ruta configurada.';
  }
  if (/permission|permiso|principal|no autoriz/i.test(m)) {
    return 'El usuario de Windows que ejecuta Wybix no tiene permiso para respaldar en este ' +
           'SQL Server. Abre Wybix con el usuario que administra SQL Server en esta ' +
           'computadora, o agrega ese usuario al rol db_backupoperator de la base.';
  }
  if (/failed to connect|ECONNREFUSED|ETIMEOUT|Login failed/i.test(m)) {
    return 'No se pudo abrir una conexion administrativa con el SQL Server local: ' + m;
  }
  return m;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function getDbName() {
  const pool = await poolPromise;
  return pool?.config?.database || 'Hidromec_DataBase';
}

function ensureFolder(folder) {
  if (folder && !fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
}

async function runBackup(reason = 'manual') {
  if (running) return { success: false, error: 'Ya hay un respaldo en curso.' };
  running = true;

  const cfg = loadBackupConfig();
  let privilegiada = null;
  try {
    const { server, database: dbName } = await conexionDeLaApp();

    // Una caja secundaria no respalda la base de la sucursal.
    if (!servidorEsLocal(server)) {
      const aviso = `Esta caja se conecta al servidor ${server}: el respaldo lo hace la ` +
                    'computadora principal, la que tiene SQL Server.';
      saveBackupConfig({ lastStatus: 'no-aplica', lastError: aviso, lastAttemptAt: new Date().toISOString() });
      console.log(`[BACKUP] omitido: esta caja no es el host (${server})`);
      return { success: false, error: aviso, noAplica: true };
    }

    ensureFolder(cfg.folder);
    const file = path.join(cfg.folder, `${dbName}_${stamp()}.bak`);

    // El BACKUP lo escribe el servicio de SQL Server, asi que la carpeta tiene
    // que ser suya. Y se ordena con la conexion de Windows, no con el login de
    // la aplicacion, que no puede ni debe respaldar.
    privilegiada = await conexionPrivilegiadaLocal(server);
    const q = `BACKUP DATABASE [${dbName}] TO DISK = N'${escSql(file)}' WITH INIT, STATS = 5;`;
    await privilegiada.request().query(q);

    // Copia fuera de la maquina (carpeta sincronizada del cliente), si esta configurada
    if (cfg.copyToFolder) {
      try {
        ensureFolder(cfg.copyToFolder);
        fs.copyFileSync(file, path.join(cfg.copyToFolder, path.basename(file)));
      } catch (e) {
        console.error('[BACKUP] no se pudo copiar a la carpeta externa:', e);
      }
    }

    const at = new Date().toISOString();
    saveBackupConfig({ lastBackupAt: at, lastStatus: 'ok', lastError: null });
    console.log(`[BACKUP] ok (${reason}): ${file}`);

    cleanupOldBackups(cfg.folder, cfg.retentionDays);
    if (cfg.copyToFolder) cleanupOldBackups(cfg.copyToFolder, cfg.retentionDays);

    return { success: true, path: file, at };
  } catch (err) {
    const mensaje = explicar(err);
    saveBackupConfig({ lastStatus: 'error', lastError: mensaje, lastAttemptAt: new Date().toISOString() });
    console.error('[BACKUP] error:', err);
    return { success: false, error: mensaje };
  } finally {
    if (privilegiada) { try { await privilegiada.close(); } catch { /* noop */ } }
    running = false;
  }
}

function cleanupOldBackups(folder, retentionDays) {
  try {
    if (!folder || !fs.existsSync(folder)) return;
    const cutoff = Date.now() - (Number(retentionDays) || 14) * 86400000;

    for (const name of fs.readdirSync(folder)) {
      if (!name.toLowerCase().endsWith('.bak')) continue;
      const full = path.join(folder, name);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoff) {
          fs.unlinkSync(full);
          console.log('[BACKUP] retencion, borrado:', name);
        }
      } catch { /* noop */ }
    }
  } catch (e) {
    console.error('[BACKUP] error de limpieza:', e);
  }
}

function listBackups() {
  const cfg = loadBackupConfig();
  const out = [];
  try {
    if (fs.existsSync(cfg.folder)) {
      for (const name of fs.readdirSync(cfg.folder)) {
        if (!name.toLowerCase().endsWith('.bak')) continue;
        const full = path.join(cfg.folder, name);
        const st = fs.statSync(full);
        out.push({
          name,
          path: full,
          sizeMB: +(st.size / 1048576).toFixed(2),
          modified: st.mtime.toISOString()
        });
      }
    }
  } catch (e) {
    console.error('[BACKUP] error al listar:', e);
  }
  out.sort((a, b) => b.modified.localeCompare(a.modified));
  return out;
}

function isSameDay(a, b) {
  return a && b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

// Toca respaldar durante el dia: habilitado, sin respaldo de hoy y ya paso la hora programada
function backupDueNow(cfg) {
  if (!cfg.enabled) return false;

  const now = new Date();
  const last = cfg.lastBackupAt ? new Date(cfg.lastBackupAt) : null;
  if (isSameDay(last, now)) return false;

  const [hh, mm] = String(cfg.time || '23:00').split(':').map(Number);
  const scheduled = new Date(now);
  scheduled.setHours(hh || 23, mm || 0, 0, 0);

  return now >= scheduled;
}

async function tick() {
  if (backupDueNow(loadBackupConfig())) {
    await runBackup('programado');
  }
}

// Al abrir la app: si no hay respaldo de hoy, hazlo ya (cubre las noches cerrado)
async function startupCatchUp() {
  const cfg = loadBackupConfig();
  if (!cfg.enabled) return;
  // En una caja secundaria no hay nada que programar.
  if (!(await esHost())) { console.log('[BACKUP] esta caja no es el host: no se programan respaldos'); return; }

  const last = cfg.lastBackupAt ? new Date(cfg.lastBackupAt) : null;
  if (!isSameDay(last, new Date())) {
    await runBackup('arranque');
  }
}

function startScheduler() {
  if (timer) clearInterval(timer);

  // catch-up unos segundos despues de arrancar (deja que la conexion SQL este lista)
  setTimeout(() => { startupCatchUp().catch(() => {}); }, 8000);

  // y revisa cada 30 min por si dejan la app abierta hasta la hora programada
  timer = setInterval(() => { tick().catch(() => {}); }, 30 * 60 * 1000);
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  loadBackupConfig,
  saveBackupConfig,
  runBackup,
  listBackups,
  startScheduler,
  stopScheduler,
  esHost,
  servidorEsLocal,
  conexionPrivilegiadaLocal,
  conexionDeLaApp
};