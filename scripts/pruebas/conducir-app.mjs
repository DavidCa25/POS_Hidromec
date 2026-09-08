/**
 * Conduce la ventana REAL de Wybix (Electron) por el protocolo de depuracion.
 *
 *     npx electron ./electron/main.js --remote-debugging-port=9222   (en otra consola)
 *     node scripts/pruebas/conducir-app.mjs <guion.mjs>
 *
 * Para que sirve: las pruebas de interfaz con `electronAPI` simulado
 * demuestran que la pantalla llama a lo que debe, pero no que la aplicacion
 * REAL funcione contra SQL Server. Esto ejecuta codigo dentro de la ventana
 * de verdad, con su preload, su base y sus dispositivos.
 *
 * El guion recibe `{ ev, captura }`:
 *   ev(expresion)  evalua en la pagina y devuelve el resultado (admite await)
 *   captura(ruta)  guarda un PNG de la ventana
 *   cdp(metodo, params)  envia un comando del protocolo (p. ej. Emulation.*)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PUERTO = process.env.WYBIX_CDP_PORT || 9222;

async function objetivo() {
  const r = await fetch(`http://localhost:${PUERTO}/json/list`);
  const lista = await r.json();
  // La ventana de la aplicacion, no la pantalla de cliente ni las devtools:
  // con el display abierto hay mas de un target y el orden no esta garantizado.
  const paginas = lista.filter(t => t.type === 'page' && !/devtools/.test(t.url));
  const p = paginas.find(t => /localhost:4200/.test(t.url)) || paginas.find(t => !/customer.html/.test(t.url)) || paginas[0];
  if (!p) throw new Error('No hay ninguna ventana de Wybix abierta con depuracion en el puerto ' + PUERTO);
  return p;
}

export async function conectar() {
  const t = await objetivo();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = () => err(new Error('No se pudo abrir el canal de depuracion.')); });

  let id = 0;
  const pendientes = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pendientes.has(msg.id)) {
      const { ok, err } = pendientes.get(msg.id);
      pendientes.delete(msg.id);
      if (msg.error) err(new Error(msg.error.message));
      else ok(msg.result);
    }
  };

  const enviar = (method, params = {}) => new Promise((ok, err) => {
    const n = ++id;
    pendientes.set(n, { ok, err });
    ws.send(JSON.stringify({ id: n, method, params }));
    setTimeout(() => {
      if (pendientes.has(n)) { pendientes.delete(n); err(new Error(`Sin respuesta de ${method}`)); }
    }, 60000);
  });

  await enviar('Runtime.enable');
  await enviar('Page.enable');

  /** Evalua en la pagina. Admite `await` y devuelve el valor ya serializado. */
  const ev = async (expresion) => {
    const r = await enviar('Runtime.evaluate', {
      expression: `(async () => { ${expresion} })()`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      const e = r.exceptionDetails;
      throw new Error(e.exception?.description || e.text || 'Error en la pagina');
    }
    return r.result?.value;
  };

  const captura = async (ruta) => {
    // Con la ventana oculta el compositor no entrega fotogramas y la captura
    // se queda esperando: primero se trae al frente.
    try { await enviar('Page.bringToFront'); await new Promise(s => setTimeout(s, 250)); } catch { /* da igual */ }
    const r = await enviar('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, Buffer.from(r.data, 'base64'));
    return ruta;
  };

  return { ev, captura, cdp: enviar, cerrar: () => ws.close(), url: t.url };
}

// Uso directo: node conducir-app.mjs <guion.mjs>
if (process.argv[1] && process.argv[1].endsWith('conducir-app.mjs')) {
  const guion = process.argv[2];
  const app = await conectar();
  console.log(`Conectado a la ventana real: ${app.url}\n`);
  if (guion) {
    const mod = await import(new URL(`file://${process.cwd().replace(/\\/g, '/')}/${guion}`).href);
    await mod.default(app);
  } else {
    console.log(await app.ev('return { url: location.href, titulo: document.title, api: typeof window.electronAPI, wybix: typeof window.wybix };'));
  }
  app.cerrar();
}
