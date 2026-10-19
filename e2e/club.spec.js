/**
 * CLUB (0063), DE PUNTA A PUNTA, EN LA APP DE VERDAD.
 *
 *     npx playwright test e2e/club.spec.js
 *
 *   1. Fidelización > Club: se crea el plan desde la pantalla.
 *   2. Venta: se afilia a un cliente cobrando la membresía.
 *   3. Venta: se le da el café de hoy; el cobro enseña el descuento y la
 *      venta queda en $0 con su canje.
 *   4. Touch: el mismo cliente sale con «Ya usó su beneficio de hoy».
 *   5. Touch: vencida (se fuerza en SQL), «Renovar y dar café» en una sola
 *      venta con tarjeta: paga el periodo y canjea.
 *   6. Fidelización > Club: el socio aparece activo y los indicadores cuentan.
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

/** Con WYBIX_CAPTURAS=<carpeta>, guarda la pantalla en ese punto. */
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

test('Club: plan, afiliar, café del día, ya usó, renovar vencida y administración', async ({ app }) => {
  test.setTimeout(300000);
  const p = app.ventana;
  await entrar(app, CUENTAS.admin);

  /* Fidelización encendida para el negocio. */
  const mod = await app.invocar('modulosSet', 'loyalty', true);
  expect(mod?.success ?? true, JSON.stringify(mod)).toBeTruthy();

  /* Productos de esta corrida: el café que se regala y la membresía (servicio). */
  const n = Date.now().toString().slice(-6);
  const cafe = `Café club ${n}`, memb = `Membresía club ${n}`, nombreCliente = `Socia club ${n}`;
  let cats = filas(await app.invocar('getCategories'));
  if (!cats.length) { await app.invocar('createCategory', { nombre: 'QA Club' }); cats = filas(await app.invocar('getCategories')); }
  let marcas = filas(await app.invocar('getBrands'));
  if (!marcas.length) { await app.invocar('createBrand', { nombre: 'QA Club' }); marcas = filas(await app.invocar('getBrands')); }
  for (const [sku, nombre, precio, modo] of [[`CLC-${n}`, cafe, 45, 'DIRECT'], [`CLM-${n}`, memb, 299, 'NONE']]) {
    const r = await app.invocar('agregarProducto', Number(marcas[0].id), Number(cats[0].id), sku, nombre, precio, 100,
      null, null, '02', 0.16, null, { inventory_mode: modo, sellable: 1, base_uom: 'pza' });
    expect(r?.success ?? true, JSON.stringify(r)).toBeTruthy();
  }
  const cli = await app.invocar('createCustomer', `CL${n}`, nombreCliente, null, null, `477 555 ${n.slice(0, 2)} ${n.slice(2)}`,
    0, 0, true, null, null, null, 0, 0, 0, null);
  expect(cli?.success ?? true, JSON.stringify(cli)).toBeTruthy();
  const cliente = filas(await app.invocar('getCustomers')).find(c => c.customerName === nombreCliente);
  expect(cliente, 'el cliente existe').toBeTruthy();

  /* Aplicaciones relee los módulos: así el menú ve Fidelización encendida. */
  await p.evaluate(() => { location.hash = '#/dashboard/aplicaciones'; });
  await p.waitForTimeout(1500);

  // ------------------------------------------------ 1. plan desde la pantalla
  await irPorMas(p, 'Fidelización');
  await p.locator('.loy-nav button', { hasText: 'Club' }).click();
  await p.locator('[data-guide=club-nuevo-plan]').click();
  const form = p.locator('[data-guide=club-plan-form]');
  await form.locator('input[name=cNom]').fill(`Club QA ${n}`);
  await form.locator('wx-select').first().getByRole('combobox').click();
  await p.getByRole('option', { name: new RegExp(memb) }).click();
  await form.locator('wx-multi-select .wm-field').click();
  await p.locator('.wm-panel:popover-open input[type=search]').fill(cafe);
  await p.locator('.wm-panel:popover-open label', { hasText: cafe }).locator('input').check();
  await p.keyboard.press('Escape');
  await form.getByRole('button', { name: /Guardar/ }).click();
  await expect(form).toHaveCount(0);
  await expect(p.locator('[data-guide=club-admin] tr', { hasText: `Club QA ${n}` })).toContainText(memb);

  // ------------------------------------------------ 2. afiliar en Venta
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
  const elegirClienteVenta = async () => {
    await p.locator('.wx-panel-tenue', { hasText: 'Cliente asignado' }).getByRole('button', { name: /Buscar|Cambiar/ }).first().click();
    await p.locator('.prod-pick-row', { hasText: nombreCliente }).click();
    await expect(p.locator('.wx-panel-tenue', { hasText: 'Cliente asignado' })).toContainText(nombreCliente);
  };
  await elegirClienteVenta();
  const tarjeta = p.locator('app-club-cliente');
  /* Un plan: botón directo. Varios (corridas anteriores en la misma base): menú. */
  const directo = tarjeta.locator('[data-guide=club-afiliar]');
  const menuPlanes = tarjeta.locator('.club--vacio wx-menu');
  await expect(directo.or(menuPlanes).first()).toBeVisible();
  if (await directo.count()) await directo.click();
  else {
    await menuPlanes.locator('.wx-menu__btn').click();
    await p.locator('.wx-opt', { hasText: `Club QA ${n}` }).click();
  }
  await expect(p.locator('[data-guide=venta-linea]', { hasText: memb })).toHaveCount(1);
  await p.keyboard.press('F8');
  await expect(p.locator('.total-amount')).toContainText('299.00');
  await p.locator('[data-guide=venta-recibido]').fill('300');
  await p.locator('[data-guide=venta-confirmar-cobro]').click();
  await expect.poll(async () => (await sql(
    `SELECT COUNT(*) n FROM dbo.customer_memberships WHERE customer_id = ${cliente.id} AND status = 'ACTIVE' AND paid_until >= CAST(GETDATE() AS DATE)`))[0].n,
    { timeout: 30000, message: 'la venta afilió a la clienta' }).toBe(1);
  await cerrarAvisoDeVenta(p);

  // ------------------------------------------------ 3. café del día en Venta
  await elegirClienteVenta();
  await expect(tarjeta.locator('[data-guide=club-tarjeta]')).toHaveAttribute('data-guide-estado', 'ACTIVA');
  await tarjeta.locator('[data-guide=club-dar]').click();
  await expect(p.locator('[data-guide=venta-linea]', { hasText: cafe })).toHaveCount(1);
  await expect(tarjeta).toContainText('En el ticket');
  await captura(p, 'club-venta-tarjeta');
  await p.keyboard.press('F8');
  await expect(p.locator('[data-guide=club-cobro]')).toContainText('45.00');
  await expect(p.locator('.total-amount')).toContainText('0.00');
  await captura(p, 'club-venta-cobro');
  await p.locator('[data-guide=venta-recibido]').fill('0');
  await p.locator('[data-guide=venta-confirmar-cobro]').click();
  await expect.poll(async () => (await sql(
    `SELECT COUNT(*) n FROM dbo.membership_redemptions r JOIN dbo.customer_memberships m ON m.id = r.membership_id
      WHERE m.customer_id = ${cliente.id} AND r.voided_at IS NULL AND r.redeem_date = CAST(GETDATE() AS DATE)`))[0].n,
    { timeout: 30000, message: 'el café quedó canjeado' }).toBe(1);
  await cerrarAvisoDeVenta(p);

  /* Administración: la socia sale activa, con su café del mes. */
  await irPorMas(p, 'Fidelización');
  await p.locator('.loy-nav button', { hasText: 'Club' }).click();
  await expect(p.locator('[data-guide=club-socio]', { hasText: nombreCliente })).toHaveAttribute('data-guide-estado', 'ACTIVA');
  await captura(p, 'club-admin');

  // ------------------------------------------------ 4. Touch: ya usó
  await app.invocar('setDeviceConfig', { deviceProfile: 'TOUCH_POS' });
  await p.click('.wx-yo__btn');
  await p.click('.wx-yo__fila:has-text("Cerrar sesión")');
  await entrar(app, CUENTAS.admin);
  await p.waitForSelector('app-touch-pos .tp-card', { timeout: 60000 });
  const elegirClienteTouch = async () => {
    await p.click('[data-guide=touch-cliente]');
    await p.click(`[data-cliente="${cliente.id}"]`);
    await expect(p.locator('.tp-cliente__nombre')).toContainText(nombreCliente);
  };
  await elegirClienteTouch();
  await expect(p.locator('app-club-cliente')).toContainText('Ya usó su beneficio de hoy');
  await captura(p, 'club-touch-ya-uso');

  // ------------------------------------------------ 5. Touch: vencida y renovar
  await sql(`UPDATE r SET voided_at = SYSDATETIME() FROM dbo.membership_redemptions r JOIN dbo.customer_memberships m ON m.id = r.membership_id WHERE m.customer_id = ${cliente.id};
             UPDATE dbo.customer_memberships SET paid_until = DATEADD(DAY, -20, CAST(GETDATE() AS DATE)) WHERE customer_id = ${cliente.id};`);
  await p.click('[data-guide=touch-cliente]');
  await p.getByRole('button', { name: 'Quitar cliente' }).click().catch(() => p.keyboard.press('Escape'));
  await elegirClienteTouch();
  const tt = p.locator('app-club-cliente');
  await expect(tt.locator('[data-guide=club-tarjeta]')).toHaveAttribute('data-guide-estado', 'VENCIDA');
  await captura(p, 'club-touch-vencida');
  await tt.locator('[data-guide=club-renovar]').click();
  await expect(tt).toContainText('En el ticket');
  await p.click('.tp-cart__foot .tp-primaria');
  await expect(p.locator('[data-guide=club-cobro]')).toContainText('45.00');
  await captura(p, 'club-touch-cobro');
  await p.click('.tp-metodo:has-text("Tarjeta")');
  await p.click('.tp-cobro__confirmar');
  await expect.poll(async () => (await sql(
    `SELECT CASE WHEN paid_until >= CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END ok,
            (SELECT COUNT(*) FROM dbo.membership_redemptions r WHERE r.membership_id = m.id AND r.voided_at IS NULL) canjes,
            (SELECT COUNT(*) FROM dbo.membership_payments x WHERE x.membership_id = m.id AND x.voided_at IS NULL) pagos
       FROM dbo.customer_memberships m WHERE customer_id = ${cliente.id}`))[0],
    { timeout: 30000, message: 'renovó y canjeó en la misma venta' }).toEqual({ ok: 1, canjes: 1, pagos: 2 });

  // ------------------------------------------------ 6. administración
  await app.invocar('setDeviceConfig', { deviceProfile: 'RETAIL_POS' });
  const adm = await app.invocar('clubAdmin', { buscar: n.slice(2) });
  expect(adm?.success, JSON.stringify(adm)).toBeTruthy();
  expect(adm.data.socios.map(s => s.cliente), 'la búsqueda por teléfono con espacios la encuentra').toContain(nombreCliente);
  expect(Number(adm.data.resumen.pagos_mes)).toBeGreaterThanOrEqual(2);
});
