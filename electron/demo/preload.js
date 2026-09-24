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
  /* `presetId` es el GIRO, y solo lo llevan los perfiles que lo piden.
     Sigue sin viajar ningun nombre de base: el giro elige QUE semilla se
     usa dentro de la carpeta del perfil, y el gestor lo resuelve contra
     el catalogo del producto antes de tocar el disco. */
  crear:        (perfilId, presetId) => ipcRenderer.invoke('demo:crear', { perfilId, presetId }),
  restablecer:  (perfilId)   => ipcRenderer.invoke('demo:restablecer', { perfilId }),
  eliminar:     (perfilId)   => ipcRenderer.invoke('demo:eliminar', { perfilId }),
  abrir:        (perfilId)   => ipcRenderer.invoke('demo:abrir', { perfilId }),
});
