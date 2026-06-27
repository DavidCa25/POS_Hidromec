const path = require('path');
const fs = require('fs');
const { app, shell } = require('electron');
const log = require('electron-log');

function pad(n) { return String(n).padStart(2, '0'); }

function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function logsDir() {
  return path.join(app.getPath('userData'), 'logs');
}

function currentLogPath() {
  return path.join(logsDir(), `pos-${dateStr()}.log`);
}

function setupLogging({ retentionDays = 14 } = {}) {
  if (log.transports.file.resolvePathFn) {
    log.transports.file.resolvePathFn = () => currentLogPath();
  } else {
    log.transports.file.resolvePath = () => currentLogPath();
  }

  log.transports.file.level = 'info';
  log.transports.console.level = 'debug';
  log.transports.file.maxSize = 10 * 1024 * 1024; // tope de seguridad por archivo
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

  try {
    if (log.errorHandler && log.errorHandler.startCatching) {
      log.errorHandler.startCatching({ showDialog: false });
    } else if (typeof log.catchErrors === 'function') {
      log.catchErrors({ showDialog: false });
    }
  } catch (e) {
    log.warn('No se pudo activar la captura de errores:', e.message);
  }

  console.log = log.log.bind(log);
  console.info = (log.info || log.log).bind(log);
  console.warn = (log.warn || log.log).bind(log);
  console.error = (log.error || log.log).bind(log);
  console.debug = (log.debug || log.log).bind(log);

  cleanupOldLogs(retentionDays);

  log.info('==== App iniciada ====', 'v' + app.getVersion());
}

function cleanupOldLogs(retentionDays) {
  try {
    const dir = logsDir();
    if (!fs.existsSync(dir)) return;
    const cutoff = Date.now() - (Number(retentionDays) || 14) * 86400000;

    for (const name of fs.readdirSync(dir)) {
      if (!name.toLowerCase().endsWith('.log')) continue;
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoff) fs.unlinkSync(full);
      } catch { /* noop */ }
    }
  } catch (e) {
    log.warn('No se pudieron limpiar logs viejos:', e.message);
  }
}

function logFromRenderer({ level = 'info', message = '', meta = null } = {}) {
  const fn = log[level] || log.info;
  if (meta) fn('[RENDERER]', message, meta);
  else fn('[RENDERER]', message);
}

function openLogsFolder() {
  const dir = logsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
}

function logsInfo() {
  const p = currentLogPath();
  let sizeMB = 0;
  try { if (fs.existsSync(p)) sizeMB = +(fs.statSync(p).size / 1048576).toFixed(2); } catch { /* noop */ }
  return { path: p, sizeMB, dir: logsDir() };
}

module.exports = { setupLogging, logFromRenderer, openLogsFolder, logsInfo, currentLogPath, logsDir };