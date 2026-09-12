const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('customerAPI', {
  // Recibe el estado de la venta (idle | sale | checkout)
  onState: (cb) => ipcRenderer.on('customer:state', (_e, state) => cb(state)),
  // Datos del negocio para la pantalla de espera
  getBusiness: () => ipcRenderer.invoke('customer:get-business'),
  /**
   * Lo que hace el CLIENTE en su pantalla: empezar, parar, girar.
   *
   * Va como evento conceptual -STOP_TIMING, SPIN- y no como "he ganado". El
   * origen de la interaccion (tactil, raton o, algun dia, un boton fisico) es
   * cosa de esta pantalla; lo que viaja es la intencion, y quien decide el
   * resultado sigue siendo el servidor.
   */
  enviar: (accion) => ipcRenderer.invoke('customer:action', accion),
});
