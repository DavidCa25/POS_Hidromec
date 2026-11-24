/**
 * Una papelería de barrio de punta a punta, en la app de verdad.
 *
 *     npm run e2e:papeleria
 *
 * Llena la base de prueba con el catálogo de scripts/giros/papeleria.mjs
 * (264 productos en 10 categorías: escolar, oficina, manualidades, fiesta,
 * tecnología y los servicios del mostrador; el listón, el forro y el papel
 * kraft por metro) y recorre lo que usa el negocio, con capturas en
 * tmp/e2e-papeleria/:
 *
 *   1. Venta: el buscador con sus dibujos; buscar «cuaderno».
 *   2. Una venta de mostrador: un cuaderno, 2.5 m de listón y 10 copias;
 *      cobrar, y la venta queda con la cantidad real del listón.
 *   3. Inventario con todo el catálogo.
 *   4. Touch: el mosaico por categoría; tocar el listón pregunta cuántos metros.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-papeleria');

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

async function login(app, c) {
  const p = app.ventana;
  await p.fill('#username', c.usuario);
  await p.fill('#password', c.password);
  await p.click('#btnLogin');
  await expect.poll(async () => { try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; } }, { timeout: 60000 })
    .toBe(c.usuario);
}

async function cerrarAvisoDeVenta(p) {
  for (let i = 0; i < 2; i++) {
    for (const b of [p.getByRole('button', { name: 'Nada más, cerrar' }), p.locator('app-premios-venta').getByRole('button', { name: 'Continuar' }).first()]) {
      try { await b.click({ timeout: 2500 }); } catch { /* no está */ }
    }
  }
}

/** El catálogo de la papelería en la base (idempotente: PAP-001…). */
async function sembrar(base) {
  const { PAPELERIA, sqlSembrar } = await import('../scripts/giros/papeleria.mjs');
  await sql(base, sqlSembrar());
  return PAPELERIA.length;
}

