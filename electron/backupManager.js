// backupManager.js
// Respaldos automaticos de SQL Server desde el proceso principal.
// No depende del Programador de Tareas de Windows: usa la conexion de la app
// y un catch-up al arranque para cubrir las noches con la tienda cerrada.

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { poolPromise } = require('./db');

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
  try {
    ensureFolder(cfg.folder);

    const dbName = await getDbName();
    const file = path.join(cfg.folder, `${dbName}_${stamp()}.bak`);

    // El BACKUP lo ejecuta el servicio de SQL Server: la carpeta debe ser escribible por ese servicio
    const pool = await poolPromise;
    const q = `BACKUP DATABASE [${dbName}] TO DISK = N'${escSql(file)}' WITH INIT, STATS = 5;`;
    await pool.request().query(q);

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
    saveBackupConfig({ lastStatus: 'error', lastError: err.message, lastAttemptAt: new Date().toISOString() });
    console.error('[BACKUP] error:', err);
    return { success: false, error: err.message };
  } finally {
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
  stopScheduler
};