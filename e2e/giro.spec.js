/**
 * ELEGIR GIRO, PULSANDO BOTONES.
 *
 *     npx playwright test e2e/giro.spec.js
 *
 * Un cliente real enciende Servicios desde Aplicaciones. Lo que esta prueba
 * defiende es que ahí se le PREGUNTE de qué negocio es, y que la respuesta
 * cambie lo que ve: un taller entra por Órdenes y llama «Vehículos» a lo que
 * registra; una barbería entra por la Agenda y no tiene esa pestaña.
 *
 * POR QUÉ NO VALE COMPROBARLO LEYENDO EL FUENTE
 * ---------------------------------------------
 * Porque entre el giro guardado y la pestaña dibujada hay cinco piezas —un
 * procedimiento, un canal, un servicio, un guard y una redirección— y
 * cualquiera de ellas puede estar bien escrita y no llegar a ejecutarse. Ya
 * pasó con el cobro de las órdenes: el canal funcionaba, el procedimiento
 * funcionaba, y el cable entre las dos pantallas no estaba puesto.
 *
 * BASE PROPIA, CON SERVICIOS APAGADO
 * ----------------------------------
 * Es el único estado desde el que se puede probar el onboarding, y las demás
 * bases lo tienen encendido. Se levanta, se usa y se borra.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const { nuevoPerfil, opcionesDeArranque } = require('./perfil');
const { CUENTAS, irPorDock, irPorMas } = require('./fixtures');

const BASE = 'Wybix_E2E_Giro';

async function herramientas() {
  const bases = await import('./preparar-bases.mjs');
  const temporal = await import('../scripts/db/lib/temporal.mjs');
  return { bases, temporal };
}

test.describe('Elegir el giro de Servicios', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const { bases } = await herramientas();
    /* Sin `modulos`: Servicios llega APAGADO, que es de donde parte un
       cliente que acaba de instalar. */
    bases.prepararBase(BASE, { perfil: 'RETAIL' });
  });

  test.afterAll(async () => {
    const { temporal } = await herramientas();
    try { temporal.eliminar(BASE); } catch { /* ya no estaba */ }
  });

  /** Arranca la aplicación contra la base y entra como administrador. */
  async function abrir() {
    const perfil = await nuevoPerfil(BASE);
    const app = await electron.launch(opcionesDeArranque(perfil));
    const ventana = await app.firstWindow({ timeout: 120000 });
    await ventana.waitForFunction(() => !!(window).electronAPI, null, { timeout: 60000 });
    await ventana.waitForSelector('#username', { timeout: 60000 });

    await ventana.fill('#username', CUENTAS.admin.usuario);
    await ventana.fill('#password', CUENTAS.admin.password);
    await ventana.click('#btnLogin');
    await expect.poll(async () => {
      try {
        const r = await ventana.evaluate(() => window.electronAPI.sesion());
        return r?.data?.usuario ?? null;
      } catch { return null; }
    }, { timeout: 30000 }).toBe(CUENTAS.admin.usuario);

    const cerrar = async () => {
      await app.close().catch(() => {});
      try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* noop */ }
    };
    return { ventana, cerrar };
  }

  /**
   * Va a Aplicaciones y deja la tarjeta de Servicios delante.
   *
   * Aplicaciones vive en el cajon "Mas" del dock, no en un rail siempre
   * desplegado: primero se abre el cajon y despues se pulsa la entrada. Es el
   * mismo recorrido que hace una persona, y por eso se prueba asi y no
   * saltando a la ruta a mano.
   */
  async function irAAplicaciones(ventana) {
    /* Se localiza por su papel, no por su etiqueta: "Mas" lleva tilde y una
       prueba no deberia romperse por como se escriba una palabra. */
    await irPorMas(ventana, 'Aplicaciones');
    await ventana.waitForSelector('.apps-card', { timeout: 30000 });
  }

  function tarjetaServicios(ventana) {
    return ventana.locator('.apps-card', { hasText: 'Órdenes de servicio' });
  }

  test('activar Servicios pregunta de qué negocio es, y no acepta un no-giro', async () => {
    const { ventana, cerrar } = await abrir();
    try {
      await irAAplicaciones(ventana);
      const tarjeta = tarjetaServicios(ventana);
      await expect(tarjeta.locator('.apps-card__estado')).toHaveText('Desactivado');

      await tarjeta.locator('button:has-text("Activar")').click();

      /* La pregunta, con los cinco giros del producto y NINGUNO marcado. */
      await expect(ventana.locator('.swal2-title')).toContainText('tipo de negocio');
      const opciones = ventana.locator('.giro-op input[type="radio"]');
      await expect(opciones).toHaveCount(5);
      await expect(ventana.locator('.giro-op input:checked')).toHaveCount(0);

      /* Confirmar sin elegir no enciende nada: se queda pidiéndolo. */
      await ventana.click('.swal2-confirm');
      await expect(ventana.locator('.swal2-validation-message')).toBeVisible();

      await ventana.locator('.giro-op input[value="TALLER_AUTOMOTRIZ"]').click();
      await ventana.click('.swal2-confirm');

      await expect.poll(async () => {
        const r = await ventana.evaluate(() => window.electronAPI.serviciosConfig());
        return r?.data?.[0]?.preset ?? null;
      }, { timeout: 30000 }).toBe('TALLER_AUTOMOTRIZ');

      /* Y el módulo quedó encendido en el mismo movimiento. */
      const modulos = await ventana.evaluate(() => window.electronAPI.modulosLista());
      const servicios = (modulos.data ?? []).find(m => m.module_key === 'servicios');
      expect(servicios?.enabled === true || servicios?.enabled === 1,
        JSON.stringify(servicios)).toBeTruthy();
    } finally { await cerrar(); }
  });

  test('el taller entra por Órdenes y llama Vehículos a lo que registra', async () => {
    const { ventana, cerrar } = await abrir();
    try {
      await irPorDock(ventana, 'Servicios');
      await ventana.waitForSelector('.srv-nav', { timeout: 30000 });

      /* La redirección de la ruta vacía la decide el giro. */
      await expect.poll(async () => ventana.url(), { timeout: 20000 })
        .toContain('/ordenes-de-servicio/ordenes');

      const nav = ventana.locator('.srv-nav');
      await expect(nav).toContainText('Vehículos');
      await expect(nav).not.toContainText('Sobre qué');
      /* El taller no da citas: su pestaña de agenda no estorba en el menú. */
      await expect(nav).not.toContainText('Agenda');

      await ventana.click('.srv-nav a:has-text("Vehículos")');
      await ventana.waitForSelector('.srv-tabla', { timeout: 30000 });
      await expect(ventana.locator('.srv-pagina h1')).toHaveText('Vehículos');
      await expect(ventana.locator('.srv-tabla thead')).toContainText('Placa');
    } finally { await cerrar(); }
  });

  test('cambiar a barbería cambia la pantalla, y no borra nada', async () => {
    const { ventana, cerrar } = await abrir();
    try {
      /* Algo dentro ANTES de cambiar: es lo que no se puede perder. */
      const svc = await ventana.evaluate(() => window.electronAPI.serviciosGuardarServicio({
        nombre: 'Servicio que no se borra', precio: 500, duracionMinutos: 30,
      }));
      expect(svc.success, JSON.stringify(svc)).toBeTruthy();

      await irAAplicaciones(ventana);
      const tarjeta = tarjetaServicios(ventana);
      await expect(tarjeta).toContainText('Taller automotriz');

      await tarjeta.locator('button:has-text("Cambiar")').click();
      await expect(ventana.locator('.swal2-title')).toContainText('Cambiar el giro');
      /* Aquí SÍ viene marcado el actual: no es una elección nueva, es ver en
         cuál estás antes de moverte. */
      await expect(ventana.locator('.giro-op input[value="TALLER_AUTOMOTRIZ"]')).toBeChecked();

      await ventana.locator('.giro-op input[value="BELLEZA"]').click();
      await ventana.click('.swal2-confirm');

      await expect.poll(async () => {
        const r = await ventana.evaluate(() => window.electronAPI.serviciosConfig());
        return r?.data?.[0]?.preset ?? null;
      }, { timeout: 30000 }).toBe('BELLEZA');

      /* Lo que había sigue ahí. Cambiar de giro cambia cómo se presenta el
         módulo, no lo que hay dentro. */
      const cat = await ventana.evaluate(() => window.electronAPI.serviciosCatalogo({}));
      const nombres = (cat.data ?? []).map(s => s.nombre);
      expect(nombres, JSON.stringify(nombres)).toContain('Servicio que no se borra');

      await irPorDock(ventana, 'Servicios');
      await ventana.waitForSelector('.srv-nav', { timeout: 30000 });

      /* Una barbería abre en la agenda: su día es la agenda. */
      await expect.poll(async () => ventana.url(), { timeout: 20000 })
        .toContain('/ordenes-de-servicio/agenda');
      const nav = ventana.locator('.srv-nav');
      await expect(nav).toContainText('Agenda');
      await expect(nav).not.toContainText('Vehículos');
      await expect(nav).toContainText('Órdenes');
    } finally { await cerrar(); }
  });
});
