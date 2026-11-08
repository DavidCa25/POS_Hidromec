/**
 * Las opciones de un producto en Venta (Retail), por la pantalla.
 *
 *     npm run build && node e2e/preparar-bases.mjs core && npx playwright test e2e/opciones-retail.spec.js
 *
 * La ventana de dos paneles: grupos a la izquierda, opciones a la derecha.
 * Sin el tamaño (obligatorio) no deja agregar y lleva al grupo que falta;
 * elegir el tamaño pasa solo al siguiente; los extras suman al precio y la
 * línea del carrito cobra lo mismo que dice el botón.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-opciones-retail');

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

test('Venta: elegir tamaño y extras en la ventana de opciones', async ({ app }) => {
  test.setTimeout(240000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1366, height: 820 });
  const n = Date.now().toString().slice(-6);
  const nombre = `Latte opciones ${n}`;

  const [x] = await sql(app.base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'E2E Marca') INSERT INTO dbo.CAT_brands (namee) VALUES (N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'E2E Opciones') INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E Opciones');
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date)
    VALUES (N'OPR-${n}', N'${nombre}', 50, 0, 1, 1, 'NONE',
            (SELECT id FROM dbo.CAT_categories WHERE namee = N'E2E Opciones'), (SELECT id FROM dbo.CAT_brands WHERE namee = N'E2E Marca'), 20, '02', 0.16, GETDATE());
    SELECT id FROM dbo.products WHERE part_number = N'OPR-${n}';`);
  const productId = Number(x.id);

  await p.fill('#username', CUENTAS.admin.usuario);
  await p.fill('#password', CUENTAS.admin.password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }, { timeout: 60000 }).toBe(CUENTAS.admin.usuario);
  const yo = (await app.invocar('sesion')).data.userId;
  const t = await app.invocar('openShift', { user_id: yo, opening_cash: 500, register_id: 1 });
  expect(t?.success || /ya existe un turno|ya hay un turno/i.test(String(t?.error ?? '')), JSON.stringify(t)).toBeTruthy();
  await app.invocar('modulosSet', 'hospitality', true);

  const grupo = (g) => p.evaluate((g) => window.wybix.modifiers.save(g), g);
  const tam = await grupo({ name: `Tamaño ${n}`, role: 'SIZE', required: true, minSelect: 1, maxSelect: 1,
    options: [{ name: 'Chico', priceDelta: 0, effect: 'NONE' }, { name: 'Grande', priceDelta: 10, effect: 'NONE' }] });
  const ext = await grupo({ name: `Extras ${n}`, role: 'ADDON', required: false, minSelect: 0, maxSelect: 2,
    options: [{ name: 'Crema', priceDelta: 6, effect: 'NONE' }, { name: 'Canela', priceDelta: 3, effect: 'NONE' }] });
  expect(tam.success && ext.success, JSON.stringify([tam, ext])).toBeTruthy();
  const ok = await p.evaluate(([productId, groupIds]) => window.wybix.modifiers.setProductGroups({ productId, groupIds }),
    [productId, [tam.groupId, ext.groupId]]);
  expect(ok.success, JSON.stringify(ok)).toBeTruthy();

  await irPorDock(p, 'Venta');
  await p.waitForSelector('.pos-wrap');
  await p.getByRole('button', { name: /Agregar producto/ }).click();
  await p.locator('.modal-productos .prod-item').filter({ hasText: nombre }).click();

  const ventana = p.locator('[data-guide=venta-opciones]');
  await expect(ventana).toBeVisible();
  const agregar = p.locator('[data-guide=venta-opciones-agregar]');
  await expect(agregar).toContainText('$50.00');

  /* Sin tamaño no agrega: avisa y deja abierto el grupo que falta. */
  await agregar.click();
  await expect(ventana).toContainText(`Falta elegir: Tamaño ${n}`);

  /* Grande: pasa solo a Extras, que no es obligatorio. */
  await ventana.locator('[data-guide=venta-opcion][data-guide-clave="Grande"]').click();
  await expect(ventana.locator('[data-guide=venta-opciones-grupo][data-guide-clave="Tamaño ' + n + '"]')).toHaveAttribute('data-guide-estado', 'listo');
  await ventana.locator('[data-guide=venta-opciones-grupo][data-guide-clave="Extras ' + n + '"]').click();
  await ventana.locator('[data-guide=venta-opcion][data-guide-clave="Crema"]').click();
  await ventana.locator('[data-guide=venta-opcion][data-guide-clave="Canela"]').click();
  await expect(agregar).toContainText('$69.00');
  await p.screenshot({ path: path.join(SHOTS, 'opciones.png') });
  await agregar.click();
  await expect(ventana).toHaveCount(0);
  await expect(p.locator('.modal-productos')).toHaveCount(0);

  /* El total de la venta es lo que decía el botón. */
  await p.keyboard.press('F8');
  await expect(p.locator('.total-amount')).toContainText('69.00');
  await p.locator('.pay-pill', { hasText: 'Dividir pago' }).click();
  await p.screenshot({ path: path.join(SHOTS, 'dividir-pago.png') });
});
