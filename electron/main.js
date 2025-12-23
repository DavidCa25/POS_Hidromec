const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { poolPromise, sql } = require('./db');
const { pool } = require('mssql');
const puppeteer = require("puppeteer");
const { generateSaleA4Pdf } = require('./pdf/generateSaleA4Pdf');
const { generateSalesBatchA4Pdf } = require('./pdf/generateSalesBatchA4Pdf');
const { htmlToPdf } = require('./pdf/printToPdfElectron');
const { autoUpdater } = require('electron-updater');


const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';

let businessConfig = null;

let updateCheckTimer = null;

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

  return win;
}


async function ensureBusinessConfig() {
  if (businessConfig) return businessConfig;  
  const pool = await poolPromise;
  const result = await pool.request().execute('sp_get_business_config');
  businessConfig = result.recordset[0] || null;

  return businessConfig;
}

app.whenReady().then(async () => {
  try {
    createWindow();  

    ensureBusinessConfig().catch(err => {
      console.error('Error cargando businessConfig al inicio:', err);
    });
  
  } catch (err) {
    console.error(err);
  }
});


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

ipcMain.handle('sp-add-product', async (event, brand, category, partNumber, name, price, stock) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('brand', sql.Int, brand)
            .input('category', sql.Int, category)
            .input('part_number', sql.NVarChar(100), partNumber)
            .input('name', sql.NVarChar(100), name)
            .input('price', sql.Decimal(10, 2), price)
            .input('stock', sql.Int, stock)
            .execute('sp_add_product');

        return {
            success: true,
            data: result.recordset
        };
    } catch (err) {
        console.error('❌ Error al ejecutar sp_add_product:', err);
        return {
            success: false,
            error: err.message
        };
    }
   
});

