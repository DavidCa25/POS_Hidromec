/**
 * Mayoreo (0089), en la app de verdad.
 *
 *     npm run e2e:mayoreo
 *
 *   1. Cartón: escanear el código del cartón de 12 agrega 12 piezas al precio
 *      del cartón ($200, no 12 × $20). Otro escaneo suma otro cartón; una
 *      pieza suelta va aparte a $20. Al cobrar, el inventario baja en piezas.
 *   2. Lista de clientes: la tiendita tiene la lista «Mayoreo» (solo
 *      clientes). Al asignarla a la cuenta, la caja cobra $17 la pieza; la
 *      venta queda a su nombre.
 */
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

const PIEZA = '7500000089001', CARTON = '7500000089012';

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

test('mayoreo: el cartón se escanea a su precio y la tiendita paga su lista', async ({ app }) => {
  test.setTimeout(300000);
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1366, height: 820 });
  const [ids] = await sql(app.base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'E2E Marca') INSERT INTO dbo.CAT_brands (namee) VALUES (N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'E2E Cerveza') INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E Cerveza');
    DECLARE @c INT = (SELECT id FROM dbo.CAT_categories WHERE namee = N'E2E Cerveza'), @b INT = (SELECT id FROM dbo.CAT_brands WHERE namee = N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'E2E-MEDIANA')
      INSERT INTO dbo.products (part_number, bar_code, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date)
      VALUES (N'E2E-MEDIANA', N'${PIEZA}', N'Corona mediana', 20, 100, 1, 1, 'DIRECT', @c, @b, 12, '02', 0.16, GETDATE());
    UPDATE dbo.products SET price = 20, stock = 100 WHERE part_number = N'E2E-MEDIANA';
    DECLARE @p INT = (SELECT id FROM dbo.products WHERE part_number = N'E2E-MEDIANA');
    IF NOT EXISTS (SELECT 1 FROM dbo.product_presentations WHERE product_id = @p)
      EXEC dbo.sp_save_product_presentation @product_id = @p, @name = N'Cartón 12', @factor_to_base = 12,
           @con_venta = 1, @bar_code = N'${CARTON}', @sale_price = 200;
    IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE customerName = N'Tiendita Doña Mary')
      INSERT INTO dbo.customers (customerName, phone) VALUES (N'Tiendita Doña Mary', N'5550001111');
    SELECT @p AS chela, (SELECT id FROM dbo.customers WHERE customerName = N'Tiendita Doña Mary') AS tienda;`);

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
  };
  const stock = async () => Number((await sql(app.base, `SELECT CAST(stock AS float) s FROM dbo.products WHERE id = ${ids.chela}`))[0].s);
  const cobrar = async (recibido) => {
    await p.locator('[data-guide=venta-cobrar]').click();
    await p.locator('[data-guide=venta-recibido]').fill(String(recibido));
    await p.locator('[data-guide=venta-confirmar-cobro]').click();
  };
  const ultimaVenta = async () => (await sql(app.base, `
    SELECT TOP 1 s.id, CAST(s.total AS float) total, s.customer_id,
           (SELECT CAST(SUM(quantity) AS float) FROM dbo.sale_detail WHERE sale_id = s.id) piezas
      FROM dbo.sales s WHERE EXISTS (SELECT 1 FROM dbo.sale_detail d WHERE d.sale_id = s.id AND d.product_id = ${ids.chela})
     ORDER BY s.id DESC;`))[0] ?? null;

  /* La lista «Mayoreo» se da de alta antes de abrir la caja, que lee la
     política comercial al entrar. */
  const cat = (await app.invocar('commercialCatalog')).data;
  const uuid = cat.ids.find((x) => x.id === ids.chela).uuid;
  const policy = cat.policy;
  policy.channels.push({ id: 'MAYOREO', name: 'Mayoreo', active: true, inheritBase: true, customersOnly: true });
  policy.prices.push({ channel: 'MAYOREO', product: uuid, price: '17.00' });
  const g = await app.invocar('commercialSave', { version: policy.version, policy });
  expect(g?.success, JSON.stringify(g)).toBeTruthy();
  const a = await app.invocar('commercialCustomerPriceList', { customerId: ids.tienda, channel: 'MAYOREO' });
  expect(a?.success, JSON.stringify(a)).toBeTruthy();

  await irPorDock(p, 'Venta');
  await p.waitForSelector('.pos-wrap');

  // ------------------------------------------------ 1. el cartón, escaneado
  await escanear(CARTON);
  await expect(p.locator('.pos-wrap')).toContainText('Corona mediana · Cartón 12', { timeout: 30000 });
  await expect.poll(total, { timeout: 30000 }).toBe(200);
  await escanear(CARTON);
  await expect.poll(total, { timeout: 30000 }).toBe(400);
  await escanear(PIEZA);
  await expect.poll(total, { timeout: 30000 }).toBe(420);
  await cobrar(500);
  await expect.poll(ultimaVenta, { timeout: 30000 }).toMatchObject({ total: 420, piezas: 25 });
  expect(await stock(), 'el inventario baja 2 cartones × 12 + 1').toBe(75);
  await cerrarAvisoDeVenta(p);

  // ------------------------------------- 2. la tiendita paga su lista de mayoreo
  await p.locator('[data-caja=cliente]').click();
  await p.locator('tr.prod-pick-row', { hasText: 'Tiendita Doña Mary' }).click();
  for (let i = 0; i < 5; i++) await escanear(PIEZA);
  await expect.poll(total, { timeout: 30000 }).toBe(85);
  await cobrar(100);
  await expect.poll(ultimaVenta, { timeout: 30000 }).toMatchObject({ total: 85, piezas: 5, customer_id: ids.tienda });
});
