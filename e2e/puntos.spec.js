/**
 * PUNTOS Y SELLOS (0064), DE PUNTA A PUNTA, EN LA APP DE VERDAD.
 *
 *     npx playwright test e2e/puntos.spec.js
 *
 *   1. Fidelización > Puntos: se enciende (1 punto por cada $10, 5 por
 *      visita), se crea una tarjeta de sellos y se le pone costo a una
 *      recompensa, todo desde la pantalla.
 *   2. Venta: una compra con cliente gana puntos y un sello.
 *   3. Venta: con la tarjeta del cliente se canjea la dona por puntos; el
 *      cobro enseña el canje y la venta queda en $0.
 *   4. Venta: tarjeta de sellos llena (ajuste con motivo) -> se canjea.
 *   5. Fidelización > Puntos: el cliente y su historial.
 *
 * Supone una base recién preparada (npm run e2e:preparar).
 */
const { test, expect, CUENTAS, BASE_CORE, irPorMas, irPorDock } = require('./fixtures');

const filas = (r) => (Array.isArray(r) ? r : (r?.data ?? r?.recordset ?? []));

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
  if (process.env.WYBIX_CAPTURAS) await p.screenshot({ path: require('node:path').join(process.env.WYBIX_CAPTURAS, nombre + '.png') });
}

async function cerrarAvisoDeVenta(p) {
  /* El aviso de la venta y lo ganado (puntos, sellos) salen uno tras otro. */
  for (let i = 0; i < 2; i++) {
    for (const b of [p.getByRole('button', { name: 'Nada más, cerrar' }), p.locator('app-premios-venta').getByRole('button', { name: 'Continuar' }).first()]) {
      try { await b.click({ timeout: 2500 }); } catch { /* no está */ }
    }
  }
  await expect(p.locator('app-premios-venta .pv-velo')).toHaveCount(0);
}

