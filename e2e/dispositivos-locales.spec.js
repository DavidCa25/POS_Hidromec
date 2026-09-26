/**
 * CONFIGURACION -> DISPOSITIVOS LOCALES, en la aplicacion de verdad.
 *
 * Una base de cafeteria con Servicios (todas las funciones disponibles), el
 * Local Host encendido en un puerto de prueba, tres dispositivos emparejados
 * por HTTP como lo haria una tablet (dos de ellos conectados en tiempo real) y
 * el panel abierto desde Configuracion: el mapa (diseño B), conectar un
 * dispositivo eligiendo su funcion, y las personas con su PIN.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const http = require('node:http');
const { nuevoPerfil, opcionesDeArranque } = require('./perfil');
const { CUENTAS, irPorMas } = require('./fixtures');

const BASE = 'Wybix_E2E_Dispositivos';
const PUERTO = 17627;

async function herramientas() {
  const bases = await import('./preparar-bases.mjs');
  const temporal = await import('../scripts/db/lib/temporal.mjs');
  return { bases, temporal };
}

function peticion(ruta, { metodo = 'GET', cuerpo, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const datos = cuerpo ? JSON.stringify(cuerpo) : null;
    const req = http.request({ host: '127.0.0.1', port: PUERTO, path: ruta, method: metodo,
      headers: { ...(datos ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(datos) } : {}), ...(cookie ? { Cookie: cookie } : {}) } },
    (res) => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, texto: b })); });
    req.on('error', reject);
    if (datos) req.write(datos);
    req.end();
  });
}

test.describe('Dispositivos locales', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const { bases } = await herramientas();
    bases.prepararBase(BASE, { perfil: 'HOSPITALITY', modulos: ['hospitality', 'mesas', 'comandas'], giroServicios: 'MANTENIMIENTO' });
  });

  test.afterAll(async () => {
    const { temporal } = await herramientas();
    try { temporal.eliminar(BASE); } catch { /* ya no estaba */ }
  });

  test('el mapa de la red muestra cada dispositivo con su función y su estado', async ({}, info) => {
    test.setTimeout(240000);
    const perfil = await nuevoPerfil(BASE);
    const opciones = opcionesDeArranque(perfil);
    opciones.env = { ...(opciones.env || process.env), WYBIX_LOCAL_HOST_PUERTO: String(PUERTO) };
    const app = await electron.launch(opciones);
    const flujos = [];
    try {
      const ventana = await app.firstWindow({ timeout: 120000 });
      await ventana.waitForFunction(() => !!(window).electronAPI, null, { timeout: 60000 });
      await ventana.waitForSelector('#username', { timeout: 60000 });
      await ventana.evaluate(() => { try { localStorage.setItem('wx-guide:auto', '0'); } catch { /* noop */ } });
      await ventana.fill('#username', CUENTAS.admin.usuario);
      await ventana.fill('#password', CUENTAS.admin.password);
      await ventana.click('#btnLogin');
      await expect.poll(async () => (await ventana.evaluate(() => window.electronAPI.sesion()))?.data?.usuario ?? null, { timeout: 30000 }).toBe(CUENTAS.admin.usuario);

      /* Lo que haria el negocio: una estacion, el Host encendido, tres pantallas. */
      const prep = await ventana.evaluate(async () => {
        const w = window.wybix;
        await w.estaciones.guardar({ nombre: 'Barra', salida: 'PANTALLA' });
        const est = (await w.estaciones.listar()).data.find(x => x.nombre === 'Barra');
        const act = await w.localHost.activar({ activo: true });
        const yo = (await window.electronAPI.sesion()).data;
        const pin = await w.localHost.pinTrabajador({ userId: yo.userId, pin: '2580' });
        const a = await w.localHost.emparejar({ superficie: 'PREPARATION', stationId: est.id, nombre: 'Tablet Barra' });
        const b = await w.localHost.emparejar({ superficie: 'WAITER', nombre: 'Tablet Meseros' });
        const c = await w.localHost.emparejar({ superficie: 'CUSTOMER_STATUS', nombre: 'TV Mostrador' });
        return { act: act.data?.fase, pin: pin.success, urls: [a, b, c].map(x => x.data?.url || x.error) };
      });
      expect(prep.act, 'el Local Host se enciende').toBe('ACTIVO');
      expect(prep.pin).toBe(true);
      const cookies = [];
      for (const url of prep.urls) {
        const token = String(url).split('/pair/')[1];
        const r = await peticion('/api/pair', { metodo: 'POST', cuerpo: { token } });
        expect(r.status, url).toBe(200);
        cookies.push(String([].concat(r.headers['set-cookie'])[0]).split(';')[0]);
      }
      /* La Barra y la TV quedan conectadas en tiempo real; el de meseros no
         (nadie ha entrado), y debe verse como tal. */
      for (const c of [cookies[0], cookies[2]]) {
        flujos.push(http.get({ host: '127.0.0.1', port: PUERTO, path: '/api/s/eventos', headers: { Cookie: c } }));
      }

      await irPorMas(ventana, 'Configuracion');
      await ventana.waitForSelector('.cs-tile', { timeout: 30000 });
      await ventana.locator('.cs-tile', { hasText: 'Dispositivos locales' }).click();
      await ventana.waitForSelector('.dl-mapa', { timeout: 20000 });
      await expect(ventana.locator('.dl-nodo--disp')).toHaveCount(3, { timeout: 15000 });
      await expect(ventana.locator('.dl-nodo--disp:not(.dl-nodo--fuera)')).toHaveCount(2, { timeout: 15000 });
      await expect(ventana.locator('.dl-nodo--disp', { hasText: 'Tablet Barra' })).toContainText('Preparación');
      await expect(ventana.locator('.dl-nodo--disp', { hasText: 'Tablet Meseros' })).toContainText('Nadie ha entrado');
      const cabe = await ventana.evaluate(() => { const b = document.querySelector('.cs-drawer-body'); return b.scrollWidth <= b.clientWidth + 1; });
      expect(cabe, 'el panel amplio no tiene scroll horizontal').toBe(true);
      await ventana.waitForTimeout(400);
      await ventana.locator('.cs-drawer').screenshot({ path: info.outputPath('dispositivos-mapa.png') });

      await ventana.locator('.dl-lista .dl-disp', { hasText: 'Tablet Barra' }).getByRole('button', { name: 'Ver' }).click();
      await expect(ventana.locator('.dl-datos')).toContainText('Último contacto');

      await ventana.getByRole('button', { name: 'Conectar dispositivo' }).click();
      await expect(ventana.locator('.dl-funcion')).toHaveCount(6);
      await ventana.locator('.dl-funcion', { hasText: 'Mesero' }).click();
      await expect(ventana.getByText('Áreas que atiende')).toHaveCount(0);   // sin areas creadas no se ofrece
      await ventana.locator('.dl-funcion', { hasText: 'Estado de pedidos' }).click();
      await expect(ventana.getByText('Nunca nombres, totales ni teléfonos.')).toBeVisible();
      await ventana.locator('.cs-drawer').screenshot({ path: info.outputPath('dispositivos-conectar.png') });
      await ventana.getByRole('button', { name: 'Generar código' }).click();
      await expect(ventana.locator('.dl-qr img')).toBeVisible({ timeout: 10000 });
      await expect(ventana.locator('.dl-qr code')).toContainText('/pair/…');

      await ventana.getByRole('button', { name: 'Listo' }).click();
      const admin = ventana.locator('.dl-lista .dl-disp', { hasText: CUENTAS.admin.usuario });
      await expect(admin.locator('.dl-marca--on', { hasText: 'PIN' })).toBeVisible();
      await ventana.locator('.cs-drawer-body').evaluate(b => { b.scrollTop = b.scrollHeight; });
      await ventana.locator('.cs-drawer').screenshot({ path: info.outputPath('dispositivos-personas.png') });

      await ventana.evaluate(() => window.wybix.localHost.activar({ activo: false }));
    } finally {
      for (const f of flujos) { try { f.destroy(); } catch { /* noop */ } }
      await app.close().catch(() => {});
      try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });
});
