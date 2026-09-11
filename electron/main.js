const { app, BrowserWindow, ipcMain, shell, dialog, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { poolPromise, sql } = require('./db');
const { generateSaleA4Pdf } = require('./pdf/generateSaleA4Pdf');
const { generateSalesBatchA4Pdf } = require('./pdf/generateSalesBatchA4Pdf');
const { htmlToPdf } = require('./pdf/printToPdfElectron');
const { construirTicketHtml } = require('./lib/ticket');
const { construirHuella } = require('./lib/huella');
const { autoUpdater } = require('electron-updater');
const { listSerialPorts, startSerialScanner, stopSerialScanner } = require('./scanner');
const { runMigrations } = require('./migrationsRunner');
const ipcHospitality = require('./ipc/hospitality');
const ipcLoyalty = require('./ipc/loyalty');
const { verificarObjetosCriticos } = require('./verificarObjetos');
const mpPoint  = require('./mercadoPoint');
const backup = require('./backupManager');
const logger = require('./logger');
const db = require('./db');
const DB_NAME = 'Wybix_POS';
const setupServer = require('./setupServer');
const cloudSync = require('./cloudSync');
const licenseStore = require('./license');
const cajaArrendada = require('./cajaArrendada');
const { normalizarServidor } = require('./lib/servidor-sql');
const arranque = require('./arranque');
const redMulticaja = require('./redMulticaja');
const { sellarComoPrueba } = require('./lib/licencia-prueba');
const { execSync } = require('child_process');
const crypto = require('crypto');
const os = require('os');

//Casillas_2512_19

logger.setupLogging({ retentionDays: 14 });

/**
 * Una promesa rechazada que nadie esperaba NO puede tumbar la caja.
 *
 * En Node 20 -el que trae Electron 37- una unhandled rejection termina el
 * proceso. Durante la instalacion de una caja secundaria eso significaba que
 * un intento de conexion fallido, que ni siquiera formaba parte del flujo del
 * asistente, cerraba Wybix entera delante del cliente.
 *
 * La causa concreta ya no existe (ver `poolPromise` en db.js), pero esta red
 * queda puesta: un fallo suelto se anota y se sigue. Cerrar el punto de venta
 * porque una promesa quedo suelta nunca es la respuesta correcta; lo que hay
 * que poder hacer es leer el registro y arreglarlo.
 */
process.on('unhandledRejection', (motivo) => {
  const detalle = motivo instanceof Error ? (motivo.stack || motivo.message) : String(motivo);
  console.error('[PROCESO] Promesa rechazada sin manejar:', detalle);
});

// IPC del dominio Hospitality (recetas, modificadores, presentaciones,
// catalogo Touch e imagenes). Vive en su propio modulo: main.js ya tiene
// 158 handlers y no debe crecer sin orden.
ipcHospitality.registrar({ ipcMain, sql, poolPromise, nativeImage });

// IPC del dominio Fidelizacion (campanas, recompensas, cupones, dinamicas y
// rifas). `machineId` se pasa como funcion, no como valor: al cargar este
// modulo la huella todavia no esta construida.
ipcLoyalty.registrar({ ipcMain, sql, poolPromise, machineId: () => machineIdDeEsteEquipo() });

const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';

const SUPABASE_URL = 'https://swlpspgmkwzlrowllvvj.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3bHBzcGdta3d6bHJvd2xsdnZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNDMyNzAsImV4cCI6MjA5ODYxOTI3MH0.Wyh4fjmhYJp-USPHtrj_dKAJow038Nj62jR44qirmlM';

let businessConfig = null;

let updateCheckTimer = null;
let mainWindow = null;
let setupWindow = null;

function escSqlString(s) {
  return String(s ?? '').replace(/'/g, "''");
}

function safeSqlBackupDir() {
  return process.env.SQL_BACKUP_DIR || 'C:\\POS_Backups';
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function getCurrentDbName() {
  const pool = await poolPromise;
  return pool?.config?.database || DB_NAME;
}

async function runOnMaster(fn) {
  const poolDb = await poolPromise;
  const baseCfg = poolDb.config; 
  const masterPool = await new sql.ConnectionPool({ ...baseCfg, database: 'master' }).connect();
  try {
    return await fn(masterPool);
  } finally {
    try { await masterPool.close(); } catch {}
  }
}

function buildDrawerKickCmd({ pulseMs = 120, pin = 0 } = {}) {
  const t = Math.max(1, Math.min(255, Math.round((Number(pulseMs) || 120) / 2)));
  return Buffer.from([0x1B, 0x70, pin ? 0x01 : 0x00, t, t]);
}

function getInstallConfigPath() {
  return path.join(app.getPath('userData'), 'install-config.json');
}

function loadInstallConfig() {
  const p = getInstallConfigPath();
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('Error leyendo install-config.json:', e);
  }
  return null;
}

function saveInstallConfig(cfg) {
  fs.writeFileSync(getInstallConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

function obtenerSerialDisco() {
  try {
    const out = execSync('wmic diskdrive get serialnumber', { encoding: 'utf8', timeout: 4000 });
    const lineas = out.split('\n').map(l => l.trim()).filter(l => l && l !== 'SerialNumber');
    return lineas[0] || '';
  } catch {
    return '';
  }
}

function obtenerUuidPlaca() {
  try {
    const out = execSync('wmic csproduct get uuid', { encoding: 'utf8', timeout: 4000 });
    const lineas = out.split('\n').map(l => l.trim()).filter(l => l && l !== 'UUID');
    return lineas[0] || '';
  } catch {
    return '';
  }
}
 
/**
 * TODOS los seriales de disco, no solo el primero.
 *
 * `wmic diskdrive` no garantiza el orden: agregar un disco podia cambiar cual
 * salia primero y, con el, la huella entera.
 */
function obtenerSerialesDisco() {
  try {
    const out = execSync('wmic diskdrive get serialnumber', { encoding: 'utf8', timeout: 4000 });
    return out.split(/\r?\n/).map(l => l.trim()).filter(l => l && l !== 'SerialNumber');
  } catch {
    return [];
  }
}

/**
 * Direcciones MAC fisicas.
 *
 * Es la unica senal de identidad que NO pasa por WMI, y por eso es la que
 * sostiene el caso "wmic no respondio al arrancar". No se filtran las de
 * adaptadores virtuales: en una caja con VPN o con una maquina virtual
 * instalada seguirian siendo estables, y descartarlas dejaria sin senal a los
 * equipos donde son las unicas.
 */
function obtenerMacs() {
  try {
    const ifaces = os.networkInterfaces() || {};
    const macs = [];
    for (const nombre of Object.keys(ifaces)) {
      for (const dir of ifaces[nombre] || []) {
        if (dir.internal) continue;
        const m = String(dir.mac || '').trim();
        if (m && m !== '00:00:00:00:00:00') macs.push(m);
      }
    }
    return macs;
  } catch {
    return [];
  }
}

/** Senales crudas del equipo, para construir la huella. */
function senalesDeEquipo() {
  return {
    uuid: obtenerUuidPlaca(),
    discos: obtenerSerialesDisco(),
    macs: obtenerMacs(),
    host: os.hostname(),
    plat: os.platform(),
    arch: os.arch(),
  };
}

/**
 * machineId v1: el identificador HISTORICO, el que ya conoce el servidor de
 * activacion de los clientes dados de alta. No se cambia su formula: cambiarla
 * dejaria a esos clientes sin poder revalidar.
 *
 * Se conserva como identificador REPORTADO. Lo que dejo de hacer es decidir si
 * la licencia se puede leer: de eso se encarga ahora la huella.
 */
function generarMachineId() {
  const partes = [
    obtenerUuidPlaca(),
    obtenerSerialDisco(),
    os.hostname(),
    os.platform(),
    os.arch()
  ].filter(Boolean).join('|');
 
  return crypto.createHash('sha256').update(partes).digest('hex').slice(0, 32);
}

/**
 * Las variantes ENUMERABLES del machineId v1 cuando WMI viene incompleto.
 *
 * `.filter(Boolean)` descartaba las partes vacias, asi que un `wmic` caido
 * producia un hash distinto en silencio y la licencia ya no abria. Las
 * combinaciones posibles son pocas -con o sin uuid, con o sin disco- y
 * probarlas recupera exactamente ese caso sin debilitar nada: si ninguna
 * abre el archivo, la licencia sigue sin leerse.
 *
 * El hostname NO se puede enumerar: no hay forma de saber cual era. Ese caso
 * -equipo renombrado ANTES de esta version- se resuelve reactivando.
 */
function candidatosMachineIdV1() {
  const uuid = obtenerUuidPlaca();
  const disco = obtenerSerialDisco();
  const host = os.hostname();
  const fijo = [os.platform(), os.arch()];
  const combinaciones = [
    [uuid, disco, host, ...fijo],
    [disco, host, ...fijo],
    [uuid, host, ...fijo],
    [host, ...fijo],
  ];
  return [...new Set(combinaciones.map(partes =>
    crypto.createHash('sha256').update(partes.filter(Boolean).join('|')).digest('hex').slice(0, 32)
  ))];
}

/** Contexto que espera electron/license.js. */
function contextoLicencia() {
  if (!cachedMachineId) cachedMachineId = generarMachineId();
  return {
    machineIdV1: cachedMachineId,
    candidatosV1: candidatosMachineIdV1(),
    huella: construirHuella(senalesDeEquipo()),
  };
}

/**
 * La identidad de ESTA maquina, estable.
 *
 * Es la misma que reporta la licencia: el identificador que quedo SELLADO la
 * primera vez, no uno recalculado en cada arranque. Renombrar el equipo, o un
 * fallo temporal de WMI, no deben cambiarlo -ese fue justo el defecto que
 * dejaba licencias ilegibles-, y aqui importa por la misma razon: una caja no
 * puede perderse porque alguien renombro la PC.
 *
 * Si la licencia todavia no existe -durante la prueba, antes de activar- cae
 * al machineId v1 calculado, que es lo que habia antes y sirve igual para
 * distinguir dos equipos entre si.
 */
function machineIdDeEsteEquipo() {
  try {
    const id = licenseStore.machineIdEstable(contextoLicencia());
    if (id) return id;
  } catch { /* sin licencia todavia */ }
  if (!cachedMachineId) cachedMachineId = generarMachineId();
  return cachedMachineId;
}

function getLicensePath() {
  return path.join(app.getPath('userData'), 'license.json');
}

let cachedMachineId = null;

function createSetupWindow() {
  const win = new BrowserWindow({
    width: 640,
    height: 640,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'setup/setup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, 'setup/setup-wizard.html'));
  return win;
}

async function bootMainApp(poolYaAbierto) {
  // El pool llega del paso "conectar" del arranque. Se acepta tambien sin
  // argumento porque `setup-run` llama aqui despues de dar de alta la
  // instalacion, y ahi la conexion ya quedo establecida igualmente.
  const pool = poolYaAbierto || await poolPromise;
  const migrationsDir = isDev
    ? path.join(__dirname, 'migrations')
    : path.join(process.resourcesPath, 'migrations');

  const mig = await runMigrations({ pool, sql, migrationsDir });
  console.log('Migraciones:', mig);

  // Comprobacion de presencia de los objetos SQL criticos, DESPUES de aplicar
  // las migraciones. Antes de esto, a una instalacion podia faltarle un
  // procedure durante meses: cada pantalla fallaba por su cuenta y parecia un
  // problema de datos. Ahora se detecta al arrancar y se dice cual falta.
  try {
    const chequeo = await verificarObjetosCriticos(pool);
    if (chequeo.sinLista) {
      console.warn('[OBJETOS] Sin lista de objetos criticos: no se verifico nada.');
    } else if (!chequeo.ok) {
      const detalle = chequeo.faltantes.join(', ');
      console.error(`[OBJETOS] Faltan ${chequeo.faltantes.length} objetos criticos: ${detalle}`);
      dialog.showErrorBox(
        'Instalacion incompleta',
        'A esta base de datos le faltan objetos que Wybix necesita para operar:\n\n' +
        chequeo.faltantes.map(n => `  · ${n}`).join('\n') +
        '\n\nNo se puede continuar de forma segura. Contacta a soporte con este mensaje.',
      );
      app.quit();
      return;
    } else {
      console.log(`[OBJETOS] ${chequeo.comprobados} objetos criticos presentes.`);
    }
  } catch (e) {
    // Un fallo de la propia comprobacion no debe impedir vender.
    console.error('[OBJETOS] No se pudo verificar:', e.message);
  }

  mainWindow = createWindow();

  /* ARRIENDO DE CAJA
     ----------------
     Esta maquina reclama la caja que tiene guardada y empieza a latir. En una
     instalacion que ya existia, la caja guardada es la que ya tenia y nadie
     mas la tiene: la toma sin conflicto y nada cambia para el usuario. En una
     de una sola caja esto es invisible.

     La identidad es la MISMA que usa la licencia -la huella sellada-, no el
     hostname: renombrar un equipo no puede costarle su caja. */
  try {
    cajaArrendada.configurar({
      machineId: machineIdDeEsteEquipo(),
      machineName: os.hostname(),
      leerCaja: () => loadDeviceConfig()?.register ?? null,
    });
    await cajaArrendada.iniciar();
    const c = cajaArrendada.instantanea();
    if (c.registerId) {
      console.log(`[CAJA] ${c.registerName ?? c.registerId}: ${c.ultimo ?? c.error ?? 'sin respuesta'}`);
    }
  } catch (e) {
    // Sin arriendo se opera como siempre. No es motivo para no abrir.
    console.error('[CAJA] No se pudo iniciar el arriendo:', e.message);
  }

  backup.startScheduler();
  // Pasa el machine_id de licencia a la nube (para ligar licencias↔negocio en el admin)
  if (!cachedMachineId) cachedMachineId = generarMachineId();
  cloudSync.setLicenseMachineId(cachedMachineId);
  cloudSync.startScheduler();
  ensureBusinessConfig().catch(err => console.error('businessConfig:', err));

  // Abre la pantalla de cliente si quedo habilitada en la configuracion.
  autoOpenCustomerDisplay();
}

app.whenReady().then(() => arranque.arrancar({
  cargarInstalacion: () => loadInstallConfig(),

  // Se responde leyendo el disco, sin abrir ninguna conexion.
  hayConfiguracion: () => db.hayConfiguracion(),

  // Arranque de una instalacion que ya existe: la version del motor se
  // reporta, no bloquea. Quien ya opera no puede quedarse sin vender por algo
  // que no puede resolver en ese momento.
  prepararServidor: (install) => setupServer.ensureServerReady({
    role: install.role,
    server: install.server,
    dbName: install.dbName || DB_NAME,
    altaDeHost: false,
  }),

  conectar: () => poolPromise,

  arrancarApp: (pool) => bootMainApp(pool),

  abrirAsistente: () => { setupWindow = createSetupWindow(); },

  /* Un fallo antes de la ventana NO puede quedarse solo en el registro: el
     usuario ve una aplicacion que no abre y no tiene donde mirar. */
  avisarFallo: ({ paso, error }) => {
    if (error?.reinicioPendiente) {
      dialog.showMessageBoxSync({
        type: 'info',
        title: 'Falta reiniciar el equipo',
        message: 'Actualizacion de SQL Server aplicada',
        detail: error.message,
        buttons: ['Entendido'],
      });
      app.quit();
      return;
    }
    dialog.showErrorBox(
      'Wybix no pudo iniciar',
      `Se detuvo en el paso "${paso}".\n\n${error?.message || error}\n\n` +
      'El detalle completo esta en el registro (Configuracion > Diagnostico).');
  },

  log: (m) => console.log(m),
  logError: (m) => console.error(m),
}));

/**
 * Guarda bytes generados en el renderer como un archivo de verdad.
 *
 * POR QUE EXISTE
 * --------------
 * jsPDF y xlsx-js-style "guardan" creando un Blob y disparando un
 * <a download>. Eso es del navegador: en la aplicacion empaquetada la pagina
 * se sirve por `file://` y esa descarga no llega a ninguna parte -no hay
 * carpeta de descargas ni gestor que la recoja-, asi que el usuario pulsa
 * Exportar y no pasa nada. Con esto el renderer solo produce los bytes y el
 * proceso principal hace lo unico que sabe hacer bien: preguntar donde y
 * escribir el archivo.
 */
ipcMain.handle('files:save-bytes', async (_e, payload = {}) => {
  try {
    const nombre = String(payload?.suggestedName || 'wybix').replace(/[\\/:*?"<>|]/g, '_');
    const b64 = String(payload?.base64 || '');
    if (!b64) return { success: false, error: 'No se recibio contenido para guardar.' };

    const ext = String(payload?.extension || '').replace(/^\./, '') || 'bin';
    const filtros = Array.isArray(payload?.filters) && payload.filters.length
      ? payload.filters
      : [{ name: ext.toUpperCase(), extensions: [ext] }];

    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: payload?.title || 'Guardar archivo',
      defaultPath: `${nombre}.${ext}`,
      filters: filtros,
    });
    // Cancelar no es un error: no se avisa de nada al usuario.
    if (canceled || !filePath) return { success: true, canceled: true };

    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
    return { success: true, path: filePath };
  } catch (err) {
    console.error('files:save-bytes:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('export-database', async () => {
  try {
    const dbName = await getCurrentDbName();

    // Exportar la base es respaldarla: solo el host, y con la conexion de
    // Windows, igual que el respaldo automatico. Ver backupManager.js.
    if (!(await backup.esHost())) {
      return {
        success: false,
        error: 'Esta caja se conecta al SQL Server de otra computadora. La exportacion de la ' +
               'base se hace desde la computadora principal.'
      };
    }

    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Exportar base de datos',
      defaultPath: `${dbName}_${stamp()}.bak`,
      filters: [{ name: 'SQL Server Backup', extensions: ['bak'] }]
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    const sqlDir = safeSqlBackupDir();
    if (!fs.existsSync(sqlDir)) fs.mkdirSync(sqlDir, { recursive: true });

    const tmpBak = path.join(sqlDir, `${dbName}_${stamp()}_${Math.random().toString(16).slice(2)}.bak`);

    const { server } = await backup.conexionDeLaApp();
    const pool = await backup.conexionPrivilegiadaLocal(server);
    try {
      const query = `
        DECLARE @p NVARCHAR(4000) = N'${escSqlString(tmpBak)}';
        BACKUP DATABASE [${dbName}]
        TO DISK = @p
        WITH INIT, STATS = 5;
      `;
      await pool.request().query(query);
    } finally {
      try { await pool.close(); } catch { /* noop */ }
    }

    fs.copyFileSync(tmpBak, filePath);

    try { fs.unlinkSync(tmpBak); } catch {}

    return { success: true, path: filePath };
  } catch (err) {
    console.error('❌ export-database:', err);
    return {
      success: false,
      error:
        err?.message ||
        'No se pudo exportar. Asegura permisos para SQL Server en C:\\POS_Backups (o SQL_BACKUP_DIR).'
    };
  }
});

ipcMain.handle('import-database', async () => {
  try {
    const dbName = await getCurrentDbName();
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

    const pick = await dialog.showOpenDialog(win, {
      title: 'Importar (restaurar) base de datos',
      properties: ['openFile'],
      filters: [{ name: 'SQL Server Backup', extensions: ['bak'] }]
    });

    if (pick.canceled || !pick.filePaths?.length) return { success: false, canceled: true };

    const bakPath = pick.filePaths[0];

    const confirm = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancelar', 'Restaurar'],
      defaultId: 1,
      cancelId: 0,
      title: 'Confirmar restauración',
      message: 'Esto reemplazará la base de datos actual con el respaldo seleccionado.',
      detail: `BD: ${dbName}\nArchivo: ${bakPath}\n\n¿Deseas continuar?`
    });

    if (confirm.response !== 1) return { success: false, canceled: true };

    await runOnMaster(async (masterPool) => {
      const q = `
        DECLARE @p NVARCHAR(4000) = N'${escSqlString(bakPath)}';

        ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;

        RESTORE DATABASE [${dbName}]
        FROM DISK = @p
        WITH REPLACE, RECOVERY, STATS = 5;

        ALTER DATABASE [${dbName}] SET MULTI_USER;
      `;
      await masterPool.request().query(q);
    });

    return { success: true, requiresRestart: true };
  } catch (err) {
    console.error('❌ import-database:', err);
    return {
      success: false,
      error:
        err?.message ||
        'No se pudo importar. Revisa que SQL Server pueda acceder a la ruta del .bak.'
    };
  }
});

function getDeviceConfigPath() {
  return path.join(app.getPath('userData'), 'device-config.json');
}

function loadDeviceConfig() {
  const p = getDeviceConfigPath();
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) {
    console.error('Error leyendo device-config.json:', e);
  }
  return {
    // Perfil del DISPOSITIVO: BACKOFFICE | RETAIL_POS | TOUCH_POS.
    // Cambiarlo no reinstala ni toca la base: solo cambia la experiencia
    // que carga esta caja. Las instalaciones sin la clave son RETAIL_POS.
    deviceProfile: 'RETAIL_POS',
    // conexion: 'teclado' (USB automatico) | 'usb' (serial COM) | 'bluetooth' (proximamente)
    scanner: { conexion: 'teclado', enabled: false, path: '', baudRate: 9600 },
    // conexion: 'sistema' (impresora del SO) | 'bluetooth' (proximamente)
    printer: { conexion: 'sistema', name: '', ticketPrinterName: '' },
    // conexion: 'impresora' (cajon conectado a la impresora, lo mas comun) | 'usb' (serial COM) | 'bluetooth' (proximamente)
    drawer: { conexion: 'impresora', enabled: false, path: '', baudRate: 9600, pulseMs: 120, pin: 0, openOnPayment: false },
    // Pantalla de cliente (segundo monitor)
    customerDisplay: { enabled: false, displayId: null }
  };
}

function saveDeviceConfig(cfg) {
  const p = getDeviceConfigPath();
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

// ============================================================
//  PANTALLA DE CLIENTE (segundo monitor)
// ============================================================
let customerWindow = null;
let displayWatchOn = false;

function listMonitors() {
  try {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: (d.id === primary.id ? 'Monitor principal' : 'Monitor ' + (i + 1)) +
             ` (${d.size.width}x${d.size.height})`,
      primary: d.id === primary.id,
      bounds: d.bounds
    }));
  } catch (e) {
    return [];
  }
}

function pickDisplay(displayId) {
  const all = screen.getAllDisplays();
  if (displayId != null) {
    const found = all.find(d => d.id === displayId);
    if (found) return found;
  }
  // Por defecto: el primer monitor que NO sea el principal
  const primary = screen.getPrimaryDisplay();
  return all.find(d => d.id !== primary.id) || primary;
}

function pushCustomerState(state) {
  try {
    if (customerWindow && !customerWindow.isDestroyed()) {
      customerWindow.webContents.send('customer:state', state);
    }
  } catch { /* noop */ }
}

function watchDisplays() {
  if (displayWatchOn) return;
  displayWatchOn = true;
  // Si se desconecta el monitor de la pantalla de cliente, avisa al POS.
  screen.on('display-removed', () => {
    if (customerWindow && !customerWindow.isDestroyed()) {
      try { mainWindow && mainWindow.webContents.send('customer-display:disconnected'); } catch { /* noop */ }
    }
  });
}

function openCustomerDisplay(displayId) {
  try {
    watchDisplays();
    const disp = pickDisplay(displayId);
    if (customerWindow && !customerWindow.isDestroyed()) {
      customerWindow.setBounds(disp.bounds);
      customerWindow.show();
      return { ok: true, displayId: disp.id };
    }
    customerWindow = new BrowserWindow({
      x: disp.bounds.x, y: disp.bounds.y,
      width: disp.bounds.width, height: disp.bounds.height,
      frame: false, fullscreen: true, skipTaskbar: true,
      backgroundColor: '#0b1620',
      webPreferences: {
        preload: path.join(__dirname, 'customer-display', 'customer-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false
      }
    });
    customerWindow.loadFile(path.join(__dirname, 'customer-display', 'customer.html'));
    customerWindow.webContents.on('did-finish-load', () => pushCustomerState({ mode: 'idle' }));
    customerWindow.on('closed', () => { customerWindow = null; });
    return { ok: true, displayId: disp.id };
  } catch (e) {
    console.error('openCustomerDisplay:', e);
    return { ok: false, error: e.message };
  }
}

function closeCustomerDisplay() {
  try {
    if (customerWindow && !customerWindow.isDestroyed()) customerWindow.close();
    customerWindow = null;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Se llama al arrancar el POS: abre la pantalla si esta habilitada en la config.
function autoOpenCustomerDisplay() {
  try {
    const cfg = loadDeviceConfig();
    const cd = cfg.customerDisplay || {};
    if (cd.enabled) openCustomerDisplay(cd.displayId ?? null);
  } catch (e) { console.error('autoOpenCustomerDisplay:', e); }
}

ipcMain.handle('customer-display:list-monitors', async () => listMonitors());
ipcMain.handle('customer-display:open', async (_e, displayId = null) => openCustomerDisplay(displayId));
ipcMain.handle('customer-display:close', async () => closeCustomerDisplay());
ipcMain.handle('customer-display:state', async (_e, state) => { pushCustomerState(state); return { ok: true }; });
ipcMain.handle('customer-display:status', async () => ({ open: !!(customerWindow && !customerWindow.isDestroyed()) }));
ipcMain.handle('customer:get-business', async () => {
  try {
    const cfg = await ensureBusinessConfig();
    return { name: cfg?.business_name || cfg?.businessName || '' };
  } catch {
    return { name: '' };
  }
});

// ============================================================
//  MODULOS OPCIONALES — Pago de servicios / recargas (TAECEL, etc.)
// ============================================================
function getServicesConfigPath() {
  return path.join(app.getPath('userData'), 'services-config.json');
}
function loadServicesConfig() {
  try {
    const p = getServicesConfigPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { console.error('services-config.json:', e); }
  return { provider: null, enabled: false, credentials: {} };
}
function saveServicesConfig(cfg) {
  fs.writeFileSync(getServicesConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

// Estado del modulo (sin exponer las credenciales secretas al render)
ipcMain.handle('services:get-config', async () => {
  try {
    const c = loadServicesConfig();
    return {
      success: true,
      data: {
        provider: c.provider || null,
        enabled: !!c.enabled,
        hasCredentials: !!(c.credentials && Object.keys(c.credentials).length)
      }
    };
  } catch (e) { return { success: false, error: e.message }; }
});

// Valida las credenciales contra el proveedor antes de habilitar el modulo.
ipcMain.handle('services:validate', async (_e, payload = {}) => {
  try {
    const provider = payload.provider;
    const credentials = payload.credentials || {};
    if (provider !== 'taecel') return { ok: false, error: 'Proveedor no soportado por ahora.' };

    // ============================================================
    //  PUNTO DE INTEGRACION TAECEL
    //  Aqui va la llamada real a TAECEL (p. ej. "consultar saldo")
    //  para validar las credenciales del alta. Requiere los
    //  endpoints/credenciales reales del portal de TAECEL.
    //  Referencia: taecel.com (WebService).
    // ============================================================
    if (!credentials.key || !credentials.nip) {
      return { ok: false, error: 'Faltan credenciales: Key y NIP de TAECEL.' };
    }
    // Validacion basica de formato hasta conectar el WebService real.
    return { ok: true, saldo: null, pendingApi: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('services:set-config', async (_e, cfg = {}) => {
  try {
    const current = loadServicesConfig();
    const merged = {
      ...current, ...cfg,
      credentials: { ...(current.credentials || {}), ...(cfg.credentials || {}) }
    };
    saveServicesConfig(merged);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('services:clear', async () => {
  try {
    saveServicesConfig({ provider: null, enabled: false, credentials: {} });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// Ejecuta una operacion (recarga / pago de servicio). Pendiente de conectar TAECEL.
ipcMain.handle('services:operate', async (_e, op = {}) => {
  try {
    const c = loadServicesConfig();
    if (!c.enabled || c.provider !== 'taecel') return { ok: false, error: 'El modulo no esta configurado.' };
    // === PUNTO DE INTEGRACION TAECEL: aqui va la recarga/pago real ===
    return { ok: false, pendingApi: true, error: 'Conecta tu cuenta TAECEL para operar (falta la API real).' };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ============================================================
//  BLINDAJE / SEGURIDAD (anti robo hormiga)
// ============================================================
ipcMain.handle('security:authorize', async (_e, p = {}) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request()
      .input('usuario', sql.NVarChar(50), String(p.usuario || '').trim())
      .input('password', sql.NVarChar(255), String(p.password || ''))
      .execute('sp_authorize_supervisor');
    const row = r.recordset?.[0];
    if (!row) return { ok: false, error: 'Usuario o contraseña incorrectos, o sin permisos de supervisor.' };
    return { ok: true, userId: row.id, name: row.usuario, rol: row.rol };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Eventos que disparan una alerta EN VIVO (además de quedar en la bitácora)
const CRITICOS_ALERTA = {
  REFUND: 'Devolución en caja',
  DEVOLUCION: 'Devolución en caja',
  VOID: 'Venta anulada',
  ANULADA: 'Venta anulada',
  DRAWER_NO_SALE: 'Cajón abierto sin venta',
  DELETE: 'Producto eliminado del ticket',
  ELIMINADO: 'Producto eliminado del ticket'
};

ipcMain.handle('security:log', async (_e, p = {}) => {
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('user_id', sql.Int, p.userId ?? null)
      .input('authorized_by', sql.Int, p.authorizedBy ?? null)
      .input('register_id', sql.Int, p.registerId ?? null)
      .input('event_type', sql.NVarChar(40), String(p.eventType || 'OTHER'))
      .input('amount', sql.Decimal(18, 2), p.amount ?? null)
      .input('detail', sql.NVarChar(400), p.detail ?? null)
      .input('sale_id', sql.Int, p.saleId ?? null)
      .execute('sp_log_security_event');

    // Alerta en vivo para eventos críticos (robo hormiga): sin esperar los 5 min.
    const et = String(p.eventType || '').toUpperCase();
    const titulo = CRITICOS_ALERTA[et];
    if (titulo) {
      const monto = (p.amount != null) ? ` ($${Number(p.amount).toFixed(2)})` : '';
      const quien = p.detail ? ` — ${p.detail}` : '';
      cloudSync.crearAlertaInmediata(et, titulo, `${titulo}${monto}${quien}`).catch(() => {});
    }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('security:by-cashier', async (_e, p = {}) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request()
      .input('from', sql.Date, p.from ?? null).input('to', sql.Date, p.to ?? null)
      .execute('sp_security_by_cashier');
    return { success: true, data: r.recordset };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('security:risk', async (_e, p = {}) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request()
      .input('from', sql.Date, p.from ?? null).input('to', sql.Date, p.to ?? null)
      .execute('sp_cashier_risk');
    return { success: true, data: r.recordset };
  } catch (e) { return { success: false, error: e.message }; }
});

function setupAutoUpdater(win) {
  if (isDev) {
    console.log('🔧 Modo desarrollo: Auto-updater desactivado');
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  setTimeout(() => {
    autoUpdater.checkForUpdates();
  }, 3000);

  updateCheckTimer = setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 4 * 60 * 60 * 1000);

  autoUpdater.on('checking-for-update', () => {
    console.log('🔍 Buscando actualizaciones...');
    win.webContents.send('update-status', {
      type: 'checking',
      message: 'Buscando actualizaciones...'
    });
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Actualización disponible:', info.version);
    win.webContents.send('update-status', {
      type: 'available',
      message: `Nueva versión ${info.version} disponible`,
      version: info.version
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('Sistema actualizado');
    win.webContents.send('update-status', {
      type: 'not-available',
      message: 'El sistema está actualizado'
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('Error en auto-updater:', err);
    win.webContents.send('update-status', {
      type: 'error',
      message: 'Error al buscar actualizaciones',
      error: err.message
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const msg = `Descargando: ${progressObj.percent.toFixed(2)}%`;
    console.log(msg);
    win.webContents.send('update-status', {
      type: 'downloading',
      message: msg,
      percent: progressObj.percent
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Actualización descargada');
    win.webContents.send('update-status', {
      type: 'downloaded',
      message: 'Actualización lista para instalar',
      version: info.version
    });
  });
}

ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    console.error('Error descargando actualización:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
  return { success: true };
});

ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

function toDateOrNull(value, endOfDay = false) {
  if (!value) return null;
  const d = (value instanceof Date) ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) {
    d.setHours(23, 59, 59, 0);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,  
      sandbox: false,       
      enableRemoteModule: false
    }
  });

  if (isDev) {
    win.loadURL('http://localhost:4200');
  } else {
    win.loadFile(path.join(__dirname, '../dist/filtros_lubs_rios/browser/index.html'));
  }

  setupAutoUpdater(win);
  startSerialScanner(win, { path: 'COM3', baudRate: 9600 });
  return win;
}


async function ensureBusinessConfig() {
  if (businessConfig) return businessConfig;  
  const pool = await poolPromise;
  const result = await pool.request().execute('sp_get_business_config');
  businessConfig = result.recordset[0] || null;

  return businessConfig;
}

app.on('window-all-closed', () => {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
  }
  if (process.platform !== 'darwin') app.quit();
});

/**
 * Soltar la caja al cerrar Wybix limpiamente.
 *
 * El arriendo caduca solo en cinco minutos, asi que esto no es lo que evita
 * que una caja quede bloqueada -de eso se encarga la caducidad-. Es lo que
 * hace que CAMBIAR de equipo sea inmediato en el caso normal: apago la caja
 * vieja, enciendo la nueva y la caja ya esta libre.
 *
 * `preventDefault` + `app.exit()` porque soltar es una llamada a SQL y
 * `before-quit` no espera promesas. El tiempo maximo se acota: nadie puede
 * quedarse con la ventana cerrada y el proceso vivo porque el servidor no
 * conteste.
 */
let soltandoCaja = false;
app.on('before-quit', (e) => {
  if (soltandoCaja) return;
  const caja = cajaArrendada.instantanea();
  if (!caja.registerId || !caja.vigente) return;

  soltandoCaja = true;
  e.preventDefault();
  cajaArrendada.detener();

  const aTiempo = new Promise(r => setTimeout(r, 3000));
  Promise.race([cajaArrendada.soltar('EQUIPO'), aTiempo])
    .catch(() => { /* cerrar no puede fallar por esto */ })
    .finally(() => app.exit(0));
});

ipcMain.handle('getConfig', async () => {
  const cfg = await ensureBusinessConfig();
  return cfg;
});

// Guardar datos del negocio (Configuracion > Datos del negocio)
ipcMain.handle('update-business-config', async (_e, payload = {}) => {
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('business_name', sql.NVarChar(200), payload.business_name ?? null)
      .input('address',       sql.NVarChar(300), payload.address ?? null)
      .input('phone',         sql.NVarChar(50),  payload.phone ?? null)
      .input('rfc',           sql.NVarChar(50),  payload.rfc ?? null)
      .input('ticket_footer', sql.NVarChar(300), payload.ticket_footer ?? null)
      // Perfil del negocio (RETAIL | HOSPITALITY). NULL conserva el actual.
      .input('business_profile', sql.NVarChar(20), payload.business_profile ?? null)
      // Fidelizacion encendida. NULL -y no 0- cuando no viene: este mismo
      // handler atiende al panel de datos del negocio, que guarda sin
      // mencionarla. Mandar 0 ahi apagaria las campanas al cambiar el telefono.
      .input('loyalty_enabled', sql.Bit,
        payload.loyalty_enabled === undefined || payload.loyalty_enabled === null
          ? null : (payload.loyalty_enabled ? 1 : 0))
      .execute('sp_update_business_config');
    businessConfig = null; // invalida el cache para releer datos frescos
    return { success: true };
  } catch (e) {
    console.error('update-business-config:', e);
    return { success: false, error: e.message };
  }
});

// Formas de pago (config local por caja)
function paymentsConfigPath() { return path.join(app.getPath('userData'), 'payments-config.json'); }
function defaultPayments() { return { efectivo: true, tarjeta: true, transferencia: true, credito: true, terminal_mp: true }; }
function loadPaymentsConfig() {
  try {
    const pp = paymentsConfigPath();
    if (fs.existsSync(pp)) return { ...defaultPayments(), ...JSON.parse(fs.readFileSync(pp, 'utf8')) };
  } catch { /* usa default */ }
  return defaultPayments();
}
ipcMain.handle('payments:get', async () => ({ success: true, data: loadPaymentsConfig() }));
ipcMain.handle('payments:set', async (_e, cfg = {}) => {
  try {
    const merged = { ...loadPaymentsConfig(), ...cfg };
    fs.writeFileSync(paymentsConfigPath(), JSON.stringify(merged, null, 2), 'utf8');
    return { success: true, data: merged };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Version de la app (Configuracion > Actualizaciones)
ipcMain.handle('app:get-version', async () => {
  try { return { success: true, version: app.getVersion() }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('sp-iniciar-sesion', async (event, { usuario, contrasena }) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('username', sql.NVarChar, usuario)
      .input('password', sql.NVarChar, contrasena)
      .execute('sp_login_user');

    const row = result.recordset[0];

    if (!row) {
      return {
        success: false,
        message: 'Usuario o contraseña incorrectos'
      };
    }
  
    return {
      success: true,
      data: {
        id: row.id,
        usuario: row.usuario,
        rol: row.rol,
        active: row.active,
        creation_date: row.creation_date
      }
    };
  } catch (err) {
    console.error('❌ Error login:', err);
    return {
      success: false,
      message: err.message
    };
  }
});

ipcMain.handle('sp-get-products', async () => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('sp_get_active_products');

        return result.recordset; 

    } catch (err) {
        console.error('❌ Error al ejecutar sp_get_active_products:', err);
        throw err; 
    }
});

ipcMain.handle('sp-Consultar-Detalle-Productos', async (event, CategoryID) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('CategoryID', sql.Int, CategoryID)
            .execute('sp_Consultar_Detalle_Productos');
        return {
        brand: result.recordsets[0],
        categorys: result.recordsets[1],
        subcategorys: result.recordsets[2]

    
    };
    } catch (err) {
        console.error('❌ Error al ejecutar sp_Consultar_Detalles_Producto:', err);
        throw err; 
    }
});

ipcMain.handle('sp-add-product', async (event, brand, category, partNumber, name, price, stock,
                                        claveProdServ, claveUnidad, objetoImpuesto, tasaIva, barCode,
                                        control = null) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('brand', sql.Int, brand)
            .input('category', sql.Int, category)
            .input('part_number', sql.NVarChar(100), partNumber)
            .input('name', sql.NVarChar(100), name)
            .input('price', sql.Decimal(10, 2), price)
            // Decimal, no entero: un ingrediente se mide en gramos o mililitros.
            .input('stock', sql.Decimal(12, 2), stock)
            .input('bar_code', sql.NVarChar(100), (barCode ?? null) === '' ? null : (barCode ?? null))
            .input('clave_prod_serv', sql.NVarChar(8), claveProdServ ?? null)
            .input('clave_unidad', sql.NVarChar(5), claveUnidad ?? null)
            .input('objeto_impuesto', sql.NVarChar(2), objetoImpuesto ?? '02')
            .input('tasa_iva', sql.Decimal(5, 4), tasaIva ?? 0.16)
            // Sin `control` van en NULL y el procedimiento aplica sus defaults
            // (DIRECT / vendible / pza / sin decimales): el Retail de siempre.
            .input('inventory_mode', sql.NVarChar(10), control?.inventory_mode ?? null)
            .input('sellable', sql.Bit, control?.sellable == null ? null : (control.sellable ? 1 : 0))
            .input('base_uom', sql.NVarChar(10), control?.base_uom ?? null)
            .input('allow_decimal_qty', sql.Bit, control?.allow_decimal_qty == null ? null : (control.allow_decimal_qty ? 1 : 0))
            .input('cost', sql.Decimal(14, 4), control?.cost ?? null)
            .execute('sp_add_product');
 
        return {
            success: true,
            data: result.recordset
        };
    } catch (err) {
        console.error('Error al ejecutar sp_add_product:', err);
        return {
            success: false,
            error: err.message
        };
    }
 
});
 
ipcMain.handle('sp-delete-product', async (_event, productId) => {
  try {
    const id = Number(productId);
    if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'product_id invalido.' };

    const pool = await poolPromise;
    const r = await pool.request()
      .input('product_id', sql.Int, id)
      .execute('sp_delete_product');

    return { success: true, data: r.recordset?.[0] ?? null };
  } catch (err) {
    console.error('sp-delete-product:', err);

    // El procedimiento ya nombra lo que bloquea, pero por el canal de ERRORES:
    // el driver degrada ese texto a un byte por caracter y "QA Frappe" con
    // acento llegaba como "QA Frapp?". Las filas de datos NO se degradan, asi
    // que los nombres se vuelven a pedir por una consulta normal y el mensaje
    // se arma aqui. Si esa consulta fallara, se conserva el mensaje del
    // procedimiento: peor acentuado, pero nunca vacio.
    try {
      const pool = await poolPromise;
      const dep = await pool.request()
        .input('product_id', sql.Int, Number(productId))
        .execute('sp_get_product_dependencies');
      const filas = dep.recordset || [];
      const recetas = filas.filter(f => f.tipo === 'RECIPE').map(f => f.nombre);
      const mods    = filas.filter(f => f.tipo === 'MODIFIER').map(f => f.nombre);

      if (recetas.length || mods.length) {
        const partes = [];
        if (recetas.length) {
          partes.push(`se usa como ingrediente en: ${recetas.join(', ')}. ` +
                      'Quitalo de esas recetas antes de darlo de baja.');
        }
        if (mods.length) {
          partes.push(`se usa en los modificadores: ${mods.join(', ')}. ` +
                      'Cambialos antes de darlo de baja.');
        }
        return {
          success: false,
          error: partes.join(' '),
          bloqueos: { recetas, modificadores: mods },
        };
      }
    } catch (e2) {
      console.error('sp-delete-product (dependencias):', e2);
    }

    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-update-product', async (event, payload = {}) => {
  try {
    const productId = Number(payload?.product_id ?? payload?.productId ?? 0);
    const nombre = String(payload?.nombre ?? payload?.name ?? '').trim();
    const precio = Number(payload?.precio ?? payload?.price ?? 0);
    const stock = Number(payload?.stock ?? 0);
    const numeroParte = String(payload?.numero_parte ?? payload?.partNumber ?? '').trim();
    const barCode = payload?.bar_code ?? payload?.barCode ?? null;
 
    const claveProdServ = payload?.clave_prod_serv ?? null;
    const claveUnidad = payload?.clave_unidad ?? null;
    const objetoImpuesto = payload?.objeto_impuesto ?? null;
    const tasaIva = payload?.tasa_iva ?? null;
 
    if (!Number.isFinite(productId) || productId <= 0) return { success: false, error: 'product_id invalido.' };
    if (!nombre) return { success: false, error: 'El nombre es obligatorio.' };
    if (!Number.isFinite(precio) || precio < 0) return { success: false, error: 'Precio invalido.' };
    if (!Number.isFinite(stock) || stock < 0) return { success: false, error: 'Stock invalido.' };
 
    const pool = await poolPromise;
    const req = pool.request()
      .input('product_id', sql.Int, productId)
      .input('nombre', sql.NVarChar(100), nombre)
      .input('precio', sql.Decimal(10, 2), precio)
      .input('stock', sql.Decimal(10, 2), stock)
      .input('numero_parte', sql.NVarChar(100), numeroParte);
 
    req.input('bar_code', sql.NVarChar(100), barCode === undefined ? null : barCode);
 
    req.input('clave_prod_serv', sql.NVarChar(8), claveProdServ);
    req.input('clave_unidad', sql.NVarChar(5), claveUnidad);
    req.input('objeto_impuesto', sql.NVarChar(2), objetoImpuesto);
    req.input('tasa_iva', sql.Decimal(5, 4), tasaIva);

    // NULL = no lo tocan. El procedimiento resuelve cada campo con ISNULL
    // contra su valor actual, asi que un formulario Retail que no envie nada
    // de esto deja el producto exactamente como estaba.
    req.input('inventory_mode', sql.NVarChar(10), payload?.inventory_mode ?? null);
    req.input('sellable', sql.Bit, payload?.sellable == null ? null : (payload.sellable ? 1 : 0));
    req.input('base_uom', sql.NVarChar(10), payload?.base_uom ?? null);
    req.input('allow_decimal_qty', sql.Bit, payload?.allow_decimal_qty == null ? null : (payload.allow_decimal_qty ? 1 : 0));
    req.input('cost', sql.Decimal(14, 4), payload?.cost ?? null);

    await req.execute('sp_update_product');
    return { success: true };
  } catch (err) {
    console.error('sp-update-product:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-get-categories', async (event, data) => {
    try {   
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('sp_get_categories');

        return result.recordset; 

    } catch (err) {
        console.error('Error al ejecutar sp_get_categories:', err);
        throw err; 
    }
});

ipcMain.handle('sp-get-brands', async (event, data) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('sp_get_brands');

        return result.recordset; 

    } catch (err) {
        console.error('❌ Error al ejecutar sp_get_brands:', err);
        throw err; 
    }
});

ipcMain.handle('sp-get-active-products', async (event, data) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('sp_get_active_products');

        return result.recordset; 

    } catch (err) {
        console.error('❌ Error al ejecutar sp_get_active_products:', err);
        throw err; 
    }
});

/**
 * Registro de venta. UNICA ruta: Retail y Touch entran por aqui.
 *
 * Acepta las dos formas de llamada, para no romper a ningun consumidor:
 *   antigua  (userId, paymentMethod, items, customerId, dueDate, registerId)
 *   nueva    ({ userId, paymentMethod, lines, customerId, dueDate,
 *               registerId, serviceMode })
 * donde cada linea puede traer `options` (modificadores) y `note`.
 *
 * La APP declara la intencion; sp_register_sale decide el inventario.
 */
function construirTvpsVenta(lines) {
  // v1 vacio: el procedure une los dos tipos. Se sigue enviando para que la
  // firma no cambie y una instalacion a medio migrar no falle.
  const d1 = new sql.Table('dbo.SaleDetailType');
  d1.columns.add('product_id', sql.Int, { nullable: true });
  d1.columns.add('quantity',   sql.Decimal(12, 2), { nullable: true });
  d1.columns.add('unit_price', sql.Decimal(10, 2), { nullable: true });

  const d2 = new sql.Table('dbo.SaleDetailType2');
  d2.columns.add('line_no',    sql.Int, { nullable: false });
  d2.columns.add('product_id', sql.Int, { nullable: false });
  d2.columns.add('quantity',   sql.Decimal(12, 2), { nullable: false });
  d2.columns.add('unit_price', sql.Decimal(10, 2), { nullable: false });
  d2.columns.add('note',       sql.NVarChar(200), { nullable: true });

  const mo = new sql.Table('dbo.SaleModifierType');
  mo.columns.add('line_no',            sql.Int, { nullable: false });
  mo.columns.add('modifier_option_id', sql.Int, { nullable: false });
  mo.columns.add('quantity',           sql.Int, { nullable: false });

  lines.forEach((l, i) => {
    const lineNo = i + 1;
    d2.rows.add(lineNo, l.productId, l.qty, l.unitPrice, l.note ?? null);
    for (const o of (l.options || [])) {
      mo.rows.add(lineNo, o.optionId ?? o.modifierOptionId, Number(o.quantity ?? 1));
    }
  });

  return { d1, d2, mo };
}

/** ¿Es un aborto por deadlock? El SP re-lanza el 1205 con su marca. */
function esDeadlock(err) {
  return err && (err.number === 1205 || /\[1205\]|deadlock|interbloqueo/i.test(String(err.message || '')));
}

ipcMain.handle('sp-register-sale', async (event, a, b, c, d, e, f) => {
  // Normaliza las dos formas de llamada.
  const p = (a && typeof a === 'object' && !Array.isArray(a))
    ? a
    : { userId: a, paymentMethod: b, lines: c, customerId: d, dueDate: e, registerId: f };

  const lines = (p.lines || []).map(l => ({
    productId: l.productId ?? l.product_id,
    qty: l.qty ?? l.quantity,
    unitPrice: l.unitPrice ?? l.unit_price,
    note: l.note ?? null,
    options: l.options || [],
  }));

  if (!lines.length) return { success: false, error: 'La venta no tiene partidas.' };

  /**
   * Reintento SOLO ante deadlock (1205).
   *
   * Es seguro porque un 1205 aborta la transaccion entera: no quedo venta,
   * ni inventario, ni movimiento de caja, asi que reenviar la MISMA intencion
   * no puede duplicar nada. Cualquier otro error (falta stock, no hay turno)
   * se devuelve tal cual: no se reintenta a ciegas. El cobro externo
   * (terminal) queda fuera de esto por completo.
   */
  const MAX_INTENTOS = 3;
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      const pool = await poolPromise;
      const { d1, d2, mo } = construirTvpsVenta(lines);
      const ident = cajaArrendada.identidad();

      const request = pool.request()
        .input('user_id',        sql.Int,           p.userId)
        .input('payment_method', sql.NVarChar(50),  p.paymentMethod)
        .input('SaleDetails',    d1)
        .input('customer_id',    sql.Int,           p.customerId ?? null)
        .input('due_date',       sql.Date,          p.dueDate ? new Date(p.dueDate) : null)
        .input('register_id',    sql.Int,           p.registerId ?? null)
        .input('SaleDetails2',   d2)
        .input('SaleModifiers',  mo)
        .input('service_mode',   sql.NVarChar(10),  p.serviceMode ?? null)
        // Quien es esta maquina. El procedimiento rechaza la venta si la caja
        // la tiene otro equipo -dos equipos en la misma caja comparten turno y
        // corte- y de paso RENUEVA el arriendo: vender es la senal de vida mas
        // fuerte que hay, y no puede depender de un temporizador de interfaz.
        .input('machine_id',     sql.NVarChar(64),  ident.machineId)
        .input('machine_name',   sql.NVarChar(120), ident.machineName);

      const result = await request.execute('sp_register_sale');

      const fila = result.recordset?.[0] ?? null;
      return {
        success: true,
        saleId: fila?.sale_id ?? fila?.id ?? null,
        total: fila?.total ?? null,
        data: result.recordset ?? [],
      };
    } catch (err) {
      if (esDeadlock(err) && intento < MAX_INTENTOS) {
        // Espera creciente y corta: deja que la otra transaccion termine.
        await new Promise(r => setTimeout(r, 60 * intento));
        console.warn(`[VENTA] deadlock, reintento ${intento + 1}/${MAX_INTENTOS}`);
        continue;
      }
      console.error('❌ Error en sp_register_sale:', err);
      return { success: false, error: err.message };
    }
  }
});


    
ipcMain.handle('sp-get-suppliers', async (event, data) => {
    try {   
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('sp_get_suppliers');

        return result.recordset; 

    } catch (err) {
        console.error('❌ Error al ejecutar sp_get_suppliers:', err);
        throw err; 
    }
});

ipcMain.handle('get-next-purchase-folio', async () => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().execute('sp_get_next_purchase_folio');
    return { success: true, folio: result.recordset[0].next_folio };
  } catch (err) {
    console.error('Error get-next-purchase-folio:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-register-purchase', async (event, { user_id, supplier_id, tax_rate, tax_amount, subtotal, total, detalles, payment_method, register_id }) => {
  try {
    const pool = await poolPromise;

    // Una compra = un proveedor: el proveedor va a nivel compra, no por linea
    // El nombre del tipo (dbo.PurchaseDetailType) es OBLIGATORIO para msnodesqlv8;
    // sin el sale "Catalog or schema name of XML schema collection...".
    const tvp = new sql.Table('dbo.PurchaseDetailType');
    tvp.columns.add('product_id',     sql.Int,            { nullable: false });
    tvp.columns.add('quantity',       sql.Decimal(12, 2), { nullable: false });
    tvp.columns.add('unit_price',     sql.Decimal(10, 2), { nullable: false });
    tvp.columns.add('profit_percent', sql.Decimal(5, 2),  { nullable: true  });

    // Version 2: la misma linea mas la PRESENTACION en que se compro. El
    // procedimiento la usa para convertir a unidad base -5 cajas de 1 L suben
    // 5000 ml-, y lo hacia desde el principio: lo que faltaba era mandarsela.
    // Sin presentacion el comportamiento es identico al de siempre.
    //
    // La v1 se declara vacia porque el parametro es obligatorio, no porque
    // sobre: el procedimiento une las dos tablas y llenar ambas duplicaria.
    const tvp2 = new sql.Table('dbo.PurchaseDetailType2');
    tvp2.columns.add('product_id',      sql.Int,            { nullable: false });
    tvp2.columns.add('quantity',        sql.Decimal(12, 2), { nullable: false });
    tvp2.columns.add('unit_price',      sql.Decimal(10, 2), { nullable: false });
    tvp2.columns.add('profit_percent',  sql.Decimal(5, 2),  { nullable: true  });
    tvp2.columns.add('presentation_id', sql.Int,            { nullable: true  });

    detalles.forEach(d => {
      const qty = d.cantidad ?? d.quantity ?? 0;
      const unitPrice = d.precio_unitario ?? d.unit_price ?? 0;
      const profit = d.profit_percent ?? d.profitPercent ?? 0;
      const presentacion = d.presentation_id ?? d.presentationId ?? null;

      // SOLO la v2. El procedimiento hace UNION ALL de las dos tablas, asi
      // que mandar la misma linea en ambas duplicaria la compra entera.
      // Es "una u otra", igual que @SaleDetails / @SaleDetails2 en la venta.
      tvp2.rows.add(d.product_id, qty, unitPrice, profit, presentacion);
    });

    const request = pool.request();
    request.input('user_id', sql.Int, user_id);
    request.input('supplier_id', sql.Int, supplier_id);
    request.input('tax_rate', sql.Decimal(5, 2), tax_rate);
    request.input('tax_amount', sql.Decimal(10, 2), tax_amount);
    request.input('subtotal', sql.Decimal(10, 2), subtotal);
    request.input('total', sql.Decimal(10, 2), total);

    request.input('PurchaseDetails', tvp);
    request.input('PurchaseDetails2', tvp2);

    // Como se pago. A credito -el valor de siempre- la compra no toca la
    // caja; en efectivo el procedimiento exige turno abierto y cuelga la
    // salida de ese turno para que salga en el corte.
    request.input('payment_method', sql.NVarChar(20), payment_method || 'CREDITO');
    request.input('register_id', sql.Int, Number(register_id) || null);

    const result = await request.execute('sp_register_purchase');
    const fila = result.recordset?.[0] ?? {};

    return {
      success: true,
      purchase_id: fila.purchase_id,
      payment_method: fila.payment_method ?? null,
      balance: fila.balance ?? null,
      cash_movement_id: fila.cash_movement_id ?? null,
      closure_id: fila.closure_id ?? null,
    };
  } catch (err) {
    console.error('❌ Error sp_register_purchase:', err);
    return { success: false, error: err.message };
  }
});


ipcMain.handle('sp-get-top-selling-products', async (event, data) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('sp_get_top_selling_product');

        return { success: true, data: result.recordset };
    } catch (err) {
        console.error('❌ Error en sp_get_top_selling_product:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('sp-get-total-sales-month', async (event, data) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('sp_get_total_sales_month');

        return { success: true, data: result.recordset };
    } catch (err) {
        console.error('❌ Error en sp_get_total_sales_month:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('sp-get-total-sales-today', async (event, data) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('sp_get_total_sales_today');

        return { success: true, data: result.recordset };
    } catch (err) {
        console.error('❌ Error en sp_get_total_sales_today:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('sp-get-total-orders', async (event, data) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('sp_get_total_orders');
        return { success: true, data: result.recordset };
    } catch (err) {
        console.error('❌ Error en sp_get_total_orders:', err);
        return { success: false, error: err.message };
    }
});

// main.js
ipcMain.handle('sp-get-cash-movements', async (_event, payload = {}) => {
  const {
    start_date = null,   // 'YYYY-MM-DD' o null
    end_date   = null,   // 'YYYY-MM-DD' o null
    user_id    = null,   // number o null
    typee      = null,   // string o null
    only_open  = 0,      // 0/1
    closure_id = null    // number o null
  } = payload;

  try {
    const pool = await poolPromise;

    const req = pool.request()
      .input('start_date', sql.Date, start_date)         
      .input('end_date',   sql.Date, end_date)
      .input('user_id',    sql.Int, user_id)
      .input('typee',      sql.NVarChar(20), typee)
      .input('only_open',  sql.Bit, only_open ? 1 : 0)
      .input('closure_id', sql.Int, closure_id);

    const result = await req.execute('sp_get_cash_movements');

    const rows = Array.isArray(result.recordsets?.[0]) ? result.recordsets[0] : [];
    const summary = (Array.isArray(result.recordsets?.[1]) && result.recordsets[1][0])
      ? result.recordsets[1][0]
      : { total_entradas: 0, total_salidas: 0, neto: 0 };

    return { success: true, data: { rows, summary } };
  } catch (err) {
    console.error('❌ sp-get-cash-movements:', err);
    return { success: false, error: err.message };
  }
});

//CUSTOMER

// CREATE
ipcMain.handle(
  'sp-create-customer',
  async (event, code, customerName, taxId, email, phone, creditLimit, termsDays, active, regimenFiscal, usoCfdi, razonSocial) => {
    try {
      const pool = await poolPromise;
      const request = pool.request();

      request
        .input('code',           sql.NVarChar(30),  code)
        .input('customerName',   sql.NVarChar(120), customerName)
        .input('tax_id',         sql.NVarChar(20),  taxId ?? null)
        .input('email',          sql.NVarChar(120), email)
        .input('phone',          sql.NVarChar(30),  phone)
        .input('credit_limit',   sql.Decimal(12, 2), creditLimit)
        .input('terms_days',     sql.Int,           termsDays)
        .input('active',         sql.Bit,           active)
        .input('regimen_fiscal', sql.NVarChar(5),   regimenFiscal ?? null)
        .input('uso_cfdi',       sql.NVarChar(5),   usoCfdi ?? null)
        .input('razon_social',   sql.NVarChar(255), razonSocial ?? null);

      request.output('NewId', sql.Int);

      const result = await request.execute('sp_create_customer');

      return {
        success: true,
        id: result.output.NewId
      };
    } catch (err) {
      console.error('Error al ejecutar sp_create_customer:', err);
      return { success: false, error: err.message };
    }
  }
);



ipcMain.handle('sp-get-customer', async (event, { id, code }) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();

    request.input('id',   sql.Int,          id   ?? null);
    request.input('code', sql.NVarChar(30), code ?? null);

    const result = await request.execute('sp_get_customer');
    const rows = result.recordset || [];

    return { success: true, data: rows };
  } catch (err) {
    console.error('❌ Error sp-get-customer:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-get-customers', async (event) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('sp_get_customers');
        return { success: true, data: result.recordset };
    } catch (err) {
        console.error('❌ Error en get-customers:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('sp-get-credit-customers', async () => {
  try {
    const pool = await poolPromise;
    const request = pool.request();

    const result = await request.execute('sp_get_customers_with_credit_available');

    console.log('sp_get_customers_with_credit_available result:', result.recordset); 

    return {
      success: true,
      data: result.recordset ?? []
    };
  } catch (err) {
    console.error('❌ Error en sp_get_customers_with_credit_available:', err);
    return {
      success: false,
      error: err.message
    };
  }
});

ipcMain.handle('sp-get-customers-summary', async () => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .execute('sp_get_customers_credit_summary');

    return { success: true, data: result.recordset ?? [] };
  } catch (err) {
    console.error('❌ Error sp_get_customers_credit_summary:', err);
    return { success: false, error: err.message };
  }
});



ipcMain.handle(
  'sp-update-customer', 
  async (event, id, code, customerName, taxId, email, phone, creditLimit, termsDays, active, regimenFiscal, usoCfdi, razonSocial, graceDays, lateFeePct, lateFeeFixed, riskLevel) => {
    try {
      const pool = await poolPromise;
      const request = pool.request();

      request
        .input('id',             sql.Int,           id)
        .input('code',           sql.NVarChar(30),  code ?? null)
        .input('customerName',   sql.NVarChar(120), customerName)
        .input('tax_id',         sql.NVarChar(20),  taxId ?? null)
        .input('email',          sql.NVarChar(120), email ?? null)
        .input('phone',          sql.NVarChar(30),  phone ?? null)
        .input('credit_limit',   sql.Decimal(12, 2), creditLimit)
        .input('terms_days',     sql.Int,           termsDays)
        .input('active',         sql.Bit,           active)
        .input('regimen_fiscal', sql.NVarChar(5),   regimenFiscal ?? null)
        .input('uso_cfdi',       sql.NVarChar(5),   usoCfdi ?? null)
        .input('razon_social',   sql.NVarChar(255), razonSocial ?? null)
        .input('grace_days',     sql.Int,           graceDays ?? 0)
        .input('late_fee_pct',   sql.Decimal(5, 2), lateFeePct ?? 0)
        .input('late_fee_fixed', sql.Decimal(12, 2), lateFeeFixed ?? 0)
        .input('risk_level',     sql.TinyInt,       riskLevel ?? 0);

      const result = await request.execute('sp_update_customer');

      return {
        success: true,
        rowsAffected: result.rowsAffected?.[0] ?? 0
      };
    } catch (err) {
      console.error('Error al ejecutar sp_update_customer:', err);
      return { success: false, error: err.message };
    }
  }
);

ipcMain.handle('sp-get-customer-open-sales', async (event, customerId) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('customer_id', sql.Int, customerId)
      .execute('sp_get_customer_open_credit_sales');

    return {
      success: true,
      data: result.recordset ?? []
    };
  } catch (err) {
    console.error('❌ Error sp_get_customer_open_credit_sales:', err);
    return {
      success: false,
      error: err.message
    };
  }
});

ipcMain.handle(
  'sp-register-customer-payment',
  async (event, customerId, saleId, amount, userId, paymentMethod, note) => {
    try {
      const pool = await poolPromise;
      const result = await pool.request()
        .input('customer_id',    sql.Int,          customerId)
        .input('sale_id',        sql.Int,          saleId)
        .input('amount',         sql.Decimal(10,2), amount)
        .input('user_id',        sql.Int,          userId)
        .input('payment_method', sql.NVarChar(50), paymentMethod)
        .input('note',           sql.NVarChar(255), note ?? null)
        .execute('sp_register_customer_payment');

      return {
        success: true,
        data: result.recordset ?? []
      };
    } catch (err) {
      console.error('❌ Error sp_register_customer_payment:', err);
      return {
        success: false,
        error: err.message
      };
    }
  }
);

// Envia bytes crudos (ESC/POS) directamente a una impresora de Windows via el spooler.
// Se usa para el pulso de apertura del cajon conectado a la impresora de tickets (RJ11).
// No requiere dependencias npm: usa PowerShell + Win32 (winspool.drv).
function printRawToPrinter(printerName, buffer) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      return reject(new Error('La impresion cruda solo esta disponible en Windows.'));
    }
    const { spawn } = require('child_process');
    const stamp = Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const binFile = path.join(os.tmpdir(), `wybix_drawer_${stamp}.bin`);
    const psFile  = path.join(os.tmpdir(), `wybix_drawer_${stamp}.ps1`);
    const pName = String(printerName).replace(/'/g, "''");
    const script = `
$ErrorActionPreference='Stop'
$src=[System.IO.File]::ReadAllBytes('${binFile.replace(/'/g, "''")}')
$code=@"
using System;
using System.Runtime.InteropServices;
public class WybixRaw {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool OpenPrinter(string s, out IntPtr h, IntPtr p);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool StartDocPrinter(IntPtr h, int l, ref DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);
  public static bool Send(string name, byte[] data){
    IntPtr h; if(!OpenPrinter(name, out h, IntPtr.Zero)) return false;
    DOCINFO di=new DOCINFO(); di.pDocName="Wybix Drawer"; di.pDataType="RAW"; bool ok=false;
    if(StartDocPrinter(h,1,ref di)){ if(StartPagePrinter(h)){ int w; ok=WritePrinter(h,data,data.Length,out w); EndPagePrinter(h);} EndDocPrinter(h);}
    ClosePrinter(h); return ok; }
}
"@
Add-Type -TypeDefinition $code -Language CSharp
if([WybixRaw]::Send('${pName}', $src)){ 'OK' } else { throw 'WritePrinter fallo' }
`;
    try {
      fs.writeFileSync(binFile, buffer);
      fs.writeFileSync(psFile, script, 'utf8');
    } catch (e) { return reject(e); }
    const cleanup = () => { try { fs.unlinkSync(binFile); } catch {} try { fs.unlinkSync(psFile); } catch {} };
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile], { windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (x) => out += x.toString());
    child.stderr.on('data', (x) => err += x.toString());
    child.on('error', (e) => { cleanup(); reject(e); });
    child.on('close', (code) => {
      cleanup();
      if (code === 0 && /OK/.test(out)) resolve(true);
      else reject(new Error((err || out || ('powershell salio con codigo ' + code)).trim()));
    });
  });
}

ipcMain.handle('open-cash-drawer', async (_event, payload = {}) => {
  try {
    const dcfg = loadDeviceConfig();
    const d = (dcfg && dcfg.drawer) || {};
    const conexion = String(payload?.conexion || d.conexion || 'usb');

    // Disparo automatico al cobrar: respetar "Habilitar" y "Abrir al cobrar".
    if (payload?.reason === 'payment' && (!d.enabled || !d.openOnPayment)) {
      return { success: true, skipped: true };
    }

    const pulseMs  = Number(payload?.pulseMs || d.pulseMs || 120);
    const pin      = Number(payload?.pin ?? d.pin ?? 0); // 0 default, 1 alternativo
    const cmd = buildDrawerKickCmd({ pulseMs, pin });

    // --- Modo: cajon conectado a la impresora de tickets (lo mas comun) ---
    if (conexion === 'impresora') {
      const printerName = String(
        payload?.printerName ||
        (dcfg && dcfg.printer && (dcfg.printer.ticketPrinterName || dcfg.printer.name)) || ''
      ).trim();
      if (!printerName) {
        return { success: false, error: 'Elige primero la impresora en Configuracion > Impresora de tickets.' };
      }
      try {
        await printRawToPrinter(printerName, cmd);
        return { success: true };
      } catch (e) {
        return { success: false, error: 'No se pudo enviar el pulso a la impresora: ' + (e?.message || String(e)) };
      }
    }

    // --- Modo: cajon por cable / serial (COM) ---
    const portPath = String(payload?.portPath || payload?.path || d.path || '').trim();
    const baudRate = Number(payload?.baudRate || d.baudRate || 9600);
    if (!portPath) {
      return { success: false, error: 'Configura el puerto del cajon en Configuracion > Cajon de dinero.' };
    }
    if (!Number.isFinite(baudRate) || baudRate <= 0) {
      return { success: false, error: 'baudRate invalido.' };
    }

    const result = await new Promise((resolve) => {
      const sp = new SerialPort({ path: portPath, baudRate, autoOpen: false });
      sp.open((openErr) => {
        if (openErr) return resolve({ ok: false, error: openErr.message });
        sp.write(cmd, (writeErr) => {
          if (writeErr) {
            try { sp.close(); } catch {}
            return resolve({ ok: false, error: writeErr.message });
          }
          sp.drain(() => {
            try { sp.close(); } catch {}
            resolve({ ok: true });
          });
        });
      });
    });

    if (!result.ok) {
      return { success: false, error: result.error || 'No se pudo abrir el cajon.' };
    }
    return { success: true };
  } catch (err) {
    console.error('open-cash-drawer:', err);
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('sp-get-daily-sales-last-7-days', async () => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .execute('sp_get_daily_sales_last_7_days');

    console.log('▶ sp_get_daily_sales_last_7_days result:', result.recordset);

    return {
      success: true,
      data: result.recordset || []
    };
  } catch (err) {
    console.error('❌ Error sp_get_daily_sales_last_7_days:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-get-daily-sales-current-month', async () => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .execute('sp_get_daily_sales_current_month');

    return {
      success: true,
      data: result.recordset || []
    };
  } catch (err) {
    console.error('❌ Error sp_get_daily_sales_current_month:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-get-profit-overview', async (event, { fromDate, toDate }) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();

    if (fromDate) {
      request.input('from_date', sql.Date, fromDate);
    }
    if (toDate) {
      request.input('to_date', sql.Date, toDate);
    }

    const result = await request.execute('sp_get_profit_overview');

    return {
      success: true,
      data: result.recordset ?? []
    };
  } catch (err) {
    console.error('❌ Error en sp_get_profit_overview:', err);
    return {
      success: false,
      error: err.message
    };
  }
});

//CIERRE DE CAJA

ipcMain.handle('sp-close-shift', async (event, payload) => {
  try {
    console.log('sp-close-shift payload RAW:', payload);

    const userId = parseInt(payload?.user_id ?? payload?.userId, 10);
    const cashDelivered = Number(payload?.cash_delivered ?? payload?.cashDelivered);
    const closureId = Number(payload?.closure_id ?? payload?.closureId);
    /* La caja de ESTE equipo como respaldo, nunca `null`.
       Un `null` aqui hacia que el procedimiento cayera a "la primera caja de
       la tabla" -la Caja 1- y validara el arriendo de una caja ajena. La
       identidad de caja de esta maquina vive en un solo sitio: su
       `device-config`, que es el mismo que se usa al abrir turno y al vender. */
    const registerId = payload?.register_id ?? payload?.registerId
      ?? loadDeviceConfig()?.register?.id ?? null;


    console.log('parsed:', { userId, cashDelivered });

    if (!Number.isFinite(userId)) {
      return { success: false, error: `user_id inválido: ${payload?.user_id ?? payload?.userId}` };
    }
    if (!Number.isFinite(cashDelivered)) {
      return { success: false, error: `cash_delivered inválido: ${payload?.cash_delivered ?? payload?.cashDelivered}` };
    }

    const pool = await poolPromise;
    const identCorte = cajaArrendada.identidad();
    const req = pool.request()
      .input('user_id', sql.Int, userId)
      .input('cash_delivered', sql.Decimal(12, 2), cashDelivered)
      .input('register_id', sql.Int, registerId)
      // Nadie cierra el corte de la caja de otro equipo por detras.
      .input('machine_id', sql.NVarChar(64), identCorte.machineId)
      .input('machine_name', sql.NVarChar(120), identCorte.machineName);

    if (Number.isFinite(closureId) && closureId > 0) {
      req.input('closure_id', sql.Int, closureId);
    }

    const result = await req.execute('sp_close_shift');

    return {
      success: true,
      data: result.recordset && result.recordset[0] ? result.recordset[0] : null
    };
  } catch (err) {
    console.error('Error en sp_close_shift:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-get-actual-folio', async () => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().execute('sp_get_actual_folio');
    const row = result.recordset?.[0] ?? null;
    return { success: true, data: row };
  } catch (err) {
    console.error('Error en sp_get_actual_folio:', err);
    return { success: false, error: err.message };
  }
});



ipcMain.handle('sp-get-active-users', async () => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT id, usuario, rol
      FROM users
      WHERE active = 1
      ORDER BY usuario
    `);
    return { success: true, data: result.recordset };
  } catch (err) {
    console.error('Error sp-get-active-users:', err);
    return { success: false, error: err.message };
  }
});

// ===== Usuarios y permisos =====
const ROLES_VALIDOS = ['admin', 'supervisor', 'cajero'];

// ===== Alertas: productos agotados (stock 0) =====
ipcMain.handle('alerts:out-of-stock', async () => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().query(`
      -- Solo los que SE CUENTAN. Un producto por receta tiene stock 0 por
      -- diseno -su disponibilidad sale de los ingredientes- y uno sin
      -- inventario no tiene existencias: los dos aparecian aqui como
      -- "agotados" para siempre, y una alerta que siempre esta encendida deja
      -- de leerse.
      SELECT id, nombre, part_number, stock
      FROM products
      WHERE active = 1 AND inventory_mode = 'DIRECT' AND stock <= 0
      ORDER BY nombre
    `);
    return { success: true, data: r.recordset || [] };
  } catch (e) { console.error('alerts:out-of-stock:', e); return { success: false, error: e.message }; }
});

// ===== Alertas: ventas en $0 (posible anomalia) =====
ipcMain.handle('alerts:zero-sales', async (_e, p = {}) => {
  try {
    const dias = Number(p.dias) || 30;
    const pool = await poolPromise;
    const r = await pool.request()
      .input('dias', sql.Int, dias)
      .query(`
        SELECT TOP 200 s.id, s.datee, s.total, u.usuario
        FROM sales s
        LEFT JOIN users u ON u.id = s.useer_id
        WHERE s.total = 0
          AND s.datee >= DATEADD(DAY, -@dias, CAST(GETDATE() AS DATE))
        ORDER BY s.datee DESC
      `);
    return { success: true, data: r.recordset || [] };
  } catch (e) { console.error('alerts:zero-sales:', e); return { success: false, error: e.message }; }
});

// ===== Alertas: descuadre en corte de caja (robo hormiga) =====
ipcMain.handle('alerts:cash-closures', async (_e, p = {}) => {
  try {
    const dias = Number(p.dias) || 30;
    const start = new Date(Date.now() - dias * 86400000);
    const end = new Date();
    const pool = await poolPromise;
    const r = await pool.request()
      .input('start_date', sql.Date, start)
      .input('end_date', sql.Date, end)
      .execute('sp_get_cash_closures');
    return { success: true, data: r.recordset || [] };
  } catch (e) { console.error('alerts:cash-closures:', e); return { success: false, error: e.message }; }
});

// ===== Alertas: devoluciones por cajero (robo hormiga) =====
ipcMain.handle('alerts:refunds-by-cashier', async () => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().query(`
      SELECT sr.user_id, u.usuario, COUNT(*) AS num_devoluciones, SUM(sr.refund_total) AS monto
      FROM sale_refunds sr
      LEFT JOIN users u ON u.id = sr.user_id
      GROUP BY sr.user_id, u.usuario
      ORDER BY num_devoluciones DESC
    `);
    return { success: true, data: r.recordset || [] };
  } catch (e) { console.error('alerts:refunds-by-cashier:', e); return { success: false, error: e.message }; }
});

// ===== Alertas: credito vencido (cobranza) =====
ipcMain.handle('alerts:overdue-credit', async () => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().query(`
      SELECT s.customer_id,
             SUM(s.balance) AS deuda_vencida,
             MIN(s.due_date) AS vence,
             DATEDIFF(DAY, MIN(s.due_date), CAST(GETDATE() AS DATE)) AS dias_vencido,
             COUNT(*) AS facturas
      FROM sales s
      WHERE UPPER(s.payment_method) = 'CREDITO'
        AND s.balance > 0
        AND s.due_date < CAST(GETDATE() AS DATE)
        AND s.customer_id IS NOT NULL
      GROUP BY s.customer_id
      ORDER BY deuda_vencida DESC
    `);
    return { success: true, data: r.recordset || [] };
  } catch (e) { console.error('alerts:overdue-credit:', e); return { success: false, error: e.message }; }
});

// ===== Alertas: stock bajo (punto de reorden fijo) =====
ipcMain.handle('alerts:low-stock', async (_e, p = {}) => {
  try {
    const min = Number(p.min) || 3;
    const pool = await poolPromise;
    const r = await pool.request().input('min', sql.Int, min).query(`
      SELECT id, nombre, part_number, stock
      FROM products
      WHERE active = 1 AND inventory_mode = 'DIRECT' AND stock > 0 AND stock <= @min
      ORDER BY stock ASC, nombre
    `);
    return { success: true, data: r.recordset || [] };
  } catch (e) { console.error('alerts:low-stock:', e); return { success: false, error: e.message }; }
});

// ===== Alertas: conteo total (para el badge del menu) =====
ipcMain.handle('alerts:counts', async (_e, p = {}) => {
  try {
    const min = Number(p.min) || 3;
    const pool = await poolPromise;
    const one = async (text, inputs) => {
      const req = pool.request();
      (inputs || []).forEach(([n, t, v]) => req.input(n, t, v));
      const r = await req.query(text);
      return Number(r.recordset[0]?.c || 0);
    };
    // Mismo criterio que las listas: si el contador y la lista no cuentan lo
    // mismo, la cabecera dice 3 y el detalle ensena 1.
    const agotados   = await one(`SELECT COUNT(*) c FROM products WHERE active=1 AND inventory_mode='DIRECT' AND stock<=0`);
    const lowstock   = await one(`SELECT COUNT(*) c FROM products WHERE active=1 AND inventory_mode='DIRECT' AND stock>0 AND stock<=@min`, [['min', sql.Int, min]]);
    const cero       = await one(`SELECT COUNT(*) c FROM sales WHERE total=0 AND datee>=DATEADD(DAY,-30,CAST(GETDATE() AS DATE))`);
    const vencidos   = await one(`SELECT COUNT(DISTINCT customer_id) c FROM sales WHERE UPPER(payment_method)='CREDITO' AND balance>0 AND due_date<CAST(GETDATE() AS DATE) AND customer_id IS NOT NULL`);
    const descuadres = await one(`SELECT COUNT(*) c FROM cash_closures WHERE difference<>0 AND CAST(create_date AS DATE)>=DATEADD(DAY,-30,CAST(GETDATE() AS DATE))`);
    let reorden = 0;
    try {
      const rr = await pool.request()
        .input('dias_ventana', sql.Int, 30).input('dias_alerta', sql.Int, 7).input('dias_objetivo', sql.Int, 30)
        .execute('sp_reorder_suggestions');
      reorden = (rr.recordset || []).length;
    } catch { /* si el SP no existe aun */ }
    const total = agotados + lowstock + cero + vencidos + descuadres + reorden;
    return { success: true, data: { agotados, lowstock, cero, vencidos, descuadres, reorden, total } };
  } catch (e) { console.error('alerts:counts:', e); return { success: false, error: e.message }; }
});

// ===== Conteo fisico: aplicar ajustes de inventario =====
ipcMain.handle('inventory:apply-count', async (_e, p = {}) => {
  try {
    const items = Array.isArray(p.items) ? p.items : [];
    if (!items.length) return { success: false, error: 'No hay conteos para aplicar.' };
    const pool = await poolPromise;
    let ajustados = 0;
    for (const it of items) {
      const pid = Number(it.product_id);
      const fisico = Number(it.fisico);
      if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(fisico) || fisico < 0) continue;
      const cur = await pool.request().input('id', sql.Int, pid).query('SELECT stock FROM products WHERE id=@id');
      const teorico = Number(cur.recordset[0]?.stock ?? 0);
      const diff = fisico - teorico;
      if (diff === 0) continue;
      await pool.request().input('id', sql.Int, pid).input('s', sql.Decimal(12, 2), fisico)
        .query('UPDATE products SET stock=@s WHERE id=@id');
      await pool.request()
        .input('pid', sql.Int, pid)
        .input('t', sql.NVarChar(20), diff > 0 ? 'entrada' : 'salida')
        .input('q', sql.Decimal(12, 2), Math.abs(diff))
        .input('d', sql.NVarChar(200), 'Ajuste por conteo fisico (dif ' + diff + ')')
        .query(`INSERT INTO inventory_movements (product_id, typee, reference, quantity, datee, descriptionn)
                VALUES (@pid, @t, 'CONTEO', @q, GETDATE(), @d)`);
      ajustados++;
    }
    return { success: true, ajustados };
  } catch (e) { console.error('inventory:apply-count:', e); return { success: false, error: e.message }; }
});

// ===== Alertas: reorden inteligente =====
ipcMain.handle('alerts:reorder', async (_e, p = {}) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request()
      .input('dias_ventana',  sql.Int, Number(p.dias_ventana)  || 30)
      .input('dias_alerta',   sql.Int, Number(p.dias_alerta)   || 7)
      .input('dias_objetivo', sql.Int, Number(p.dias_objetivo) || 30)
      .execute('sp_reorder_suggestions');
    return { success: true, data: r.recordset || [] };
  } catch (e) {
    console.error('alerts:reorder:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('users:list', async () => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().query(`
      SELECT id, usuario, rol, active, creation_date
      FROM users
      ORDER BY active DESC, usuario
    `);
    return { success: true, data: r.recordset };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('users:create', async (_e, p = {}) => {
  try {
    const usuario = String(p.usuario ?? '').trim();
    const password = String(p.password ?? '');
    const rol = String(p.rol ?? 'cajero').trim().toLowerCase();
    if (usuario.length < 3) return { success: false, error: 'El usuario debe tener al menos 3 caracteres.' };
    if (password.length < 6) return { success: false, error: 'La contrasena debe tener al menos 6 caracteres.' };
    if (!ROLES_VALIDOS.includes(rol)) return { success: false, error: 'Rol invalido.' };

    const pool = await poolPromise;
    const dup = await pool.request().input('u', sql.NVarChar(50), usuario).query('SELECT 1 FROM users WHERE usuario = @u');
    if (dup.recordset.length) return { success: false, error: 'Ese usuario ya existe.' };

    await pool.request()
      .input('usuario', sql.NVarChar(50), usuario)
      .input('password', sql.NVarChar(255), password)
      .input('rol', sql.NVarChar(20), rol)
      .query(`INSERT INTO users (usuario, password_hash, rol, active, creation_date)
              VALUES (@usuario, CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', @password), 2), @rol, 1, GETDATE())`);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('users:update-role', async (_e, p = {}) => {
  try {
    const id = Number(p.id);
    const rol = String(p.rol ?? '').trim().toLowerCase();
    if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'id invalido.' };
    if (!ROLES_VALIDOS.includes(rol)) return { success: false, error: 'Rol invalido.' };
    const pool = await poolPromise;
    if (rol !== 'admin') {
      const t = await pool.request().input('id', sql.Int, id).query('SELECT rol FROM users WHERE id = @id');
      if (t.recordset[0]?.rol === 'admin') {
        const c = await pool.request().query("SELECT COUNT(*) c FROM users WHERE active = 1 AND rol = 'admin'");
        if (c.recordset[0].c <= 1) return { success: false, error: 'Debe quedar al menos un administrador.' };
      }
    }
    await pool.request().input('id', sql.Int, id).input('rol', sql.NVarChar(20), rol)
      .query('UPDATE users SET rol = @rol WHERE id = @id');
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('users:reset-password', async (_e, p = {}) => {
  try {
    const id = Number(p.id);
    const password = String(p.password ?? '');
    if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'id invalido.' };
    if (password.length < 6) return { success: false, error: 'La contrasena debe tener al menos 6 caracteres.' };
    const pool = await poolPromise;
    await pool.request().input('id', sql.Int, id).input('password', sql.NVarChar(255), password)
      .query(`UPDATE users SET password_hash = CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', @password), 2) WHERE id = @id`);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('users:set-active', async (_e, p = {}) => {
  try {
    const id = Number(p.id);
    const active = p.active ? 1 : 0;
    if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'id invalido.' };
    const pool = await poolPromise;
    if (!active) {
      const t = await pool.request().input('id', sql.Int, id).query('SELECT rol FROM users WHERE id = @id');
      if (t.recordset[0]?.rol === 'admin') {
        const c = await pool.request().query("SELECT COUNT(*) c FROM users WHERE active = 1 AND rol = 'admin'");
        if (c.recordset[0].c <= 1) return { success: false, error: 'No puedes desactivar al unico administrador.' };
      }
    }
    await pool.request().input('id', sql.Int, id).input('a', sql.Bit, active)
      .query('UPDATE users SET active = @a WHERE id = @id');
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// Pago a Proveedores

ipcMain.handle('sp-register-supplier-payment', async (event, payload) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('user_id',        sql.Int,          payload.user_id)
      .input('supplier_id',    sql.Int,          payload.supplier_id)
      .input('purchase_id',    sql.Int,          payload.purchase_id)
      .input('amount',         sql.Decimal(10,2),payload.amount)
      .input('payment_method', sql.NVarChar(50), payload.payment_method)
      .input('note',           sql.NVarChar(255),payload.note || null)
      .input('register_id',    sql.Int,          Number(payload.register_id) || null)
      .execute('sp_register_supplier_payment');

    return { success: true, data: result.recordset[0] ?? null };
  } catch (err) {
    console.error('sp_register_supplier_payment:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-register-cash-out', async (event, payload) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('user_id', sql.Int, payload.user_id)
      .input('amount', sql.Decimal(10,2), payload.amount)
      .input('note', sql.NVarChar(255), payload.note || null)
      .input('register_id', sql.Int, payload.register_id ?? null)
      .execute('sp_register_cash_out');

    return { success: true, data: result.recordset?.[0] ?? null };
  } catch (err) {
    console.error('sp_register_cash_out:', err);
    return { success: false, error: err.message };
  }
});


async function loadSaleFromDbWithSp(saleId) {
  const pool = await poolPromise;

  const result = await pool
    .request()
    .input('sale_id', sql.Int, saleId)
    .execute('sp_get_sale_ticket');

  const headerSet = result.recordsets[0] || [];
  const linesSet  = result.recordsets[1] || [];

  if (!headerSet.length) {
    throw new Error(`No se encontró la venta ${saleId}`);
  }

  return {
    header: headerSet[0],
    lines: linesSet,
  };
}

function ensureTicketsDir() {
  const baseDir = path.join(app.getPath('documents'), 'TicketsPOS');
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return baseDir;
}

function formatDateTimeEsMX(d) {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

async function generateSaleTicketPdf(header, lines, extras = {}) {
  await ensureBusinessConfig();

  // MISMO constructor que la impresion. Antes habia dos copias con el mismo
  // error de IVA y el mismo logo ajeno: arreglar una dejaba la otra rota.
  const paperWidthMm = Number(extras.paperWidthMm) > 0 ? Number(extras.paperWidthMm) : 80;
  const fecha = (typeof formatDateTimeEsMX === "function")
    ? formatDateTimeEsMX(header?.datee) : String(header?.datee ?? "");

  const filledHtml = construirTicketHtml(header, lines, {
    ...ticketExtrasComunes(paperWidthMm),
    fecha,
    pagado: extras.pagado,
    cambio: extras.cambio,
    payment_method: extras.payment_method,
  });

  const pdfPath = path.join(ensureTicketsDir(), `ticket_${header.id}.pdf`);
  await htmlToPdf(filledHtml, {
    outPath: pdfPath,
    // El alto lo decide el contenido; el ancho, el papel configurado.
    pageSize: { widthMm: paperWidthMm, heightMm: 279.4 },
    printBackground: true,
  });
  return pdfPath;
}

ipcMain.handle("generate-sale-pdf", async (event, payload) => {
  try {
    const { saleId, pagado, cambio } =
      typeof payload === "object"
        ? payload
        : { saleId: payload, pagado: null, cambio: null };

    if (!saleId) {
      throw new Error("ID de venta no proporcionado");
    }

    const { header, lines } = await loadSaleFromDbWithSp(saleId);

    const pdfPath = await generateSaleTicketPdf(header, lines, {
      pagado,
      cambio,
    });

    await shell.openPath(pdfPath);
    return { success: true, path: pdfPath };
  } catch (err) {
    console.error("❌ Error generate-sale-pdf:", err);
    return { success: false, error: err.message || "Error al generar PDF" };
  }
});

ipcMain.handle('sp-get-sales', async (_event, payload = {}) => {
  try {
    const { start_date = null, end_date = null } = payload;
    const pool = await poolPromise;

    const result = await pool.request()
      .input('start_date', sql.Date, start_date)
      .input('end_date',   sql.Date, end_date)
      .execute('sp_get_sales_filtered');

    return { success: true, data: result.recordset ?? [] };
  } catch (err) {
    console.error('❌ sp-get-sales:', err);
    return { success: false, error: err.message };
  }
});


ipcMain.handle('export-sales-pdf', async (_event, payload = {}) => {
  try {
    const { start_date = null, end_date = null } = payload;

    const pool = await poolPromise;
    const result = await pool.request()
      .input('start_date', sql.Date, start_date)
      .input('end_date',   sql.Date, end_date)
      .execute('sp_get_sales_filtered');

    const sales = result.recordset ?? [];
    if (!sales.length) {
      return { success: false, error: 'No hay ventas en ese rango.' };
    }

    const cfg = await ensureBusinessConfig();

    const docs = [];
    for (const s of sales) {
      const { header, lines } = await loadSaleFromDbWithSp(s.id);
      docs.push({ header, lines });
    }

    const pdfPath = await generateSalesBatchA4Pdf(docs, { businessConfig: cfg, start_date, end_date });
    await shell.openPath(pdfPath); 
    return { success: true, count: 1, paths: [pdfPath] };

  } catch (err) {
    console.error('export-sales-pdf:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-get-open-shift', async (event, payload) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('user_id', sql.Int, payload.user_id)
      .input('date', sql.Date, payload.date || null) 
      .input('register_id', sql.Int, payload.register_id ?? null)
      .execute('sp_get_open_shift');

    return { success: true, data: result.recordset?.[0] ?? null };
  } catch (err) {
    console.error('❌ sp_get_open_shift:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-open-shift', async (event, payload) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('user_id', sql.Int, payload.user_id)
      .input('opening_cash', sql.Decimal(12,2), Number(payload.opening_cash ?? 0))
      // El servicio manda `opening_note`, con el mismo nombre que el
      // parametro del procedimiento. Este handler solo leia `note`, asi que la
      // nota que escribe el cajero al abrir el turno se perdia en silencio.
      .input('opening_note', sql.NVarChar(255), payload.opening_note ?? payload.note ?? null)
      .input('opening_user_id', sql.Int, payload.opening_user_id ?? payload.user_id)
      .input('register_id', sql.Int, payload.register_id ?? null)
      // Abrir turno en una caja ajena crearia un turno compartido entre dos
      // equipos. Lo rechaza el procedimiento, no la pantalla.
      .input('machine_id', sql.NVarChar(64), cajaArrendada.identidad().machineId)
      .input('machine_name', sql.NVarChar(120), cajaArrendada.identidad().machineName)
      .execute('sp_open_shift');

    return { success: true, data: result.recordset?.[0] ?? null };
  } catch (err) {
    console.error('sp_open_shift:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-update-sale', async (event, payload) => {
  try {
    const saleId = Number(payload?.sale_id ?? payload?.saleId ?? 0);
    const userId = Number(payload?.user_id ?? payload?.userId ?? 0);
    const items = payload?.items ?? [];
    const note = payload?.note ?? null;

    if (!Number.isFinite(saleId) || saleId <= 0) throw new Error('sale_id inválido.');
    if (!Number.isFinite(userId) || userId <= 0) throw new Error('user_id inválido.');
    if (!Array.isArray(items) || items.length === 0) throw new Error('La venta no tiene partidas.');

    const pool = await poolPromise;

    // TVP (mismo tipo que usas en register sale)
    // El nombre del tipo es OBLIGATORIO para msnodesqlv8: sin el, la llamada
    // falla con "Catalog or schema name of XML schema collection...", un
    // mensaje que no menciona el problema real.
    const tvp = new sql.Table('dbo.SaleDetailType');
    tvp.columns.add('product_id', sql.Int, { nullable: false });
    tvp.columns.add('quantity',   sql.Decimal(12, 2), { nullable: false });
    tvp.columns.add('unit_price', sql.Decimal(10, 2), { nullable: false });

    for (const it of items) {
      const pid = Number(it.productId ?? it.product_id);
      const qty = Number(it.qty ?? it.quantity);
      const up  = Number(it.unitPrice ?? it.unit_price);

      if (!Number.isFinite(pid) || pid <= 0) throw new Error('Producto inválido en detalle.');
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Cantidad inválida en detalle.');
      if (!Number.isFinite(up)  || up < 0)   throw new Error('Precio inválido en detalle.');

      tvp.rows.add(pid, qty, up);
    }

    const req = pool.request()
      .input('sale_id',     sql.Int, saleId)
      .input('user_id',     sql.Int, userId)
      .input('SaleDetails', tvp)
      .input('note',        sql.NVarChar(250), note);

    const result = await req.execute('sp_update_sale');

    return {
      success: true,
      data: result.recordset ?? []
    };
  } catch (err) {
    console.error('❌ Error en sp_update_sale:', err);
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('sp-get-sale-by-folio', async (event, payload) => {
  try {
    const saleId =
      typeof payload === 'number' ? payload :
      typeof payload === 'string' ? Number(payload) :
      Number(payload?.sale_id ?? payload?.saleId ?? payload?.id ?? 0);

    if (!Number.isFinite(saleId) || saleId <= 0) {
      throw new Error('Folio inválido.');
    }

    const pool = await poolPromise;

    const req = pool.request()
      .input('sale_id', sql.Int, saleId);

    const result = await req.execute('sp_get_sale_by_folio');

    const header = result.recordsets?.[0]?.[0] ?? null;
    const details = result.recordsets?.[1] ?? [];

    return {
      success: true,
      data: { header, details }
    };
  } catch (err) {
    console.error('❌ Error en sp_get_sale_by_folio:', err);
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('sp-refund-sale', async (event, payload) => {
  try {
    const saleId = Number(payload?.sale_id ?? payload?.saleId ?? 0);
    const userId = Number(payload?.user_id ?? payload?.userId ?? 0);
    const paymentMethod = String(payload?.payment_method ?? payload?.paymentMethod ?? 'EFECTIVO');
    const items = payload?.items ?? [];
    const note = payload?.note ?? null;
    const applyNetUpdate = payload?.apply_net_update ? 1 : 0;

    if (!Number.isFinite(saleId) || saleId <= 0) throw new Error('sale_id inválido.');
    if (!Number.isFinite(userId) || userId <= 0) throw new Error('user_id inválido.');
    if (!Array.isArray(items) || items.length === 0) throw new Error('El reembolso no tiene partidas.');

    const pool = await poolPromise;

    // El nombre del tipo es OBLIGATORIO para msnodesqlv8: sin el, la llamada
    // falla con "Catalog or schema name of XML schema collection...", un
    // mensaje que no menciona el problema real.
    const tvp = new sql.Table('dbo.SaleDetailType');
    tvp.columns.add('product_id', sql.Int, { nullable: false });
    tvp.columns.add('quantity',   sql.Decimal(12, 2), { nullable: false });
    tvp.columns.add('unit_price', sql.Decimal(10, 2), { nullable: false });

    for (const it of items) {
      const pid = Number(it.productId ?? it.product_id);
      const qty = Number(it.qty ?? it.quantity);
      const up  = Number(it.unitPrice ?? it.unit_price ?? 0);

      if (!Number.isFinite(pid) || pid <= 0) throw new Error('Producto inválido en reembolso.');
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Cantidad inválida en reembolso.');
      if (!Number.isFinite(up)  || up < 0)   throw new Error('Precio inválido en reembolso.');

      tvp.rows.add(pid, qty, up);
    }

    const req = pool.request()
      .input('sale_id',        sql.Int, saleId)
      .input('user_id',        sql.Int, userId)
      .input('payment_method', sql.NVarChar(50), paymentMethod)
      .input('RefundDetails',  tvp)
      .input('note',           sql.NVarChar(250), note)
      .input('apply_net_update', sql.Bit, applyNetUpdate ? 1 : 0);

    const result = await req.execute('sp_refund_sale');

    return {
      success: true,
      data: result.recordset ?? []
    };
  } catch (err) {
    console.error('❌ Error en sp_refund_sale:', err);
    return { success: false, error: err?.message || String(err) };
  }
});

async function loadSaleByFolioFromDb(saleId) {
  const pool = await poolPromise;

  const result = await pool
    .request()
    .input('sale_id', sql.Int, saleId)
    .execute('sp_get_sale_by_folio');

  const header = result.recordsets?.[0]?.[0] ?? null;
  const details = result.recordsets?.[1] ?? [];

  if (!header) throw new Error(`No se encontró la venta ${saleId}`);
  return { header, details };
}

function escHtmlTicket(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function moneyTicket(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

/**
 * Ruta de la imagen del ticket, si el negocio configuro una.
 *
 * Antes iba fija `assets/LogoHidromec.jpg`: CUALQUIER negocio imprimia la
 * marca de otro cliente en su ticket. Ahora se busca un archivo que el
 * negocio pone en su propia carpeta de datos; si no hay, el ticket se
 * encabeza con el nombre del negocio, que es lo correcto.
 */
function ticketLogoUrl() {
  try {
    const base = app.getPath('userData');
    for (const nombre of ['ticket-logo.png', 'ticket-logo.jpg', 'ticket-logo.jpeg']) {
      const p = path.join(base, nombre);
      if (fs.existsSync(p)) return 'file://' + p.split(path.sep).join('/');
    }
  } catch { /* sin carpeta de datos accesible */ }
  return null;
}

/** Plantilla + datos del negocio, comunes al PDF y a la impresion. */
function ticketExtrasComunes(paperWidthMm) {
  return {
    plantilla: fs.readFileSync(path.join(__dirname, 'templates', 'ticket.html'), 'utf8'),
    paperWidthMm,
    logoUrl: ticketLogoUrl(),
    negocio: {
      business_name: businessConfig?.business_name || '',
      address: businessConfig?.address || '',
      phone: businessConfig?.phone || '',
      rfc: businessConfig?.rfc || '',
      ticket_footer: businessConfig?.ticket_footer || '',
    },
  };
}

function buildTicketHtmlFromTemplate(header, details, extras = {}) {
  const paperWidthMm = Number(extras.paperWidthMm) > 0 ? Number(extras.paperWidthMm) : 58;
  const fecha = (typeof formatDateTimeEsMX === 'function')
    ? formatDateTimeEsMX(header?.datee) : String(header?.datee ?? '');
  return construirTicketHtml(header, details, {
    ...ticketExtrasComunes(paperWidthMm),
    fecha,
    pagado: extras.pagado,
    cambio: extras.cambio,
    payment_method: extras.payment_method,
  });
}

ipcMain.handle('print-sale-ticket', async (_event, payload = {}) => {
  let printWin = null;

  try {
    const saleId = Number(payload?.saleId ?? payload?.sale_id ?? 0);
    if (!Number.isFinite(saleId) || saleId <= 0) {
      return { success: false, error: 'saleId inválido' };
    }

    await ensureBusinessConfig();

    const { header, details } = await loadSaleByFolioFromDb(saleId);

    // Ancho de papel (mm): payload > config de la impresora > 58 por defecto.
    let paperWidthMm = Number(payload?.paperWidthMm) || 0;
    if (!paperWidthMm) {
      try {
        const dc = loadDeviceConfig();
        const ps = String(dc?.printer?.paperSize || '');
        if (/80/.test(ps)) paperWidthMm = 80;
        else if (/58/.test(ps)) paperWidthMm = 58;
      } catch {}
    }
    if (!paperWidthMm) paperWidthMm = 58;

    const html = buildTicketHtmlFromTemplate(header, details, {
      pagado: payload?.pagado ?? payload?.paid ?? null,
      cambio: payload?.cambio ?? payload?.change ?? null,
      payment_method: payload?.paymentMethod ?? payload?.payment_method ?? null,
      paperWidthMm
    });

    printWin = new BrowserWindow({
      show: false,
      width: 420,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        sandbox: false
      }
    });

    await printWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));

    // Esperar render y medir el alto real del contenido para no sacar papel en blanco de mas.
    await new Promise(r => setTimeout(r, 200));
    let heightPx = 0;
    try { heightPx = Number(await printWin.webContents.executeJavaScript('document.body.scrollHeight')) || 0; } catch {}
    if (!heightPx || heightPx < 40) heightPx = 500;

    const MICRON_PER_PX = 25400 / 96; // 1px @96dpi = 264.58 micras
    const widthMicrons  = Math.round(paperWidthMm * 1000);
    const heightMicrons = Math.round((heightPx + 12) * MICRON_PER_PX);

    const silent = payload?.silent !== false;
    const deviceName = payload?.printerName || undefined;
    const ok = await new Promise((resolve) => {
      printWin.webContents.print(
        {
          silent,
          printBackground: true,
          deviceName,
          margins: { marginType: 'none' },
          pageSize: { width: widthMicrons, height: heightMicrons }
        },
        (success, failureReason) => {
          if (!success) console.error('Print failed:', failureReason);
          resolve(success);
        }
      );
    });

    try { printWin.close(); } catch {}

    if (!ok) {
      return { success: false, error: 'No se pudo imprimir (revisa impresora predeterminada / driver / deviceName).' };
    }


    return { success: true };
  } catch (err) {
    console.error('❌ print-sale-ticket:', err);
    try { if (printWin) printWin.close(); } catch {}
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('devices:list-serial-ports', async () => {
  try {
    const ports = await listSerialPorts();
    const data = ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer || '',
      serialNumber: p.serialNumber || '',
      vendorId: p.vendorId || '',
      productId: p.productId || ''
    }));
    return { success: true, data };
  } catch (err) {
    console.error('devices:list-serial-ports:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('devices:list-printers', async () => {
  try {
    if (!mainWindow) throw new Error('Ventana principal no disponible');
    const printers = await mainWindow.webContents.getPrintersAsync();
    const data = printers.map(p => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: !!p.isDefault,
      status: p.status || 0,
      description: p.description || ''
    }));
    return { success: true, data };
  } catch (err) {
    console.error('devices:list-printers:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('devices:get-config', async () => {
  try {
    return { success: true, data: loadDeviceConfig() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('devices:set-config', async (_event, partialCfg = {}) => {
  try {
    const current = loadDeviceConfig();
    const merged = {
      ...current,
      ...partialCfg,
      scanner: { ...(current.scanner || {}), ...(partialCfg.scanner || {}) },
      printer: { ...(current.printer || {}), ...(partialCfg.printer || {}) },
      drawer: { ...(current.drawer || {}), ...(partialCfg.drawer || {}) },
      customerDisplay: { ...(current.customerDisplay || {}), ...(partialCfg.customerDisplay || {}) }
    };

    saveDeviceConfig(merged);

    // Solo se arranca el lector serial cuando la conexion del scanner es 'usb' (serial COM)
    const scannerSerial = merged.scanner?.conexion === 'usb' && merged.scanner?.path;
    if (scannerSerial) {
      startSerialScanner(mainWindow, {
        path: merged.scanner.path,
        baudRate: merged.scanner.baudRate || 9600
      });
    } else {
      stopSerialScanner();
    }

    return { success: true, data: merged };
  } catch (err) {
    console.error('devices:set-config:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-get-purchases', async (event) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('sp_get_purchases');
        return { success: true, data: result.recordset };
    } catch (err) {
        console.error('❌ Error en get-purchases:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('sp-get-user-by-id', async (event, userId) => { 
    try {
        const pool = await poolPromise;
        const result = await pool.request()
        .input('userID', sql.Int, userId)
        .execute('sp_get_user_by_id');
    
        if (result.recordset.length > 0) {
        return { success: true, user: result.recordset[0] };
        } else {
        return { success: false, message: 'Usuario no encontrado' };
        }
    } catch (err) {
        console.error('❌ Error en get-user-by-id:', err);
        return { success: false, error: err.message };
    }
});

// PRODUCT SUPPLIERS (proveedores por producto)

// Lista proveedores vinculados a un producto
ipcMain.handle('sp-get-product-suppliers', async (_event, payload) => {
  try {
    const product_id = Number(payload?.product_id ?? payload?.productId ?? 0);
    const only_active = payload?.only_active ?? payload?.onlyActive ?? 1;

    if (!Number.isFinite(product_id) || product_id <= 0) {
      return { success: false, error: 'product_id inválido' };
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input('product_id', sql.Int, product_id)
      .input('only_active', sql.Bit, only_active ? 1 : 0)
      .execute('sp_get_product_suppliers');

    return { success: true, data: result.recordset ?? [] };
  } catch (err) {
    console.error('❌ sp-get-product-suppliers:', err);
    return { success: false, error: err.message };
  }
});

// Agrega/actualiza vínculo producto-proveedor
ipcMain.handle('sp-upsert-product-supplier', async (_event, payload) => {
  try {
    const product_id  = Number(payload?.product_id ?? payload?.productId ?? 0);
    const supplier_id = Number(payload?.supplier_id ?? payload?.supplierId ?? 0);

    const is_default  = payload?.is_default ?? payload?.isDefault ?? 0;
    const active      = payload?.active ?? 1;

    // last_cost puede venir null
    const last_cost_raw = payload?.last_cost ?? payload?.lastCost ?? null;
    const last_cost = (last_cost_raw === null || last_cost_raw === '' || last_cost_raw === undefined)
      ? null
      : Number(last_cost_raw);

    if (!Number.isFinite(product_id) || product_id <= 0) return { success: false, error: 'product_id inválido' };
    if (!Number.isFinite(supplier_id) || supplier_id <= 0) return { success: false, error: 'supplier_id inválido' };
    if (last_cost !== null && !Number.isFinite(last_cost)) return { success: false, error: 'last_cost inválido' };

    const pool = await poolPromise;
    const req = pool.request()
      .input('product_id',  sql.Int, product_id)
      .input('supplier_id', sql.Int, supplier_id)
      .input('is_default',  sql.Bit, is_default ? 1 : 0)
      .input('active',      sql.Bit, active ? 1 : 0);

    req.input('last_cost', sql.Decimal(10,2), last_cost);

    const result = await req.execute('sp_upsert_product_supplier');
    return { success: true, data: result.recordset ?? [] };
  } catch (err) {
    console.error('❌ sp-upsert-product-supplier:', err);
    return { success: false, error: err.message };
  }
});

// Poner proveedor default
ipcMain.handle('sp-set-product-default-supplier', async (_event, payload) => {
  try {
    const product_id  = Number(payload?.product_id ?? payload?.productId ?? 0);
    const supplier_id = Number(payload?.supplier_id ?? payload?.supplierId ?? 0);

    if (!Number.isFinite(product_id) || product_id <= 0) return { success: false, error: 'product_id inválido' };
    if (!Number.isFinite(supplier_id) || supplier_id <= 0) return { success: false, error: 'supplier_id inválido' };

    const pool = await poolPromise;
    const result = await pool.request()
      .input('product_id',  sql.Int, product_id)
      .input('supplier_id', sql.Int, supplier_id)
      .execute('sp_set_product_default_supplier');

    return { success: true, data: result.recordset ?? [] };
  } catch (err) {
    console.error('❌ sp-set-product-default-supplier:', err);
    return { success: false, error: err.message };
  }
});

// Quitar (desactivar) proveedor de producto
ipcMain.handle('sp-remove-product-supplier', async (_event, payload) => {
  try {
    const product_id  = Number(payload?.product_id ?? payload?.productId ?? 0);
    const supplier_id = Number(payload?.supplier_id ?? payload?.supplierId ?? 0);

    if (!Number.isFinite(product_id) || product_id <= 0) return { success: false, error: 'product_id inválido' };
    if (!Number.isFinite(supplier_id) || supplier_id <= 0) return { success: false, error: 'supplier_id inválido' };

    const pool = await poolPromise;
    const result = await pool.request()
      .input('product_id',  sql.Int, product_id)
      .input('supplier_id', sql.Int, supplier_id)
      .execute('sp_remove_product_supplier');

    return { success: true, data: result.recordset ?? [] };
  } catch (err) {
    console.error('❌ sp-remove-product-supplier:', err);
    return { success: false, error: err.message };
  }
});

// Obtener default (rápido)
ipcMain.handle('sp-get-product-default-supplier', async (_event, payload) => {
  try {
    const product_id = Number(payload?.product_id ?? payload?.productId ?? 0);
    if (!Number.isFinite(product_id) || product_id <= 0) {
      return { success: false, error: 'product_id inválido' };
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input('product_id', sql.Int, product_id)
      .execute('sp_get_product_default_supplier');

    return { success: true, data: result.recordset?.[0] ?? null };
  } catch (err) {
    console.error('❌ sp-get-product-default-supplier:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-add-supplier', async (_event, payload) => {
  try {
    const nombre = String(payload?.nombre ?? payload?.name ?? '').trim();
    if (!nombre) return { success: false, error: 'nombre requerido' };

    const pool = await poolPromise;
    const result = await pool.request()
      .input('nombre', sql.NVarChar(150), nombre)
      .execute('sp_add_supplier');

    const newId = result.recordset?.[0]?.id ?? null;
    return { success: true, data: { id: newId } };
  } catch (err) {
    console.error('❌ sp-add-supplier:', err);
    return { success: false, error: err.message };
  }
});

function pickName(payload) {
  if (typeof payload === 'string') return payload.trim();

  const v = payload?.nombre ?? payload?.name ?? payload?.namee ?? '';
  if (typeof v !== 'string') return '';
  return v.trim();
}

ipcMain.handle('sp-add-brand', async (_event, payload) => {
  try {
    const nombre = pickName(payload);
    if (!nombre) return { success: false, error: 'nombre requerido' };

    const pool = await poolPromise;
    const result = await pool.request()
      .input('namee', sql.NVarChar(150), nombre)
      .execute('sp_add_brand');

    const newId = result.recordset?.[0]?.id ?? null;
    return { success: true, data: { id: newId } };
  } catch (err) {
    console.error('sp-add-brand:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-add-category', async (_event, payload) => {
  try {
    const nombre = pickName(payload);
    if (!nombre) return { success: false, error: 'nombre requerido' };

    const pool = await poolPromise;
    const result = await pool.request()
      .input('namee', sql.NVarChar(150), nombre)
      .execute('sp_add_categories');

    const newId = result.recordset?.[0]?.id ?? null;
    return { success: true, data: { id: newId } };
  } catch (err) {
    console.error('sp-add-categories:', err);
    return { success: false, error: err.message };
  }

});

// Importacion masiva de productos desde Excel (catalogo por giro / migracion)
ipcMain.handle('sp-import-products', async (_event, payload = {}) => {
  try {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (!rows.length) return { success: false, error: 'No hay filas para importar.' };

    const pool = await poolPromise;

    // El nombre del tipo es OBLIGATORIO para msnodesqlv8
    const tvp = new sql.Table('dbo.ProductImportType');
    tvp.columns.add('part_number',     sql.NVarChar(100), { nullable: true });
    tvp.columns.add('name',            sql.NVarChar(100), { nullable: true });
    tvp.columns.add('brand_name',      sql.NVarChar(150), { nullable: true });
    tvp.columns.add('category_name',   sql.NVarChar(150), { nullable: true });
    tvp.columns.add('price',           sql.Decimal(10, 2), { nullable: true });
    tvp.columns.add('stock',           sql.Decimal(12, 2), { nullable: true });
    tvp.columns.add('bar_code',        sql.NVarChar(100), { nullable: true });
    tvp.columns.add('clave_prod_serv', sql.NVarChar(8),   { nullable: true });
    tvp.columns.add('clave_unidad',    sql.NVarChar(5),   { nullable: true });
    tvp.columns.add('objeto_impuesto', sql.NVarChar(2),   { nullable: true });
    tvp.columns.add('tasa_iva',        sql.Decimal(5, 4), { nullable: true });

    const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
    const str = (v) => (v === null || v === undefined) ? null : (String(v).trim() || null);

    rows.forEach(r => {
      tvp.rows.add(
        str(r.part_number),
        str(r.name),
        str(r.brand_name),
        str(r.category_name),
        num(r.price),
        num(r.stock),
        str(r.bar_code),
        str(r.clave_prod_serv),
        str(r.clave_unidad),
        str(r.objeto_impuesto),
        num(r.tasa_iva)
      );
    });

    const result = await pool.request()
      .input('Rows', tvp)
      .execute('sp_import_products');

    return { success: true, data: result.recordset?.[0] ?? null };
  } catch (err) {
    console.error('sp-import-products:', err);
    return { success: false, error: err.message };
  }
});

// Migracion: clientes (reusa sp_create_customer, de-dup en Node)
ipcMain.handle('sp-import-customers', async (_event, payload = {}) => {
  try {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (!rows.length) return { success: false, error: 'No hay filas para importar.' };
    const pool = await poolPromise;

    const existCodes = new Set(), existNames = new Set();
    try {
      const ex = await pool.request().execute('sp_get_customers');
      (ex.recordset || []).forEach(c => {
        if (c.code) existCodes.add(String(c.code).trim().toLowerCase());
        const nm = c.name ?? c.customer_name ?? c.nombre;
        if (nm) existNames.add(String(nm).trim().toLowerCase());
      });
    } catch {}

    let inserted = 0, skipped = 0, errors = 0;
    for (const r of rows) {
      const name = String(r.name ?? '').trim();
      if (!name) { skipped++; continue; }
      const code = r.code ? String(r.code).trim() : null;
      const nk = name.toLowerCase(), ck = code ? code.toLowerCase() : null;
      if (existNames.has(nk) || (ck && existCodes.has(ck))) { skipped++; continue; }
      try {
        const req = pool.request()
          .input('code', sql.NVarChar(30), code)
          .input('customerName', sql.NVarChar(120), name)
          .input('tax_id', sql.NVarChar(20), r.tax_id ? String(r.tax_id).trim() : null)
          .input('email', sql.NVarChar(120), r.email ? String(r.email).trim() : '')
          .input('phone', sql.NVarChar(30), r.phone ? String(r.phone).trim() : '')
          .input('credit_limit', sql.Decimal(12, 2), Number(r.credit_limit) || 0)
          .input('terms_days', sql.Int, Number(r.terms_days) || 0)
          .input('active', sql.Bit, 1)
          .input('regimen_fiscal', sql.NVarChar(5), null)
          .input('uso_cfdi', sql.NVarChar(5), null)
          .input('razon_social', sql.NVarChar(255), null);
        req.output('NewId', sql.Int);
        await req.execute('sp_create_customer');
        inserted++; existNames.add(nk); if (ck) existCodes.add(ck);
      } catch (e) { errors++; }
    }
    return { success: true, data: { inserted, skipped, errors } };
  } catch (err) {
    console.error('sp-import-customers:', err);
    return { success: false, error: err.message };
  }
});

// Migracion: proveedores (reusa sp_add_supplier, de-dup en Node)
ipcMain.handle('sp-import-suppliers', async (_event, payload = {}) => {
  try {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (!rows.length) return { success: false, error: 'No hay filas para importar.' };
    const pool = await poolPromise;

    const existNames = new Set();
    try {
      const ex = await pool.request().execute('sp_get_suppliers');
      (ex.recordset || []).forEach(s => {
        const nm = s.nombre ?? s.name ?? s.namee;
        if (nm) existNames.add(String(nm).trim().toLowerCase());
      });
    } catch {}

    let inserted = 0, skipped = 0, errors = 0;
    for (const r of rows) {
      const name = String(r.name ?? r.nombre ?? '').trim();
      if (!name) { skipped++; continue; }
      const nk = name.toLowerCase();
      if (existNames.has(nk)) { skipped++; continue; }
      try {
        // CAT_suppliers guarda nombre, telefono y correo
        await pool.request()
          .input('nombre', sql.NVarChar(100), name)
          .input('telefono', sql.NVarChar(20), r.telefono ? String(r.telefono).trim() : null)
          .input('correo', sql.NVarChar(100), r.correo ? String(r.correo).trim() : null)
          .input('rfc', sql.NVarChar(20), r.rfc ? String(r.rfc).trim() : null)
          .query('INSERT INTO CAT_suppliers (nombre, telefono, correo, rfc) VALUES (@nombre, @telefono, @correo, @rfc)');
        inserted++; existNames.add(nk);
      } catch (e) { errors++; }
    }
    return { success: true, data: { inserted, skipped, errors } };
  } catch (err) {
    console.error('sp-import-suppliers:', err);
    return { success: false, error: err.message };
  }
});

// Migracion: ventas historicas (TVP + sp_import_sales)
ipcMain.handle('sp-import-sales', async (_event, payload = {}) => {
  try {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const userId = Number(payload?.user_id) || null;
    if (!rows.length) return { success: false, error: 'No hay filas para importar.' };
    if (!userId) return { success: false, error: 'Falta el usuario para asignar las ventas.' };
    const pool = await poolPromise;

    const tvp = new sql.Table('dbo.SaleLineImportType');
    tvp.columns.add('ext_folio',      sql.NVarChar(40),  { nullable: true });
    tvp.columns.add('sale_date',      sql.DateTime,      { nullable: true });
    tvp.columns.add('part_number',    sql.NVarChar(100), { nullable: true });
    tvp.columns.add('quantity',       sql.Decimal(12, 2), { nullable: true });
    tvp.columns.add('unit_price',     sql.Decimal(10, 2), { nullable: true });
    tvp.columns.add('payment_method', sql.NVarChar(50),  { nullable: true });

    const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
    const str = (v) => (v === null || v === undefined) ? null : (String(v).trim() || null);

    rows.forEach(r => {
      let d = null;
      if (r.sale_date) { const dt = new Date(r.sale_date); if (!isNaN(dt.getTime())) d = dt; }
      tvp.rows.add(str(r.ext_folio), d, str(r.part_number), num(r.quantity), num(r.unit_price), str(r.payment_method));
    });

    const result = await pool.request()
      .input('Rows', tvp)
      .input('user_id', sql.Int, userId)
      .execute('sp_import_sales');

    return { success: true, data: result.recordset?.[0] ?? null };
  } catch (err) {
    console.error('sp-import-sales:', err);
    return { success: false, error: err.message };
  }
});

// Proveedores: cuenta (lo que se debe) y detalle
ipcMain.handle('sp-get-suppliers-account', async () => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().execute('sp_get_suppliers_account');
    return { success: true, data: r.recordset };
  } catch (err) {
    console.error('sp-get-suppliers-account:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-get-supplier-account-detail', async (_event, payload = {}) => {
  try {
    const supplierId = Number(payload?.supplier_id) || null;
    if (!supplierId) return { success: false, error: 'Falta supplier_id.' };
    const pool = await poolPromise;
    const r = await pool.request()
      .input('supplier_id', sql.Int, supplierId)
      .execute('sp_get_supplier_payments');
    return { success: true, data: { payments: r.recordset ?? [] } };
  } catch (err) {
    console.error('sp-get-supplier-account-detail:', err);
    return { success: false, error: err.message };
  }
});

// Alta / edicion de proveedor
ipcMain.handle('sp-supplier-save', async (_event, payload = {}) => {
  try {
    const nombre = String(payload?.nombre ?? '').trim();
    if (!nombre) return { success: false, error: 'El nombre es obligatorio.' };
    const pool = await poolPromise;
    const r = await pool.request()
      .input('id', sql.Int, Number(payload?.id) || null)
      .input('nombre', sql.NVarChar(100), nombre)
      .input('telefono', sql.NVarChar(20), payload?.telefono ? String(payload.telefono).trim() : null)
      .input('correo', sql.NVarChar(100), payload?.correo ? String(payload.correo).trim() : null)
      .input('rfc', sql.NVarChar(20), payload?.rfc ? String(payload.rfc).trim() : null)
      .execute('sp_supplier_save');
    return { success: true, data: { id: r.recordset?.[0]?.id ?? null } };
  } catch (err) {
    console.error('sp-supplier-save:', err);
    return { success: false, error: err.message };
  }
});

// Pago a proveedor (desde salida de efectivo): registra en supplier_payments
ipcMain.handle('sp-pay-supplier', async (_event, payload = {}) => {
  try {
    const supplierId = Number(payload?.supplier_id) || null;
    const amount = Number(payload?.amount) || 0;
    const userId = Number(payload?.user_id) || null;
    if (!supplierId || amount <= 0 || !userId) return { success: false, error: 'Datos incompletos.' };
    const pool = await poolPromise;
    await pool.request()
      .input('supplier_id', sql.Int, supplierId)
      .input('amount', sql.Decimal(10, 2), amount)
      .input('payment_method', sql.NVarChar(50), payload?.payment_method || 'EFECTIVO')
      .input('user_id', sql.Int, userId)
      .input('note', sql.NVarChar(255), payload?.note ? String(payload.note).trim() : null)
      .input('cash_movement_id', sql.Int, Number(payload?.cash_movement_id) || null)
      .query('INSERT INTO supplier_payments (supplier_id, datee, amount, payment_method, user_id, note, cash_movement_id) VALUES (@supplier_id, GETDATE(), @amount, @payment_method, @user_id, @note, @cash_movement_id)');
    return { success: true };
  } catch (err) {
    console.error('sp-pay-supplier:', err);
    return { success: false, error: err.message };
  }
});

// ===== Estadisticas =====
ipcMain.handle('sp-top-customers', async (_e, payload = {}) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().input('limit', sql.Int, Number(payload?.limit) || 10).execute('sp_top_customers');
    return { success: true, data: r.recordset };
  } catch (err) { console.error('sp-top-customers:', err); return { success: false, error: err.message }; }
});

ipcMain.handle('sp-sales-by-payment', async (_e, payload = {}) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().input('days', sql.Int, Number(payload?.days) || 30).execute('sp_sales_by_payment');
    return { success: true, data: r.recordset };
  } catch (err) { console.error('sp-sales-by-payment:', err); return { success: false, error: err.message }; }
});

ipcMain.handle('sp-dead-products', async (_e, payload = {}) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().input('limit', sql.Int, Number(payload?.limit) || 20).execute('sp_dead_products');
    return { success: true, data: r.recordset };
  } catch (err) { console.error('sp-dead-products:', err); return { success: false, error: err.message }; }
});

ipcMain.handle('sp-cash-summary', async (_e, payload = {}) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().input('days', sql.Int, Number(payload?.days) || 30).execute('sp_cash_summary');
    return { success: true, data: r.recordset?.[0] ?? null };
  } catch (err) { console.error('sp-cash-summary:', err); return { success: false, error: err.message }; }
});

ipcMain.handle('sp-customers-kpis', async () => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().execute('sp_customers_kpis');
    return { success: true, data: r.recordset?.[0] ?? null };
  } catch (err) { console.error('sp-customers-kpis:', err); return { success: false, error: err.message }; }
});

 //Mercado Pago

  ipcMain.handle('mp-create-order', async (_event, payload = {}) => {
    return mpPoint.createPointOrder({
      amount: payload?.amount,
      externalReference: payload?.externalReference,
      expirationTime: payload?.expirationTime,        
      printOnTerminal: payload?.printOnTerminal      
    });
  });

  ipcMain.handle('mp-get-order', async (_event, orderId) => {
    return mpPoint.getOrder(orderId);
  });

  ipcMain.handle('mp-cancel-order', async (_event, orderId) => {
    return mpPoint.cancelOrder(orderId);
  });

  ipcMain.handle('mp-list-terminals', async () => {
    return mpPoint.listTerminals();
  });

  ipcMain.handle('mp-get-config', async () => mpPoint.getPublicConfig());
  ipcMain.handle('mp-set-config', async (_event, cfg = {}) => mpPoint.setConfig(cfg));

  ipcMain.handle('mp-simulate-order', async (_event, payload = {}) => {
    const orderId = typeof payload === 'string' ? payload : payload?.orderId;
    const status  = (typeof payload === 'object' ? payload?.status : null) || 'processed';
    return mpPoint.simulateOrderEvent(orderId, status, payload?.opts || {});
  });

  ipcMain.handle('mp-validate-token', async () => mpPoint.validateToken());
  ipcMain.handle('mp-create-store', async (_event, payload = {}) => mpPoint.createStore(payload));
  ipcMain.handle('mp-create-pos', async (_event, payload = {}) => mpPoint.createPos(payload));
  ipcMain.handle('mp-set-pdv', async (_event, terminalId) => mpPoint.setPdv(terminalId));

  //Backups
  ipcMain.handle('backup-get-config', async () => ({ success: true, data: backup.loadBackupConfig() }));

  ipcMain.handle('backup-set-config', async (_event, partial = {}) => {
    const saved = backup.saveBackupConfig(partial);
    backup.startScheduler();   
    return { success: true, data: saved };
  });

  ipcMain.handle('backup-run-now', async () => backup.runBackup('manual'));
  ipcMain.handle('backup-list', async () => ({ success: true, data: backup.listBackups() }));

  ipcMain.handle('backup-open-folder', async () => {
    const cfg = backup.loadBackupConfig();
    await shell.openPath(cfg.folder);
    return { success: true };
  });

  ipcMain.on('app-log', (_event, payload) => logger.logFromRenderer(payload));
  ipcMain.handle('logs-open-folder', async () => { await logger.openLogsFolder(); return { success: true }; });
  ipcMain.handle('logs-info', async () => ({ success: true, data: logger.logsInfo() }));

  db.onStateChange((state) => { mainWindow?.webContents.send('db-status', state); });

  ipcMain.handle('db-status', async () => ({ success: true, data: db.getState() }));
  ipcMain.handle('db-reconnect', async () => { await db.reconnect(); return { success: true }; });
  ipcMain.handle('db-get-connection', async () => ({ success: true, data: db.getConnectionConfig() }));
  ipcMain.handle('db-set-connection', async (_e, cfg = {}) => db.setConnectionConfig(cfg));

  // ===== CAJAS (registers) =====

  // Catálogo de cajas desde la BD
  ipcMain.handle('registers-list', async (_event, onlyActive = false) => {
    try {
      const pool = await poolPromise;
      const result = await pool.request()
        .input('only_active', sql.Bit, onlyActive ? 1 : 0)
        .execute('sp_get_registers');
      return { success: true, data: result.recordset ?? [] };
    } catch (err) {
      console.error('registers-list:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('registers-add', async (_event, payload = {}) => {
    try {
      const name = String(payload?.name ?? '').trim();
      const code = payload?.code ? String(payload.code).trim() : null;
      if (!name) return { success: false, error: 'El nombre es obligatorio.' };

      const pool = await poolPromise;
      const req = pool.request().input('name', sql.NVarChar(60), name);
      req.input('code', sql.NVarChar(10), code);

      const result = await req.execute('sp_add_register');
      return { success: true, data: result.recordset?.[0] ?? null };
    } catch (err) {
      console.error('registers-add:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('registers-set-active', async (_event, payload = {}) => {
    try {
      const id = Number(payload?.id);
      const isActive = payload?.is_active ? 1 : 0;
      if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'id inválido.' };

      const pool = await poolPromise;
      const result = await pool.request()
        .input('id', sql.Int, id)
        .input('is_active', sql.Bit, isActive)
        .execute('sp_set_register_active');
      return { success: true, data: result.recordset?.[0] ?? null };
    } catch (err) {
      console.error('registers-set-active:', err);
      return { success: false, error: err.message };
    }
  });

  // ===== IDENTIDAD DE ESTA MÁQUINA (qué caja soy) =====

  ipcMain.handle('register-get-current', async () => {
    try {
      const cfg = loadDeviceConfig();
      return { success: true, data: { registerId: cfg?.register?.id ?? null, registerName: cfg?.register?.name ?? null } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('register-set-current', async (_event, payload = {}) => {
    try {
      const id = Number(payload?.id);
      if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'id inválido.' };

      /* PRIMERO se reclama, DESPUES se guarda.
         Guardar antes dejaria a esta maquina creyendo que es la Caja 2 con la
         Caja 2 en manos de otro equipo: la pantalla diria una cosa y cada
         venta se rechazaria por otra. Si la caja esta tomada, aqui no cambia
         nada y se devuelve quien la tiene. */
      const anterior = loadDeviceConfig()?.register ?? null;
      const rs = await cajaArrendada.reclamar(id, payload?.name ?? null);
      if (!rs.ok) {
        return {
          success: false,
          error: rs.data?.mensaje || rs.error || 'No se pudo tomar esta caja.',
          data: rs.data ?? null,
        };
      }

      const current = loadDeviceConfig();
      const merged = {
        ...current,
        register: { id, name: payload?.name ?? null }
      };
      saveDeviceConfig(merged);

      // Soltar la caja ANTERIOR, si habia otra: cambiar de caja no debe dejar
      // la de antes bloqueada cinco minutos por un equipo que ya no la usa.
      if (anterior?.id && Number(anterior.id) !== id) {
        cajaArrendada.soltarOtra(Number(anterior.id)).catch(() => { /* caduca sola */ });
      }

      return { success: true, data: merged.register, lease: rs.data ?? null };
    } catch (err) {
      console.error('register-set-current:', err);
      return { success: false, error: err.message };
    }
  });

  // ===== ARRIENDO DE CAJA (una caja, un equipo) =====

  /** El catalogo CON quien tiene cada caja, resuelto con el reloj del servidor. */
  ipcMain.handle('registers-assignments', async (_event, onlyActive = false) => {
    try {
      const pool = await poolPromise;
      const result = await pool.request()
        .input('machine_id', sql.NVarChar(64), cajaArrendada.identidad().machineId)
        .input('only_active', sql.Bit, onlyActive ? 1 : 0)
        .execute('sp_get_register_assignments');
      return { success: true, data: result.recordset ?? [], yo: cajaArrendada.instantanea() };
    } catch (err) {
      console.error('registers-assignments:', err);
      return { success: false, error: err.message };
    }
  });

  /** Estado del arriendo de ESTA maquina, sin ir a la base. */
  ipcMain.handle('register-lease-status', async () => ({ success: true, data: cajaArrendada.instantanea() }));

  /** Soltar la caja de esta maquina a proposito. */
  ipcMain.handle('register-release', async () => {
    const r = await cajaArrendada.soltar('EQUIPO');
    return { success: r.ok, data: r.data ?? null, error: r.error ?? null };
  });

  /**
   * La escotilla: liberar la caja de un equipo que ya no existe.
   *
   * Sin esto, cambiar una PC robada o reinstalada obligaria a esperar a que
   * caduque el arriendo. Con esto es inmediato, y queda registrado que lo hizo
   * un administrador y no el propio equipo.
   */
  ipcMain.handle('register-release-admin', async (_event, payload = {}) => {
    const id = Number(payload?.id);
    if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'id inválido.' };
    const r = await cajaArrendada.liberarComoAdmin(id);
    return { success: r.ok, data: r.data ?? null, error: r.error ?? null };
  });

  // ===== RED MULTICAJA (prueba / MonoCaja -> MultiCaja) =====

  ipcMain.handle('network:diagnose', async (_event, plan = null) => {
    try { return { success: true, data: await redMulticaja.diagnosticar(plan) }; }
    catch (err) {
      console.error('network:diagnose:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('network:prepare', async (_event, payload = {}) => {
    try {
      const r = await redMulticaja.preparar({ rotar: !!payload?.rotar });
      return r.ok ? { success: true, data: r } : { success: false, error: r.error, data: r };
    } catch (err) {
      console.error('network:prepare:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('network:reveal-password', async () => {
    try {
      const r = redMulticaja.revelarContrasena();
      return r.ok ? { success: true, data: r } : { success: false, error: r.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });


  ipcMain.handle('setup-run', async (_event, payload = {}) => {
  try {
    const role = payload.role;
    const ocusPassword = payload.ocusPassword;
    const saPassword = payload.saPassword;

    /* LA DIRECCION DEL SERVIDOR SE NORMALIZA AQUI, NO EN LA PANTALLA.
       -------------------------------------------------------------
       El asistente hacia `serverIp + '\\SQLEXPRESS'` sin mirar lo que habia
       escrito la persona. Quien escribia solo la IP tenia suerte; quien
       escribia `192.168.100.211\SQLEXPRESS` -lo mismo que acababa de probar
       con sqlcmd, que es lo natural- acababa con
       `192.168.100.211\SQLEXPRESS\SQLEXPRESS` guardado en disco.

       Se normaliza en el proceso principal porque este es el UNICO sitio que
       escribe `db-config.json`. Arreglarlo solo en la pantalla dejaria a
       cualquier otra ruta libre de volver a construir la cadena a mano, que
       es exactamente como aparecio el fallo. */
    const forma = normalizarServidor(payload.server);
    if (!forma.ok) {
      // Se falla ANTES de escribir nada y antes de intentar conectar: no hay
      // ninguna razon para hacerle esperar 20 reintentos a alguien cuya
      // direccion ya sabemos que no puede funcionar.
      return { ok: false, error: forma.error };
    }
    const server = forma.server;
    if (server !== String(payload.server ?? '').trim()) {
      console.log(`[SETUP] Servidor normalizado: "${payload.server}" -> "${server}"`);
    }

    // 1) Escribe db-config.json segun el rol
    const dbConfig = (role === 'principal')
      ? { server, database: DB_NAME, auth: 'windows' }
      : { server, database: DB_NAME, auth: 'sql', user: 'ocus_app', password: ocusPassword };

    fs.writeFileSync(
      path.join(app.getPath('userData'), 'db-config.json'),
      JSON.stringify(dbConfig, null, 2), 'utf8'
    );

    // 2) Prepara el servidor (instala SQL en principal / valida en secundaria)
    // Alta de un host nuevo: se exige el contrato completo del motor. Aqui se
    // esta estrenando la base de un negocio, no arrancando una que ya opera.
    const setupRes = await setupServer.ensureServerReady({
      role, server, dbName: DB_NAME, saPassword, ocusPassword,
      altaDeHost: role === 'principal'
    });

    if (!setupRes?.ok) {
      return { ok: false, error: 'No se pudo preparar el servidor.' };
    }

    /* 3) Confirmar que la base responde DE VERDAD, con la configuracion que
          se acaba de escribir.

          `reconnect()` invalida cualquier intento anterior antes de empezar
          (ver la generacion en db.js). Sin eso, aqui podia devolverse un bucle
          que llevaba medio minuto reintentando con la configuracion VIEJA, y
          el asistente concluia "no se pudo conectar con la computadora
          principal" teniendo ya guardada la configuracion buena.

          Se exige tambien en la principal: si la base no responde, es mejor
          decirlo ahora -con el asistente abierto y la persona delante- que
          dejar `install-config.json` escrito y que el fallo aparezca en el
          siguiente arranque, sin asistente al que volver. */
    try {
      await db.reconnect();
    } catch (e) {
      console.error('setup-run: conexion inicial:', e.message);
    }
    const st = db.getState();
    if (st.status !== 'connected') {
      return {
        ok: false,
        error: role === 'secundaria'
          ? `No se pudo conectar con la computadora principal (${server}). ${st.error || 'Revisa la IP y la red.'}`
          : `No se pudo conectar con la base de datos. ${st.error || ''}`.trim(),
      };
    }

    // 4) Guarda la config de instalacion (sin contrasenas en claro)
    saveInstallConfig({ role, server, configuredAt: new Date().toISOString() });

    // 5) Cierra el asistente y arranca la app normal
    if (setupWindow) { setupWindow.close(); setupWindow = null; }
    await bootMainApp();

    return { ok: true };
  } catch (err) {
    console.error('setup-run:', err);
    return { ok: false, error: err.message };
  }
});

/**
 * Que va a guardar Wybix con lo que la persona acaba de escribir.
 *
 * Lo usa el asistente mientras se teclea, para poder decir "asi voy a
 * conectarme" o "esto no puede funcionar" ANTES de pulsar el boton. La regla
 * es exactamente la misma que aplica `setup-run`: una sola gramatica, y la
 * pantalla la consulta en vez de reimplementarla.
 */
ipcMain.handle('setup-normalizar-servidor', async (_event, texto) => {
  const r = normalizarServidor(texto);
  return r.ok
    ? { ok: true, server: r.server, completado: r.completado }
    : { ok: false, error: r.error };
});

ipcMain.handle('cloud-get-config', async () => ({ success: true, data: cloudSync.getCloudConfig() }));

ipcMain.handle('cloud-set-config', async (_event, partial = {}) => {
  const res = cloudSync.setCloudConfig(partial);
  cloudSync.startScheduler();  
  return res;
});

ipcMain.handle('cloud-push-now', async () => cloudSync.pushNow());

ipcMain.handle('cloud-ensure-provisioned', async (_e, nombre) => cloudSync.ensureProvisioned(nombre));
ipcMain.handle('cloud-get-pairing', async () => cloudSync.getPairingPayload());
ipcMain.handle('cloud-set-anon-key', async (_e, key) => cloudSync.setAnonKey(key));
ipcMain.handle('cloud-delete-account', async () => cloudSync.deleteAccount());


//FACTURACION

ipcMain.handle('fiscal-get-config', async () => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().execute('sp_get_fiscal_config');
    return { success: true, data: r.recordset?.[0] ?? null };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('fiscal-save-config', async (_e, cfg) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request()
      .input('rfc', sql.NVarChar(13), cfg.rfc)
      .input('razon_social', sql.NVarChar(255), cfg.razon_social)
      .input('regimen_fiscal', sql.NVarChar(5), cfg.regimen_fiscal)
      .input('codigo_postal', sql.NVarChar(5), cfg.codigo_postal)
      .input('serie', sql.NVarChar(25), cfg.serie)
      .execute('sp_save_fiscal_config');
    return { success: true, data: r.recordset?.[0] ?? null };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('fiscal-set-issuer-ref', async (_e, issuerId) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request()
      .input('fiscalapi_issuer_id', sql.NVarChar(100), issuerId)
      .execute('sp_set_fiscal_issuer_ref');
    return { success: true, data: r.recordset?.[0] ?? null };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('fiscal-get-invoices', async (_e, filtros) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request()
      .input('estado', sql.NVarChar(20), filtros?.estado ?? null)
      .input('busqueda', sql.NVarChar(100), filtros?.busqueda ?? null)
      .execute('sp_get_invoices');
    return { success: true, data: r.recordset ?? [] };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('fiscal-get-invoices-counts', async () => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().execute('sp_get_invoices_counts');
    return { success: true, data: r.recordset?.[0] ?? null };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('fiscal-save-invoice', async (_e, inv) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request()
      .input('sale_id', sql.Int, inv.sale_id ?? null)
      .input('serie', sql.NVarChar(25), inv.serie ?? null)
      .input('folio', sql.NVarChar(40), inv.folio ?? null)
      .input('uuid', sql.NVarChar(50), inv.uuid ?? null)
      .input('receptor_rfc', sql.NVarChar(13), inv.receptor_rfc)
      .input('receptor_razon_social', sql.NVarChar(255), inv.receptor_razon_social)
      .input('receptor_regimen', sql.NVarChar(5), inv.receptor_regimen)
      .input('receptor_uso_cfdi', sql.NVarChar(5), inv.receptor_uso_cfdi)
      .input('receptor_codigo_postal', sql.NVarChar(5), inv.receptor_codigo_postal)
      .input('receptor_email', sql.NVarChar(255), inv.receptor_email ?? null)
      .input('metodo_pago', sql.NVarChar(3), inv.metodo_pago ?? 'PUE')
      .input('forma_pago', sql.NVarChar(3), inv.forma_pago ?? '01')
      .input('subtotal', sql.Decimal(12,2), inv.subtotal ?? 0)
      .input('descuento', sql.Decimal(12,2), inv.descuento ?? 0)
      .input('iva', sql.Decimal(12,2), inv.iva ?? 0)
      .input('total', sql.Decimal(12,2), inv.total ?? 0)
      .input('estado', sql.NVarChar(20), inv.estado ?? 'timbrada')
      .input('fiscalapi_invoice_id', sql.NVarChar(100), inv.fiscalapi_invoice_id ?? null)
      .input('xml_content', sql.NVarChar(sql.MAX), inv.xml_content ?? null)
      .input('error_mensaje', sql.NVarChar(sql.MAX), inv.error_mensaje ?? null)
      .execute('sp_save_invoice');
    return { success: true, id: r.recordset?.[0]?.id ?? null };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('fiscal-get-invoice-files-data', async (_e, id) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().input('id', sql.Int, id).execute('sp_get_invoice_files_data');
    return { success: true, data: r.recordset?.[0] ?? null };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('fiscal-cancel-invoice', async (_e, p) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request()
      .input('id', sql.Int, p.id)
      .input('motivo_cancelacion', sql.NVarChar(2), p.motivo_cancelacion)
      .input('folio_sustitucion', sql.NVarChar(50), p.folio_sustitucion ?? null)
      .execute('sp_cancel_invoice');
    return { success: true, data: r.recordset?.[0] ?? null };
  } catch (e) { return { success: false, error: e.message }; }
});

//LICENCIA
ipcMain.handle('get-machine-id', async () => {
  // El sellado en la licencia, mientras siga siendo la misma maquina: un
  // renombrado o un fallo de WMI no deben cambiar el identificador con el que
  // el cliente ya esta dado de alta en el servidor de activacion.
  try { return licenseStore.machineIdEstable(contextoLicencia()); }
  catch {
    if (!cachedMachineId) cachedMachineId = generarMachineId();
    return cachedMachineId;
  }
});

// Abre una URL en el NAVEGADOR del sistema (no en una ventana de Electron)
ipcMain.handle('open-external', async (_event, url) => {
  try {
    const u = String(url || '');
    if (!/^https?:\/\//i.test(u)) return { ok: false, error: 'URL no valida' };
    await shell.openExternal(u);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

//Setup

ipcMain.handle('setup-status', async () => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().execute('sp_setup_status');
    const row = r.recordset?.[0] ?? { usuarios: 0, negocio_configurado: 0 };
    return {
      success: true,
      configurado: Number(row.usuarios) > 0,
      data: row
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
 
// Crea el usuario administrador y los datos del negocio
ipcMain.handle('setup-inicial', async (_e, p) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request()
      .input('usuario', sql.NVarChar(50), p.usuario)
      .input('password', sql.NVarChar(255), p.password)
      .input('business_name', sql.NVarChar(200), p.business_name)
      .input('address', sql.NVarChar(300), p.address ?? null)
      .input('phone', sql.NVarChar(50), p.phone ?? null)
      .input('rfc', sql.NVarChar(50), p.rfc ?? null)
      .input('business_profile', sql.NVarChar(20), p.business_profile ?? null)
      .execute('sp_setup_inicial');
    // El alta ESCRIBE business_config. Sin invalidar aqui, `getConfig` seguiria
    // sirviendo lo que hubiera memorizado antes del alta, y el renderer no
    // puede ganarle a un cache que vive en el proceso principal: recargar a la
    // fuerza desde la pantalla devolveria igualmente el valor viejo.
    businessConfig = null;
    return { success: true, data: r.recordset?.[0] ?? null };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('license:activate', async (_event, payload) => {
  try {
    const licenseKey = typeof payload === 'string' ? payload : payload?.licenseKey;
    const machineAlias = typeof payload === 'object' ? payload?.machineAlias : null;

    if (!licenseKey) return { ok: false, error: 'Falta la clave de licencia.' };

    if (!cachedMachineId) cachedMachineId = generarMachineId();

    // Timeout para que la activacion nunca se quede colgada.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    let res;
    try {
      res = await fetch(`${SUPABASE_URL}/functions/v1/license-check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey': ANON_KEY
        },
        body: JSON.stringify({
          action: 'activate',
          licenseKey: String(licenseKey).trim().toUpperCase(),
          machineId: cachedMachineId,
          machineAlias
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(t);
    }

    // Parseo seguro (si el servicio devuelve 404/HTML, no truena)
    let data = null;
    try { data = await res.json(); } catch { data = null; }

    if (!res.ok || !data?.success) {
      const error = data?.error
        || (res.status === 404 ? 'El servicio de licencias no responde. Intenta más tarde.' : 'La clave no es válida o ya está en uso.');
      return { ok: false, error, code: data?.code };
    }

    licenseStore.saveLicense(contextoLicencia(), data);
    return { ok: true, plan: data.plan, customerName: data.customerName };
  } catch (err) {
    console.error('license:activate:', err);
    const error = err?.name === 'AbortError'
      ? 'La validación tardó demasiado. Revisa tu internet e intenta de nuevo.'
      : 'No hay conexión para validar la licencia.';
    return { ok: false, error };
  }
});

// 2. Leer la licencia (Para que Angular la consuma)
ipcMain.handle('license:get', async () => {
  try {
    return licenseStore.readLicense(contextoLicencia()).data;
  } catch (err) {
    return null;
  }
});

// 3. Escribir/Actualizar licencia (Para cuando Angular revalide en segundo plano)
ipcMain.handle('license:save', async (event, licenseData) => {
  try {
    licenseStore.saveLicense(contextoLicencia(), licenseData);
    return { ok: true };
  } catch (err) {
    return { ok: false };
  }
});

// 4. Borrar licencia (Liberar máquina)
ipcMain.handle('license:clear', async () => {
  try {
    licenseStore.clearLicense();
    return { ok: true };
  } catch (err) {
    return { ok: false };
  }
});

// 5. Iniciar PRUEBA GRATIS de 30 dias (valida en la nube: una por maquina)
ipcMain.handle('license:start-trial', async (_event, payload = {}) => {
  try {
    if (!cachedMachineId) cachedMachineId = generarMachineId();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/trial-license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
        'apikey': ANON_KEY
      },
      body: JSON.stringify({
        action: 'start',
        machineId: cachedMachineId,
        businessName: payload?.businessName ?? null,
        email: payload?.email ?? null
      })
    });
    const data = await res.json();
    if (!data?.success) return { ok: false, error: data?.error || 'No se pudo iniciar la prueba.' };

    // Sellada como prueba antes de guardarse: sin `type`, computeStatus la
    // clasificaria como licencia de pago y la caja anunciaria un plan que
    // nadie compro. Los demas campos remotos se conservan intactos.
    licenseStore.saveLicense(contextoLicencia(), sellarComoPrueba(data));
    return { ok: true, expiresAt: data.expiresAt, trialExpired: !!data.trialExpired };
  } catch (err) {
    console.error('license:start-trial:', err);
    return { ok: false, error: 'Necesitas conexion a internet para iniciar tu prueba.' };
  }
});

// 6. Estado unificado y blindado (none | trial | active | expired | tamper)
ipcMain.handle('license:status', async () => {
  try {
    return licenseStore.computeStatus(contextoLicencia());
  } catch (err) {
    console.error('license:status:', err);
    return { state: 'none' };
  }
});










