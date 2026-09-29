/**
 * ARNES DE PRUEBAS DE WYBIX LOCAL HOST.
 *
 * Lo comparten `local-host.mjs` (KDS / Preparacion) y
 * `pantallas-operativas.mjs` (las demas superficies): una base temporal que
 * nace como una instalacion real, un pool como el de la app, peticiones HTTP
 * con cookies como un navegador, un cliente de Server-Sent Events, y un Local
 * Host de verdad escuchando en un puerto de prueba.
 *
 * Corre con el Node de Electron (el driver de SQL esta compilado para el).
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { ejecutar, ejecutarVarios, restaurar, eliminar, exigirTemporal } from '../../db/lib/temporal.mjs';
import { SERVIDOR } from '../../db/lib/sql.mjs';

const require = createRequire(import.meta.url);
export const sql = require('mssql/msnodesqlv8');

export const dormir = (ms) => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------ resultados
export function crearMarcador() {
  const resultados = [];
  const check = (n, cond, titulo, detalle = '') => {
    resultados.push({ n, ok: !!cond, titulo, detalle });
    console.log(`   ${cond ? 'ok    ' : 'FALLA '} ${String(n).padStart(5)}. ${titulo}${detalle ? '  · ' + detalle : ''}`);
  };
  const salto = (n, titulo, motivo) => {
    resultados.push({ n, ok: null, titulo, detalle: motivo });
    console.log(`   SALTA  ${String(n).padStart(5)}. ${titulo}  · ${motivo}`);
  };
  const seccion = (t) => console.log(`\n-- ${t}`);
  function resumen({ grupos } = {}) {
    const porN = new Map();
    for (const r of resultados) {
      const x = porN.get(r.n) || { fallos: 0, oks: 0, saltos: 0 };
      if (r.ok === true) x.oks++; else if (r.ok === false) x.fallos++; else x.saltos++;
      porN.set(r.n, x);
    }
    const orden = (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true });
    const pasa = [...porN].filter(([, x]) => !x.fallos && x.oks).map(([n]) => n).sort(orden);
    const falla = [...porN].filter(([, x]) => x.fallos).map(([n]) => n).sort(orden);
    const salta = [...porN].filter(([, x]) => !x.fallos && !x.oks).map(([n]) => n).sort(orden);
    console.log(`\nPASS ${pasa.length}: ${pasa.join(', ')}`);
    console.log(`FAIL ${falla.length}: ${falla.join(', ')}`);
    console.log(`SKIPPED ${salta.length}: ${salta.join(', ')}`);
    if (grupos) {
      console.log('\nPOR BLOQUE');
      for (const [nombre, pref] of Object.entries(grupos)) {
        const de = (arr) => arr.filter(n => String(n).startsWith(pref)).length;
        console.log(`   ${nombre.padEnd(18)} PASS ${de(pasa)} · FAIL ${de(falla)} · SKIPPED ${de(salta)}`);
      }
    }
    console.log(`(${resultados.filter(r => r.ok).length} comprobaciones ok de ${resultados.length})`);
    return { pasa, falla, salta };
  }
  return { resultados, check, salto, seccion, resumen };
}

// ------------------------------------------------------------------ base
const lotesDe = (ruta) => readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n')
  .split(/\n\s*GO\s*\n/gi).map(x => x.trim()).filter(Boolean);

export function nacerBase(DB, { perfil = 'HOSPITALITY', usuario = 'dueno', password = 'dueno12345' } = {}) {
  exigirTemporal(DB);
  eliminar(DB);
  restaurar(DB, join(process.cwd(), 'installer', 'template.bak'));
  const dir = join(process.cwd(), 'electron', 'migrations');
  const lotes = readdirSync(dir).filter(f => f.endsWith('.sql')).sort().flatMap(f => lotesDe(join(dir, f)));
  const r = ejecutarVarios(DB, lotes);
  const malo = r.findIndex(x => !x.ok);
  if (malo >= 0) throw new Error(`migraciones, lote ${malo + 1}: ${r[malo].error}\n${lotes[malo].slice(0, 300)}`);
  ejecutar(DB, `EXEC dbo.sp_setup_inicial @usuario = N'${usuario}', @password = N'${password}',
      @business_name = N'Negocio LAN', @business_profile = N'${perfil}'`);
}

export const borrarBase = (DB) => { try { eliminar(DB); } catch { /* noop */ } };

export async function abrirPool(DB) {
  const p = new sql.ConnectionPool({
    server: SERVIDOR, database: DB, connectionTimeout: 8000, requestTimeout: 30000,
    options: { trustedConnection: true, trustServerCertificate: true, encrypt: false, enableArithAbort: true },
  });
  return p.connect();
}

// ------------------------------------------------------------------ HTTP
/** Un navegador minimo: guarda las cookies que el Host le pone. */
export function crearTablet(puerto) {
  const galletas = new Map();
  function guardar(set) {
    for (const c of [].concat(set || [])) {
      const [par, ...atr] = String(c).split(';');
      const [k, v] = par.split('=');
      if (/Max-Age=0/i.test(atr.join(';')) || v === '') galletas.delete(k.trim());
      else galletas.set(k.trim(), v);
    }
  }
  const cookie = () => [...galletas].map(([k, v]) => `${k}=${v}`).join('; ');
  async function pedir(ruta, opts = {}) {
    const r = await pedirCrudo(ruta, { ...opts, puerto, cookie: opts.cookie ?? (cookie() || null) });
    guardar(r.headers['set-cookie']);
    return r;
  }
  return {
    pedir,
    galletas,
    cookie,
    get: (ruta, o = {}) => pedir(ruta, o),
    post: (ruta, cuerpo, o = {}) => pedir(ruta, { ...o, metodo: 'POST', cuerpo }),
    escuchar: (ruta = '/api/s/eventos') => escuchar(cookie(), { puerto, ruta }),
    olvidarTrabajador: () => galletas.delete('wx_trab'),
  };
}

