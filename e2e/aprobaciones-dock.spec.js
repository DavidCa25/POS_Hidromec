/**
 * Aprobaciones desde el dock (Más > Aprobaciones).
 *
 *   1. El Administrador las ve encendidas (Wybix sin addon) y las apaga:
 *      pide confirmar, queda en business_modules y en la bitácora.
 *   2. Un Operador no ve el interruptor, no puede cambiarlo por su canal, y
 *      con las aprobaciones apagadas hace un retiro sin PIN.
 *   3. Encendidas otra vez, el mismo retiro vuelve a pedir autorización.
 *
 * Supone una base recién preparada (npm run e2e:preparar).
 */
const path = require('node:path');
const { test, expect, CUENTAS } = require('./fixtures');

async function login(app, c) {
  const p = app.ventana;
  await p.fill('#username', c.usuario);
  await p.fill('#password', c.password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }).toBe(c.usuario);
}

async function salir(app) {
  const p = app.ventana;
  /* Venta del Operador pide abrir turno al entrar (el turno se abrió por canal,
     no por esa pantalla): su «Salir» cierra el aviso. */
  const aviso = p.getByRole('button', { name: 'Salir', exact: true });
  if (await aviso.isVisible().catch(() => false)) await aviso.click();
  if (await p.locator('#username').isVisible().catch(() => false)) return;
  await p.locator('.wx-yo__btn').click();
  await p.locator('.wx-yo__fila').filter({ hasText: 'Cerrar sesión' }).click();
  await p.waitForSelector('#username');
}

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

test('Aprobaciones: el encargado las apaga desde el dock y el operador deja de necesitarlas', async ({ app }) => {
  test.setTimeout(180000);
  const p = app.ventana;

  /* Un turno abierto con efectivo, del Operador. */
  await login(app, CUENTAS.operador);
  const op = (await app.invocar('sesion')).data.userId;
  const turno = await app.invocar('openShift', { user_id: op, opening_cash: 1000 });
  expect(turno?.success || /ya existe un turno/i.test(String(turno?.error ?? '')), JSON.stringify(turno)).toBeTruthy();
  /* Con aprobaciones, el puente pide autorización (PIN o app del dueño) y la
     llamada espera. Se cancela ese pedido: la respuesta dice que faltó. */
  const retiroPideAutorizacion = async () => {
    await p.evaluate(() => { (window).__r = null; (window).electronAPI.registerCashMovement({ amount: 50, note: 'E2E retiro' }).then((r) => { (window).__r = r; }); });
    const pide = p.locator('.swal2-popup');
    const pidio = await pide.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    if (pidio) {
      await p.locator('.swal2-cancel').click();
      await p.locator('.swal2-container').waitFor({ state: 'detached', timeout: 10000 });
    }
    await expect.poll(() => p.evaluate(() => (window).__r)).not.toBeNull();
    return { pidio, r: await p.evaluate(() => (window).__r) };
  };
  const antes = await retiroPideAutorizacion();
  expect(antes.pidio, 'con aprobaciones, el retiro pide autorización').toBe(true);
  expect(antes.r?.success).toBeFalsy();
  await salir(app);

  /* 1. El Administrador las apaga desde Más. */
  await login(app, CUENTAS.admin);
  await p.locator('.wxdock__btn--mas').click();
  const panel = p.locator('[data-guide="aprobaciones"]');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-guide-estado', 'activas');
  await panel.locator('[role="switch"]').click();
  await expect(panel.locator('.wxdock-aprob__confirma')).toBeVisible();     // apagar pide confirmar
  await p.screenshot({ path: path.join(__dirname, '..', 'tmp', 'aprobaciones-dock.png') });
  await panel.locator('button', { hasText: 'Sí, apagar' }).click();
  await expect(panel).toHaveAttribute('data-guide-estado', 'apagadas');
  const fila = (await sql(app.base, "SELECT enabled FROM dbo.business_modules WHERE module_key = N'APROBACIONES'"))[0];
  expect(fila?.enabled === false || fila?.enabled === 0).toBe(true);
  const ev = await sql(app.base, "SELECT COUNT(*) n FROM dbo.security_events WHERE event_type = N'APPROVALS_DISABLED'");
  expect(Number(ev[0].n)).toBe(1);
  await salir(app);

  /* 2. El Operador: sin interruptor, sin canal, y retira sin PIN. */
  await login(app, CUENTAS.operador);
  await p.locator('.wxdock__btn--mas').click().catch(() => {});
  await expect(p.locator('[data-guide="aprobaciones"]')).toHaveCount(0);
  const intento = await app.invocar('aprobacionesCambiar', true);
  expect(intento?.success).toBeFalsy();
  const sinPin = await retiroPideAutorizacion();
  expect(sinPin.pidio, 'sin aprobaciones no se pide nada').toBe(false);
  expect(sinPin.r?.success, JSON.stringify(sinPin.r)).toBe(true);
  await salir(app);

  /* 3. Encendidas de nuevo, el retiro vuelve a pedir autorización. */
  await login(app, CUENTAS.encargado);
  const on = await app.invocar('aprobacionesCambiar', true);
  expect(on?.success && on.data.activas, JSON.stringify(on)).toBe(true);
  await salir(app);
  await login(app, CUENTAS.operador);
  const otra = await retiroPideAutorizacion();
  expect(otra.pidio, 'encendidas otra vez, pide autorización').toBe(true);
});
