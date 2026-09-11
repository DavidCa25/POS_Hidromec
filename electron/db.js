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

// La gramatica de un servidor de SQL Server vive en UN solo sitio. Antes
// estaba repartida entre este archivo, lib/host.js, lib/red-principal.js y el
// asistente, y esa dispersion es como se llego a guardar
// `192.168.100.211\SQLEXPRESS\SQLEXPRESS` sin que nada protestara.
const { componerServidor, validarServidor } = require('./lib/servidor-sql');

function buildServerName(host, instance) {
  return componerServidor(String(host || 'localhost').trim(), instance);
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
    /* UN INTENTO TIENE QUE TERMINAR.
       `setupServer.js` pone `connectionTimeout: 6000` en todas sus conexiones;
       esta, la que usa la aplicacion entera, no ponia ninguna. Con el driver
       nativo `msnodesqlv8` eso significa que `connect()` puede quedarse
       esperando sin final y sin error: ni conecta, ni falla, ni reintenta.
       Un arranque que se queda en silencio es peor que uno que falla. */
    connectionTimeout: Number(cfg.connectionTimeoutMs) || 8000,
    requestTimeout: Number(cfg.requestTimeoutMs) || 30000,
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

/**
 * Generacion de la configuracion.
 *
 * `connectWithRetry` lee la configuracion UNA vez y despues reintenta hasta 20
 * veces con 3 segundos entre medias: un minuto entero atado a la configuracion
 * que habia cuando empezo. Si durante ese minuto alguien la cambia -y eso es
 * exactamente lo que hace el asistente al dar de alta una caja secundaria-,
 * el bucle sigue intentando con la vieja, y `reconnect()` le devolvia ese
 * mismo bucle al que acababa de guardar la buena.
 *
 * Cada cambio de configuracion incrementa este numero. El bucle en vuelo lo
 * comprueba entre intentos y se retira; `getPool()` no reparte intentos de una
 * generacion anterior. Asi "guarde configuracion nueva" significa siempre
 * "conexion nueva", y nunca "espera a que termine la anterior".
 */
let generacion = 0;

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

/**
 * Una promesa con fecha limite.
 *
 * Existe por el driver nativo: cuando `msnodesqlv8` se queda dentro de su
 * propio codigo, ningun temporizador de mssql lo saca de ahi. Sin este tope,
 * el arranque se quedaba esperando para siempre, sin conectar, sin fallar y
 * sin escribir una linea.
 *
 * El temporizador se limpia siempre: dejarlo vivo mantendria despierto al
 * proceso despues de cerrar la ventana.
 */
function conTope(promesa, ms, mensaje) {
  let reloj = null;
  const limite = new Promise((_, rechazar) => {
    reloj = setTimeout(() => {
      const e = new Error(mensaje);
      e.porTiempo = true;
      rechazar(e);
    }, ms);
    if (typeof reloj.unref === 'function') reloj.unref();
  });
  return Promise.race([promesa, limite]).finally(() => { if (reloj) clearTimeout(reloj); });
}


async function connectWithRetry(miGeneracion) {
  const { poolConfig, retry } = resolvePoolConfig();

  if (!poolConfig.database) {
    setState('error', { error: 'No hay base de datos configurada en db-config.json.' });
    throw new Error('No hay base de datos configurada (database vacio en db-config.json).');
  }

  /* ANTES del bucle, no dentro.
     Una cadena de servidor rota no mejora esperando tres segundos veinte
     veces. Cuando el asistente guardo `192.168.100.211\SQLEXPRESS\SQLEXPRESS`,
     esto es lo que vivio la persona: un minuto entero de reintentos para
     terminar leyendo "verifica la IP y el firewall", con la IP y el firewall
     perfectos. El error tiene que llegar al instante y decir que esta mal en
     la cadena, no que revise la red. */
  const forma = validarServidor(poolConfig.server);
  if (!forma.ok) {
    const msg = `La direccion del servidor guardada no es valida: ${forma.error}`;
    setState('error', { error: msg });
    throw new Error(msg);
  }

  const maxAttempts = Number(retry?.maxAttempts) || 20;
  const delayMs = Number(retry?.delayMs) || 3000;
  let ultimoError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // La configuracion cambio mientras se reintentaba: este bucle ya no sirve
    // para nada y seguir gastaria un minuto contra un servidor que ya nadie
    // pidio. Se retira en silencio; quien cambio la configuracion ya arranco
    // el bucle nuevo.
    if (miGeneracion !== generacion) {
      const e = new Error('Configuracion de conexion sustituida mientras se reintentaba.');
      e.generacionObsoleta = true;
      throw e;
    }

    setState('connecting', { attempts: attempt, error: null });

    /* SE ANUNCIA ANTES DE INTENTAR, NO SOLO AL FALLAR.
       El unico `[DB] Intento n/N` que existia estaba dentro del `catch`. Un
       intento que ni conecta ni falla no imprimia absolutamente nada, y el
       registro se cortaba en seco: eso es lo que vio QA en la laptop, dos
       lineas y silencio. Ahora el registro dice siempre donde esta. */
    console.log(`[DB] Intento ${attempt}/${maxAttempts}: conectando a ${poolConfig.server} / ${poolConfig.database} (${poolConfig.options.trustedConnection ? 'windows' : 'sql:' + poolConfig.user})`);

    const p = new sql.ConnectionPool(poolConfig);
    try {
      p.on('error', (err) => {
        console.error('[DB] Error en el pool:', err.message);
        if (pool === p) pool = null;
        setState('disconnected', { error: err.message });
      });

      /* El tope de JavaScript va ADEMAS del `connectionTimeout` del driver.
         `connectionTimeout` lo respeta la capa de mssql, pero quien abre el
         socket es una libreria nativa: si se queda dentro del codigo nativo,
         no hay temporizador de mssql que la despierte. Este `race` es lo que
         garantiza que un intento SIEMPRE termina, conecte o no. */
      await conTope(p.connect(), (poolConfig.connectionTimeout || 8000) + 4000,
        `El servidor ${poolConfig.server} no respondio a tiempo.`);
      // Conectar tarda; en ese hueco la configuracion pudo cambiar. Publicar
      // este pool ahora dejaria a la caja conectada al servidor ANTERIOR
      // creyendo que esta al dia.
      if (miGeneracion !== generacion) {
        try { await p.close(); } catch { /* noop */ }
        const e = new Error('Configuracion de conexion sustituida mientras se conectaba.');
        e.generacionObsoleta = true;
        throw e;
      }
      pool = p;
      setState('connected', { error: null });
      console.log(`[DB] Conectado. Server: ${poolConfig.server} DB: ${poolConfig.database} Auth: ${poolConfig.options.trustedConnection ? 'windows' : 'sql'}`);
      return pool;
    } catch (err) {
      if (err?.generacionObsoleta) throw err;   // no es un fallo: es un relevo
      console.error(`[DB] Intento ${attempt}/${maxAttempts} fallo:`, err.message);
      ultimoError = err;
      try { await p.close(); } catch { /* noop */ }
      setState('connecting', { attempts: attempt, error: err.message });
      if (attempt < maxAttempts) await sleep(delayMs);
    }
  }

  /* El motivo REAL, no "se intento 20 veces".
     Antes el ultimo error se perdia y quien leia el registro tenia que ir a
     buscar la linea del primer intento. Ahora viaja en el mensaje y la causa
     original queda encadenada para que el `stack` la conserve. */
  const motivo = ultimoError ? ultimoError.message : 'sin detalle';
  setState('error', { error: motivo });
  const e = new Error(
    `No se pudo conectar a ${poolConfig.server} / ${poolConfig.database} tras ${maxAttempts} intentos: ${motivo}`);
  if (ultimoError) e.cause = ultimoError;
  throw e;
}

