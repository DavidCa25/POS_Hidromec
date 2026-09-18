/**
 * EL MÓDULO RECIÉN ENCENDIDO.
 *
 *     npx playwright test e2e/primer-uso.spec.js
 *
 * Servicios se acaba de encender en Aplicaciones y todavía no hay nada: ni
 * catálogo, ni gente, ni órdenes. Lo primero que ve el negocio es una tabla
 * vacía, y una tabla vacía no explica que antes hace falta montar el catálogo.
 *
 * POR QUÉ TIENE SU PROPIA BASE
 * ----------------------------
 * Este estado existe UNA vez en la vida de una instalación: en cuanto alguien
 * da de alta el primer servicio, ya no vuelve. Colgarse de que esta prueba
 * corra antes que las demás sería colgarse del orden alfabético de los
 * archivos, que nadie mantiene. Así que se levanta una base nueva, se mira el
 * primer arranque, y se borra.
 *
 * POR QUÉ CADA CASO ARRANCA LA APLICACIÓN OTRA VEZ
 * ------------------------------------------------
 * Para ver la pantalla con otra persona dentro hay que cerrar la sesión, y
 * cerrarla de verdad —no sólo quitarle la identidad al proceso principal—
 * significa volver a la pantalla de acceso. Recargar la ventana no vale: la
 * ruta de Angular ya no corresponde a ningún archivo y el `file://` se pierde.
 * Arrancar otra vez cuesta unos segundos y no tiene trampa.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const { nuevoPerfil, opcionesDeArranque } = require('./perfil');
const { CUENTAS } = require('./fixtures');

const BASE = 'Wybix_E2E_PrimerUso';

/* `preparar-bases.mjs` y `temporal.mjs` son módulos ESM y esto es CommonJS:
   se cargan con import() dinámico, que sí cruza las dos formas. */
async function herramientas() {
  const bases = await import('./preparar-bases.mjs');
  const temporal = await import('../scripts/db/lib/temporal.mjs');
  return { bases, temporal };
}

test.describe('Servicios recién encendido', () => {
  /* En serie: las tres miran la misma base y la tercera la cambia. */
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const { bases } = await herramientas();
    bases.prepararBase(BASE, { perfil: 'RETAIL', modulos: ['servicios'] });
  });

  test.afterAll(async () => {
    const { temporal } = await herramientas();
    try { temporal.eliminar(BASE); } catch { /* ya no estaba */ }
  });

  /** Arranca la aplicación contra la base recién montada y entra con `cuenta`. */
  async function abrir(cuenta) {
    const perfil = await nuevoPerfil(BASE);
    const app = await electron.launch(opcionesDeArranque(perfil));
    const ventana = await app.firstWindow({ timeout: 120000 });
    await ventana.waitForFunction(() => !!(window).electronAPI, null, { timeout: 60000 });
    await ventana.waitForSelector('#username', { timeout: 60000 });

    await ventana.fill('#username', cuenta.usuario);
    await ventana.fill('#password', cuenta.password);
    await ventana.click('#btnLogin');
    await expect.poll(async () => {
      try {
        const r = await ventana.evaluate(() => window.electronAPI.sesion());
        return r?.data?.usuario ?? null;
      } catch { return null; }
    }, { timeout: 30000 }).toBe(cuenta.usuario);

    const cerrar = async () => {
      await app.close().catch(() => {});
      try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* noop */ }
    };
    return { app, ventana, cerrar };
  }

  async function irAOrdenes(ventana) {
    /* Al Operador la aplicación lo deja en el punto de venta, y ahí lo primero
       que ve es «Necesitas un turno abierto para vender», que tapa el resto de
       la pantalla. Eso está bien: hoy no viene a vender, viene a recibir
       trabajo, así que sale por donde el propio modal le indica. */
    /* Se le da un momento a aparecer: el modal lo abre el punto de venta al
       terminar de cargar, y preguntar por él nada más entrar es preguntar
       antes de tiempo. Si no sale, no había nada que cerrar. */
    await ventana.waitForSelector('.open-shift-modal', { timeout: 8000 }).catch(() => null);
    const turno = ventana.locator('.open-shift-modal button:has-text("Salir")');
    if (await turno.isVisible().catch(() => false)) {
      await turno.click();
      await ventana.waitForSelector('.open-shift-modal', { state: 'detached', timeout: 30000 });
    }

    await ventana.click('a[href$="/dashboard/ordenes-de-servicio"]');
    await ventana.waitForSelector('.srv-vacio, .srv-fila', { timeout: 30000 });
  }

  test('el administrador ve los pasos, y llevan a donde se montan', async () => {
    const { ventana, cerrar } = await abrir(CUENTAS.admin);
    try {
      await irAOrdenes(ventana);

      const vacio = ventana.locator('.srv-vacio');
      await expect(vacio).toContainText('Faltan dos cosas');

      /* Los dos enlaces existen y apuntan a las dos pantallas. Se comprueba el
         destino resuelto —el href que el navegador calculó—, no el `routerLink`
         relativo del fuente: `../catalogo` puede estar bien escrito y resolver
         a otro sitio si la ruta cambia de sitio. */
      const pasos = ventana.locator('.srv-pasos');
      await expect(pasos.locator('a')).toHaveCount(2);
      const destinos = await pasos.locator('a').evaluateAll(
        (as) => as.map((a) => new URL(a.href).pathname));
      expect(destinos.some((d) => d.endsWith('/ordenes-de-servicio/catalogo')),
        `el primer paso no lleva al catálogo: ${destinos.join(' ')}`).toBeTruthy();
      expect(destinos.some((d) => d.endsWith('/ordenes-de-servicio/profesionales')),
        `el segundo paso no lleva a profesionales: ${destinos.join(' ')}`).toBeTruthy();

      /* Y el enlace funciona: pulsarlo abre el catálogo de verdad. */
      await pasos.locator('a').first().click();
      await ventana.waitForSelector('.srv-pagina h1', { timeout: 30000 });
      await expect(ventana.locator('.srv-pagina h1')).toContainText(/Servicios|Catálogo/i);
    } finally { await cerrar(); }
  });

  test('al operador no se le ofrece un enlace que no puede abrir', async () => {
    const { ventana, cerrar } = await abrir(CUENTAS.operador);
    try {
      await irAOrdenes(ventana);

      const vacio = ventana.locator('.srv-vacio');
      await expect(vacio).toContainText('Faltan dos cosas');
      await expect(vacio.locator('.srv-pasos a')).toHaveCount(0);
      await expect(vacio.locator('.srv-pasos')).toContainText('Lo hace un encargado');
    } finally { await cerrar(); }
  });

  test('en cuanto hay catálogo, los pasos desaparecen', async () => {
    const { ventana, cerrar } = await abrir(CUENTAS.admin);
    try {
      const svc = await ventana.evaluate(() => window.electronAPI.serviciosGuardarServicio({
        nombre: 'Primer servicio', precio: 350, duracionMinutos: 30,
      }));
      expect(svc.success, JSON.stringify(svc)).toBeTruthy();

      await irAOrdenes(ventana);
      const vacio = ventana.locator('.srv-vacio');
      await expect(vacio).toContainText('Aquí aparece el trabajo que entra');
      await expect(vacio.locator('.srv-pasos')).toHaveCount(0);
    } finally { await cerrar(); }
  });
});
