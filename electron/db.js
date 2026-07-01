const sql = require('mssql/msnodesqlv8');
const path = require('path');
const fs = require('fs');
const { app, safeStorage } = require('electron');

// ============================================================
// Configuracion
// ============================================================

function getConfigPath() {
  return path.join(app.getPath('userData'), 'db-config.json');
}

function buildServerName(host, instance) {
  const h = String(host || 'localhost').trim();
  const inst = String(instance || '').trim();
  return inst ? `${h}\\${inst}` : h;
}

// auth: 'windows' (principal) o 'sql' (cajas secundarias por red).
const defaultConfig = {
  server: buildServerName(process.env.DB_HOST, process.env.DB_INSTANCE),
  database: process.env.DB_NAME || '',
  auth: process.env.DB_AUTH || 'windows',
  user: process.env.DB_USER || 'ocus_app',
  options: {
    encrypt: String(process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true',
    trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERT || 'true').toLowerCase() === 'true',
    enableArithAbort: true
  },
  retry: {
    maxAttempts: Number(process.env.DB_RETRY_ATTEMPTS || 20),
    delayMs: Number(process.env.DB_RETRY_DELAY_MS || 3000)
  }
};

function writeConfigFile(obj) {
  const p = getConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function loadConfig() {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const userCfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return {
        ...defaultConfig,
        ...userCfg,
        server: userCfg.server || defaultConfig.server,
        database: userCfg.database || defaultConfig.database,
        auth: userCfg.auth || defaultConfig.auth,
        user: userCfg.user || defaultConfig.user,
        options: { ...defaultConfig.options, ...(userCfg.options || {}) },
        retry: { ...defaultConfig.retry, ...(userCfg.retry || {}) }
      };
    }
    writeConfigFile(defaultConfig);
    console.log('[DB] Archivo de configuracion creado en:', configPath);
    return { ...defaultConfig };
  } catch (err) {
    console.error('[DB] Error cargando configuracion:', err);
    try { if (fs.existsSync(configPath)) fs.renameSync(configPath, `${configPath}.bak`); } catch { /* noop */ }
    return { ...defaultConfig };
  }
}

// Cifrado de la contraseña (SQL Auth) con el almacen del SO

function encryptSecret(plain) {
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return { enc: safeStorage.encryptString(String(plain)).toString('base64'), method: 'safeStorage' };
    }
  } catch (e) {
    console.error('[DB] safeStorage no disponible:', e.message);
  }
  // Fallback: base64 (ofuscacion, no es cifrado real). Mejor que texto plano.
  return { enc: Buffer.from(String(plain), 'utf8').toString('base64'), method: 'base64' };
}

function decryptSecret(b64, method) {
  if (!b64) return '';
  try {
    if (method === 'safeStorage' && safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(b64, 'base64'));
    }
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch (e) {
    console.error('[DB] No se pudo descifrar la contrasena:', e.message);
    return '';
  }
}

// Resolver el config real del pool segun el modo de auth

function resolvePoolConfig() {
  const cfg = loadConfig();

  const base = {
    server: cfg.server,
    database: cfg.database,
    options: {
      encrypt: cfg.options?.encrypt ?? false,
      trustServerCertificate: cfg.options?.trustServerCertificate ?? true,
      enableArithAbort: true
    }
  };

  if ((cfg.auth || 'windows') === 'sql') {
    base.options.trustedConnection = false;
    base.user = cfg.user || 'ocus_app';

    if (cfg.password) {
      const { enc, method } = encryptSecret(cfg.password);
      const persisted = { ...cfg };
      delete persisted.password;
      persisted.passwordEnc = enc;
      persisted.passwordEncMethod = method;
      writeConfigFile(persisted);
      base.password = cfg.password;
    } else {
      base.password = decryptSecret(cfg.passwordEnc, cfg.passwordEncMethod);
    }
  } else {
    base.options.trustedConnection = true;
  }

  return { poolConfig: base, retry: cfg.retry };
}

let pool = null;
let connecting = null;
let listeners = [];

const STATE = { status: 'disconnected', error: null, attempts: 0 };

function getState() {
  const cfg = loadConfig();
  return { ...STATE, server: cfg.server, database: cfg.database, auth: cfg.auth };
}

function onStateChange(cb) {
  if (typeof cb === 'function') listeners.push(cb);
  return () => { listeners = listeners.filter(l => l !== cb); };
}

function setState(status, extra = {}) {
  STATE.status = status;
  Object.assign(STATE, extra);
  const snapshot = getState();
  for (const cb of listeners) { try { cb(snapshot); } catch { /* noop */ } }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function isHealthy(p) { return !!p && p.connected === true; }


async function connectWithRetry() {
  const { poolConfig, retry } = resolvePoolConfig();

  if (!poolConfig.database) {
    setState('error', { error: 'No hay base de datos configurada en db-config.json.' });
    throw new Error('No hay base de datos configurada (database vacio en db-config.json).');
  }

  const maxAttempts = Number(retry?.maxAttempts) || 20;
  const delayMs = Number(retry?.delayMs) || 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    setState('connecting', { attempts: attempt, error: null });

    const p = new sql.ConnectionPool(poolConfig);
    try {
      p.on('error', (err) => {
        console.error('[DB] Error en el pool:', err.message);
        if (pool === p) pool = null;
        setState('disconnected', { error: err.message });
      });

      await p.connect();
      pool = p;
      setState('connected', { error: null });
      console.log(`[DB] Conectado. Server: ${poolConfig.server} DB: ${poolConfig.database} Auth: ${poolConfig.options.trustedConnection ? 'windows' : 'sql'}`);
      return pool;
    } catch (err) {
      console.error(`[DB] Intento ${attempt}/${maxAttempts} fallo:`, err.message);
      try { await p.close(); } catch { /* noop */ }
      setState('connecting', { attempts: attempt, error: err.message });
      if (attempt < maxAttempts) await sleep(delayMs);
    }
  }

  setState('error', { error: 'No se pudo conectar tras varios intentos.' });
  throw new Error(`No se pudo conectar a SQL Server tras ${maxAttempts} intentos.`);
}

async function getPool() {
  if (isHealthy(pool)) return pool;
  if (connecting) return connecting;
  connecting = connectWithRetry().finally(() => { connecting = null; });
  return connecting;
}

async function reconnect() {
  try { if (pool) await pool.close(); } catch { /* noop */ }
  pool = null;
  return getPool();
}

function getConnectionConfig() {
  const cfg = loadConfig();
  return {
    server: cfg.server,
    database: cfg.database,
    auth: cfg.auth || 'windows',
    user: cfg.user || 'ocus_app',
    hasPassword: !!(cfg.passwordEnc || cfg.password)
  };
}

async function setConnectionConfig(partial = {}) {
  const cfg = loadConfig();
  const merged = { ...cfg, ...partial };
  if (partial.options) merged.options = { ...cfg.options, ...partial.options };

  if (partial.password) {
    const { enc, method } = encryptSecret(partial.password);
    merged.passwordEnc = enc;
    merged.passwordEncMethod = method;
  }
  delete merged.password; // nunca en claro

  writeConfigFile(merged);
  await reconnect();
  return { success: true };
}

// ============================================================
// Exports
// ============================================================

const api = { sql, getPool, reconnect, getState, onStateChange, getConnectionConfig, setConnectionConfig };

Object.defineProperty(api, 'poolPromise', {
  enumerable: true,
  get() { return getPool(); }
});

module.exports = api;