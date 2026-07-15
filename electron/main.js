const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { poolPromise, sql } = require('./db');
const puppeteer = require("puppeteer");
const { generateSaleA4Pdf } = require('./pdf/generateSaleA4Pdf');
const { generateSalesBatchA4Pdf } = require('./pdf/generateSalesBatchA4Pdf');
const { htmlToPdf } = require('./pdf/printToPdfElectron');
const { autoUpdater } = require('electron-updater');
const { start } = require('repl');
const { listSerialPorts, startSerialScanner, stopSerialScanner } = require('./scanner');
const { runMigrations } = require('./migrationsRunner');
const mpPoint  = require('./mercadoPoint');
const backup = require('./backupManager');
const logger = require('./logger');
const db = require('./db');
const DB_NAME = 'Wybix_POS';
const setupServer = require('./setupServer');
const cloudSync = require('./cloudSync');
const { execSync } = require('child_process');
const crypto = require('crypto');
const os = require('os');

//Casillas_2512_19

logger.setupLogging({ retentionDays: 14 });

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

async function bootMainApp() {
  const pool = await poolPromise;
  const migrationsDir = isDev
    ? path.join(__dirname, 'migrations')
    : path.join(process.resourcesPath, 'migrations');

  const mig = await runMigrations({ pool, sql, migrationsDir });
  console.log('Migraciones:', mig);

  mainWindow = createWindow();
  backup.startScheduler();
  backup.startScheduler();
  cloudSync.startScheduler();
  ensureBusinessConfig().catch(err => console.error('businessConfig:', err));
}

app.whenReady().then(async () => {
  try {
    const install = loadInstallConfig();

    if (!install) {
      // Primera vez: abre el asistente, no arranca la app todavia
      setupWindow = createSetupWindow();
      return;
    }

    // Ya configurado: prepara servidor (rapido si ya esta listo) y arranca
    await setupServer.ensureServerReady({
      role: install.role,
      server: install.server,
      dbName: install.dbName || DB_NAME
    });
    await bootMainApp();
  } catch (err) {
    console.error(err);
  }
});

