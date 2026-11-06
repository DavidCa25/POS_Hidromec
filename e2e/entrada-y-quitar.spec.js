/**
 * Entrada de efectivo (0076) y quitar un producto al bajar de 1, en la app de verdad.
 *
 *   1. F4 abre «Entrada de efectivo»; se registra $250 de cambio y el corte
 *      lo suma en entradas y en el efectivo esperado.
 *   2. En la venta, «−» sobre un producto con 1 pieza pregunta si se quita;
 *      ← → cambian entre «Quitar» y «Cancelar», Esc cancela y Enter quita.
 *
 *     npm run build && node e2e/preparar-bases.mjs core && npx playwright test e2e/entrada-y-quitar.spec.js
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-entrada-quitar');

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

test('Entrada de efectivo con F4 y quitar producto al bajar de 1', async ({ app }) => {
  test.setTimeout(240000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;

  const n = Date.now().toString().slice(-6);
  const PROD = `Refresco E2E ${n}`;
  const ids = await sql(app.base, `
    DECLARE @b INT = (SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id);
    DECLARE @c INT = (SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id);
    IF @b IS NULL BEGIN INSERT INTO dbo.CAT_brands (namee) VALUES (N'E2E'); SET @b = SCOPE_IDENTITY(); END
    IF @c IS NULL BEGIN INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E'); SET @c = SCOPE_IDENTITY(); END
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, category_id, brand_id, cost, bar_code)
    VALUES (N'REF-${n}', N'${PROD}', 22, 50, 1, @c, @b, 15, NULL);
    SELECT id FROM dbo.products WHERE part_number = N'REF-${n}';`);
  const prodId = ids[0].id;

  await login(app, CUENTAS.admin);
  const userId = (await app.invocar('sesion')).data.userId;
  const abierto = await app.invocar('openShift', { user_id: userId, opening_cash: 500 });
  expect(abierto?.success || /ya existe un turno/i.test(String(abierto?.error ?? '')), JSON.stringify(abierto)).toBeTruthy();

  await irPorDock(p, 'Venta');
  await p.waitForSelector('[data-guide="venta-agregar"]', { timeout: 30000 });

  // ------------------------------------------------- 1. entrada de efectivo
  const esperadoAntes = await sql(app.base, `
    SELECT CAST(ISNULL(SUM(CASE WHEN typee <> 'OPENING' THEN amount ELSE 0 END),0) AS FLOAT) AS neto
      FROM dbo.cash_movements WHERE closure_id = (SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC);`);
  await expect(p.locator('[data-guide="venta-entrada"]'), 'el atajo F4 se ve en la barra').toContainText('Entrada de efectivo');
  await p.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await p.keyboard.press('F4');
  const modal = p.locator('app-entrada-efectivo .modal-content');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.salida-tipo.activa')).toContainText('Cambio para la caja');
  await modal.locator('input[name="monto"]').fill('250');
  await modal.locator('textarea[name="nota"]').fill('Monedas del banco');
  await p.screenshot({ path: path.join(SHOTS, '1-entrada.png') });
  await modal.locator('[data-guide="entrada-registrar"]').click();
  await expect(p.locator('.swal2-popup')).toContainText('Entrada registrada');
  await p.locator('.swal2-confirm').click();
  await p.locator('.swal2-container').waitFor({ state: 'detached' }).catch(() => {});

  const mov = await sql(app.base, `SELECT TOP 1 typee, CAST(amount AS FLOAT) AS amount, note FROM dbo.cash_movements ORDER BY id DESC;`);
  expect(mov[0]).toMatchObject({ typee: 'DEPOSIT', amount: 250, note: 'Cambio para la caja · Monedas del banco' });
  const esperadoDespues = await sql(app.base, `
    SELECT CAST(ISNULL(SUM(CASE WHEN typee <> 'OPENING' THEN amount ELSE 0 END),0) AS FLOAT) AS neto
      FROM dbo.cash_movements WHERE closure_id = (SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC);`);
  expect(esperadoDespues[0].neto - esperadoAntes[0].neto, 'el efectivo esperado sube 250').toBe(250);

  /* El corte la muestra en «Otras entradas de efectivo». */
  const cid = (await sql(app.base, `SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC;`))[0].id;
  const movs = await app.invocar('getCashMovements', { closure_id: cid }).catch(() => null);
  if (movs) {
    const texto = JSON.stringify(movs);
    expect(texto, 'el corte trae el grupo ENTRADAS').toContain('ENTRADAS');
  }

  // ------------------------------------------------- 2. quitar al bajar de 1
  await p.locator('[data-guide="venta-agregar"]').click();
  await p.locator('[data-guide="venta-buscar"]').fill(PROD);
  await p.locator(`[data-guide="venta-producto"][data-guide-clave="REF-${n}"]`).click();
  const linea = p.locator(`[data-guide="venta-linea"][data-guide-clave="${prodId}"]`);
  await expect(linea).toBeVisible();
  await p.keyboard.press('Escape').catch(() => {});
  await p.locator('.swal2-container').waitFor({ state: 'detached' }).catch(() => {});
  if (await p.locator('[data-guide="venta-buscar"]').isVisible().catch(() => false)) await p.keyboard.press('Escape');
  await p.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});

  /* Esc: pregunta y no quita. */
  await p.keyboard.press('-');
  await expect(p.locator('.swal2-popup')).toContainText('¿Quitar de la venta?');
  await expect(p.locator('.swal2-confirm'), 'el foco empieza en «Quitar»').toBeFocused();
  await p.keyboard.press('ArrowRight');
  await expect(p.locator('.swal2-cancel'), '→ pasa a «Cancelar»').toBeFocused();
  await p.keyboard.press('ArrowLeft');
  await expect(p.locator('.swal2-confirm'), '← vuelve a «Quitar»').toBeFocused();
  await p.screenshot({ path: path.join(SHOTS, '2-pregunta.png') });
  await p.keyboard.press('Escape');
  await p.locator('.swal2-container').waitFor({ state: 'detached' });
  await expect(linea, 'cancelar lo deja en la venta').toBeVisible();
  await expect(linea.locator('input[type="number"]').first()).toHaveValue('1');

  /* Cancelar con flechas + Enter tampoco quita. */
  await p.keyboard.press('-');
  await expect(p.locator('.swal2-popup')).toBeVisible();
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('Enter');
  await p.locator('.swal2-container').waitFor({ state: 'detached' });
  await expect(linea).toBeVisible();

  /* Enter sobre «Quitar»: se va. */
  await p.keyboard.press('-');
  await expect(p.locator('.swal2-popup')).toBeVisible();
  await p.keyboard.press('Enter');
  await p.locator('.swal2-container').waitFor({ state: 'detached' });
  await expect(linea, 'Enter lo quita de la venta').toHaveCount(0);
  await p.screenshot({ path: path.join(SHOTS, '3-quitado.png') });
});

