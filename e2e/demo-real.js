/**
 * UNA DEMO COMO LA CREA EL GESTOR, PARA LAS PRUEBAS.
 *
 * La prueba anterior de la demo automatica partia de la base de pruebas normal
 * y le METIA a mano una marca y una categoria «para que la demo tuviera que
 * elegir». La demo real no las tenia: el recorrido fallaba en «Marca: Sin
 * resultados» y la prueba seguia en verde. Una prueba que prepara el mundo a
 * la medida del recorrido no prueba el recorrido.
 *
 * Aqui se sigue EXACTAMENTE el camino del gestor (electron/demo/gestor.js):
 *
 *     template.bak  ->  todas las migraciones  ->  semilla del perfil
 *
 * con las mismas semillas (`semillasDe`) y el mismo troceo por GO (`lotes`).
 * Lo unico que cambia es el nombre de la base, que tiene que ser temporal.
 */
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('@playwright/test');
const { nuevoPerfil, opcionesDeArranque, escribirConfiguracion } = require('./perfil');

const RAIZ = path.join(__dirname, '..');
const DEMO = { usuario: 'demo', password: 'demo1234' };

async function herramientas() {
  const temporal = await import('../scripts/db/lib/temporal.mjs');
  const { consultar } = await import('../scripts/db/lib/sql.mjs');
  return { temporal, consultar };
}

/** Base demo nueva, del perfil (y giro) pedido. Devuelve su instancia. */
async function prepararDemoReal({ base, perfil, preset = null }) {
  const { temporal, consultar } = await herramientas();
  const gestor = require('../electron/demo/gestor');
  temporal.exigirTemporal(base);

  const perfiles = gestor.leerPerfiles(null);
  const p = perfiles.find(x => x.id === perfil);
  if (!p) throw new Error(`No existe el perfil de demo ${perfil}`);

  temporal.eliminar(base);
  temporal.restaurar(base, path.join(RAIZ, 'installer', 'template.bak'));

  const dir = path.join(RAIZ, 'electron', 'migrations');
  const lotes = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) {
    lotes.push(...gestor.lotes(fs.readFileSync(path.join(dir, f), 'utf8')));
  }
  const r = temporal.ejecutarVarios(base, lotes);
  const malo = r.find(x => !x.ok);
  if (malo) throw new Error(`migraciones: ${malo.error}`);

  for (const semilla of gestor.semillasDe(p, p.giros ? preset : null)) {
    const rs = temporal.ejecutarVarios(base, gestor.lotes(fs.readFileSync(semilla, 'utf8')));
    const m = rs.find(x => !x.ok);
    if (m) throw new Error(`semilla ${path.basename(semilla)}: ${m.error}`);
  }
  const meta = {};
  for (const f of consultar(base, "SELECT clave, valor FROM dbo.database_metadata WHERE clave IN ('is_demo','demo_instance_id','demo_profile','demo_preset')")) meta[f.clave] = f.valor;
  if (String(meta.is_demo).toLowerCase() !== 'true') throw new Error('la semilla no dejo is_demo');
  return { instancia: meta.demo_instance_id, perfil, preset };
}

/** Arranca Wybix con el gestor de demos, como en la maquina de ventas. */
async function arrancarDemoReal({ base, perfil, instancia, touch = false }) {
  const dirPerfil = await nuevoPerfil(base);
  const dirDemo = `${dirPerfil}-demo`;
  fs.mkdirSync(dirDemo, { recursive: true });
  escribirConfiguracion(dirDemo, base);
  /* Una caja Touch, como la que usa quien atiende en mesa. */
  if (touch) {
    fs.writeFileSync(path.join(dirDemo, 'device-config.json'), JSON.stringify({
      deviceProfile: 'TOUCH_POS',
      scanner: { conexion: 'teclado', enabled: false, path: '', baudRate: 9600 },
      printer: { conexion: 'sistema', name: '', ticketPrinterName: '' },
      drawer: { conexion: 'impresora', enabled: false, path: '', baudRate: 9600, pulseMs: 120, pin: 0, openOnPayment: false },
      customerDisplay: { enabled: false, displayId: null },
    }, null, 2), 'utf8');
  }
  fs.writeFileSync(path.join(dirDemo, 'demo-instancias.json'),
    JSON.stringify({ [perfil]: { instancia, base, anotada: new Date().toISOString() } }, null, 2), 'utf8');

  const opts = opcionesDeArranque(dirPerfil);
  const app = await electron.launch({ ...opts, env: { ...opts.env, WYBIX_DEMO: '1' } });
  const registro = [];
  app.process().stdout.on('data', (d) => registro.push(String(d)));
  app.process().stderr.on('data', (d) => registro.push('[err] ' + String(d)));

  let ventana = null;
  const limite = Date.now() + 120000;
  while (!ventana && Date.now() < limite) {
    for (const w of app.windows()) {
      if (/demo\.html/.test(w.url())) continue;
      if (await w.locator('#username').count().catch(() => 0)) { ventana = w; break; }
    }
    if (!ventana) await new Promise(r => setTimeout(r, 500));
  }
  if (!ventana) throw new Error('No aparecio la ventana de Wybix');
  await ventana.evaluate(() => { try { localStorage.setItem('wx-guide:auto', '0'); } catch { /* noop */ } });

  const cerrar = async () => {
    await app.close().catch(() => {});
    for (const d of [dirPerfil, dirDemo]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* noop */ } }
  };
  return { app, ventana, registro, cerrar };
}

async function entrarDemo(ventana) {
  await ventana.fill('#username', DEMO.usuario);
  await ventana.fill('#password', DEMO.password);
  await ventana.click('#btnLogin');
  /* La capa de Wybix Guide también existe en la pantalla de login: su
     presencia NO dice que se entró. Se espera a salir de /login (sesión
     abierta en el proceso principal) y a la capa. Antes, el recorrido podía
     arrancar con la sesión en vuelo («Inicia sesión para continuar»). */
  await ventana.waitForFunction(() => !!window.wybixGuide
    && !/login/.test(location.hash || location.pathname)
    && !document.querySelector('#btnLogin'), null, { timeout: 60000 });
}

async function borrarDemo(base) {
  const { temporal } = await herramientas();
  try { temporal.eliminar(base); } catch { /* ya no estaba */ }
}

/** Lo que dice y hace la guia ahora mismo, para diagnosticar. */
async function estadoGuia(ventana) {
  return ventana.evaluate(() => ({
    fase: window.wybixGuide?.fase?.() ?? null,
    paso: window.wybixGuide?.paso?.() ?? null,
    diag: window.wybixGuide?.diagnostico?.() ?? null,
    frase: document.querySelector('.wxgl .wx-sr-only')?.textContent?.trim() ?? null,
    aviso: document.querySelector('.wxgl__aviso')?.textContent?.trim() ?? null,
    url: location.hash || location.pathname,
  }));
}

module.exports = { prepararDemoReal, arrancarDemoReal, entrarDemo, borrarDemo, estadoGuia, DEMO };
