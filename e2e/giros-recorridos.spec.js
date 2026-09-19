/**
 * CADA GIRO, RECORRIDO POR SEPARADO.
 *
 *     npx playwright test e2e/giros-recorridos.spec.js
 *
 * Lo que defiende no es que el módulo funcione —eso lo prueban las otras—
 * sino que NO se parezcan entre sí. El fallo que motivó todo esto es que una
 * barbería veía la pantalla de un taller: le ofrecía registrar un vehículo,
 * llamaba «refacción» al tinte y le pedía autorizar un corte de pelo.
 *
 * Por eso cada caso mira DOS cosas: que lo propio del giro esté, y que lo de
 * otro giro NO esté. La segunda mitad es la que importa.
 *
 * Cada giro levanta su base y la borra: el giro se guarda por negocio, así
 * que dos giros no caben en la misma instalación a la vez.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const { nuevoPerfil, opcionesDeArranque } = require('./perfil');
const { CUENTAS } = require('./fixtures');

async function herramientas() {
  const bases = await import('./preparar-bases.mjs');
  const temporal = await import('../scripts/db/lib/temporal.mjs');
  return { bases, temporal };
}

/** Arranca Wybix contra una base y entra como administrador. */
async function abrir(base) {
  const perfil = await nuevoPerfil(base);
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

/** Entra al módulo y espera a que la carcasa esté dibujada. */
async function entrarAlModulo(ventana) {
  await ventana.click('a[href$="/dashboard/ordenes-de-servicio"]');
  await ventana.waitForSelector('.srv-nav', { timeout: 30000 });
}

/**
 * LO QUE CADA GIRO TIENE QUE ENSEÑAR, Y LO QUE NO.
 *
 * Se describe aquí para que las diferencias se lean de un vistazo: es
 * literalmente la tabla de «en qué se distinguen», y cualquiera que añada un
 * giro sabe qué tiene que rellenar.
 */
const GIROS = [
  {
    id: 'TALLER_AUTOMOTRIZ',
    base: 'Wybix_E2E_GiroTaller',
    entra: '/ordenes-de-servicio/ordenes',
    pestanas: ['Órdenes', 'Vehículos'],
    sinPestanas: ['Agenda'],
    material: 'Refacción',
    sinMaterial: ['Producto o insumo', 'Componente'],
    reportado: 'reporta el cliente',
    identificador: 'Placa',
  },
  {
    id: 'BELLEZA',
    base: 'Wybix_E2E_GiroBelleza',
    entra: '/ordenes-de-servicio/agenda',
    pestanas: ['Órdenes', 'Agenda'],
    /* LA COMPROBACIÓN QUE MOTIVÓ TODO: una barbería no registra vehículos. */
    sinPestanas: ['Vehículos', 'Equipos', 'Sobre qué'],
    material: 'Producto o insumo',
    sinMaterial: ['Refacción', 'Componente'],
    reportado: 'necesita el cliente',
    identificador: null,
  },
  {
    id: 'REPARACION_ELECTRONICA',
    base: 'Wybix_E2E_GiroElectronica',
    entra: '/ordenes-de-servicio/ordenes',
    pestanas: ['Órdenes', 'Equipos'],
    sinPestanas: ['Vehículos', 'Agenda'],
    material: 'Componente',
    sinMaterial: ['Refacción', 'Producto o insumo'],
    reportado: 'falla presenta el equipo',
    identificador: 'Número de serie',
  },
  {
    id: 'MANTENIMIENTO',
    base: 'Wybix_E2E_GiroMantenimiento',
    entra: '/ordenes-de-servicio/ordenes',
    pestanas: ['Órdenes', 'Agenda', 'Equipos e instalaciones'],
    sinPestanas: ['Vehículos'],
    material: 'Material',
    sinMaterial: ['Refacción', 'Componente'],
    reportado: 'trabajo solicita el cliente',
    identificador: 'Número de serie',
  },
  {
    id: 'OTRO',
    base: 'Wybix_E2E_GiroOtro',
    entra: '/ordenes-de-servicio/ordenes',
    pestanas: ['Órdenes', 'Agenda', 'Activos'],
    /* El genérico NO puede inventarse el vocabulario de nadie. */
    sinPestanas: ['Vehículos', 'Equipos'],
    material: 'Material o producto',
    sinMaterial: ['Refacción', 'Componente', 'Vehículo', 'Tinte'],
    reportado: 'necesita el cliente',
    /* OPCIONAL, no ausente: el genérico OFRECE registrar algo —hay negocios
       que trabajan sobre una cosa y no encajan en ningún giro— pero no lo
       exige ni lo llama de ninguna manera concreta. La diferencia con Belleza
       es justo esa: allí no se ofrece en absoluto. */
    identificador: 'Identificador',
    activoOpcional: true,
  },
];

for (const g of GIROS) {
  test.describe(`Giro ${g.id}`, () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeAll(async () => {
      const { bases } = await herramientas();
      bases.prepararBase(g.base, {
        perfil: 'RETAIL', modulos: ['servicios'], giroServicios: g.id,
      });
    });

    test.afterAll(async () => {
      const { temporal } = await herramientas();
      try { temporal.eliminar(g.base); } catch { /* ya no estaba */ }
    });

    test('abre donde le toca y su menú es el suyo', async () => {
      const { ventana, cerrar } = await abrir(g.base);
      try {
        await entrarAlModulo(ventana);

        /* La pantalla de entrada la decide el giro: una barbería abre en la
           agenda porque su día ES la agenda. */
        await expect.poll(async () => ventana.url(), { timeout: 20000 }).toContain(g.entra);

        const nav = ventana.locator('.srv-nav');
        for (const p of g.pestanas) await expect(nav).toContainText(p);
        for (const p of g.sinPestanas) await expect(nav).not.toContainText(p);
      } finally { await cerrar(); }
    });

    test('llama a las cosas como se llaman aquí', async () => {
      const { ventana, cerrar } = await abrir(g.base);
      try {
        /* Un cliente y una orden, por el canal: lo que se mira es la pantalla
           de la orden, no cómo se llegó a ella. */
        await ventana.evaluate(() => window.electronAPI.createCustomer(
          'GIRO-1', 'Cliente de giro', null, null, '3330000000', 0, 0, 1, null, null, null, 0, 0, 0, 0));
        const cli = await ventana.evaluate(() => window.electronAPI.getCustomers());
        const cliente = (cli.data ?? []).find(c => c.customerName === 'Cliente de giro');
        expect(cliente, 'el cliente de la prueba existe').toBeTruthy();

        const orden = await ventana.evaluate((id) => window.electronAPI.serviciosOrdenCrear(
          { clienteId: id, reportado: 'Lo que sea' }), cliente.id);
        expect(orden.success, JSON.stringify(orden)).toBeTruthy();
        const ordenId = orden.data[0].id;

        await ventana.click('a[href$="/dashboard/ordenes-de-servicio"]');
        await ventana.waitForSelector('.srv-nav', { timeout: 30000 });
        /* Belleza abre en la AGENDA -su día es la agenda-, así que para mirar
           una orden hay que pasar a Órdenes. Darlo por hecho era suponer que
           todos los giros entran por el mismo sitio, que es justo lo que este
           archivo existe para negar. */
        await ventana.click('.srv-nav a:has-text("Órdenes")');
        await ventana.waitForSelector('.srv-tabla', { timeout: 30000 });
        await ventana.click('.srv-fila');
        await ventana.waitForSelector('.os-lineas', { timeout: 30000 });

        /* EL MATERIAL. Es el botón que en una barbería decía «+ Refacción». */
        const acciones = ventana.locator('.os-add');
        await expect(acciones).toContainText(g.material);
        for (const m of g.sinMaterial) await expect(acciones).not.toContainText(m);

        /* EL ACTIVO. Sólo donde el giro lo usa. */
        const carril = ventana.locator('.os-rail-acc');
        if (g.identificador) {
          await expect(carril).toContainText(/Indicar|Cambiar/);
        } else {
          await expect(carril).not.toContainText('Indicar');
          await expect(carril).not.toContainText('Cambiar');
        }
      } finally { await cerrar(); }
    });

    test('la recepción pregunta en el idioma del giro', async () => {
      const { ventana, cerrar } = await abrir(g.base);
      try {
        await ventana.evaluate(() => window.electronAPI.createCustomer(
          'GIRO-2', 'Cliente recepción', null, null, '3330000001', 0, 0, 1, null, null, null, 0, 0, 0, 0));

        await ventana.click('a[href$="/dashboard/ordenes-de-servicio"]');
        await ventana.waitForSelector('.srv-nav', { timeout: 30000 });
        /* Belleza abre en la agenda: se pasa a órdenes para abrir una. */
        await ventana.click('.srv-nav a:has-text("Órdenes")');
        await ventana.waitForSelector('.srv-tabla', { timeout: 30000 });
        await ventana.click('button:has-text("Nueva orden")');

        const modal = ventana.locator('.srv-modal');
        await expect(modal).toBeVisible({ timeout: 20000 });
        await expect(modal).toContainText(g.reportado);

        if (g.identificador) {
          /* El campo del identificador se llama como se llama aquí: «Placa»
             en un taller, «Número de serie» en electrónica. */
          await ventana.click('#srv-cliente .wx-sel__campo');
          await ventana.locator('.wx-pop [role="option"]', { hasText: 'Cliente recepción' })
            .first().click();
          await ventana.click('#srv-activo-n .wx-sel__campo');
          await ventana.locator('.wx-pop [role="option"]', { hasText: 'Registrar' }).first().click();
          await expect(modal).toContainText(g.identificador);
        } else {
          /* Y donde no se usa, no se pregunta por él en absoluto. */
          await expect(modal.locator('#srv-activo-n')).toHaveCount(0);
        }

        /* Lo que un giro opcional NO hace: exigirlo. Se abre la orden sin
           tocar el activo y tiene que dejar. */
        if (g.activoOpcional) {
          await expect(modal).toContainText('opcional');
        }
      } finally { await cerrar(); }
    });
  });
}
