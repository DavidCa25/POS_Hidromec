const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { poolPromise, sql } = require('./db');
const { pool } = require('mssql');
const isDev = process.env.NODE_ENV === 'development';

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
      enableRemoteModule: false
    }
  });

  if (isDev) {
    win.loadURL('http://localhost:4200');
  } else {
    win.loadFile(path.join(__dirname, '../dist/filtros_lubs_rios/browser/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('sp-iniciar-sesion', async (event, { usuario, contrasena }) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('username', sql.VarChar, usuario)
            .input('password', sql.VarChar, contrasena)
            .execute('sp_login_user');
        

        if (result.recordset.length > 0) {
            return {
                success: true,
                data: result.recordset[0] // Retorna el primer registro
            };
        } else {
            return {
                success: false,
                message: 'Usuario o contraseña incorrectos'
            };
        }

    } catch (err) {
        console.error('❌ Error al ejecutar sp_login_user:', err);
        return {
            success: false,
            error: err.message
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

ipcMain.handle('sp-register-sale', async (event, userId, paymentMethod, items) => {
  try {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('La venta no tiene partidas.');
    }

    const pool = await poolPromise;

    // --- Construir TVP para @SaleDetails ---
    // Importante: Las columnas y su orden deben coincidir con el tipo SQL:
    // CREATE TYPE dbo.SaleDetailType AS TABLE (
    //   product_id INT, quantity INT, unit_price DECIMAL(10,2)
    // )
    const tvp = new sql.Table();     
    tvp.columns.add('product_id', sql.Int, { nullable: false });
    tvp.columns.add('quantity',   sql.Int, { nullable: false });
    tvp.columns.add('unit_price', sql.Decimal(10, 2), { nullable: false });

    for (const it of items) {
      tvp.rows.add(it.productId, it.qty, it.unitPrice);
    }

    const request = pool.request()
      .input('user_id', sql.Int, userId)
      .input('payment_method', sql.NVarChar(50), paymentMethod)
      .input('SaleDetails', tvp); 

    const result = await request.execute('sp_register_sale');

    return { success: true, data: result.recordset ?? [] };
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
  // usa snake_case en ambos lados
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
      .input('start_date', sql.Date, start_date)          // mssql acepta string 'YYYY-MM-DD' para Date
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

