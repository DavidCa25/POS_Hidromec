/**
 * HTML -> PDF con el propio Chromium de Electron.
 *
 * Antes cada PDF (ticket, venta A4, reporte de ventas) levantaba Puppeteer,
 * es decir, UN SEGUNDO Chromium (~1.2 GB en cache del desarrollador, y en la
 * caja del cliente ni siquiera existe: Puppeteer no descarga el navegador en
 * tiempo de ejecucion). Electron ya trae Chromium; `webContents.printToPDF`
 * produce el mismo resultado sin dependencias externas y funciona sin red.
 *
 * La ventana es invisible, se destruye al terminar, no tiene acceso a Node
 * (sandbox, sin preload) y solo carga el HTML que se le entrega.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MM_POR_PULGADA = 25.4;
const pulgadas = (mm) => Number(mm) / MM_POR_PULGADA;

/**
 * @param {string} html  Documento completo.
 * @param {object} opts
 * @param {string} opts.outPath                 Ruta del PDF resultante.
 * @param {string|{widthMm:number,heightMm:number}} [opts.pageSize='Letter']
 * @param {{top:number,right:number,bottom:number,left:number}} [opts.marginsMm]
 *        Sin margenes = 0, igual que el comportamiento por defecto de Puppeteer.
 * @param {boolean} [opts.landscape=false]
 * @param {boolean} [opts.printBackground=true]
 * @param {boolean} [opts.preferCSSPageSize=false]
 * @param {number}  [opts.timeoutMs=15000]
 * @returns {Promise<string>} outPath
 */
async function htmlToPdf(html, opts = {}) {
  if (!opts.outPath) throw new Error('htmlToPdf: falta outPath.');
  if (!app.isReady()) throw new Error('htmlToPdf: la aplicacion no esta lista.');

  // Archivo temporal en vez de data: URL: permite recursos file:// (logo) y
  // no depende del limite de longitud de una URL.
  const tmpDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'wybix-pdf-'));
  const tmpHtml = path.join(tmpDir, 'documento.html');
  fs.writeFileSync(tmpHtml, html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 1400,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const timeoutMs = Number(opts.timeoutMs) || 15000;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('htmlToPdf: tiempo de espera agotado al renderizar.')), timeoutMs);
  });

  try {
    // URL explicita: en Windows `loadFile` dejaba las barras invertidas en la
    // URL y Chromium respondia ERR_FAILED. Se reintenta un par de veces por
    // precaucion: un archivo recien escrito puede estar abierto unos ms por el
    // antivirus de la caja.
    const url = pathToFileURL(tmpHtml).href;
    let ultimoError = null;
    for (let intento = 1; intento <= 4; intento++) {
      try {
        await Promise.race([win.loadURL(url), timeout]);
        ultimoError = null;
        break;
      } catch (e) {
        ultimoError = e;
        if (!/ERR_FAILED|ERR_FILE_NOT_FOUND|ERR_ACCESS_DENIED/.test(String(e && e.message))) throw e;
        await new Promise(r => setTimeout(r, 120 * intento));
      }
    }
    if (ultimoError) throw ultimoError;

    // Espera fuentes e imagenes: equivale al `networkidle0` de Puppeteer para
    // un documento local.
    await Promise.race([
      win.webContents.executeJavaScript(`
        (async () => {
          try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
          const imgs = Array.from(document.images || []);
          await Promise.all(imgs.map(img => img.complete ? null : new Promise(res => {
            img.addEventListener('load', res, { once: true });
            img.addEventListener('error', res, { once: true });
          })));
          return true;
        })()
      `, true).catch(() => true),
      timeout,
    ]);

    const pdfOpts = {
      printBackground: opts.printBackground !== false,
      landscape: !!opts.landscape,
      preferCSSPageSize: !!opts.preferCSSPageSize,
    };

    const ps = opts.pageSize || 'Letter';
    pdfOpts.pageSize = typeof ps === 'string'
      ? ps
      : { width: pulgadas(ps.widthMm), height: pulgadas(ps.heightMm) };

    const m = opts.marginsMm;
    pdfOpts.margins = m
      ? { marginType: 'custom', top: pulgadas(m.top), right: pulgadas(m.right), bottom: pulgadas(m.bottom), left: pulgadas(m.left) }
      : { marginType: 'custom', top: 0, right: 0, bottom: 0, left: 0 };

    const buffer = await Promise.race([win.webContents.printToPDF(pdfOpts), timeout]);

    fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
    fs.writeFileSync(opts.outPath, buffer);
    return opts.outPath;
  } finally {
    if (timer) clearTimeout(timer);
    try { if (!win.isDestroyed()) win.destroy(); } catch { /* noop */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

module.exports = { htmlToPdf };
