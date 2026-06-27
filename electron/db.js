const sql = require('mssql/msnodesqlv8');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

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

const defaultConfig = {
  server: buildServerName(process.env.DB_HOST, process.env.DB_INSTANCE),
  database: process.env.DB_NAME || '',
  options: {
    trustedConnection: true,
    encrypt: String(process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true',
    trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERT || 'true').toLowerCase() === 'true',
    enableArithAbort: true
  },
  // Resiliencia: configurable por cliente
  retry: {
    maxAttempts: Number(process.env.DB_RETRY_ATTEMPTS || 20),
    delayMs: Number(process.env.DB_RETRY_DELAY_MS || 3000)
  }
};

function loadConfig() {
  const configPath = getConfigPath();

  try {
    if (fs.existsSync(configPath)) {
      const userCfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      const merged = {
        ...defaultConfig,
        ...userCfg,
        server: userCfg.server || defaultConfig.server,
        database: userCfg.database || defaultConfig.database,
        options: { ...defaultConfig.options, ...(userCfg.options || {}), trustedConnection: true },
        retry: { ...defaultConfig.retry, ...(userCfg.retry || {}) }
      };

      delete merged.user;
      delete merged.password;

      fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
      console.log('[DB] Configuracion cargada desde:', configPath);
      return merged;
    }

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log('[DB] Archivo de configuracion creado en:', configPath);
    return defaultConfig;
  } catch (err) {
    console.error('[DB] Error cargando configuracion:', err);
    try { if (fs.existsSync(configPath)) fs.renameSync(configPath, `${configPath}.bak`); } catch { /* noop */ }
    return defaultConfig;
  }
}

const dbConfig = loadConfig();

// mssql no conoce la clave "retry": la separamos del config del pool
const { retry, ...poolConfig } = dbConfig;

// ============================================================
// Estado de conexion (observable para la UI)
// ============================================================

let pool = null;
let connecting = null;        // promesa en curso, evita conexiones duplicadas
let listeners = [];

const STATE = { status: 'disconnected', error: null, attempts: 0 };

function getState() {
  return { ...STATE, server: poolConfig.server, database: poolConfig.database };
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

function isHealthy(p) {
  return !!p && p.connected === true;
}

// ============================================================
// Conexion con reintento
// ============================================================

async function connectWithRetry() {
  if (!poolConfig.database) {
    setState('error', { error: 'No hay base de datos configurada en db-config.json.' });
    throw new Error('No hay base de datos configurada (database vacio en db-config.json).');
  }

  const maxAttempts = Number(retry.maxAttempts) || 20;
  const delayMs = Number(retry.delayMs) || 3000;

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
      console.log(`[DB] Conectado. Server: ${poolConfig.server} DB: ${poolConfig.database}`);
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

// Punto de entrada principal: siempre devuelve un pool sano (reconecta si hace falta)
async function getPool() {
  if (isHealthy(pool)) return pool;
  if (connecting) return connecting;

  connecting = connectWithRetry().finally(() => { connecting = null; });
  return connecting;
}

// Fuerza un nuevo intento (para el boton "Reintentar" de la UI)
async function reconnect() {
  pool = null;
  return getPool();
}

// ============================================================
// Exports
// ============================================================
// getPool() es lo recomendado (reconecta solo). poolPromise se mantiene como
// getter para compatibilidad con el codigo existente.

const api = { sql, getPool, reconnect, getState, onStateChange };

Object.defineProperty(api, 'poolPromise', {
  enumerable: true,
  get() { return getPool(); }
});

module.exports = api;