test('papelería: catálogo escolar y de oficina en Venta, metros, Inventario y Touch', async ({ app }) => {
  test.setTimeout(420000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1366, height: 820 });
  const n = await sembrar(app.base);
  const foto = (nombre) => p.screenshot({ path: path.join(SHOTS, `${nombre}.png`) });

  await login(app, CUENTAS.admin);
  const yo = (await app.invocar('sesion')).data.userId;
  await app.invocar('openShift', { user_id: yo, opening_cash: 500, register_id: 1 });

  // ------------------------------------------------------------- 1. Venta
  await irPorDock(p, 'Venta');
  await p.waitForSelector('.pos-wrap');
  await p.getByRole('button', { name: /Agregar producto/ }).click();
  await p.locator('.modal-productos [data-guide=venta-producto]').first().waitFor({ timeout: 60000 });
  await foto('1-venta-buscador');
  await p.locator('[data-guide=venta-buscar]').fill('cuaderno');
  await expect(p.locator('.modal-productos [data-guide=venta-producto]').first()).toContainText(/Cuaderno/i);
  /* Cada tarjeta con su dibujo. */
  const cuaderno = p.locator('.modal-productos [data-guide=venta-producto]').filter({ hasText: 'Cuaderno profesional cuadro chico' });
  await expect(cuaderno.locator('wx-ilustracion')).toHaveAttribute('data-forma', 'cuaderno');
  await foto('2-venta-buscar-cuaderno');
  await p.locator('[data-guide=venta-buscar]').fill('pistola');
  await expect(p.locator('.modal-productos [data-guide=venta-producto]').filter({ hasText: 'Pistola de silicón chica' }).locator('wx-ilustracion'))
    .toHaveAttribute('data-forma', 'pistola_silicon');
  await foto('3-venta-buscar-pistola');

  // ------------------------------------------- 2. venta de mostrador y cobro
  const agregar = async (texto) => {
    if (!(await p.locator('.modal-productos').count())) {
      await p.getByRole('button', { name: /Agregar producto/ }).click();
    }
    await p.locator('[data-guide=venta-buscar]').fill(texto);
    await p.locator('.modal-productos [data-guide=venta-producto]').filter({ hasText: texto }).first().click();
  };
  await agregar('Cuaderno profesional cuadro chico');
  await agregar('Listón satinado');
  await expect(p.locator('[data-guide=granel-cantidad]')).toBeVisible();
  await p.locator('[data-guide=granel-cantidad-kg]').fill('2.5');
  await foto('4-liston-por-metro');
  await p.locator('[data-guide=granel-agregar]').click();
  await agregar('Copia blanco y negro');
  await expect(p.locator('[data-guide=venta-linea]')).toHaveCount(3);
  await expect(p.locator('[data-guide=venta-linea]').filter({ hasText: 'Listón' }).locator('.venta-uom')).toHaveText('m');
  await expect(p.locator('[data-guide=venta-linea]').filter({ hasText: 'Cuaderno' }).locator('.venta-uom')).toHaveCount(0);
  await foto('5-venta-cuenta');
  const total = Number(((await p.locator('#total-venta').innerText()).match(/[\d,.]+/) || ['0'])[0].replace(/,/g, ''));
  /* Cuaderno 45 + 2.5 m de listón a $6 = 15 + una copia 1. */
  expect(total).toBe(61);
  await p.locator('[data-guide=venta-cobrar]').click();
  await p.locator('[data-guide=venta-recibido]').fill('100');
  await p.locator('[data-guide=venta-confirmar-cobro]').click();
  await expect.poll(async () => (await sql(app.base, `
    SELECT TOP 1 CAST(d.quantity AS float) q FROM dbo.sale_detail d JOIN dbo.products x ON x.id = d.product_id
     WHERE x.part_number LIKE N'PAP-%' AND x.base_uom = 'm' ORDER BY d.id DESC;`))[0]?.q, { timeout: 30000 }).toBe(2.5);
  await cerrarAvisoDeVenta(p);

  // --------------------------------------------------------- 3. Inventario
  await irPorDock(p, 'Inventario');
  await p.locator('tbody tr').nth(5).waitFor({ timeout: 60000 });
  await p.locator('.ventas-search input[type=search]').fill('papel');
  await foto('6-inventario-papel');

  // --------------------------------------------------------------- 4. Touch
  await app.invocar('modulosSet', 'hospitality', true);
  await app.invocar('setDeviceConfig', { deviceProfile: 'TOUCH_POS' });
  await p.locator('.wx-yo__btn').click();
  await p.locator('.wx-yo__fila').filter({ hasText: 'Cerrar sesión' }).click();
  await p.waitForSelector('#username');
  await login(app, CUENTAS.admin);
  await p.waitForSelector('app-touch-pos .tp-card', { timeout: 60000 });
  const turno = p.getByRole('dialog').filter({ has: p.getByRole('heading', { name: 'Abrir turno', exact: true }) });
  if (await turno.count()) await turno.getByRole('button', { name: 'Abrir turno', exact: true }).click();
  await p.getByRole('button', { name: 'Útiles escolares' }).first().click();
  await expect(p.locator('[data-guide=touch-producto]').filter({ hasText: 'Mochila escolar' })).toBeVisible();
  await foto('7-touch-utiles');
  await p.getByRole('button', { name: 'Arte y manualidades' }).first().click();
  await expect(p.locator('[data-guide=touch-producto]').filter({ hasText: 'Listón satinado' }).locator('.tp-card__precio')).toContainText('/ m');
  await foto('8-touch-manualidades');
  await p.getByRole('button', { name: 'Regalos y fiesta' }).first().click();
  await foto('9-touch-regalos');
  await p.getByRole('button', { name: 'Servicios' }).first().click();
  await foto('10-touch-servicios');
  await p.getByRole('button', { name: 'Arte y manualidades' }).first().click();
  await p.locator('[data-guide=touch-producto]').filter({ hasText: 'Listón satinado' }).click();
  await expect(p.locator('[data-guide=granel-cantidad]')).toBeVisible();
  await foto('11-touch-liston-metros');
  await app.invocar('setDeviceConfig', { deviceProfile: 'RETAIL_POS' }).catch(() => {});
  console.log(`papelería: ${n} productos, capturas en ${SHOTS}`);
});
