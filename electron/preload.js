const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    makeSale: (data) => ipcRenderer.send('make-sale', data),
    onSaleResult: (callback) => ipcRenderer.on('sale-result', (event, data) => callback(data)),
    iniciarSesion: (usuario, contrasena) => ipcRenderer.invoke('sp-iniciar-sesion', { usuario, contrasena }),
    consultarInventario: () => ipcRenderer.invoke('sp-consultar-inventario'),
    consultarDetallesProducto: (CategoryID) => ipcRenderer.invoke('sp-Consultar-Detalle-Productos', CategoryID)
});
