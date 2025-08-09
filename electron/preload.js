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
    getActiveProducts: () => ipcRenderer.invoke('sp-get-active-products')
});
