/**
 * IMPRIMIR UN DOCUMENTO HTML EN UNA IMPRESORA TERMICA.
 *
 * Una sola implementacion para el ticket de venta y para las comandas de
 * cocina. El HTML se pinta en una ventana oculta, se mide su alto real -para
 * no sacar papel en blanco de mas- y se manda con `webContents.print` al
 * dispositivo de Windows indicado, o al predeterminado si no se indica.
 *
 * Devuelve true/false; nunca lanza por un fallo de la impresora. Una comanda
 * que no se imprime NO deshace el envio: sigue en el KDS y se reimprime.
 */
const { BrowserWindow } = require('electron');

const MICRAS_POR_PX = 25400 / 96; // 1 px a 96 dpi = 264.58 micras

async function imprimirHtml(html, { printerName, paperWidthMm = 58, paperHeightMm = 0, format = 'roll', silent = true } = {}) {
  let ventana = null;
  try {
    ventana = new BrowserWindow({
      show: false,
      width: Math.ceil(paperWidthMm * 96 / 25.4),
      height: 800,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });

    await ventana.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    // Esperar el render y medir el alto real del contenido.
    await new Promise(r => setTimeout(r, 200));
    let altoPx = 0;
    try { altoPx = Number(await ventana.webContents.executeJavaScript('document.body.scrollHeight')) || 0; } catch { /* sin medida */ }
    if (!altoPx || altoPx < 40) altoPx = 500;

    const ancho = Math.round(Number(paperWidthMm || 58) * 1000);
    if (format === 'label' && paperHeightMm && (altoPx * 25.4 / 96) > paperHeightMm + 1) throw Error('El contenido no cabe en la etiqueta. Aumenta el alto o reduce los campos.');
    const alto = paperHeightMm ? Math.round(paperHeightMm*1000) : Math.round((altoPx + 12) * MICRAS_POR_PX);

    return await new Promise((resolve) => {
      ventana.webContents.print(
        {
          silent,
          printBackground: true,
          deviceName: printerName || undefined,
          margins: { marginType: 'none' },
          pageSize: { width: ancho, height: alto },
        },
        (ok, motivo) => {
          if (!ok) console.error('[IMPRESION] fallo:', motivo);
          resolve(!!ok);
        },
      );
    });
  } catch (e) {
    console.error('[IMPRESION]', e?.message || e);
    return false;
  } finally {
    try { if (ventana) ventana.close(); } catch { /* ya cerrada */ }
  }
}

module.exports = { imprimirHtml };
