/**
 * Una frutería (casi todo verdulería) de punta a punta, en la app de verdad.
 *
 *     npm run e2e:fruteria
 *
 * Llena la base de prueba con el catálogo de scripts/giros/fruteria.mjs
 * (183 productos: por kilo, por pieza y por manojo, en 9 categorías) y
 * recorre lo que usa el negocio, con capturas en tmp/e2e-fruteria/:
 *
 *   1. Venta: el buscador con sus dibujos; buscar «chile».
 *   2. Venta a granel: «½ kg de jitomate», «$20 de limón», 1 manojo de
 *      cilantro, cobrar; la venta queda redonda y con las cantidades reales.
 *   3. Inventario con todo el catálogo.
 *   4. Touch: el mosaico por categoría; tocar un producto por kilo pregunta
 *      cuánto.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-fruteria');

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

/** El catálogo de la frutería en la base (idempotente: FRU-001…). */
async function sembrar(base) {
  const { FRUTERIA } = await import('../scripts/giros/fruteria.mjs');
  const q = (s) => s.replace(/'/g, "''");
  const cats = [...new Set(FRUTERIA.map((f) => f[1]))];
  const filas = FRUTERIA.map(([nombre, cat, unidad, precio], i) => {
    const kg = unidad === 'kg';
    return `(N'FRU-${String(i + 1).padStart(3, '0')}', N'${q(nombre)}', ${precio}, ${kg ? 25 : 30}, N'${q(cat)}', ${kg ? 1 : 0}, ${kg ? "'kg'" : "'pza'"}, ${Math.round(precio * 60) / 100})`;
  });
  await sql(base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'Mercado') INSERT INTO dbo.CAT_brands (namee) VALUES (N'Mercado');
    ${cats.map((c) => `IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'${q(c)}') INSERT INTO dbo.CAT_categories (namee) VALUES (N'${q(c)}');`).join('\n')}
    DECLARE @b INT = (SELECT id FROM dbo.CAT_brands WHERE namee = N'Mercado');
    DECLARE @f TABLE (pn NVARCHAR(40), nombre NVARCHAR(100), price DECIMAL(10,2), stock DECIMAL(10,2), cat NVARCHAR(100), granel BIT, uom NVARCHAR(10), cost DECIMAL(10,2));
    INSERT INTO @f VALUES ${filas.join(',\n')};
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date)
      SELECT f.pn, f.nombre, f.price, f.stock, 1, 1, 'DIRECT', c.id, @b, f.cost, '02', 0, GETDATE()
        FROM @f f JOIN dbo.CAT_categories c ON c.namee = f.cat
       WHERE NOT EXISTS (SELECT 1 FROM dbo.products p WHERE p.part_number = f.pn);
    UPDATE p SET p.price = f.price, p.stock = f.stock, p.allow_decimal_qty = f.granel, p.base_uom = f.uom, p.active = 1, p.sellable = 1
      FROM dbo.products p JOIN @f f ON f.pn = p.part_number;`);
  return FRUTERIA.length;
}

test('frutería: catálogo de mercado en Venta, granel, Inventario y Touch', async ({ app }) => {
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
  await p.locator('[data-guide=venta-buscar]').fill('chile');
  await expect(p.locator('.modal-productos [data-guide=venta-producto]').first()).toContainText(/Chile/i);
  /* Cada tarjeta con su dibujo y el precio por kilo. */
  const guajillo = p.locator('.modal-productos [data-guide=venta-producto]').filter({ hasText: 'Chile guajillo' });
  await expect(guajillo.locator('wx-ilustracion')).toHaveAttribute('data-forma', 'chile_seco');
  await expect(guajillo.locator('.pi-price')).toContainText('/ kg');
  await foto('2-venta-buscar-chile');

  // ------------------------------------------------- 2. granel y cobro
  const agregar = async (texto) => {
    if (!(await p.locator('.modal-productos').count())) {
      await p.getByRole('button', { name: /Agregar producto/ }).click();
    }
    await p.locator('[data-guide=venta-buscar]').fill(texto);
    await p.locator('.modal-productos [data-guide=venta-producto]').filter({ hasText: texto }).first().click();
  };
  await agregar('Jitomate saladet');
  await expect(p.locator('[data-guide=granel-cantidad]')).toBeVisible();
  await foto('3-granel-jitomate');
  await p.locator('.granel__rapido', { hasText: '½' }).click();
  await agregar('Limón c/semilla');
  await p.locator('[data-guide=granel-importe]').fill('20');
  await foto('4-granel-limon-20-pesos');
  await p.locator('[data-guide=granel-agregar]').click();
  await agregar('Cilantro manojo');
  await expect(p.locator('[data-guide=venta-linea]')).toHaveCount(3);
  await expect(p.locator('[data-guide=venta-linea]').filter({ hasText: 'Jitomate' }).locator('.venta-uom')).toHaveText('kg');
  await expect(p.locator('[data-guide=venta-linea]').filter({ hasText: 'Cilantro' }).locator('.venta-uom')).toHaveCount(0);
  await foto('5-venta-cuenta');
  const total = Number(((await p.locator('#total-venta').innerText()).match(/[\d,.]+/) || ['0'])[0].replace(/,/g, ''));
  /* ½ kg a $28 = 14; $20 de limón a $30 = 0.67 kg = 20.10 → 20.00; manojo 8. */
  expect(total).toBe(42);
  await p.locator('[data-guide=venta-cobrar]').click();
  await p.locator('[data-guide=venta-recibido]').fill('50');
  await p.locator('[data-guide=venta-confirmar-cobro]').click();
  await expect.poll(async () => (await sql(app.base, `
    SELECT TOP 1 CAST(s.total AS float) total FROM dbo.sales s
     WHERE EXISTS (SELECT 1 FROM dbo.sale_detail d JOIN dbo.products x ON x.id = d.product_id WHERE d.sale_id = s.id AND x.part_number LIKE N'FRU-%')
     ORDER BY s.id DESC;`))[0]?.total, { timeout: 30000 }).toBe(42);
  await cerrarAvisoDeVenta(p);

  // --------------------------------------------------------- 3. Inventario
  await irPorDock(p, 'Inventario');
  await p.locator('tbody tr').nth(5).waitFor({ timeout: 60000 });
  await p.locator('.ventas-search input[type=search]').fill('chile');
  await foto('6-inventario-chile');

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
  await p.getByRole('button', { name: 'Verduras' }).first().click();
  await expect(p.locator('[data-guide=touch-producto]').filter({ hasText: 'Jitomate saladet' })).toBeVisible();
  await expect(p.locator('[data-guide=touch-producto]').filter({ hasText: 'Jitomate saladet' }).locator('.tp-card__precio')).toContainText('/ kg');
  await expect(p.locator('[data-guide=touch-producto]').filter({ hasText: 'Lechuga orejona' }).locator('.tp-card__uom')).toHaveCount(0);
  await foto('7-touch-verduras');
  await p.getByRole('button', { name: 'Frutas' }).first().click();
  await foto('8-touch-frutas');
  await p.getByRole('button', { name: 'Chiles secos' }).first().click();
  await foto('9-touch-chiles-secos');
  await p.getByRole('button', { name: 'Frutas' }).first().click();
  await p.locator('[data-guide=touch-producto]').filter({ hasText: 'Plátano tabasco' }).click();
  await expect(p.locator('[data-guide=granel-cantidad]')).toBeVisible();
  await foto('10-touch-granel-platano');
  await app.invocar('setDeviceConfig', { deviceProfile: 'RETAIL_POS' }).catch(() => {});
  console.log(`frutería: ${n} productos, capturas en ${SHOTS}`);
});
