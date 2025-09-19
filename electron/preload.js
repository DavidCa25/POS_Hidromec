const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    makeSale: (data) => ipcRenderer.send('make-sale', data),
    onSaleResult: (callback) => ipcRenderer.on('sale-result', (event, data) => callback(data)),
    iniciarSesion: (usuario, contrasena) => ipcRenderer.invoke('sp-iniciar-sesion', { usuario, contrasena }),
    consultarDetallesProducto: (CategoryID) => ipcRenderer.invoke('sp-Consultar-Detalle-Productos', CategoryID),
    agregarProducto: (brand, category, partNumber, name, price, stock) =>
        ipcRenderer.invoke('sp-add-product', brand, category, partNumber, name, price, stock),
    getCategories: () => ipcRenderer.invoke('sp-get-categories'),
    getBrands: () => ipcRenderer.invoke('sp-get-brands'),
    getActiveProducts: () => ipcRenderer.invoke('sp-get-active-products'),
    registerSale: (userId, paymentMethod, items) =>
        ipcRenderer.invoke('sp-register-sale', userId, paymentMethod, items),
    getSuppliers: () => ipcRenderer.invoke('sp-get-suppliers'),
    getNextPurchaseFolio: () => ipcRenderer.invoke('get-next-purchase-folio'),
    registerPurchase: (payload) => ipcRenderer.invoke('sp-register-purchase', payload),
    getUserById: (userId) => ipcRenderer.invoke('sp-get-user-by-id', userId),



    getTopSellingProducts: () => ipcRenderer.invoke('sp-get-top-selling-products'),
    getSalesMonthly: () => ipcRenderer.invoke('sp-get-total-sales-month'),
    getSalesDayly: () => ipcRenderer.invoke('sp-get-total-sales-today'),
    getTotalOrders: () => ipcRenderer.invoke('sp-get-total-orders'),
    getCashMovements: (opts) => ipcRenderer.invoke('sp-get-cash-movements', opts),

});
