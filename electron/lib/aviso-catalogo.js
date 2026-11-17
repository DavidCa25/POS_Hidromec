/**
 * AVISO DE CATÁLOGO
 *
 * Venta y Touch cobran desde una copia del catálogo en memoria. Cuando algo
 * cambia un producto en ESTA computadora (Inventario, una compra con margen,
 * el asistente, una importación, el catálogo de la matriz), se avisa a todas
 * las ventanas con `catalogo:cambio` y cada una relee en segundo plano.
 *
 * Otra caja en red no recibe este aviso: para ella la garantía es el cobro,
 * que compara el precio de cada línea contra la base (sp-register-sale).
 */
'use strict';

const { BrowserWindow } = require('electron');

/** Canales que cambian precio, nombre, códigos o si un producto se vende. */
const CANALES_CATALOGO = new Set([
  'sp-add-product', 'sp-update-product', 'sp-delete-product', 'sp-import-products',
  'sp-register-purchase', 'import-database', 'multi:recibir', 'menu-linea:producto-guardar',
  'modifiers:set-product-groups', 'producto:impuestos-guardar',
]);

function avisarCatalogo(origen) {
  for (const w of BrowserWindow.getAllWindows()) {
    try { if (!w.isDestroyed()) w.webContents.send('catalogo:cambio', { origen }); } catch { /* ventana cerrándose */ }
  }
}

/** ¿El canal terminó bien? Un rechazo o una autorización pendiente no cambió nada. */
const exito = (r) => !(r && typeof r === 'object' && (r.success === false || r.ok === false || r.error));

/**
 * Envuelve `ipcMain.handle` para que los canales del catálogo avisen al
 * terminar bien. Se llama UNA vez, antes de registrar cualquier canal.
 */
function vigilarCanales(ipcMain) {
  if (ipcMain.__catalogoVigilado) return;
  const original = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (canal, fn) => original(canal, !CANALES_CATALOGO.has(canal) ? fn : async (...args) => {
    const r = await fn(...args);
    if (exito(r)) avisarCatalogo(canal);
    return r;
  });
  ipcMain.__catalogoVigilado = true;
}

module.exports = { avisarCatalogo, vigilarCanales, CANALES_CATALOGO };
