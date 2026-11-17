/**
 * Ilustraciones de productos sin foto, en Touch, en la app de verdad.
 *
 *     npm run build && node e2e/preparar-bases.mjs core && npx playwright test e2e/ilustraciones.spec.js
 *
 *   1. Un producto SIN foto se ve con su ilustración (dona → dona, frappé →
 *      frappé), no con una caja genérica.
 *   2. Un producto CON foto muestra la foto que subió el cliente, y ninguna
 *      ilustración encima.
 *   3. La hoja de opciones (producto con tamaños) muestra lo mismo: la
 *      ilustración si no hay foto, la foto si la hay.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-ilustraciones');

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
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }, { timeout: 60000 }).toBe(c.usuario);
}

test('Touch: ilustración sin foto, foto del cliente con foto, también en la hoja de opciones', async ({ app }) => {
  test.setTimeout(300000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  const n = Date.now().toString().slice(-6);
  const CAT = `E2E Ilustraciones ${n}`;
  const nombres = { dona: `Dona glaseada ${n}`, frappe: `Frappé de moka ${n}`, foto: `Concha con foto ${n}` };

  const filas = await sql(app.base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'E2E Marca') INSERT INTO dbo.CAT_brands (namee) VALUES (N'E2E Marca');
    INSERT INTO dbo.CAT_categories (namee) VALUES (N'${CAT}');
    DECLARE @c INT = (SELECT id FROM dbo.CAT_categories WHERE namee = N'${CAT}'), @b INT = (SELECT TOP 1 id FROM dbo.CAT_brands WHERE namee = N'E2E Marca');
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date)
    VALUES (N'ILU-D-${n}', N'${nombres.dona}', 18, 0, 1, 1, 'NONE', @c, @b, 6, '02', 0.16, GETDATE()),
           (N'ILU-F-${n}', N'${nombres.frappe}', 60, 0, 1, 1, 'NONE', @c, @b, 20, '02', 0.16, GETDATE()),
           (N'ILU-C-${n}', N'${nombres.foto}', 15, 0, 1, 1, 'NONE', @c, @b, 5, '02', 0.16, GETDATE());
    SELECT part_number, id FROM dbo.products WHERE part_number LIKE N'ILU-%-${n}';`);
  const id = Object.fromEntries(filas.map(f => [f.part_number.split('-')[1], Number(f.id)]));

  await login(app, CUENTAS.admin);
  await app.invocar('modulosSet', 'hospitality', true);

  /* Frappé y concha con tamaños: tocar la tarjeta abre la hoja de opciones. */
  const g = await p.evaluate((g) => window.wybix.modifiers.save(g), { name: `Tamaño ${n}`, role: 'SIZE', required: true, minSelect: 1, maxSelect: 1,
    options: [{ name: 'Chico', priceDelta: 0, effect: 'NONE' }, { name: 'Grande', priceDelta: 10, effect: 'NONE' }] });
  expect(g.success, JSON.stringify(g)).toBeTruthy();
  for (const pid of [id.F, id.C]) {
    const ok = await p.evaluate(([productId, groupIds]) => window.wybix.modifiers.setProductGroups({ productId, groupIds }), [pid, [g.groupId]]);
    expect(ok.success, JSON.stringify(ok)).toBeTruthy();
  }

  /* La foto del cliente: un cuadro rojo, con el mismo canal que usa Inventario. */
  const foto = await p.evaluate(async (productId) => {
    const c = document.createElement('canvas'); c.width = c.height = 120;
    const x = c.getContext('2d'); x.fillStyle = '#d0021b'; x.fillRect(0, 0, 120, 120);
    return window.wybix.images.set({ productId, dataUrl: c.toDataURL('image/png') });
  }, id.C);
  expect(foto.success, JSON.stringify(foto)).toBeTruthy();

  /* A Touch, como una caja táctil. */
  await app.invocar('setDeviceConfig', { deviceProfile: 'TOUCH_POS' });
  await p.locator('.wx-yo__btn').click();
  await p.locator('.wx-yo__fila').filter({ hasText: 'Cerrar sesión' }).click();
  await p.waitForSelector('#username');
  await login(app, CUENTAS.admin);
  await p.waitForSelector('app-touch-pos .tp-card', { timeout: 60000 });
  await p.setViewportSize?.({ width: 1280, height: 800 });
  const turno = p.getByRole('dialog').filter({ has: p.getByRole('heading', { name: 'Abrir turno', exact: true }) });
  await expect.poll(async () => (await turno.count()) + (await p.locator('.tp-turno__dot.on').count())).toBeGreaterThan(0);
  if (await turno.count()) await turno.getByRole('button', { name: 'Abrir turno', exact: true }).click();

  /* Solo la categoría de la prueba, para que las tres tarjetas estén a la vista. */
  await p.getByRole('button', { name: CAT }).first().click();
  const tarjeta = (nombre) => p.locator('[data-guide=touch-producto]').filter({ hasText: nombre });
  await expect(tarjeta(nombres.dona)).toBeVisible();

  // ------------------------------------------------ 1. sin foto: su dibujo
  await expect(tarjeta(nombres.dona).locator('wx-ilustracion')).toHaveAttribute('data-forma', 'dona');
  await expect(tarjeta(nombres.frappe).locator('wx-ilustracion')).toHaveAttribute('data-forma', 'frappe_moka');
  await expect(tarjeta(nombres.dona).locator('wx-ilustracion svg path').first()).toBeVisible();
  await expect(tarjeta(nombres.dona).locator('img')).toHaveCount(0);

  // ------------------------------------------- 2. con foto: manda la foto
  const img = tarjeta(nombres.foto).locator('.tp-card__media img');
  await expect(img).toBeVisible({ timeout: 20000 });
  await expect(tarjeta(nombres.foto).locator('wx-ilustracion')).toHaveCount(0);
  expect(await img.evaluate(e => e.naturalWidth > 0), 'la foto cargó').toBeTruthy();
  await p.screenshot({ path: path.join(SHOTS, '1-mosaico.png') });

  // ---------------------------------------------- 3. la hoja de opciones
  await tarjeta(nombres.frappe).click();
  const hoja = p.locator('.tp-hoja__media');
  await expect(hoja.locator('wx-ilustracion')).toHaveAttribute('data-forma', 'frappe_moka');
  await expect(hoja.locator('img')).toHaveCount(0);
  const caja = await hoja.boundingBox();
  expect(caja && caja.width >= 40 && caja.height >= 40, `la ilustración llena el recuadro: ${JSON.stringify(caja)}`).toBeTruthy();
  await p.screenshot({ path: path.join(SHOTS, '2-hoja-sin-foto.png') });
  await p.locator('.tp-overlay').click({ position: { x: 5, y: 5 } });
  await expect(p.locator('.tp-hoja')).toHaveCount(0);

  await tarjeta(nombres.foto).click();
  await expect(hoja.locator('img')).toBeVisible();
  await expect(hoja.locator('wx-ilustracion')).toHaveCount(0);
  await p.screenshot({ path: path.join(SHOTS, '3-hoja-con-foto.png') });
});
