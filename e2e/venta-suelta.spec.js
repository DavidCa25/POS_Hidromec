/**
 * Venta suelta (0073), en la app de verdad.
 *
 *   1. El administrador la activa en Aplicaciones.
 *   2. En Inventario edita el cigarro y lo liga a su cajetilla de 20: la
 *      seccion «Vender suelto» solo existe con la aplicacion encendida.
 *   3. En la caja vende 3 cigarros sin tener piezas: la venta abre una
 *      cajetilla sola y el inventario queda en paquetes y en piezas.
 *
 *     npm run e2e:venta-suelta
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, BASE_CORE, irPorMas, irPorDock } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-venta-suelta');

async function login(app, c) {
  const p = app.ventana;
  await p.fill('#username', c.usuario);
  await p.fill('#password', c.password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }).toBe(c.usuario);
}

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

/* La aplicacion se apaga al terminar: las pruebas que vienen despues parten
   de Core sin ella. */
test.afterEach(async () => {
  await sql(BASE_CORE, `EXEC dbo.sp_set_business_module @module_key = N'venta-suelta', @enabled = 0;`).catch(() => {});
});

test('Venta suelta: activar, ligar el cigarro a su cajetilla y vender piezas', async ({ app }) => {
  test.setTimeout(300000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1280, height: 800 });

  /* Los productos nacen por SQL: lo que se prueba es el vinculo y la venta,
     no el alta (que ya tiene sus pruebas). Codigos unicos por corrida. */
  const n = Date.now().toString().slice(-6);
  const CAJ = `Cajetilla E2E ${n}`;
  const CIG = `Cigarro E2E ${n}`;
  await sql(app.base, `DELETE FROM dbo.business_modules WHERE module_key = N'venta-suelta';`);
  const ids = await sql(app.base, `
    DECLARE @b INT = (SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id);
    DECLARE @c INT = (SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id);
    IF @b IS NULL BEGIN INSERT INTO dbo.CAT_brands (namee) VALUES (N'E2E'); SET @b = SCOPE_IDENTITY(); END
    IF @c IS NULL BEGIN INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E'); SET @c = SCOPE_IDENTITY(); END
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, category_id, brand_id, cost, bar_code)
    VALUES (N'CAJ-${n}', N'${CAJ}', 95, 2, 1, @c, @b, 80, NULL),
           (N'CIG-${n}', N'${CIG}', 6, 0, 1, @c, @b, NULL, NULL);
    SELECT (SELECT id FROM dbo.products WHERE part_number = N'CAJ-${n}') AS caj,
           (SELECT id FROM dbo.products WHERE part_number = N'CIG-${n}') AS cig;`);
  const { caj, cig } = ids[0];
  const stock = async (id) => Number((await sql(app.base, `SELECT stock FROM dbo.products WHERE id = ${id};`))[0].stock);

  // ---------------------------------------------------------- 1. activar
  await login(app, CUENTAS.admin);
  await irPorMas(p, 'Aplicaciones');
  const tarjeta = p.locator('article').filter({ has: p.locator('h3', { hasText: 'Venta suelta' }) });
  await expect(tarjeta).toBeVisible();
  await tarjeta.getByRole('button', { name: /Activar/ }).click();
  await expect(p.locator('.swal2-popup')).toContainText('Venta suelta activado');
  await expect.poll(async () => (await sql(app.base,
    `SELECT CAST(enabled AS INT) AS e FROM dbo.business_modules WHERE module_key = N'venta-suelta';`))[0]?.e)
    .toBe(1);
  await p.locator('.swal2-container').waitFor({ state: 'detached' }).catch(() => {});
  await p.screenshot({ path: path.join(SHOTS, '1-aplicaciones.png') });

  // ---------------------------------------------------------- 2. ligar
  await irPorDock(p, 'Inventario', 'Ver inventario');
  await p.locator('input[type="search"]').first().fill(CIG);
  const fila = p.locator('tr', { hasText: CIG });
  await fila.locator('button.btn-editar').click();
  const seccion = p.locator('[data-guide="producto-suelto"]');
  await expect(seccion).toBeVisible();
  await seccion.locator('[data-guide="producto-suelto-paquete"]').getByRole('combobox').click();
  await p.getByRole('option', { name: new RegExp(CAJ) }).click();
  await seccion.locator('input[name="sueltoPiezas"]').fill('20');
  await expect(seccion).toContainText('$4.75 por pieza');
  await p.screenshot({ path: path.join(SHOTS, '2-formulario.png') });
  await p.locator('[data-guide="producto-guardar"]').click();
  await expect(p.locator('.swal2-popup')).toContainText('Producto actualizado');

  const liga = await sql(app.base, `SELECT parent_product_id, piezas FROM dbo.venta_suelta WHERE product_id = ${cig};`);
  expect(liga[0]).toMatchObject({ parent_product_id: caj, piezas: 20 });
  const costo = await sql(app.base, `SELECT CAST(cost AS FLOAT) AS c FROM dbo.products WHERE id = ${cig};`);
  expect(costo[0].c, 'sin costo propio, el cigarro toma 80 / 20').toBe(4);

  /* Abrir de nuevo el formulario lo trae ligado. */
  await p.locator('.swal2-container').waitFor({ state: 'detached' }).catch(() => {});
  await fila.locator('button.btn-editar').click();
  await expect(p.locator('input[name="sueltoPiezas"]')).toHaveValue('20');
  await expect(p.locator('[data-guide="producto-suelto-paquete"]')).toContainText(CAJ);
  await p.keyboard.press('Escape');

  // ---------------------------------------------------------- 3. vender
  const userId = (await app.invocar('sesion')).data.userId;
  const abierto = await app.invocar('openShift', { user_id: userId, opening_cash: 1000 });
  const hayTurno = abierto?.success || /ya existe un turno/i.test(String(abierto?.error ?? ''));
  expect(hayTurno, `no hay turno para cobrar: ${JSON.stringify(abierto)}`).toBeTruthy();

  await irPorDock(p, 'Venta');
  await p.waitForSelector('[data-guide="venta-agregar"]', { timeout: 30000 });
  await p.locator('[data-guide="venta-agregar"]').click();
  await p.locator('[data-guide="venta-buscar"]').fill(CIG);
  await p.locator(`[data-guide="venta-producto"][data-guide-clave="CIG-${n}"]`).click();
  const linea = p.locator(`[data-guide="venta-linea"][data-guide-clave="${cig}"]`);
  await expect(linea).toBeVisible();
  /* La primera casilla es la cantidad; la segunda, el precio. */
  const cantidad = linea.locator('input[type="number"]').first();
  await cantidad.fill('3');
  await cantidad.press('Tab');
  await expect(linea).toContainText('$18.00');

  const ventasAntes = ((await app.invocar('getSales')).data ?? []).length;
  await p.locator('[data-guide="venta-cobrar"]').click();
  await p.waitForSelector('.modal-cobro', { state: 'visible', timeout: 20000 });
  await p.fill('.modal-cobro input[name="dineroRecibido"]', '100');
  await p.locator('[data-guide="venta-confirmar-cobro"]').click();
  await expect.poll(async () => ((await app.invocar('getSales')).data ?? []).length,
    { timeout: 30000, message: 'la venta no se registró' }).toBe(ventasAntes + 1);
  await p.screenshot({ path: path.join(SHOTS, '3-venta.png') });

  expect(await stock(caj), 'se abrió una cajetilla').toBe(1);
  expect(await stock(cig), '20 piezas menos las 3 vendidas').toBe(17);
  const mov = await sql(app.base, `SELECT product_id, typee, CAST(quantity AS INT) AS q FROM dbo.inventory_movements
    WHERE source = 'APERTURA' AND sold_product_id = ${cig} ORDER BY typee DESC;`);
  expect(mov).toEqual([
    { product_id: caj, typee: 'salida', q: 1 },
    { product_id: cig, typee: 'entrada', q: 20 },
  ]);
});
