const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { poolPromise, sql } = require('./db');
const { pool } = require('mssql');
const isDev = process.env.NODE_ENV === 'development';

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

ipcMain.handle("get-purchases", async () => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().execute("sp_get_purchases");
    return result.recordset;
  } catch (err) {
    console.error("❌ Error ejecutando SP:", err);
    return { error: err.message };
  }
});
