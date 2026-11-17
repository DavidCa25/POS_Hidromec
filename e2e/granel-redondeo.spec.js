/**
 * Granel: el importe se cobra redondo a medio peso, en la app de verdad.
 *
 *     npm run e2e:granel
 *
 * «Deme 15 pesos de jamón» a $189 el kilo son 0.08 kg, que darían $15.12.
 * Se cobran $15.00: menos de 35 centavos baja al peso, de 35 a 74 queda en
 * 50, desde 75 sube al peso (precioGranel en shared/comercial.ts).
 *
 *   1. Por dinero: $15 → la ventana dice «Se cobra $15.00», el renglón y el
 *      total también, y la venta queda en la base con 0.08 kg y $15.00.
 *   2. Por peso: 0.33 kg de queso a $138 (= $45.54) → $45.50.
 *   3. Con motor comercial: la cotización redondea igual.
 */
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

const JAMON = '7500000099911', QUESO = '7500000099912';

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

async function cerrarAvisoDeVenta(p) {
  for (let i = 0; i < 2; i++) {
    for (const b of [p.getByRole('button', { name: 'Nada más, cerrar' }), p.locator('app-premios-venta').getByRole('button', { name: 'Continuar' }).first()]) {
      try { await b.click({ timeout: 2500 }); } catch { /* no está */ }
    }
  }
}

test('granel: por dinero y por peso, el importe se cobra redondo a medio peso', async ({ app }) => {
  test.setTimeout(300000);
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1366, height: 820 });
  const [ids] = await sql(app.base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'E2E Marca') INSERT INTO dbo.CAT_brands (namee) VALUES (N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'E2E Granel') INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E Granel');
    DECLARE @c INT = (SELECT id FROM dbo.CAT_categories WHERE namee = N'E2E Granel'), @b INT = (SELECT id FROM dbo.CAT_brands WHERE namee = N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'E2E-JAMON')
      INSERT INTO dbo.products (part_number, bar_code, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date)
      VALUES (N'E2E-JAMON', N'${JAMON}', N'Jamón de pierna', 189, 20, 1, 1, 'DIRECT', @c, @b, 120, '02', 0, GETDATE());
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'E2E-QUESO')
      INSERT INTO dbo.products (part_number, bar_code, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date)
      VALUES (N'E2E-QUESO', N'${QUESO}', N'Queso amarillo', 138, 20, 1, 1, 'DIRECT', @c, @b, 90, '02', 0, GETDATE());
    UPDATE dbo.products SET price = 189, stock = 20, allow_decimal_qty = 1, base_uom = 'kg' WHERE part_number = N'E2E-JAMON';
    UPDATE dbo.products SET price = 138, stock = 20, allow_decimal_qty = 1, base_uom = 'kg' WHERE part_number = N'E2E-QUESO';
    SELECT (SELECT id FROM dbo.products WHERE part_number = N'E2E-JAMON') AS jamon, (SELECT id FROM dbo.products WHERE part_number = N'E2E-QUESO') AS queso;`);

  await p.fill('#username', CUENTAS.admin.usuario);
  await p.fill('#password', CUENTAS.admin.password);
  await p.click('#btnLogin');
  await expect.poll(async () => { try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; } }, { timeout: 60000 })
    .toBe(CUENTAS.admin.usuario);
  const yo = (await app.invocar('sesion')).data.userId;
  await app.invocar('openShift', { user_id: yo, opening_cash: 500, register_id: 1 });

  const total = async () => Number(((await p.locator('#total-venta').innerText()).match(/[\d,.]+/) || ['0'])[0].replace(/,/g, ''));
  const escanear = async (codigo) => {
    await p.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await p.keyboard.type(codigo, { delay: 4 });
    await p.keyboard.press('Enter');
    await expect(p.locator('[data-guide=granel-cantidad]')).toBeVisible({ timeout: 30000 });
  };
  const ultimaVenta = async (producto) => (await sql(app.base, `
    SELECT TOP 1 CAST(d.quantity AS float) q, CAST(d.unitary_price AS float) u, CAST(s.total AS float) total
      FROM dbo.sale_detail d JOIN dbo.sales s ON s.id = d.sale_id WHERE d.product_id = ${producto} ORDER BY d.sale_id DESC;`))[0] ?? null;
  const cobrar = async () => {
    await p.locator('[data-guide=venta-cobrar]').click();
    await p.locator('[data-guide=venta-recibido]').fill('100');
    await p.locator('[data-guide=venta-confirmar-cobro]').click();
  };

  await irPorDock(p, 'Venta');
  await p.waitForSelector('.pos-wrap');

  // --------------------------------------------- 1. por dinero: «$15 de jamón»
  await escanear(JAMON);
  await p.locator('[data-guide=granel-importe]').fill('15');
  await expect(p.locator('.granel__cobro')).toContainText('$15.00');
  await expect(p.locator('[data-guide=granel-cantidad-kg]')).toHaveValue('0.08');
  await p.locator('[data-guide=granel-agregar]').click();
  await expect.poll(total).toBe(15);
  await cobrar();
  await expect.poll(() => ultimaVenta(ids.jamon), { timeout: 30000 }).toMatchObject({ q: 0.08, total: 15 });
  await cerrarAvisoDeVenta(p);

  // ------------------------------------------ 2. por peso: 0.33 kg de queso
  await escanear(QUESO);
  await p.locator('[data-guide=granel-cantidad-kg]').fill('0.33');
  await expect(p.locator('.granel__cobro')).toContainText('$45.50');
  await p.locator('[data-guide=granel-agregar]').click();
  await expect.poll(total).toBe(45.5);
  await cobrar();
  await expect.poll(() => ultimaVenta(ids.queso), { timeout: 30000 }).toMatchObject({ q: 0.33, total: 45.5 });
  await cerrarAvisoDeVenta(p);

  // ------------------------------- 3. con motor comercial, la misma regla
  const politica = (await app.invocar('commercialCatalog')).data.policy;
  const q = await app.invocar('commercialQuote', { version: politica.version, channel: 'LOCAL', audiences: [],
    lines: [{ productId: ids.jamon, qty: 0.08 }, { productId: ids.queso, qty: 0.33 }] });
  expect(q?.success, JSON.stringify(q)).toBeTruthy();
  expect(Number(q.data.total), 'la cotización cobra 15.00 + 45.50').toBe(60.5);
});