/* Tras escanear un código de barras, buscar a mano por No. de parte decía
   «No encontrado»: la caja se quedaba creyendo que todo venía del escáner. */
test('Buscar por código: escanear y luego teclear el No. de parte', async ({ app }) => {
  test.setTimeout(180000);
  const p = app.ventana;
  const n = Date.now().toString().slice(-6);
  await sql(app.base, `
    DECLARE @b INT = (SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id);
    DECLARE @c INT = (SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id);
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, category_id, brand_id, cost, bar_code)
    VALUES (N'B${n}', N'Galletas E2E ${n}', 18, 50, 1, @c, @b, 10, N'750${n}123'),
           (N'${n.slice(-4)}', N'Jabón E2E ${n}', 25, 50, 1, @c, @b, 15, NULL);`);

  await login(app, CUENTAS.admin);
  const userId = (await app.invocar('sesion')).data.userId;
  await app.invocar('openShift', { user_id: userId, opening_cash: 500 });
  await irPorDock(p, 'Venta');
  await p.waitForSelector('[data-guide="venta-agregar"]', { timeout: 30000 });
  await p.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  const lineas = p.locator('[data-guide="venta-linea"]');
  const antes = await lineas.count();

  /* 1. «Escáner»: teclas pegadas y Enter. */
  await p.keyboard.type(`750${n}123`, { delay: 5 });
  await p.keyboard.press('Enter');
  await expect(lineas).toHaveCount(antes + 1);
  await expect(p.locator('[data-guide="venta-linea"]', { hasText: `Galletas E2E ${n}` })).toBeVisible();

  /* 2. A mano, despacio: el No. de parte de 4 dígitos. */
  await p.waitForTimeout(800);
  await p.keyboard.type(n.slice(-4), { delay: 150 });
  await p.keyboard.press('Enter');
  await expect(p.locator('.swal2-popup', { hasText: 'No encontrado' }), 'no debe decir «No encontrado»').toHaveCount(0, { timeout: 2000 });
  await expect(p.locator('[data-guide="venta-linea"]', { hasText: `Jabón E2E ${n}` })).toBeVisible();

  /* 3. Un producto dado de alta con la caja abierta también se encuentra. */
  await sql(app.base, `
    DECLARE @b INT = (SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id);
    DECLARE @c INT = (SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id);
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, category_id, brand_id, cost, bar_code)
    VALUES (N'N${n}', N'Nuevo E2E ${n}', 30, 5, 1, @c, @b, 20, N'780${n}999');`);
  await p.waitForTimeout(800);
  await p.keyboard.type(`780${n}999`, { delay: 5 });
  await p.keyboard.press('Enter');
  await expect(p.locator('[data-guide="venta-linea"]', { hasText: `Nuevo E2E ${n}` })).toBeVisible({ timeout: 10000 });
});

