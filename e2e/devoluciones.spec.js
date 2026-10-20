/**
 * DEVOLUCIONES (0065), EN LA APP DE VERDAD.
 *
 *     npx playwright test e2e/devoluciones.spec.js
 *
 *   1. Touch: «Devolución» bajo el cliente abre la hoja con las ventas de hoy
 *      de esta caja; se elige una sin teclear el folio.
 *   2. Sin motivo no se puede confirmar; la hoja dice cómo se regresa el
 *      dinero (efectivo y tarjeta) antes de confirmar.
 *   3. Queda registrada con su motivo y el inventario repuesto.
 *   4. El comprobante de la devolución se ve antes de imprimir.
 *   5. Cambio: devuelve una taza y se lleva una más cara, paga la diferencia
 *      en efectivo; todo en una operación.
 *   6. El corte del turno enseña el apartado «Devoluciones» y lo pagado con cambio.
 *
 * Supone una base recién preparada (npm run e2e:preparar).
 */
const path = require('node:path');
const { test, expect, CUENTAS, BASE_CORE, irPorDock } = require('./fixtures');

async function entrar(app, c) {
  const p = app.ventana;
  await p.waitForSelector('#username', { timeout: 60000 });
  await p.fill('#username', c.usuario);
  await p.fill('#password', c.password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario ?? null; } catch { return null; }
  }, { timeout: 30000 }).toBe(c.usuario);
}