test('Puntos y sellos: configurar, ganar, canjear puntos y tarjeta, historial', async ({ app }) => {
  test.setTimeout(300000);
  const p = app.ventana;
  await entrar(app, CUENTAS.admin);
  expect((await app.invocar('modulosSet', 'loyalty', true))?.success ?? true).toBeTruthy();
  await sql(`IF NOT EXISTS (SELECT 1 FROM dbo.business_config) INSERT INTO dbo.business_config (business_name) VALUES (N'Negocio E2E');
             UPDATE dbo.business_config SET loyalty_enabled = 1;`);

  const n = Date.now().toString().slice(-6);
  const cafe = `Café pts ${n}`, dona = `Dona pts ${n}`, nombreCliente = `Cliente pts ${n}`;
  let cats = filas(await app.invocar('getCategories'));
  if (!cats.length) { await app.invocar('createCategory', { nombre: 'QA Puntos' }); cats = filas(await app.invocar('getCategories')); }
  let marcas = filas(await app.invocar('getBrands'));
  if (!marcas.length) { await app.invocar('createBrand', { nombre: 'QA Puntos' }); marcas = filas(await app.invocar('getBrands')); }
  for (const [sku, nombre, precio] of [[`PTC-${n}`, cafe, 45], [`PTD-${n}`, dona, 28]]) {
    const r = await app.invocar('agregarProducto', Number(marcas[0].id), Number(cats[0].id), sku, nombre, precio, 100,
      null, null, '02', 0.16, null, { inventory_mode: 'DIRECT', sellable: 1, base_uom: 'pza' });
    expect(r?.success ?? true, JSON.stringify(r)).toBeTruthy();
  }
  const productos = filas(await app.invocar('getActiveProducts'));
  const idDe = (nombre) => Number(productos.find(x => x.product_name === nombre)?.id);
  expect((await app.invocar('createCustomer', `PT${n}`, nombreCliente, null, null, `477 600 ${n}`, 0, 0, true, null, null, null, 0, 0, 0, null))?.success ?? true).toBeTruthy();
  const cliente = filas(await app.invocar('getCustomers')).find(c => c.customerName === nombreCliente);
  const premio = await p.evaluate((d) => window.wybix.loyalty.saveDefinition({ kindOf: 'REWARD', name: 'Dona por puntos ' + d.n, kind: 'FREE_PRODUCT', productId: d.dona }),
    { n, dona: idDe(dona) });
  expect(premio?.success, JSON.stringify(premio)).toBeTruthy();
  const premioId = Number((await sql(`SELECT TOP 1 id FROM dbo.reward_definitions WHERE name = N'Dona por puntos ${n}'`))[0].id);

  await p.evaluate(() => { location.hash = '#/dashboard/aplicaciones'; });
  await p.waitForTimeout(1500);

  // ------------------------------------------------ 1. configurar desde la pantalla
  await irPorMas(p, 'Fidelización');
  await p.locator('.loy-nav button', { hasText: 'Puntos' }).click();
  const cfg = p.locator('[data-guide=puntos-config]');
  await cfg.locator('input[name=pAct]').check();
  await cfg.locator('input[name=pPor]').fill('1');
  await cfg.locator('input[name=pCada]').fill('10');
  await cfg.locator('input[name=pVis]').fill('5');
  await expect(cfg).toContainText('una compra de $200 da 20 puntos');
  await cfg.getByRole('button', { name: /Guardar/ }).click();
  await expect.poll(async () => (await sql(`SELECT enabled FROM dbo.loyalty_points_config`))[0].enabled).toBeTruthy();

  await p.locator('[data-guide=sellos-nueva]').click();
  const tf = p.locator('[data-guide=sellos-form]');
  await tf.locator('input[name=tNom]').fill(`Café 3+1 ${n}`);
  await tf.locator('input[name=tSel]').fill('3');
  await tf.locator('wx-multi-select .wm-field').click();
  await p.locator('.wm-panel:popover-open input[type=search]').fill(cafe);
  await p.locator('.wm-panel:popover-open label', { hasText: cafe }).locator('input').check();
  await p.keyboard.press('Escape');
  await tf.getByRole('button', { name: /Guardar/ }).click();
  await expect(tf).toHaveCount(0);
  const cardId = Number((await sql(`SELECT id FROM dbo.loyalty_stamp_cards WHERE name = N'Café 3+1 ${n}'`))[0].id);

  const fila = p.locator(`[data-guide=puntos-recompensa][data-guide-clave="${premioId}"]`);
  await fila.locator('input').fill('10');
  await fila.getByRole('button', { name: 'Guardar' }).click();
  await expect.poll(async () => (await sql(`SELECT points_cost FROM dbo.reward_definitions WHERE id = ${premioId}`))[0].points_cost).toBe(10);
  await captura(p, 'puntos-admin-config');

  // ------------------------------------------------ 2. ganar en Venta
  await irPorDock(p, 'Venta');
  await p.waitForSelector('.pos-wrap');
  const turno = p.locator('.open-shift-modal');
  /* En una base limpia el turno se pide un momento después de abrir Venta. */
  try { await turno.waitFor({ state: 'visible', timeout: 5000 }); } catch { /* ya había turno */ }
  if (await turno.count()) {
    await turno.locator('input[type=number]').fill('100');
    await turno.getByRole('button', { name: /Abrir turno/ }).click();
    await p.locator('.swal2-popup').getByRole('button', { name: 'OK', exact: true }).click();
  }
  const caja = p.locator('.wx-panel-tenue', { hasText: 'Cliente asignado' });
  const elegirCliente = async () => {
    await caja.getByRole('button', { name: /Buscar|Cambiar/ }).first().click();
    await p.locator('.prod-pick-row', { hasText: nombreCliente }).click();
    await expect(caja).toContainText(nombreCliente);
  };
  const agregar = async (nombre) => {
    await p.getByRole('button', { name: /Agregar producto/ }).click();
    await p.locator('.modal-productos .prod-item').filter({ hasText: nombre }).click();
    await expect(p.locator('.modal-productos')).toHaveCount(0);
  };
  await elegirCliente();
  await agregar(cafe);
  await agregar(dona);
  await p.keyboard.press('F8');
  await expect(p.locator('.total-amount')).toContainText('73.00');
  await p.locator('[data-guide=venta-recibido]').fill('100');
  await p.locator('[data-guide=venta-confirmar-cobro]').click();
  await expect(p.locator('app-premios-venta')).toContainText('+12 puntos', { timeout: 30000 });
  await captura(p, 'puntos-ganados');
  await cerrarAvisoDeVenta(p);
  const saldo = async (programa, card = null) => Number((await sql(
    `SELECT ISNULL(SUM(delta), 0) s FROM dbo.loyalty_ledger WHERE customer_id = ${cliente.id} AND program = '${programa}'${card ? ` AND card_id = ${card}` : ''}`))[0].s);
  expect(await saldo('POINTS')).toBe(12);
  expect(await saldo('STAMPS', cardId)).toBe(1);

  // ------------------------------------------------ 3. canjear la dona con puntos
  await elegirCliente();
  const tarjeta = p.locator('[data-guide=puntos-tarjeta]');
  await expect(tarjeta).toContainText('12 puntos');
  await tarjeta.locator('[data-guide=puntos-canjear] .wx-menu__btn').click();
  await p.locator('.wx-opt', { hasText: `Dona por puntos ${n}` }).click();
  await expect(p.locator('[data-guide=venta-linea]', { hasText: dona })).toHaveCount(1);
  await expect(tarjeta.locator('[data-guide=puntos-aplicado]')).toContainText('−10 pts');
  await captura(p, 'puntos-canje-tarjeta');
  await p.keyboard.press('F8');
  await expect(p.locator('[data-guide=puntos-cobro]')).toContainText('28.00');
  await expect(p.locator('.total-amount')).toContainText('0.00');
  await captura(p, 'puntos-canje-cobro');
  await p.locator('[data-guide=venta-recibido]').fill('0');
  await p.locator('[data-guide=venta-confirmar-cobro]').click();
  await expect.poll(() => saldo('POINTS'), { timeout: 30000, message: 'el canje descontó 10 puntos' }).toBe(2);
  await cerrarAvisoDeVenta(p);

  // ------------------------------------------------ 4. tarjeta de sellos llena
  const aj = await p.evaluate((d) => window.electronAPI.puntosAjustar(d), { customerId: cliente.id, cantidad: 2, tarjetaId: cardId, nota: 'Tarjeta de papel' });
  expect(aj?.success, JSON.stringify(aj)).toBeTruthy();
  await elegirCliente();
  const sello = p.locator(`[data-guide=sellos-tarjeta]`, { hasText: `Café 3+1 ${n}` });
  await expect(sello).toContainText('3/3');
  await sello.locator('[data-guide=sellos-canjear]').click();
  await expect(p.locator('[data-guide=venta-linea]', { hasText: cafe })).toHaveCount(1);
  await expect(sello).toContainText('Tarjeta canjeada');
  await p.keyboard.press('F8');
  await expect(p.locator('[data-guide=sellos-cobro]')).toContainText('45.00');
  await p.locator('[data-guide=venta-recibido]').fill('0');
  await p.locator('[data-guide=venta-confirmar-cobro]').click();
  await expect.poll(() => saldo('STAMPS', cardId), { timeout: 30000, message: 'la tarjeta se vació' }).toBe(0);
  await cerrarAvisoDeVenta(p);

  // ------------------------------------------------ 5. administración
  await irPorMas(p, 'Fidelización');
  await p.locator('.loy-nav button', { hasText: 'Puntos' }).click();
  await p.locator('[data-guide=puntos-buscar]').fill(nombreCliente);
  await p.locator('[data-guide=puntos-buscar]').press('Enter');
  const fc = p.locator(`[data-guide=puntos-cliente][data-guide-clave="${cliente.id}"]`);
  await expect(fc).toContainText('2');
  await fc.getByRole('button', { name: 'Historial' }).click();
  await expect(p.locator('.pts-hist')).toContainText('Ajuste');
  await expect(p.locator('.pts-hist')).toContainText('Canje');
  await captura(p, 'puntos-admin-cliente');
});
