/**
 * La ventana del gestor. Una sola, pequena y sin menu.
 *
 * No es el producto: es una herramienta de trabajo. Por eso no hereda el
 * preload de Wybix ni su ventana principal, y su puente expone tres cosas.
 */
const path = require('path');

let ventana = null;

function abrir({ BrowserWindow }) {
  if (ventana && !ventana.isDestroyed()) {
    ventana.show();
    ventana.focus();
    return ventana;
  }
  ventana = new BrowserWindow({
    width: 900, height: 660, minWidth: 700, minHeight: 520,
    title: 'Wybix Demo Manager',
    backgroundColor: '#0A1119',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  ventana.setMenu(null);
  ventana.loadFile(path.join(__dirname, 'ui', 'demo.html'));
  ventana.on('closed', () => { ventana = null; });
  return ventana;
}

module.exports = { abrir };
