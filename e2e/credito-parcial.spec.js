/**
 * Pago con una parte a crédito (0081), en la app de verdad.
 *
 *     npm run e2e:credito-parcial
 *
 * «El cliente trae $100 y son $150: los otros $50, a crédito.» Por la
 * pantalla, en las dos cajas:
 *
 *   Venta (tienda)       Dividir pago: Efectivo $100 + «A crédito» $50, con el
 *                        cliente de la cuenta y el aviso de lo que se cobra
 *                        ahora y lo que queda a crédito.
 *   Touch (restaurante)  Dividir pago: se quita Tarjeta, se toca «A crédito»,
 *                        se teclean $100 de efectivo y el crédito se llena
 *                        solo con $50. Sin cliente, pide elegirlo.
 *
 * En las dos, la base termina igual: venta a crédito con $100 pagados y $50
 * de saldo, los $100 en el cajón. Las reglas finas (límite, abonos,
 * devolución, corte) las prueba scripts/db/pruebas/credito-parcial.mjs.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-credito-parcial');

async function login(app, c) {
  const p = app.ventana;
  await p.fill('#username', c.usuario);
  await p.fill('#password', c.password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }, { timeout: 60000 }).toBe(c.usuario);
}

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

/** Un producto de $150 sin inventario y una clienta con crédito de $1,000. */
async function preparar(base, n) {
  const [x] = await sql(base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'E2E Marca') INSERT INTO dbo.CAT_brands (namee) VALUES (N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'E2E Crédito') INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E Crédito');
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date)
    VALUES (N'CRP-${n}', N'Orden de 150 ${n}', 150, 0, 1, 1, 'NONE',
            (SELECT id FROM dbo.CAT_categories WHERE namee = N'E2E Crédito'), (SELECT id FROM dbo.CAT_brands WHERE namee = N'E2E Marca'), 60, '02', 0.16, GETDATE());
    INSERT INTO dbo.customers (customerName, credit_limit, terms_days, grace_days) VALUES (N'Clienta crédito ${n}', 1000, 15, 3);
    SELECT (SELECT id FROM dbo.products WHERE part_number = N'CRP-${n}') AS producto,
           (SELECT id FROM dbo.customers WHERE customerName = N'Clienta crédito ${n}') AS cliente;`);
  return { producto: Number(x.producto), cliente: Number(x.cliente), nombreProducto: `Orden de 150 ${n}`, nombreCliente: `Clienta crédito ${n}` };
}

async function ventaDe(base, cliente) {
  const [v] = await sql(base, `
    SELECT TOP 1 s.id, s.payment_method, s.total, s.paid_amount, s.balance,
           (SELECT ISNULL(SUM(amount), 0) FROM dbo.cash_movements WHERE typee = 'SALE' AND reference_id = s.id) AS al_cajon,
           (SELECT COUNT(*) FROM dbo.sale_payments WHERE sale_id = s.id AND payment_method = 'EFECTIVO') AS pagos_efectivo
      FROM dbo.sales s WHERE s.customer_id = ${cliente} ORDER BY s.id DESC;`);
  return v;
}

function esperarCreditoParcial(v) {
  expect(v, 'se registró la venta').toBeTruthy();
  expect(v.payment_method, 'es una venta a crédito').toBe('CREDITO');
  expect(Number(v.total)).toBe(150);
  expect(Number(v.paid_amount), 'pagó 100 al momento').toBe(100);
  expect(Number(v.balance), 'y quedan 50 a crédito').toBe(50);
  expect(Number(v.al_cajon), 'los 100 en efectivo entran al cajón').toBe(100);
  expect(Number(v.pagos_efectivo), 'el pago en efectivo queda registrado').toBe(1);
}

async function abrirTurnoSiHaceFalta(app) {
  const yo = (await app.invocar('sesion')).data.userId;
  const t = await app.invocar('openShift', { user_id: yo, opening_cash: 500, register_id: 1 });
  expect(t?.success || /ya existe un turno|ya hay un turno/i.test(String(t?.error ?? '')), JSON.stringify(t)).toBeTruthy();
}

test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));

test('Venta (tienda): efectivo $100 y el resto a crédito', async ({ app }) => {
  test.setTimeout(300000);
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1366, height: 820 });
  const n = Date.now().toString().slice(-6);
  const d = await preparar(app.base, n);
  await login(app, CUENTAS.admin);
  await abrirTurnoSiHaceFalta(app);

  await irPorDock(p, 'Venta');
  await p.waitForSelector('.pos-wrap');
  const caja = p.locator('.wx-panel-tenue', { hasText: 'Cliente asignado' });
  await caja.getByRole('button', { name: /Buscar|Cambiar/ }).first().click();
  await p.locator('.prod-pick-row', { hasText: d.nombreCliente }).click();
  await expect(caja).toContainText(d.nombreCliente);
  await p.getByRole('button', { name: /Agregar producto/ }).click();
  await p.locator('.modal-productos .prod-item').filter({ hasText: d.nombreProducto }).click();
  await expect(p.locator('.modal-productos')).toHaveCount(0);

  await p.keyboard.press('F8');
  await expect(p.locator('.total-amount')).toContainText('150.00');
  await p.locator('.pay-pill', { hasText: 'Dividir pago' }).click();
  /* Como en Touch: Efectivo y Tarjeta vienen encendidos; se apaga Tarjeta,
     se enciende «A crédito» y se escriben $100 de efectivo. El crédito se
     llena solo con lo que falta. */
  const metodo = (m) => p.locator(`[data-guide=venta-pago-mixto-metodo][data-guide-clave="${m}"]`);
  await metodo('TARJETA').click();
  await metodo('CREDITO').click();
  await expect(metodo('CREDITO')).toHaveAttribute('aria-pressed', 'true');
  await p.locator('[data-guide=venta-pago-mixto-importe][data-guide-clave="EFECTIVO"]').fill('100');
  await expect(p.locator('[data-guide=venta-pago-mixto-importe][data-guide-clave="CREDITO"]')).toHaveAttribute('placeholder', '50.00');

  /* El aviso dice lo que se cobra ahora y lo que queda a crédito, y la
     clienta de la cuenta queda como la del crédito. */
  const aviso = p.locator('[data-guide=venta-credito-parcial]');
  await expect(aviso).toContainText('$100.00');
  await expect(aviso).toContainText('$50.00');
  await expect(p.locator('[data-guide=venta-credito-cliente]')).toContainText(d.nombreCliente);
  await p.screenshot({ path: path.join(SHOTS, 'venta-cobro.png') });
  await p.locator('[data-guide=venta-confirmar-cobro]').click();

  await expect.poll(async () => (await ventaDe(app.base, d.cliente))?.balance ?? null, { timeout: 30000 }).not.toBeNull();
  esperarCreditoParcial(await ventaDe(app.base, d.cliente));
});

test('Touch (restaurante): efectivo $100 y el crédito se llena solo con lo que falta', async ({ app }) => {
  test.setTimeout(300000);
  const p = app.ventana;
  const n = Date.now().toString().slice(-6);
  const d = await preparar(app.base, n);
  await login(app, CUENTAS.admin);
  await abrirTurnoSiHaceFalta(app);
  const antes = (await app.invocar('getDeviceConfig'))?.data ?? (await app.invocar('getDeviceConfig'));
  await app.invocar('setDeviceConfig', { ...antes, deviceProfile: 'TOUCH_POS' });

  try {
    await p.locator('.wx-yo__btn').click();
    await p.locator('.wx-yo__fila').filter({ hasText: 'Cerrar sesión' }).click();
    await p.waitForSelector('#username');
    await login(app, CUENTAS.admin);
    await p.setViewportSize({ width: 1280, height: 800 });
    await p.waitForSelector('app-touch-pos .tp-card');

    await p.locator('.tp-card').filter({ hasText: d.nombreProducto }).click();
    await expect(p.locator('.tp-cart__total')).toContainText('$150.00');
    await p.locator('[data-guide=touch-cobrar]').click();
    await p.getByRole('button', { name: 'Dividir pago', exact: true }).click();

    /* Sin cliente en la cuenta, «A crédito» pide elegirlo y no se agrega. */
    await p.locator('[data-guide=touch-pago-credito]').click();
    await expect(p.locator('.tp-aviso')).toContainText('Elige el cliente de la cuenta');
    await p.locator('.tp-res--cliente', { hasText: d.nombreCliente }).click();
    await p.locator('[data-guide=touch-cobrar]').click().catch(() => { /* ya estaba en el cobro */ });
    if (!(await p.locator('.tp-dinero--mixto').count())) await p.getByRole('button', { name: 'Dividir pago', exact: true }).click();

    /* Quedan Efectivo y Tarjeta: se quita Tarjeta (tocarla dos veces) y se agrega «A crédito». */
    const metodos = p.locator('.tp-metodos');
    await metodos.getByRole('button', { name: 'Tarjeta', exact: true }).click();
    await metodos.getByRole('button', { name: 'Tarjeta', exact: true }).click();
    await p.locator('[data-guide=touch-pago-credito]').click();
    await expect(p.locator('[data-guide=touch-credito-cliente]')).toContainText(d.nombreCliente);

    await p.locator('.tp-dinero--mixto').getByRole('button', { name: /Efectivo recibido/ }).click();
    for (const k of '100') await p.locator('.tp-num').getByRole('button', { name: k, exact: true }).click();
    const reparto = p.locator('.tp-pagos');
    await expect(reparto).toContainText('A crédito');
    await expect(reparto).toContainText('$50.00');
    await expect(reparto).toContainText('$100.00');
    await p.screenshot({ path: path.join(SHOTS, 'touch-cobro.png') });
    await p.locator('[data-guide=touch-cobro-confirmar]').click();
    await expect(p.locator('.tp-exito')).toBeVisible({ timeout: 30000 });

    esperarCreditoParcial(await ventaDe(app.base, d.cliente));
  } finally {
    await app.invocar('setDeviceConfig', { ...antes, deviceProfile: antes?.deviceProfile ?? 'RETAIL_POS' }).catch(() => {});
  }
});
