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

    // --- Construir TVP para @SaleDetails ---
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
