/**
 * Contraseña olvidada con el PIN propio, y la hora de la base en pantalla.
 *
 *   1. Un administrador le asigna PIN al Operador.
 *   2. En el inicio de sesión, «¿Olvidaste tu contraseña?»: con un PIN que no
 *      es el suyo no cambia nada (y no dice si el usuario existe); con el suyo
 *      cambia, y la contraseña nueva entra. Al final se deja como estaba.
 *   3. Hora de la base (horario-local): el chip del turno en Venta ensena la
 *      hora de apertura de la caja, no seis horas menos.
 *
 *     npm run e2e:contrasena
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-contrasena');

async function login(app, c, password = c.password) {
  const p = app.ventana;
  await p.fill('#username', c.usuario);
  await p.fill('#password', password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }).toBe(c.usuario);
}

async function salir(app) {
  const p = app.ventana;
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

async function cambiar(p, usuario, pin, nueva) {
  await p.locator('[data-guide="login-olvide"]').click();
  const f = p.locator('[data-guide="login-recuperar"]');
  await f.locator('input[name="r-usuario"]').fill(usuario);
  await f.locator('input[name="r-pin"]').fill(pin);
  await f.locator('input[name="r-nueva"]').fill(nueva);
  await f.locator('input[name="r-confirmar"]').fill(nueva);
  await f.locator('#btnRecuperar').click();
}

test('Contraseña olvidada: solo con el PIN propio', async ({ app }) => {
  test.setTimeout(180000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  const op = CUENTAS.operador;

  await login(app, CUENTAS.admin);
  const opId = (await sql(app.base, `SELECT id FROM dbo.users WHERE usuario = N'${op.usuario}';`))[0].id;
  const fijo = await app.invocar('usersSetPin', { id: opId, pin: '2468' });
  expect(fijo).toMatchObject({ success: true });
  await sql(app.base, 'UPDATE dbo.trabajadores_acceso SET pin_fallos = 0, bloqueado_hasta = NULL;');
  /* La base se reutiliza: se cuentan los eventos NUEVOS de esta corrida. */
  const eventos = async () => (await sql(app.base, `SELECT COUNT(*) AS n FROM dbo.security_events WHERE event_type = N'CONTRASENA_CON_PIN' AND user_id = ${opId};`))[0].n;
  const antes = await eventos();
  await salir(app);

  /* PIN equivocado: no cambia, y el mensaje es el mismo que para un usuario que no existe. */
  await cambiar(p, op.usuario, '1357', 'nueva-clave-1');
  await expect(p.locator('.error-message')).toContainText('Usuario o PIN incorrectos.');
  await p.locator('.link-btn', { hasText: 'Volver' }).click();
  await cambiar(p, 'no-existe-nadie', '2468', 'nueva-clave-1');
  await expect(p.locator('.error-message')).toContainText('Usuario o PIN incorrectos.');
  await p.screenshot({ path: path.join(SHOTS, '1-pin-equivocado.png') });
  await p.locator('.link-btn', { hasText: 'Volver' }).click();

  /* Las dos contraseñas tienen que coincidir. */
  await p.locator('[data-guide="login-olvide"]').click();
  const f = p.locator('[data-guide="login-recuperar"]');
  await f.locator('input[name="r-usuario"]').fill(op.usuario);
  await f.locator('input[name="r-pin"]').fill('2468');
  await f.locator('input[name="r-nueva"]').fill('nueva-clave-1');
  await f.locator('input[name="r-confirmar"]').fill('otra-cosa');
  await f.locator('#btnRecuperar').click();
  await expect(p.locator('.warning-message')).toContainText('no coinciden');
  await p.locator('.link-btn', { hasText: 'Volver' }).click();

  /* Con su PIN, cambia; y la nueva entra. */
  await cambiar(p, op.usuario, '2468', 'nueva-clave-1');
  await expect(p.locator('.swal2-popup')).toContainText('Contraseña cambiada');
  await p.locator('.swal2-container').waitFor({ state: 'detached' }).catch(() => {});
  await expect(p.locator('#btnLogin')).toBeVisible();
  await login(app, op, 'nueva-clave-1');
  expect(await eventos()).toBe(antes + 1);
  await salir(app);

  /* Se deja como estaba, por la misma via: las demas pruebas entran con la original. */
  await cambiar(p, op.usuario, '2468', op.password);
  await expect(p.locator('.swal2-popup')).toContainText('Contraseña cambiada');
  await p.locator('.swal2-container').waitFor({ state: 'detached' }).catch(() => {});
  await login(app, op);
});

test('La hora de la base: el turno se ve abierto a la hora de la caja', async ({ app }) => {
  test.setTimeout(180000);
  const p = app.ventana;
  await login(app, CUENTAS.operador);
  const op = (await app.invocar('sesion')).data.userId;
  const abierto = await app.invocar('openShift', { user_id: op, opening_cash: 500 });
  /* El turno es de la CAJA: si otra prueba ya lo abrio, vale ese; lo que se mide es su hora. */
  expect(abierto?.success || /ya existe un turno|turno abierto/i.test(String(abierto?.error ?? '')), JSON.stringify(abierto)).toBeTruthy();
  const enBase = (await sql(app.base, `SELECT TOP 1 CONVERT(CHAR(5), opened_at, 108) AS h FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC;`))[0].h;
  /* La app vive en file://: se vuelve a Venta por el router, no recargando. */
  await p.evaluate(() => { location.hash = '#/dashboard/inicio'; });
  await p.waitForTimeout(300);
  await p.evaluate(() => { location.hash = '#/dashboard/venta'; });
  await p.waitForSelector('.pos-shift-chip', { timeout: 30000 });
  await expect(p.locator('.pos-shift-chip')).toContainText(`${enBase} · Fondo`);
});