/* Venta anterior: después de cobrar, la columna izquierda muestra total, cómo pagó y el cambio. */
test('Venta anterior: total, pago y cambio en la columna izquierda', async ({ app }) => {
  test.setTimeout(180000);
  const p = app.ventana;
  const n = Date.now().toString().slice(-6);
  const ids = await sql(app.base, `
    DECLARE @b INT = (SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id);
    DECLARE @c INT = (SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id);
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, category_id, brand_id, cost, bar_code)
    VALUES (N'VA${n}', N'Leche E2E ${n}', 138.5, 50, 1, @c, @b, 100, NULL);
    SELECT id FROM dbo.products WHERE part_number = N'VA${n}';`);
  const prodId = ids[0].id;

  await login(app, CUENTAS.admin);
  const userId = (await app.invocar('sesion')).data.userId;
  await app.invocar('openShift', { user_id: userId, opening_cash: 500 });
  await irPorDock(p, 'Venta');
  await p.waitForSelector('[data-guide="venta-agregar"]', { timeout: 30000 });
  await expect(p.locator('[data-guide="venta-anterior"]'), 'sin ventas todavía no aparece').toHaveCount(0);

  await p.locator('[data-guide="venta-agregar"]').click();
  await p.locator('[data-guide="venta-buscar"]').fill(`Leche E2E ${n}`);
  await p.locator(`[data-guide="venta-producto"][data-guide-clave="VA${n}"]`).click();
  await expect(p.locator(`[data-guide="venta-linea"][data-guide-clave="${prodId}"]`)).toBeVisible();
  if (await p.locator('[data-guide="venta-buscar"]').isVisible().catch(() => false)) await p.keyboard.press('Escape');

  await p.locator('[data-guide="venta-cobrar"]').click();
  await p.waitForSelector('.modal-cobro', { state: 'visible', timeout: 20000 });
  await p.fill('.modal-cobro input[name="dineroRecibido"]', '200');
  await p.locator('[data-guide="venta-confirmar-cobro"]').click();

  const tarjeta = p.locator('[data-guide="venta-anterior"]');
  await expect(tarjeta).toBeVisible({ timeout: 30000 });
  await expect(tarjeta).toContainText('$138.50');
  await expect(tarjeta).toContainText('$200.00 · Efectivo');
  await expect(p.locator('[data-guide="venta-anterior-cambio"]')).toHaveText('$61.50');
  for (let i = 0; i < 3 && await p.locator('.modal.show, .swal2-popup').count(); i++) await p.keyboard.press('Escape');
  fs.mkdirSync(SHOTS, { recursive: true });
  await p.screenshot({ path: path.join(SHOTS, '4-venta-anterior.png') });
});

