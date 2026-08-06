const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('customerAPI', {
  // Recibe el estado de la venta (idle | sale | checkout)
  onState: (cb) => ipcRenderer.on('customer:state', (_e, state) => cb(state)),
  // Datos del negocio para la pantalla de espera
  getBusiness: () => ipcRenderer.invoke('customer:get-business'),
});
