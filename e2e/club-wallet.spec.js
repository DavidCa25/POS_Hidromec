/**
 * TARJETA DEL CLUB EN WALLET (0066), EN LA APP DE VERDAD.
 *
 *     npx playwright test e2e/club-wallet.spec.js
 *
 *   1. Un pase ya conocido por esta caja (llegó por club_pull, se simula con
 *      sp_club_wallet_apply): el escáner teclea `WXC-<serial>` en Venta y el
 *      cliente queda asignado. El guion NO resta una pieza.
 *   2. El mismo código en el buscador de clientes también lo asigna.
 *   3. Un código que esta caja no conoce, sin nube: aviso claro, sin cliente.
 *   4. «Tarjeta en Wallet» sin nube activa: el diálogo lo dice, no inventa
 *      un QR. (La emisión con nube se prueba en wybix-owner.)
 *
 * Supone una base recién preparada (npm run e2e:preparar).
 */
const { test, expect, CUENTAS, BASE_CORE, irPorDock } = require('./fixtures');

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

/** Lo que hace un escáner de teclado: teclas seguidas, muy rápido, y Enter. */
async function escanear(p, codigo) {
  await p.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await p.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
  await p.keyboard.type(codigo, { delay: 8 });
  await p.keyboard.press('Enter');
}

test('Tarjeta del Club en Wallet: el escáner identifica al cliente en Venta', async ({ app }) => {
  test.setTimeout(240000);
  const p = app.ventana;
  await entrar(app, CUENTAS.admin);
  expect((await app.invocar('modulosSet', 'loyalty', true))?.success ?? true).toBeTruthy();
  await sql(`IF NOT EXISTS (SELECT 1 FROM dbo.business_config) INSERT INTO dbo.business_config (business_name) VALUES (N'Negocio E2E');
             UPDATE dbo.business_config SET loyalty_enabled = 1;
             UPDATE dbo.loyalty_points_config SET enabled = 1, per_amount = 10, points_per = 1;`);

  const n = Date.now().toString().slice(-6);
  const nombre = `Cliente wallet ${n}`;
  const serial = (n + 'abcdef0123456789abcdef').slice(0, 24);
  expect((await app.invocar('createCustomer', `WL${n}`, nombre, null, null, `477 700 ${n.slice(0, 4)}`, 0, 0, true, null, null, null, 0, 0, 0, null))?.success ?? true).toBeTruthy();
  const cliente = filas(await app.invocar('getCustomers')).find(c => c.customerName === nombre);
  expect(cliente, 'cliente creado').toBeTruthy();
  /* Lo que haría club_pull con un pase emitido en otra sucursal. */
  await sql(`EXEC dbo.sp_club_wallet_apply @payload = N'[{"serial":"${serial}","phone":"477700${n.slice(0, 4)}","customer_name":"${nombre}"}]';`);

  await irPorDock(p, 'Venta');
  await p.waitForSelector('.pos-wrap');
  const turno = p.locator('.open-shift-modal');
  try { await turno.waitFor({ state: 'visible', timeout: 5000 }); } catch { /* ya había turno */ }
  if (await turno.count()) {
    await turno.locator('input[type=number]').fill('100');
    await turno.getByRole('button', { name: /Abrir turno/ }).click();
    await p.locator('.swal2-popup').getByRole('button', { name: 'OK', exact: true }).click();
  }
  const caja = p.locator('.wx-panel-tenue', { hasText: 'Cliente asignado' });

  // ------------------------------------------------ 1. escáner en Venta
  await escanear(p, `WXC-${serial.toUpperCase()}`);
  await expect(caja).toContainText(nombre, { timeout: 15000 });
  await expect(p.locator('[data-guide=puntos-tarjeta]')).toContainText('0 puntos');
  await expect(p.locator('.swal2-popup')).toHaveCount(0);
  await captura(p, 'wallet-escaneo-venta');

  // ------------------------------------------------ 2. buscador de clientes
  await caja.getByRole('button', { name: /Buscar|Cambiar/ }).first().click();
  const buscar = p.locator('[data-guide=venta-buscar-cliente]');
  await buscar.fill(`WXC-${serial}`);
  await buscar.press('Enter');
  await expect(p.locator('.modal-productos', { hasText: 'Seleccionar cliente' })).toHaveCount(0);
  await expect(caja).toContainText(nombre);

  // ------------------------------------------------ 3. código desconocido, sin nube
  await escanear(p, `WXC-${'f'.repeat(24)}`);
  const aviso = p.locator('.swal2-popup');
  await expect(aviso).toContainText('Tarjeta del Club');
  await expect(aviso).toContainText(/no es de este negocio|no está en esta caja/);
  await captura(p, 'wallet-codigo-desconocido');
  await aviso.getByRole('button').first().click();
  await expect(caja).toContainText(nombre);

  // ------------------------------------------------ 4. emitir sin nube
  await p.locator('[data-guide=club-wallet]').first().click();
  const dlg = p.locator('[data-guide=club-wallet-dialogo]');
  await expect(dlg.getByRole('alert')).toContainText('nube', { timeout: 15000 });
  await expect(dlg.locator('[data-guide=club-wallet-qr]')).toHaveCount(0);
  await captura(p, 'wallet-sin-nube');
  await dlg.getByRole('button', { name: 'Listo' }).click();
  await expect(dlg).toHaveCount(0);
});