/**
 * La conexion. UNA, compartida, creada solo cuando de verdad se necesita.
 *
 * `connecting` es un "single-flight": mil llamadas concurrentes comparten un
 * solo intento y un solo bucle de reintentos. Lo que se le anade es la
 * generacion: un intento en vuelo que nacio con otra configuracion ya no se
 * reparte, se descarta y se arranca uno nuevo.
 *
 * Nunca queda cacheada una promesa rechazada: `connecting` se limpia cuando el
 * intento termina, del modo que termine. Ese era el nucleo del fallo -una
 * promesa rechazada al cargar el modulo quedaba guardada para siempre-, asi
 * que aqui no se guarda ningun resultado, solo el intento EN CURSO.
 */
async function getPool() {
  if (isHealthy(pool)) return pool;

  if (connecting && connecting.generacion === generacion) return connecting.promesa;

  const mia = generacion;
  const promesa = connectWithRetry(mia).finally(() => {
    // Solo se limpia si sigue siendo el intento vigente: uno viejo que termina
    // tarde no puede borrar el que lo sustituyo.
    if (connecting && connecting.promesa === promesa) connecting = null;
  });
  connecting = { generacion: mia, promesa };
  return promesa;
}

/**
 * Tira lo que haya y empieza de cero con la configuracion actual.
 *
 * Incrementar la generacion ANTES de nada es lo que hace determinista al
 * asistente: a partir de esta linea, cualquier intento anterior queda
 * invalidado y `getPool()` no puede devolverlo. Antes, `reconnect()` podia
 * entregar un bucle que llevaba medio minuto intentando con la configuracion
 * vieja, y el asistente concluia "no se pudo conectar con la computadora
 * principal" con la configuracion nueva ya guardada y correcta.
 */
