const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { poolPromise, sql } = require('./db');
const { pool } = require('mssql');

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

    win.loadFile(path.join(__dirname, '../dist/filtros_lubs_rios/browser/index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('sp-iniciar-sesion', async (event, { usuario, contrasena }) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('Usuario', sql.VarChar, usuario)
            .input('Passwrd', sql.VarChar, contrasena)
            .execute('sp_IniciarSesion');
        

        if (result.recordset.length > 0) {
            return {
                success: true,
                data: result.recordset
            };
        } else {
            return {
                success: false,
                message: 'Usuario o contraseña incorrectos'
            };
        }

    } catch (err) {
        console.error('❌ Error al ejecutar sp_IniciarSesion:', err);
        return {
            success: false,
            error: err.message
        };
    }
});

ipcMain.handle('sp-consultar-inventario', async () => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('sp_Consultar_Inventario');

        return result.recordset; 

    } catch (err) {
        console.error('❌ Error al ejecutar sp_ConsultarInventario:', err);
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

ipcMain.handle('sp-agregar-productos', async (event, productName, brandID, categoryID, subCategoryID, controlType, piecePerBox, salePrice, minimumBoxStock, maximumBoxStock) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('ProductName', sql.VarChar, productName)
            .input('BrandID', sql.Int, brandID)
            .input('CategoryID', sql.Int, categoryID)
            .input('SubCategoryID', sql.Int, subCategoryID)
            .input('ControlType', sql.VarChar, controlType)
            .input('PiecePerBox', sql.Int, piecePerBox)
            .input('SalePrice', sql.Decimal(18, 2), salePrice)
            .input('MinimumBoxStock', sql.Int, minimumBoxStock)
            .input('MaximumBoxStock', sql.Int, maximumBoxStock)
            .execute('sp_Agregar_Productos');

        return {
            success: true,
            data: result.recordset
        };
    } catch (err) {
        console.error('❌ Error al ejecutar sp_Agregar_Productos:', err);
        return {
            success: false,
            error: err.message
        };
    }
})