ipcMain.handle('export-database', async () => {
  try {
    const dbName = await getCurrentDbName();
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

    const pool = await poolPromise;

    const query = `
      DECLARE @p NVARCHAR(4000) = N'${escSqlString(tmpBak)}';
      BACKUP DATABASE [${dbName}]
      TO DISK = @p
      WITH INIT, STATS = 5;
    `;
    await pool.request().query(query);

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
    scanner: { enabled: false, path: '', baudRate: 9600 },
    printer: { ticketPrinterName: '' },
    cashDrawer: { mode: 'printer', serialPath: '' } 
  };
}

function saveDeviceConfig(cfg) {
  const p = getDeviceConfigPath();
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

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

ipcMain.handle('getConfig', async () => {
  const cfg = await ensureBusinessConfig();
  return cfg;
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
                                        claveProdServ, claveUnidad, objetoImpuesto, tasaIva) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('brand', sql.Int, brand)
            .input('category', sql.Int, category)
            .input('part_number', sql.NVarChar(100), partNumber)
            .input('name', sql.NVarChar(100), name)
            .input('price', sql.Decimal(10, 2), price)
            .input('stock', sql.Int, stock)
            .input('bar_code', sql.NVarChar(100), null)
            .input('clave_prod_serv', sql.NVarChar(8), claveProdServ ?? null)
            .input('clave_unidad', sql.NVarChar(5), claveUnidad ?? null)
            .input('objeto_impuesto', sql.NVarChar(2), objetoImpuesto ?? '02')
            .input('tasa_iva', sql.Decimal(5, 4), tasaIva ?? 0.16)
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

ipcMain.handle('sp-register-sale', async (event, userId, paymentMethod, items, customerId, dueDate, registerId) => {
  try {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('La venta no tiene partidas.');
    }

    const pool = await poolPromise;

    const tvp = new sql.Table('dbo.SaleDetailType');
    tvp.columns.add('product_id', sql.Int, { nullable: false });
    tvp.columns.add('quantity',   sql.Decimal(12, 2), { nullable: false });
    tvp.columns.add('unit_price', sql.Decimal(10, 2), { nullable: false });

    for (const it of items) {
      tvp.rows.add(it.productId, it.qty, it.unitPrice);
    }

    const request = pool.request()
      .input('user_id',        sql.Int,           userId)
      .input('payment_method', sql.NVarChar(50),  paymentMethod)
      .input('SaleDetails',    tvp)
      .input('customer_id',    sql.Int,           customerId ?? null)
      .input('due_date',       sql.Date,          dueDate ? new Date(dueDate) : null)
      .input('register_id',    sql.Int,           registerId ?? null);

    const result = await request.execute('sp_register_sale');

    const newSaleId =
      result.recordset?.[0]?.sale_id ??
      result.recordset?.[0]?.id ??
      null;

    return {
      success: true,
      saleId: newSaleId,
      data: result.recordset ?? []
    };
  } catch (err) {
    console.error('❌ Error en sp_register_sale:', err);
    return { success: false, error: err.message };
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

ipcMain.handle('sp-register-purchase', async (event, { user_id, supplier_id, tax_rate, tax_amount, subtotal, total, detalles }) => {
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

    detalles.forEach(d => {
      const qty = d.cantidad ?? d.quantity ?? 0;
      const unitPrice = d.precio_unitario ?? d.unit_price ?? 0;
      const profit = d.profit_percent ?? d.profitPercent ?? 0;

      tvp.rows.add(
        d.product_id,
        qty,
        unitPrice,
        profit
      );
    });

    const request = pool.request();
    request.input('user_id', sql.Int, user_id);
    request.input('supplier_id', sql.Int, supplier_id);
    request.input('tax_rate', sql.Decimal(5, 2), tax_rate);
    request.input('tax_amount', sql.Decimal(10, 2), tax_amount);
    request.input('subtotal', sql.Decimal(10, 2), subtotal);
    request.input('total', sql.Decimal(10, 2), total);

    request.input('PurchaseDetails', tvp);

    const result = await request.execute('sp_register_purchase');

    return { success: true, purchase_id: result.recordset[0].purchase_id };
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

ipcMain.handle('open-cash-drawer', async (_event, payload = {}) => {
  try {
    const portPath = String(payload?.portPath || payload?.path || '').trim();
    const baudRate = Number(payload?.baudRate || 9600);
    const pulseMs  = Number(payload?.pulseMs  || 120);
    const pin      = Number(payload?.pin || 0); // 0 default, 1 alternativo

    if (!portPath) {
      return { success: false, error: 'Falta portPath (ej. COM5).' };
    }
    if (!Number.isFinite(baudRate) || baudRate <= 0) {
      return { success: false, error: 'baudRate inválido.' };
    }

    const cmd = buildDrawerKickCmd({ pulseMs, pin });

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
      return { success: false, error: result.error || 'No se pudo abrir el cajón.' };
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
    const registerId = payload?.register_id ?? payload?.registerId ?? null;


    console.log('parsed:', { userId, cashDelivered });

    if (!Number.isFinite(userId)) {
      return { success: false, error: `user_id inválido: ${payload?.user_id ?? payload?.userId}` };
    }
    if (!Number.isFinite(cashDelivered)) {
      return { success: false, error: `cash_delivered inválido: ${payload?.cash_delivered ?? payload?.cashDelivered}` };
    }

    const pool = await poolPromise;
    const req = pool.request()
      .input('user_id', sql.Int, userId)
      .input('cash_delivered', sql.Decimal(12, 2), cashDelivered)
      .input('register_id', sql.Int, registerId);

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
  const template = fs.readFileSync(
    path.join(__dirname, "templates/ticket.html"),
    "utf8"
  );

  const rowsHtml = (lines || []).map(l => {
    const qty  = Number(l.quantity ?? l.qty ?? 0);
    const unit = Number(l.unitary_price ?? l.price ?? 0);

    const nombre = (l.nombre ?? l.product_name ?? l.product ?? "").toString() || "—";

    const sub = Number(
      l.subtotal ?? (Number.isFinite(qty * unit) ? qty * unit : 0)
    );

    return `
      <tr>
        <td>${nombre}</td>
        <td class="right">${qty}</td>
        <td class="right">$${unit.toFixed(2)}</td>
        <td class="right">$${sub.toFixed(2)}</td>
      </tr>`;
  }).join("");

  // --- Totales ---
  const total = (lines || []).reduce((a, l) => {
    const qty  = Number(l.quantity ?? l.qty ?? 0);
    const unit = Number(l.unitary_price ?? l.price ?? 0);
    const sub  = Number(l.subtotal ?? (Number.isFinite(qty * unit) ? qty * unit : 0));
    return a + sub;
  }, 0);

  const IVA_RATE = 0.16;
  const subtotal = total / (1 + IVA_RATE);   
  const iva      = total - subtotal;

  // si me mandas pagado/cambio desde el front, tienen prioridad
  const pagado = extras.pagado != null
    ? Number(extras.pagado)
    : Number(header.paid_amount ?? total);

  const cambio = extras.cambio != null
    ? Number(extras.cambio)
    : pagado - total;

  // helper dinero
  const money = (n) => Number(n || 0).toFixed(2);

  // --- rellenar template ---
  let filledHtml = template
    .replace(/{{LOGO}}/g, `file://${path
      .join(__dirname, "assets/LogoHidromec.jpg")
      .replace(/\\/g, "/")}`)

    .replace(/{{BUSINESS_NAME}}/g, businessConfig.business_name || "")
    .replace(/{{ADDRESS}}/g,       businessConfig.address || "")
    .replace(/{{PHONE}}/g,         businessConfig.phone || "")
    .replace(/{{RFC}}/g,           businessConfig.rfc || "")
    .replace(/{{FOOTER}}/g,        businessConfig.ticket_footer || "")

    .replace(/{{FOLIO}}/g,   String(header.id ?? header.sale_id ?? ""))
    .replace(/{{DATE}}/g,    String(header.datee ?? header.date ?? header.created_at ?? ""))
    .replace(/{{METHOD}}/g,  String(header.payment_method ?? ""))

    .replace(/{{SUBTOTAL}}/g, money(subtotal))
    .replace(/{{IVA}}/g,       money(iva))
    .replace(/{{TOTAL}}/g,     money(total))
    .replace(/{{PAGADO}}/g,    money(pagado))
    .replace(/{{CAMBIO}}/g,    money(cambio))

    .replace(/{{ROWS}}/g, rowsHtml);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox"],
  });

  const page = await browser.newPage();
  await page.setContent(filledHtml, { waitUntil: "networkidle0" });

  const pdfPath = path.join(ensureTicketsDir(), `ticket_${header.id}.pdf`);

  await page.pdf({
    path: pdfPath,
    width: "80mm",
    printBackground: true,
  });

  await browser.close();
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
      .input('opening_note', sql.NVarChar(255), payload.note || null)
      .input('opening_user_id', sql.Int, payload.opening_user_id ?? payload.user_id)
      .input('register_id', sql.Int, payload.register_id ?? null)
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
    const tvp = new sql.Table();
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

    const tvp = new sql.Table();
    tvp.columns.add('product_id', sql.Int, { nullable: false });
    tvp.columns.add('quantity',   sql.Int, { nullable: false });
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

function buildTicketHtmlFromTemplate(header, details, extras = {}) {
  const templatePath = path.join(__dirname, "templates", "ticket.html");
  const template = fs.readFileSync(templatePath, "utf8");

  const rowsHtml = (details || []).map(l => {
    const qty  = Number(l.quantity ?? 0);
    const unit = Number(l.unitary_price ?? 0);
    const nombre = (l.nombre ?? "").toString() || "—";
    const sub = Number(l.line_total ?? (qty * unit));

    return `
      <tr>
        <td>${escHtmlTicket(nombre)}</td>
        <td class="right">${qty}</td>
        <td class="right">$${moneyTicket(unit)}</td>
        <td class="right">$${moneyTicket(sub)}</td>
      </tr>`;
  }).join("");

  const total = (details || []).reduce((a, l) => a + Number(l.line_total ?? 0), 0);

  const IVA_RATE = 0.16;
  const subtotal = total / (1 + IVA_RATE);
  const iva      = total - subtotal;

  const pagado = extras.pagado != null
    ? Number(extras.pagado)
    : Number(header.paid_amount ?? total);

  const cambio = extras.cambio != null
    ? Number(extras.cambio)
    : (pagado - total);

  const folio = header.id ?? header.sale_id ?? "";
  const method = extras.payment_method ?? header.payment_method ?? "";

  const dateText = (typeof formatDateTimeEsMX === "function")
    ? formatDateTimeEsMX(header.datee)
    : String(header.datee ?? "");

  const logoPath = `file://${path.join(__dirname, "assets/LogoHidromec.jpg").replace(/\\/g, "/")}`;

  let filledHtml = template
    .replace(/{{LOGO}}/g, logoPath)

    .replace(/{{BUSINESS_NAME}}/g, escHtmlTicket(businessConfig?.business_name || ""))
    .replace(/{{ADDRESS}}/g,       escHtmlTicket(businessConfig?.address || ""))
    .replace(/{{PHONE}}/g,         escHtmlTicket(businessConfig?.phone || ""))
    .replace(/{{RFC}}/g,           escHtmlTicket(businessConfig?.rfc || ""))
    .replace(/{{FOOTER}}/g,        escHtmlTicket(businessConfig?.ticket_footer || ""))

    .replace(/{{FOLIO}}/g,   escHtmlTicket(String(folio)))
    .replace(/{{DATE}}/g,    escHtmlTicket(String(dateText)))
    .replace(/{{METHOD}}/g,  escHtmlTicket(String(method)))

    .replace(/{{SUBTOTAL}}/g, moneyTicket(subtotal))
    .replace(/{{IVA}}/g,      moneyTicket(iva))
    .replace(/{{TOTAL}}/g,    moneyTicket(total))
    .replace(/{{PAGADO}}/g,   moneyTicket(pagado))
    .replace(/{{CAMBIO}}/g,   moneyTicket(cambio))

    .replace(/{{ROWS}}/g, rowsHtml);

  return filledHtml;
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

    const html = buildTicketHtmlFromTemplate(header, details, {
      pagado: payload?.pagado ?? payload?.paid ?? null,
      cambio: payload?.cambio ?? payload?.change ?? null,
      payment_method: payload?.paymentMethod ?? payload?.payment_method ?? null
    });

    printWin = new BrowserWindow({
      show: false,
      width: 380,
      height: 700,
      webPreferences: {
        contextIsolation: true,
        sandbox: false
      }
    });

    await printWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));

    await new Promise(r => setTimeout(r, 150));

    const silent = payload?.silent !== false; 
    const deviceName = payload?.printerName || undefined; 
    const ok = await new Promise((resolve) => {
      printWin.webContents.print(
        {
          silent,
          printBackground: true,
          deviceName
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
      cashDrawer: { ...(current.cashDrawer || {}), ...(partialCfg.cashDrawer || {}) }
    };

    saveDeviceConfig(merged);

    if (merged.scanner?.enabled && merged.scanner?.path) {
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

      const current = loadDeviceConfig();
      const merged = {
        ...current,
        register: { id, name: payload?.name ?? null }
      };
      saveDeviceConfig(merged);
      return { success: true, data: merged.register };
    } catch (err) {
      console.error('register-set-current:', err);
      return { success: false, error: err.message };
    }
  });


  ipcMain.handle('setup-run', async (_event, payload = {}) => {
  try {
    const role = payload.role;
    const server = payload.server;
    const ocusPassword = payload.ocusPassword;
    const saPassword = payload.saPassword;

    // 1) Escribe db-config.json segun el rol
    const dbConfig = (role === 'principal')
      ? { server, database: DB_NAME, auth: 'windows' }
      : { server, database: DB_NAME, auth: 'sql', user: 'ocus_app', password: ocusPassword };

    fs.writeFileSync(
      path.join(app.getPath('userData'), 'db-config.json'),
      JSON.stringify(dbConfig, null, 2), 'utf8'
    );

    // 2) Prepara el servidor (instala SQL en principal / valida en secundaria)
    const setupRes = await setupServer.ensureServerReady({
      role, server, dbName: DB_NAME, saPassword, ocusPassword
    });

    if (!setupRes?.ok) {
      return { ok: false, error: 'No se pudo preparar el servidor.' };
    }

    // 3) En secundaria, confirma que la base responde de verdad
    if (role === 'secundaria') {
      await db.reconnect();
      const st = db.getState();
      if (st.status !== 'connected') {
        return { ok: false, error: 'No se pudo conectar con la computadora principal. Revisa la IP y la red.' };
      }
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
  if (!cachedMachineId) cachedMachineId = generarMachineId();
  return cachedMachineId;
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
      .execute('sp_setup_inicial');
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

    const res = await fetch(`${SUPABASE_URL}/functions/v1/license-check`, {
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
      })
    });

    const data = await res.json();

    if (!data?.success) {
      return { ok: false, error: data?.error || 'La clave no es valida o esta en uso.', code: data?.code };
    }

    fs.writeFileSync(getLicensePath(), JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, plan: data.plan, customerName: data.customerName };
  } catch (err) {
    console.error('license:activate:', err);
    return { ok: false, error: 'No hay conexion para validar la licencia.' };
  }
});

// 2. Leer la licencia (Para que Angular la consuma)
ipcMain.handle('license:get', async () => {
  try {
    const p = getLicensePath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
    return null;
  } catch (err) {
    return null;
  }
});

// 3. Escribir/Actualizar licencia (Para cuando Angular revalide en segundo plano)
ipcMain.handle('license:save', async (event, licenseData) => {
  try {
    fs.writeFileSync(getLicensePath(), JSON.stringify(licenseData, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false };
  }
});

// 4. Borrar licencia (Liberar máquina)
ipcMain.handle('license:clear', async () => {
  try {
    const p = getLicensePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return { ok: true };
  } catch (err) {
    return { ok: false };
  }
});










