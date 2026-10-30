/**
 * Una navegacion y una caja, en la app de verdad.
 *
 *   1. Con Asistencia activada, Checar abre desde el dock Y desde la barra
 *      lateral, el mismo dialogo.
 *   2. Apps Wybix: el Administrador la ve (dock y barra); el Operador no.
 *   3. Retail ofrece la devolucion directa, como Touch.
 *
 * Complementa scripts/pruebas/paridad-ui.mjs (el contrato en el codigo).
 *
 *     npm run e2e:paridad
 */
const { test, expect, CUENTAS, BASE_CORE, irPorDock } = require('./fixtures');

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
async function aBarra(p) {
  if (await p.locator('.wxside').isVisible().catch(() => false)) return;
  await p.click('.wxmodo.es-dock');
  await p.waitForSelector('.wxside', { timeout: 5000 });
}
async function aDock(p) {
  if (await p.locator('.wxdock').isVisible().catch(() => false)) return;
  await p.click('.wxmodo.es-sidebar');
  await p.waitForSelector('.wxdock', { timeout: 5000 });
}

test.afterEach(async () => {
  await sql(BASE_CORE, `EXEC dbo.sp_set_business_module @module_key = N'asistencia', @enabled = 0;`).catch(() => {});
});

test('Dock y barra ofrecen lo mismo; Apps solo para el Administrador; devolución en Retail', async ({ app }) => {
  test.setTimeout(180000);
  const p = app.ventana;
  await sql(app.base, `EXEC dbo.sp_asistencia_reglas_guardar @cuenta_extra=1, @tolerancia=1, @descanso_pagado=0,
    @dia_libre_extra=1, @marca_retardos=1, @entrada_para_vender=0, @activar=1;`);

  // ------------------------------------------------- administrador
  await login(app, CUENTAS.admin);
  await aDock(p);
  await expect(p.locator('.wxdock [data-guide="nav-apps"]')).toBeVisible();
  await p.locator('.wxdock [data-guide="nav-checar"]').click();
  await expect(p.locator('[data-guide="asistencia-checar"]')).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(p.locator('[data-guide="asistencia-checar"]')).toBeHidden();

  await aBarra(p);
  await expect(p.locator('.wxside [data-guide="nav-apps"]')).toBeVisible();
  await expect(p.locator('.wxside [data-guide="crear"]')).toBeVisible();
  await expect(p.locator('.wxside [data-guide="aprobaciones"]')).toBeVisible();
  await p.locator('.wxside [data-guide="nav-checar"]').click();
  await expect(p.locator('[data-guide="asistencia-checar"]')).toBeVisible();
  await p.keyboard.press('Escape');
  await aDock(p);
  await salir(app);

  // ------------------------------------------------------ operador
  await login(app, CUENTAS.operador);
  const aviso = p.getByRole('button', { name: 'Salir', exact: true });
  /* El Operador entra a Venta y, sin turno, le aparece el aviso de abrirlo: se
     espera a que salga y se cierra, o se va a Inicio si no sale. */
  if (await aviso.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)) await aviso.click();
  await expect(p.locator('.modal.show')).toHaveCount(0);
  await aDock(p);
  await expect(p.locator('.wxdock [data-guide="nav-checar"]')).toBeVisible();
  await expect(p.locator('.wxdock [data-guide="nav-apps"]')).toHaveCount(0);
  await aBarra(p);
  await expect(p.locator('.wxside [data-guide="nav-checar"]')).toBeVisible();
  await expect(p.locator('.wxside [data-guide="nav-apps"]')).toHaveCount(0);
  await aDock(p);

  /* Retail: la devolucion directa abre el mismo dialogo que en Touch. */
  /* Un turno de la caja a nombre del Operador (el de otra prueba se cierra en
     esta base desechable): sin turno, Venta solo ofrece abrirlo. */
  await sql(app.base, 'UPDATE dbo.cash_closures SET closed_at = SYSDATETIME() WHERE closed_at IS NULL;');
  const op = (await app.invocar('sesion')).data.userId;
  const turno = await app.invocar('openShift', { user_id: op, opening_cash: 0 });
  expect(turno?.success, JSON.stringify(turno)).toBeTruthy();
  await irPorDock(p, 'Venta', 'Nueva venta');
  await expect(p.locator('[data-caja="devolucion"]')).toBeVisible({ timeout: 20000 });
  await p.locator('[data-caja="devolucion"]').click();
  await expect(p.locator('app-devolucion-touch')).toBeVisible();
});