ipcMain.handle('sp-get-categories', async (event, data) => {
    try {   
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('sp_get_categories');

        return result.recordset; 

    } catch (err) {
        console.error('❌ Error al ejecutar sp_get_categories:', err);
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

ipcMain.handle('sp-register-sale', async (event, userId, paymentMethod, items, customerId, dueDate) => {
  try {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('La venta no tiene partidas.');
    }

    const pool = await poolPromise;

    const tvp = new sql.Table();
    tvp.columns.add('product_id', sql.Int, { nullable: false });
    tvp.columns.add('quantity',   sql.Int, { nullable: false });
    tvp.columns.add('unit_price', sql.Decimal(10, 2), { nullable: false });

    for (const it of items) {
      tvp.rows.add(it.productId, it.qty, it.unitPrice);
    }

    const request = pool.request()
      .input('user_id',        sql.Int,           userId)
      .input('payment_method', sql.NVarChar(50),  paymentMethod)
      .input('SaleDetails',    tvp)
      .input('customer_id',    sql.Int,           customerId ?? null)
      .input('due_date',       sql.Date,          dueDate ? new Date(dueDate) : null);

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
    console.error('❌ Error get-next-purchase-folio:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sp-register-purchase', async (event, { user_id, tax_rate, tax_amount, subtotal, total, detalles }) => {
  try {
    const pool = await poolPromise;

    // Construir TVP (mssql.Table) exactamente como el tipo PurchaseDetailType
    const tvp = new sql.Table();
    tvp.columns.add('product_id', sql.Int);
    tvp.columns.add('supplier_id', sql.Int);
    tvp.columns.add('quantity', sql.Int);
    tvp.columns.add('unit_price', sql.Decimal(10, 2));

    detalles.forEach(d => {
      tvp.rows.add(
        d.product_id,
        d.supplier_id,
        d.cantidad ?? d.quantity,
        d.precio_unitario ?? d.unit_price
      );
    });

    const request = pool.request();
    request.input('user_id', sql.Int, user_id);
    request.input('tax_rate', sql.Decimal(5, 2), tax_rate); 
    request.input('tax_amount', sql.Decimal(10, 2), tax_amount);
    request.input('subtotal', sql.Decimal(10,2), subtotal) 
    request.input('total', sql.Decimal(10,2), total)
    request.input('PurchaseDetails', tvp);

    const result = await request.execute('sp_register_purchase');

    return { success: true, purchase_id: result.recordset[0].purchase_id  };
  } catch (err) {
    console.error('❌ Error sp_register_purchase:', err);
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
  async (event, code, customerName, email, phone, creditLimit, termsDays, active) => {
    try {
      const pool = await poolPromise;
      const request = pool.request();

      request
        .input('code',          sql.NVarChar(30),  code)
        .input('customerName',  sql.NVarChar(120), customerName)
        .input('email',         sql.NVarChar(120), email)
        .input('phone',         sql.NVarChar(30),  phone)
        .input('credit_limit',  sql.Decimal(12, 2), creditLimit)
        .input('terms_days',    sql.Int,            termsDays)
        .input('active',        sql.Bit,            active);

      // output del SP
      request.output('NewId', sql.Int);

      const result = await request.execute('sp_create_customer');

      return {
        success: true,
        id: result.output.NewId
      };
    } catch (err) {
      console.error('❌ Error al ejecutar sp_create_customer:', err);
      return {
        success: false,
        error: err.message
      };
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



ipcMain.handle('sp-update-customer', async (event, id, code, customerName, email, phone, creditLimit, termsDays, active) => {
    try {
      const pool = await poolPromise;
      const request = pool.request();

      request
        .input('id',            sql.Int,           id)
        .input('code',          sql.NVarChar(30),  code)
        .input('customerName',  sql.NVarChar(120), customerName)
        .input('email',         sql.NVarChar(120), email)
        .input('phone',         sql.NVarChar(30),  phone)
        .input('credit_limit',  sql.Decimal(12, 2), creditLimit)
        .input('terms_days',    sql.Int,            termsDays)
        .input('active',        sql.Bit,            active);

      const result = await request.execute('sp_update_customer');

      return {
        success: true,
        rowsAffected: result.rowsAffected?.[0] ?? 0
      };
    } catch (err) {
      console.error('❌ Error al ejecutar sp_update_customer:', err);
      return {
        success: false,
        error: err.message
      };
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

ipcMain.handle('open-cash-drawer', async () => {
  try {
    console.log('🧾 Simulación: abrir cajón de efectivo');

    // TODO: aquí en un futuro:
    // - Enviar comando ESC/POS a la impresora
    // - Escribir en puerto serial/USB, etc.

    return { success: true };
  } catch (err) {
    console.error('❌ Error al abrir cajón:', err);
    return { success: false, error: err.message };
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
      .input('cash_delivered', sql.Decimal(12, 2), cashDelivered);

    const result = await req.execute('sp_close_shift');

    return {
      success: true,
      data: result.recordset && result.recordset[0] ? result.recordset[0] : null
    };
  } catch (err) {
    console.error('❌ Error en sp_close_shift:', err);
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
    console.error('❌ sp_register_supplier_payment:', err);
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
      .execute('sp_register_cash_out');

    return { success: true, data: result.recordset?.[0] ?? null };
  } catch (err) {
    console.error('❌ sp_register_cash_out:', err);
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
  const subtotal = (lines || []).reduce((a, l) => {
    const qty  = Number(l.quantity ?? l.qty ?? 0);
    const unit = Number(l.unitary_price ?? l.price ?? 0);
    const sub  = Number(l.subtotal ?? (Number.isFinite(qty * unit) ? qty * unit : 0));
    return a + sub;
  }, 0);

  const iva   = subtotal * 0.16;
  const total = Number(header.total ?? subtotal);

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
      .execute('sp_open_shift');

    return { success: true, data: result.recordset?.[0] ?? null };
  } catch (err) {
    console.error('❌ sp_open_shift:', err);
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
    tvp.columns.add('quantity',   sql.Int, { nullable: false });
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

// Facturacion

ipcMain.handle('sp-upsert-fiscal-receiver', async (event, payload) => {
  try {
    const rfc = String(payload?.rfc ?? '').trim().toUpperCase();
    const name = String(payload?.name ?? payload?.fiscal_name ?? '').trim();
    const fiscalZip = String(payload?.fiscal_zip ?? payload?.fiscalZip ?? '').trim();
    const fiscalRegime = String(payload?.fiscal_regime ?? payload?.fiscalRegime ?? '').trim();
    const cfdiUse = String(payload?.cfdi_use ?? payload?.cfdiUse ?? '').trim().toUpperCase();
    const email = payload?.email != null ? String(payload.email).trim() : null;

    if (!rfc) throw new Error('RFC requerido.');
    if (!name) throw new Error('Nombre/Razón social requerida.');
    if (!fiscalZip) throw new Error('CP fiscal requerido.');
    if (!fiscalRegime) throw new Error('Régimen fiscal requerido.');
    if (!cfdiUse) throw new Error('Uso CFDI requerido.');

    const pool = await poolPromise;

    const req = pool.request()
      .input('rfc', sql.NVarChar(20), rfc)
      .input('name', sql.NVarChar(250), name)
      .input('fiscal_zip', sql.NVarChar(10), fiscalZip)
      .input('fiscal_regime', sql.NVarChar(10), fiscalRegime)
      .input('cfdi_use', sql.NVarChar(5), cfdiUse)
      .input('email', sql.NVarChar(120), email);

    const result = await req.execute('sp_upsert_fiscal_receiver');
    const receiverId = result?.recordset?.[0]?.receiver_id ?? null;

    return { success: true, data: { receiver_id: receiverId } };
  } catch (err) {
    console.error('❌ Error en sp_upsert_fiscal_receiver:', err);
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('sp-create-invoice-request', async (event, payload) => {
  try {
    const saleId = Number(payload?.sale_id ?? payload?.saleId ?? payload?.id ?? 0);
    const receiverIdRaw = payload?.receiver_id ?? payload?.receiverId ?? null;
    const receiverId = receiverIdRaw == null ? null : Number(receiverIdRaw);

    const receiverSnapshot =
      payload?.receiver_snapshot_json ??
      payload?.receiverSnapshotJson ??
      payload?.receiver_snapshot ??
      payload?.receiverSnapshot ??
      null;

    if (!Number.isFinite(saleId) || saleId <= 0) throw new Error('sale_id inválido.');
    if (receiverId !== null && (!Number.isFinite(receiverId) || receiverId <= 0)) {
      throw new Error('receiver_id inválido.');
    }

    // snapshot puede ser string JSON o objeto -> lo convertimos a string
    let snapshotJson = null;
    if (receiverSnapshot != null) {
      snapshotJson = typeof receiverSnapshot === 'string'
        ? receiverSnapshot
        : JSON.stringify(receiverSnapshot);
    }

    const pool = await poolPromise;

    const req = pool.request()
      .input('sale_id', sql.Int, saleId)
      .input('receiver_id', sql.Int, receiverId)
      .input('receiver_snapshot_json', sql.NVarChar(sql.MAX), snapshotJson);

    const result = await req.execute('sp_create_invoice_request');
    const row = result?.recordset?.[0] ?? null;

    return { success: true, data: row };
  } catch (err) {
    console.error('❌ Error en sp_create_invoice_request:', err);
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('sp-get-invoice-requests', async (event, payload) => {
  try {
    const status = payload?.status != null ? String(payload.status).trim().toUpperCase() : null;

    const pool = await poolPromise;

    const req = pool.request()
      .input('status', sql.NVarChar(20), status);

    const result = await req.execute('sp_get_invoice_requests');

    return { success: true, data: result?.recordset ?? [] };
  } catch (err) {
    console.error('❌ Error en sp_get_invoice_requests:', err);
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('sp-get-invoice-request-detail', async (event, payload) => {
  try {
    const invoiceRequestId =
      typeof payload === 'number' ? payload :
      typeof payload === 'string' ? Number(payload) :
      Number(payload?.invoice_request_id ?? payload?.invoiceRequestId ?? payload?.id ?? 0);

    if (!Number.isFinite(invoiceRequestId) || invoiceRequestId <= 0) {
      throw new Error('invoice_request_id inválido.');
    }

    const pool = await poolPromise;

    const req = pool.request()
      .input('invoice_request_id', sql.Int, invoiceRequestId);

    const result = await req.execute('sp_get_invoice_request_detail');

    const header = result?.recordsets?.[0]?.[0] ?? null;
    const receiver = result?.recordsets?.[1]?.[0] ?? null;
    const items = result?.recordsets?.[2] ?? [];

    return { success: true, data: { header, receiver, items } };
  } catch (err) {
    console.error('❌ Error en sp_get_invoice_request_detail:', err);
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('sp-update-invoice-request-status', async (event, payload) => {
  try {
    const invoiceRequestId = Number(payload?.invoice_request_id ?? payload?.invoiceRequestId ?? payload?.id ?? 0);
    const status = String(payload?.status ?? '').trim().toUpperCase();

    const cfdiUuid = payload?.cfdi_uuid ?? payload?.cfdiUuid ?? null;
    const xmlPath = payload?.xml_path ?? payload?.xmlPath ?? null;
    const pdfPath = payload?.pdf_path ?? payload?.pdfPath ?? null;
    const errorMessage = payload?.error_message ?? payload?.errorMessage ?? null;

    if (!Number.isFinite(invoiceRequestId) || invoiceRequestId <= 0) throw new Error('invoice_request_id inválido.');
    if (!status) throw new Error('status requerido.');

    const allowed = new Set(['PENDING', 'STAMPED', 'CANCELED', 'ERROR']);
    if (!allowed.has(status)) throw new Error('status inválido (PENDING|STAMPED|CANCELED|ERROR).');

    const pool = await poolPromise;

    const req = pool.request()
      .input('invoice_request_id', sql.Int, invoiceRequestId)
      .input('status', sql.NVarChar(20), status)
      .input('cfdi_uuid', sql.NVarChar(50), cfdiUuid)
      .input('xml_path', sql.NVarChar(400), xmlPath)
      .input('pdf_path', sql.NVarChar(400), pdfPath)
      .input('error_message', sql.NVarChar(1000), errorMessage);

    const result = await req.execute('sp_update_invoice_request_status');

    return { success: true, data: result?.recordset?.[0] ?? null };
  } catch (err) {
    console.error('❌ Error en sp_update_invoice_request_status:', err);
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('sp-update-business-config', async (event, payload) => {
  try {
    const businessName = String(payload?.business_name ?? payload?.businessName ?? '').trim();
    if (!businessName) throw new Error('business_name requerido.');

    const address = payload?.address != null ? String(payload.address).trim() : null;
    const phone = payload?.phone != null ? String(payload.phone).trim() : null;
    const rfc = payload?.rfc != null ? String(payload.rfc).trim().toUpperCase() : null;

    const fiscalName = payload?.fiscal_name ?? payload?.fiscalName ?? null;
    const fiscalZip = payload?.fiscal_zip ?? payload?.fiscalZip ?? null;
    const fiscalRegime = payload?.fiscal_regime ?? payload?.fiscalRegime ?? null;

    const invoicingEnabled = payload?.invoicing_enabled ?? payload?.invoicingEnabled ?? 0;
    const invoicingProvider = payload?.invoicing_provider ?? payload?.invoicingProvider ?? null;

    const pool = await poolPromise;

    const req = pool.request()
      .input('business_name', sql.NVarChar(200), businessName)
      .input('address', sql.NVarChar(300), address)
      .input('phone', sql.NVarChar(50), phone)
      .input('rfc', sql.NVarChar(50), rfc)

      .input('fiscal_name', sql.NVarChar(250), fiscalName ? String(fiscalName).trim() : null)
      .input('fiscal_zip', sql.NVarChar(10), fiscalZip ? String(fiscalZip).trim() : null)
      .input('fiscal_regime', sql.NVarChar(10), fiscalRegime ? String(fiscalRegime).trim() : null)

      .input('invoicing_enabled', sql.Bit, Number(invoicingEnabled) ? 1 : 0)
      .input('invoicing_provider', sql.NVarChar(30), invoicingProvider ? String(invoicingProvider).trim() : null);

    const result = await req.execute('sp_update_business_config');
    const row = result?.recordset?.[0] ?? null;

    return { success: true, data: row };
  } catch (err) {
    console.error('❌ Error en sp_update_business_config:', err);
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('sp-get-business-config', async () => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .execute('sp_get_business_config');
    const row = result?.recordset?.[0] ?? null;
    return { success: true, data: row };
  } catch (err) {
    console.error('Error en sp_get_business_config:', err);
    return { success: false, error: err?.message || String(err) };
  }
});











