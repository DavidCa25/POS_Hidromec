/**
 * Captura la PANTALLA DE CLIENTE, que es una ventana aparte de Electron.
 *
 *     node scripts/pruebas/ui/customer-display.mjs
 *
 * Se conecta directamente a su target de depuracion (customer.html) en vez
 * de al de la aplicacion, le manda un estado de venta con el mismo formato
 * que usa CustomerDisplayService y guarda las dos pantallas: espera y venta.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PUERTO = process.env.WYBIX_CDP_PORT || 9222;
const DIR = 'docs/evidencias/touch-v1';

const objetivo = async () => {
  const lista = await (await fetch(`http://localhost:${PUERTO}/json/list`)).json();
  const p = lista.find(t => t.type === 'page' && /customer\.html/.test(t.url));
  if (!p) throw new Error('La pantalla de cliente no esta abierta.');
  return p;
};

const t = await objetivo();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = () => err(new Error('sin canal')); });

let id = 0;
const pend = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pend.has(msg.id)) {
    const { ok, err } = pend.get(msg.id);
    pend.delete(msg.id);
    msg.error ? err(new Error(msg.error.message)) : ok(msg.result);
  }
};
const enviar = (method, params = {}) => new Promise((ok, err) => {
  const n = ++id;
  pend.set(n, { ok, err });
  ws.send(JSON.stringify({ id: n, method, params }));
  setTimeout(() => { if (pend.has(n)) { pend.delete(n); err(new Error('sin respuesta de ' + method)); } }, 30000);
});

await enviar('Runtime.enable');
await enviar('Page.enable');

const ev = async (expr) => {
  const r = await enviar('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'error');
  return r.result?.value;
};
const captura = async (ruta) => {
  await enviar('Page.bringToFront', {});
  await new Promise(s => setTimeout(s, 350));
  const r = await enviar('Page.captureScreenshot', { format: 'png' });
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, Buffer.from(r.data, 'base64'));
  console.log('   ' + ruta);
};

const logo = await ev(`
  const i = document.getElementById('idleInitial');
  return { etiqueta: i?.tagName, src: i?.getAttribute('src'), ancho: i?.naturalWidth ?? null };
`);
console.log('   logo en la pantalla de cliente: ' + JSON.stringify(logo));

await captura(`${DIR}/09-customer-display-espera.png`);

// Estado de venta con la forma que envia CustomerDisplayService.
await ev(`
  const estado = {
    mode: 'sale',
    business: 'Cafe Wybix',
    items: [
      { name: 'Latte', qty: 1, total: 77, opts: 'Grande, Extra shot' },
      { name: 'Americano', qty: 2, total: 70, opts: '' },
      { name: 'Coca Cola 600', qty: 1, total: 17.4, opts: '' }
    ],
    total: 164.4,
    serviceMode: 'TAKEAWAY'
  };
  if (typeof window.render === 'function') window.render(estado);
  else if (typeof window.aplicar === 'function') window.aplicar(estado);
  else window.postMessage(estado, '*');
  return true;
`);
await new Promise(s => setTimeout(s, 900));
await captura(`${DIR}/09b-customer-display-venta.png`);
ws.close();