async function sql(texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(BASE_CORE, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

async function captura(p, nombre) {
  if (process.env.WYBIX_CAPTURAS) await p.screenshot({ path: path.join(process.env.WYBIX_CAPTURAS, nombre + '.png') });
}

test('Devolución desde Touch con motivo, y su apartado en el corte', async ({ app }) => {
  test.setTimeout(240000);
  const p = app.ventana;
  await entrar(app, CUENTAS.admin);
  const yo = (await app.invocar('sesion')).data.userId;
  const turno = await app.invocar('openShift', { user_id: yo, opening_cash: 500 });
  expect(turno?.success || /ya existe un turno/i.test(String(turno?.error ?? '')), JSON.stringify(turno)).toBeTruthy();

  /* Una venta de hoy en esta caja: 2 tazas, mitad efectivo y mitad tarjeta. */
  const n = Date.now().toString().slice(-6);
  const nombre = `Taza devolución ${n}`;
  const [{ venta }] = await sql(`
    DECLARE @u INT = ${yo};
    DECLARE @cl INT = (SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL AND register_id = 1 ORDER BY id DESC);
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories) INSERT INTO dbo.CAT_categories (namee) VALUES (N'QA Devoluciones');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands) INSERT INTO dbo.CAT_brands (namee) VALUES (N'QA');
    DECLARE @cat INT = (SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id), @mar INT = (SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id);
    INSERT INTO dbo.products (part_number, nombre, price, stock, cost, objeto_impuesto, tasa_iva, active, registrated_date, inventory_mode, category_id, brand_id)
    VALUES (N'DEV-${n}', N'${nombre}', 120, 10, 50, '02', 0.16, 1, GETDATE(), 'DIRECT', @cat, @mar);
    DECLARE @p INT = SCOPE_IDENTITY();
    INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance, register_id, closure_id)
    VALUES (GETDATE(), @u, 240, N'MIXTO', 240, 0, 1, @cl);
    DECLARE @s INT = SCOPE_IDENTITY();
    INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, tax_object, tax_rate) VALUES (@s, @p, 2, 120, 50, '02', 0.16);
    INSERT INTO dbo.sale_payments (sale_id, payment_method, amount) VALUES (@s, N'EFECTIVO', 120), (@s, N'TARJETA', 120);
    INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, amount, closure_id, register_id) VALUES (GETDATE(), @u, N'SALE', @s, 120, @cl, 1);
    UPDATE dbo.products SET stock = 8 WHERE id = @p;
    INSERT INTO dbo.products (part_number, nombre, price, stock, cost, objeto_impuesto, tasa_iva, active, registrated_date, inventory_mode, category_id, brand_id)
    VALUES (N'DEVG-${n}', N'Taza grande ${n}', 150, 10, 60, '02', 0.16, 1, GETDATE(), 'DIRECT', @cat, @mar);
    INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance, register_id, closure_id)
    VALUES (GETDATE(), @u, 120, N'EFECTIVO', 120, 0, 1, @cl);
    DECLARE @s2 INT = SCOPE_IDENTITY();
    INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, tax_object, tax_rate) VALUES (@s2, @p, 1, 120, 50, '02', 0.16);
    INSERT INTO dbo.sale_payments (sale_id, payment_method, amount) VALUES (@s2, N'EFECTIVO', 120);
    INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, amount, closure_id, register_id) VALUES (GETDATE(), @u, N'SALE', @s2, 120, @cl, 1);
    SELECT @s AS venta;`);
  const venta2 = Number((await sql(`SELECT MAX(id) AS v FROM dbo.sales`))[0].v);

  /* La caja pasa a Touch. */
  await app.invocar('setDeviceConfig', { deviceProfile: 'TOUCH_POS' });
  await p.click('.wx-yo__btn');
  await p.click('.wx-yo__fila:has-text("Cerrar sesión")');
  await entrar(app, CUENTAS.admin);
  await p.waitForSelector('app-touch-pos .tp-card', { timeout: 60000 });

  // ------------------------------------------------ 1. encontrar la venta
  await p.click('[data-guide=touch-devolucion]');
  const hoja = p.locator('[data-guide=touch-devolucion-hoja]');
  await expect(hoja).toContainText('Ventas de hoy en esta caja');
  const fila = hoja.locator(`[data-guide=touch-devolucion-venta][data-guide-clave="${venta}"]`);
  await expect(fila).toContainText(nombre);
  await captura(p, 'touch-devolucion-ventas');
  await fila.click();

  // ------------------------------------------------ 2. qué, motivo y cómo
  await expect(hoja).toContainText(`Devolver de la venta #${venta}`);
  await hoja.getByRole('button', { name: 'Todo' }).click();
  const confirmar = hoja.locator('[data-guide=touch-devolucion-confirmar]');
  await expect(confirmar).toBeDisabled();
  const regreso = hoja.locator('[data-guide=touch-devolucion-regreso]');
  await expect(regreso).toContainText('Sale del cajón en efectivo');
  await expect(regreso).toContainText('Se regresa a su tarjeta');
  await hoja.getByRole('radio', { name: 'Mal estado' }).click();
  await expect(confirmar).toBeEnabled();
  await expect(confirmar).toContainText('240.00');
  await captura(p, 'touch-devolucion-motivo');

  // ------------------------------------------------ 3. registrar
  await confirmar.click();
  await expect(hoja).toContainText('Devolución registrada', { timeout: 30000 });
  await captura(p, 'touch-devolucion-listo');
  const [d] = await sql(`SELECT reason, refund_total, register_id FROM dbo.sale_refunds WHERE sale_id = ${venta}`);
  expect(d.reason).toBe('Mal estado');
  expect(Number(d.refund_total)).toBe(240);
  expect(Number((await sql(`SELECT stock FROM dbo.products WHERE part_number = N'DEV-${n}'`))[0].stock)).toBe(10);
  // ------------------------------------------------ 4. comprobante
  await hoja.locator('[data-guide=touch-devolucion-imprimir]').click();
  const visor = p.locator('app-receipt-viewer dialog');
  await expect(visor).toContainText('Comprobante de devolución');
  await expect.poll(async () => visor.locator('iframe').count()).toBe(1);
  await expect(hoja).toHaveCount(0);
  await p.waitForTimeout(800);
  await captura(p, 'touch-devolucion-comprobante');
  await visor.getByRole('button', { name: 'Cerrar' }).click();
  await hoja.locator('[data-guide=touch-devolucion-listo]').click();
  await expect(hoja).toHaveCount(0);

  // ------------------------------------------------ 5. cambio
  await p.click('[data-guide=touch-devolucion]');
  await hoja.locator(`[data-guide=touch-devolucion-venta][data-guide-clave="${venta2}"]`).click();
  await hoja.getByRole('button', { name: 'Todo' }).click();
  await hoja.getByRole('radio', { name: 'Se equivocó de producto' }).click();
  await hoja.getByRole('radio', { name: 'Cambiar por otro producto' }).click();
  await hoja.locator('[data-guide=touch-cambio-buscar]').fill(`Taza grande ${n}`);
  await hoja.locator('[data-guide=touch-cambio-producto]').first().click();
  await expect(hoja.locator('[data-guide=touch-cambio]')).toContainText('Paga la diferencia');
  await expect(hoja.locator('[data-guide=touch-devolucion-confirmar]')).toBeDisabled();
  await hoja.locator('[data-guide=touch-cambio-pago]').getByRole('radio', { name: 'Efectivo' }).click();
  await hoja.locator('[data-guide=touch-cambio-recibido]').fill('50');
  await expect(hoja.locator('[data-guide=touch-devolucion-confirmar]')).toContainText('cobra $30.00');
  await captura(p, 'touch-cambio');
  await hoja.locator('[data-guide=touch-devolucion-confirmar]').click();
  await expect(hoja).toContainText('Cambio registrado', { timeout: 30000 });
  await expect(hoja).toContainText('Cobra la diferencia');
  await captura(p, 'touch-cambio-listo');
  const [cx] = await sql(`SELECT r.exchange_amount, r.exchange_sale_id, s.total FROM dbo.sale_refunds r JOIN dbo.sales s ON s.id = r.exchange_sale_id WHERE r.sale_id = ${venta2}`);
  expect(Number(cx.exchange_amount)).toBe(120);
  expect(Number(cx.total)).toBe(150);
  await hoja.locator('[data-guide=touch-devolucion-listo]').click();

  // ------------------------------------------------ 4. el corte
  await app.invocar('setDeviceConfig', { deviceProfile: 'RETAIL_POS' });
  await p.evaluate(() => { location.hash = '#/dashboard/inicio'; });
  await p.waitForTimeout(800);
  if (!(await p.locator('.wxdock').count())) {
    await p.getByRole('button', { name: 'Salir del punto de venta' }).click().catch(() => {});
  }
  await irPorDock(p, 'Venta', 'Corte del día');
  await p.locator('.user-card').first().click();
  await p.locator('button', { hasText: 'Continuar' }).first().click();
  await p.locator('.mode-card').first().click();
  const seguir = p.locator('button', { hasText: 'Continuar' });
  if (await seguir.isVisible().catch(() => false)) await seguir.click();
  await p.locator('button', { hasText: 'Consultar movimientos' }).click();
  const apartado = p.locator('[data-guide=corte-devoluciones]');
  await expect(apartado).toContainText(`Folio #${venta} · Mal estado`);
  await expect(apartado).toContainText('salieron del cajón');
  await expect(apartado).toContainText(`Folio #${venta2} · Se equivocó de producto`);
  await expect(apartado).toContainText('Cambio de mercancía');
  await expect(p.locator('[data-guide=corte-ventas-cambio]')).toContainText('Pagado con un cambio');
  await apartado.scrollIntoViewIfNeeded();
  await captura(p, 'corte-devoluciones');
});