/* Devolución solo con teclado: flechas, Enter y Esc, sin que el carrito de abajo se mueva. */
test('Devolución con flechas en Retail', async ({ app }) => {
  test.setTimeout(240000);
  const p = app.ventana;
  const n = Date.now().toString().slice(-6);
  const ids = await sql(app.base, `
    DECLARE @b INT = (SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id);
    DECLARE @c INT = (SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id);
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, category_id, brand_id, cost, bar_code)
    VALUES (N'DV${n}', N'Taza E2E ${n}', 80, 20, 1, @c, @b, 40, NULL);
    SELECT id FROM dbo.products WHERE part_number = N'DV${n}';`);
  const prodId = ids[0].id;

  await login(app, CUENTAS.admin);
  const userId = (await app.invocar('sesion')).data.userId;
  await app.invocar('openShift', { user_id: userId, opening_cash: 500 });
  await irPorDock(p, 'Venta');
  await p.waitForSelector('[data-guide="venta-agregar"]', { timeout: 30000 });

  /* Una venta de hoy para devolver. */
  await p.locator('[data-guide="venta-agregar"]').click();
  await p.locator('[data-guide="venta-buscar"]').fill(`Taza E2E ${n}`);
  await p.locator(`[data-guide="venta-producto"][data-guide-clave="DV${n}"]`).click();
  await expect(p.locator(`[data-guide="venta-linea"][data-guide-clave="${prodId}"]`)).toBeVisible();
  if (await p.locator('[data-guide="venta-buscar"]').isVisible().catch(() => false)) await p.keyboard.press('Escape');
  await p.locator('[data-guide="venta-cobrar"]').click();
  await p.waitForSelector('.modal-cobro', { state: 'visible', timeout: 20000 });
  await p.fill('.modal-cobro input[name="dineroRecibido"]', '100');
  await p.locator('[data-guide="venta-confirmar-cobro"]').click();
  await expect(p.locator('[data-guide="venta-anterior"]')).toBeVisible({ timeout: 30000 });
  const saleId = Number((await sql(app.base, `SELECT MAX(id) AS v FROM dbo.sales;`))[0].v);
  for (let i = 0; i < 3 && await p.locator('.modal.show, .swal2-popup').count(); i++) await p.keyboard.press('Escape');

  /* Dejar algo en el carrito: Supr no debe tocarlo mientras se devuelve. */
  await p.locator('[data-guide="venta-agregar"]').click();
  await p.locator('[data-guide="venta-buscar"]').fill(`Taza E2E ${n}`);
  await p.locator(`[data-guide="venta-producto"][data-guide-clave="DV${n}"]`).click();
  if (await p.locator('[data-guide="venta-buscar"]').isVisible().catch(() => false)) await p.keyboard.press('Escape');
  const lineaCarrito = p.locator(`[data-guide="venta-linea"][data-guide-clave="${prodId}"]`);
  await expect(lineaCarrito).toBeVisible();

  await p.locator('[data-guide="venta-devolucion"]').click();
  const hoja = p.locator('[data-guide="touch-devolucion-hoja"]');
  await expect(hoja).toBeVisible();
  const enfocado = () => p.evaluate(() => {
    const a = document.activeElement;
    return a ? (a.getAttribute('data-guide') || '') + '|' + (a.getAttribute('data-guide-clave') || '') + '|' + ((a.getAttribute('aria-label') || '') + ' ' + (a.textContent || '')).trim().slice(0, 50) : '';
  });
  /* Pulsa ↓ hasta que el foco cumpla la condición. */
  const bajarHasta = async (cumple, max = 25) => {
    for (let i = 0; i < max; i++) { const f = await enfocado(); if (cumple(f)) return; await p.keyboard.press('ArrowDown'); }
    throw new Error('no se llegó con ↓; foco en: ' + await enfocado());
  };

  await expect.poll(enfocado, { message: 'abre con el foco en el folio' }).toContain('touch-devolucion-folio');
  await p.keyboard.press('Delete');
  await expect(lineaCarrito, 'Supr no borra el carrito de abajo').toBeVisible();
  await bajarHasta((f) => f.startsWith(`touch-devolucion-venta|${saleId}|`));
  await p.keyboard.press('Enter');
  await expect(hoja).toContainText(`#${saleId}`);

  await expect.poll(enfocado, { message: 'paso 2 empieza en el «+» de lo que devuelve' }).toContain(`Más Taza E2E ${n}`);
  const qty = hoja.locator('[data-guide="touch-devolucion-renglon"] .tp-hoja__qty span').first();
  await p.keyboard.press('Enter');
  await expect(qty, 'Enter sobre «+» suma uno').toHaveText('1');

  /* ↓ llega a la fila de motivos; ← → recorren la fila. */
  const motivosTxt = await hoja.locator('[data-guide="touch-devolucion-motivo"] [role="radio"]').allTextContents();
  await bajarHasta((f) => motivosTxt.some((m) => f.endsWith(m.trim())));
  for (let i = 0; i < 8 && !/Mal estado/.test(await enfocado()); i++) await p.keyboard.press('ArrowLeft');
  for (let i = 0; i < 8 && !/Mal estado/.test(await enfocado()); i++) await p.keyboard.press('ArrowRight');
  expect(await enfocado()).toContain('Mal estado');
  await p.keyboard.press('Enter');
  await bajarHasta((f) => /Otra venta/.test(f));
  await p.keyboard.press('ArrowRight');
  await expect.poll(enfocado, { message: '→ pasa a confirmar' }).toContain('touch-devolucion-confirmar');
  await p.keyboard.press('Enter');
  await expect(hoja).toContainText('Devolución registrada', { timeout: 30000 });
  await expect.poll(enfocado, { message: 'al terminar, el foco en «Listo»' }).toContain('touch-devolucion-listo');
  const [d] = await sql(app.base, `SELECT reason, CAST(refund_total AS FLOAT) AS t FROM dbo.sale_refunds WHERE sale_id = ${saleId};`);
  expect(d).toMatchObject({ reason: 'Mal estado', t: 80 });
  await p.keyboard.press('Enter');
  await expect(hoja).toHaveCount(0);
  await expect(lineaCarrito, 'el carrito sigue igual').toBeVisible();

  /* Esc también cierra. */
  await p.locator('[data-guide="venta-devolucion"]').click();
  await expect(hoja).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(hoja).toHaveCount(0);
});