export function pedirCrudo(ruta, { metodo = 'GET', cuerpo = null, cookie = null, host = '127.0.0.1', puerto, crudo = null, cabeceras = {} } = {}) {
  return new Promise((resolve, reject) => {
    const datos = crudo ?? (cuerpo ? JSON.stringify(cuerpo) : null);
    const req = http.request({ host, port: puerto, path: ruta, method: metodo, headers: {
      ...(datos ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(datos) } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...cabeceras,
    } }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', c => { b += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch { /* no es json */ }
        resolve({ status: res.statusCode, headers: res.headers, texto: b, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    if (datos) req.write(datos);
    req.end();
  });
}

/** Una pantalla escuchando eventos, como la pagina: cookie y Server-Sent Events. */
export function escuchar(cookie, { puerto, ruta = '/api/s/eventos' } = {}) {
  const eventos = [];
  let res = null;
  let cerrado = false;
  const esperando = [];
  const req = http.get({ host: '127.0.0.1', port: puerto, path: ruta, headers: { Cookie: cookie, Accept: 'text/event-stream' } }, (r) => {
    res = r;
    r.setEncoding('utf8');
    let buf = '';
    r.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const bloque = buf.slice(0, i); buf = buf.slice(i + 2);
        if (bloque.startsWith(':') || bloque.startsWith('retry:')) continue;
        const ev = { evento: 'message', datos: null, t: Date.now() };
        for (const linea of bloque.split('\n')) {
          if (linea.startsWith('event: ')) ev.evento = linea.slice(7);
          else if (linea.startsWith('data: ')) { try { ev.datos = JSON.parse(linea.slice(6)); } catch { ev.datos = linea.slice(6); } }
        }
        eventos.push(ev);
        for (const w of [...esperando]) if (w.cond(ev)) { esperando.splice(esperando.indexOf(w), 1); w.resolve(ev); }
      }
    });
    r.on('end', () => { cerrado = true; });
    r.on('close', () => { cerrado = true; });
  });
  req.on('error', () => { cerrado = true; });
  return {
    eventos,
    get status() { return res?.statusCode; },
    get cerrado() { return cerrado; },
    esperar(cond, ms = 5000) {
      const ya = eventos.find(cond);
      if (ya) return Promise.resolve(ya);
      return new Promise((resolve) => {
        const w = { cond, resolve };
        esperando.push(w);
        setTimeout(() => { const i = esperando.indexOf(w); if (i >= 0) { esperando.splice(i, 1); resolve(null); } }, ms);
      });
    },
    cerrar() { req.destroy(); cerrado = true; },
  };
}

export function puertoAbierto(puerto, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port: puerto, host });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(1500, () => { s.destroy(); resolve(false); });
  });
}

/**
 * Un Local Host de verdad con este pool. Cada llamada crea una instancia
 * nueva del modulo (el puerto se lee al cargarlo). `dominios.hospitality` son
 * las funciones de salon.js que usa el mesero: se registran con un ipcMain de
 * mentira, igual que en main.js.
 */
export function crearHost({ pool, machine = 'PC-PRINCIPAL', puerto, config = { localHost: { activo: true } }, conHospitality = true, licencia = null }) {
  const antes = process.env.WYBIX_LOCAL_HOST_PUERTO;
  process.env.WYBIX_LOCAL_HOST_PUERTO = String(puerto);
  delete require.cache[require.resolve('../../../electron/local-host/index.js')];
  const { crearLocalHost } = require('../../../electron/local-host/index.js');
  process.env.WYBIX_LOCAL_HOST_PUERTO = antes;
  let hospitality = null;
  if (conHospitality) {
    const ipcSalon = require('../../../electron/ipc/salon.js');
    hospitality = ipcSalon.registrar({
      ipcMain: { handle: () => {} }, sql, poolPromise: Promise.resolve(pool),
      imprimirHtml: async () => true, loadDeviceConfig: () => ({}), alCambiarComandas: () => host.avisar(),
    });
  }
  const host = crearLocalHost({
    sql, poolPromise: Promise.resolve(pool),
    machineId: () => machine, machineName: machine,
    esPrincipal: () => true,
    leerConfig: () => config,
    guardarConfig: (c) => Object.assign(config, c),
    dominios: { hospitality },
    licencia,
    log: () => {},
  });
  return host;
}

/** Emparejar una pantalla como lo hace la tablet: QR del Host y canje. */
export async function emparejar(host, puerto, opciones) {
  const r = await host.emparejar({ userId: 1, ...opciones });
  if (!r.ok) throw new Error(`emparejar: ${r.error}`);
  const token = r.url.split('/pair/')[1];
  const tablet = crearTablet(puerto);
  const canje = await tablet.post('/api/pair', { token });
  return { r, token, canje, tablet, cookie: tablet.cookie() };
}
