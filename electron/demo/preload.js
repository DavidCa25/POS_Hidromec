/**
 * El puente del gestor. Deliberadamente minusculo.
 *
 * Tres operaciones, todas por identificador de perfil. No hay nada aqui que
 * acepte un nombre de base, una consulta ni un fragmento de SQL: la ventana
 * no tiene por donde pedir que se toque algo que no sea una demo.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('demo', {
  estado:       ()           => ipcRenderer.invoke('demo:estado'),
  crear:        (perfilId)   => ipcRenderer.invoke('demo:crear', { perfilId }),
  restablecer:  (perfilId)   => ipcRenderer.invoke('demo:restablecer', { perfilId }),
  eliminar:     (perfilId)   => ipcRenderer.invoke('demo:eliminar', { perfilId }),
  abrir:        (perfilId)   => ipcRenderer.invoke('demo:abrir', { perfilId }),
});