async function reconnect() {
  generacion++;
  connecting = null;
  const anterior = pool;
  pool = null;
  try { if (anterior) await anterior.close(); } catch { /* noop */ }
  return getPool();
}

/**
 * ¿Hay configuracion utilizable en disco?
 *
 * Para que quien arranca pueda decidir SIN conectarse. Antes de la primera
 * instalacion no hay base que valga, y preguntar por el pool solo servia para
 * fabricar un error que no le importaba a nadie.
 */
function hayConfiguracion() {
  try {
    if (!fs.existsSync(getConfigPath())) return false;
    const cfg = loadConfig();
    return !!String(cfg.database || '').trim() && validarServidor(cfg.server).ok;
  } catch {
    return false;
  }
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

  // Validar ANTES de escribir el archivo: una cadena rota guardada en disco
  // sobrevive al reinicio y deja la caja sin arrancar. Se rechaza aqui, con la
  // configuracion anterior intacta.
  const forma = validarServidor(merged.server);
  if (!forma.ok) return { success: false, error: forma.error };

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

const api = {
  sql, getPool, reconnect, getState, onStateChange,
  getConnectionConfig, setConnectionConfig, hayConfiguracion,
};

/**
 * `poolPromise` NO es una promesa: es un "thenable".
 *
 * AQUI ESTABA EL FALLO
 * --------------------
 * Antes era una propiedad con getter:
 *
 *     Object.defineProperty(api, 'poolPromise', { get() { return getPool(); } });
 *
 * y tres modulos la DESESTRUCTURAN al cargarse:
 *
 *     electron/main.js:4          const { poolPromise, sql } = require('./db');
 *     electron/backupManager.js   const { poolPromise } = require('./db');
 *     electron/cloudSync.js       const { poolPromise, sql } = require('./db');
 *
 * Desestructurar LEE la propiedad, y leerla ejecutaba el getter. Es decir: la
 * aplicacion se conectaba a la base en el instante de cargar el modulo,
 * antes de que existiera `db-config.json`, antes del asistente y antes de
 * saber siquiera si esta maquina ya estaba instalada.
 *
 * Con la configuracion por defecto `database` viene vacio, asi que ese intento
 * rechazaba de inmediato... y la promesa RECHAZADA quedaba guardada en la
 * constante `poolPromise` de cada modulo, para toda la vida del proceso. Los
 * 104 `await poolPromise` de main.js volvian a lanzar ese mismo error viejo
 * aunque la conexion real ya estuviera establecida. De ahi el mensaje
 * imposible del QA:
 *
 *     [DB] Conectado. Server: 192.168.100.211\SQLEXPRESS DB: Wybix_POS
 *     setup-run: Error: No hay base de datos configurada (database vacio)
 *
 * Las dos lineas eran ciertas a la vez: la primera la decia una conexion
 * nueva, la segunda una promesa rechazada hace rato. Y como al cargar el
 * modulo nadie la esperaba todavia, ademas era una unhandled rejection, que
 * en Node 20 tumba el proceso.
 *
 * POR QUE UN THENABLE Y NO UNA FUNCION
 * ------------------------------------
 * `await` de un objeto con `then` llama a `then` EN ESE MOMENTO. Asi
 * desestructurar deja de conectar -solo copia un objeto- y cada
 * `await poolPromise` pide la conexion cuando de verdad la va a usar, ya con
 * la configuracion buena. Los 104 sitios que hacen `await poolPromise` siguen
 * escritos igual: el arreglo esta en la naturaleza del valor, no en cada uso.
 */
api.poolPromise = Object.freeze({
  then(alCumplir, alFallar) { return getPool().then(alCumplir, alFallar); },
  catch(alFallar) { return getPool().catch(alFallar); },
  finally(alFinal) { return getPool().finally(alFinal); },
});

module.exports = api;