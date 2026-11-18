/**
 * Capturas reales de una frutería para el video de marketing (1920×1080).
 *
 *     npm run build && node e2e/preparar-bases.mjs core && npx playwright test e2e/marketing-fruteria.spec.js
 *
 * Base de prueba (nunca Wybix_POS) con el catálogo de scripts/giros/fruteria.mjs.
 * Deja las capturas en docs/marketing/wybix/capturas/fruteria/, tal cual salen
 * de la app, para docs/marketing/wybix/produccion/composiciones/fruteria/.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

const SALIDA = path.join(__dirname, '..', 'docs', 'marketing', 'wybix', 'capturas', 'fruteria');

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

async function login(app, c) {
  const p = app.ventana;
  await p.fill('#username', c.usuario);
  await p.fill('#password', c.password);
  await p.click('#btnLogin');
  await expect.poll(async () => { try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; } }, { timeout: 60000 })
    .toBe(c.usuario);
}

test('marketing · frutería: capturas reales para el video', async ({ app }) => {
  test.setTimeout(420000);
  fs.mkdirSync(SALIDA, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1920, height: 1080 });
  const { sqlSembrar } = await import('../scripts/giros/fruteria.mjs');
  await sql(app.base, sqlSembrar() + `
    UPDATE dbo.business_config SET business_name = N'Frutería La Huerta';
    UPDATE dbo.products SET price = 28 WHERE part_number = N'FRU-001';
    DELETE FROM dbo.asistente_mensajes;`);
  const foto = async (nombre) => { await p.waitForTimeout(700); await p.screenshot({ path: path.join(SALIDA, `${nombre}.png`) }); };

  await login(app, CUENTAS.admin);
  const yo = (await app.invocar('sesion')).data.userId;
  await app.invocar('openShift', { user_id: yo, opening_cash: 500, register_id: 1 });

  // --------------------------------------------------------------- Venta
  await irPorDock(p, 'Venta');
  await p.waitForSelector('.pos-wrap');
  const abrir = async () => {
    if (!(await p.locator('.modal-productos').count())) await p.getByRole('button', { name: /Agregar producto/ }).click();
    await p.locator('.modal-productos [data-guide=venta-producto]').first().waitFor({ timeout: 60000 });
  };
  await abrir();
  await p.locator('[data-guide=venta-buscar]').fill('chile');
  await expect(p.locator('.modal-productos [data-guide=venta-producto]').filter({ hasText: 'Chile guajillo' })).toBeVisible();
  await foto('venta-buscar-chile');
  const agregar = async (texto) => {
    await abrir();
    await p.locator('[data-guide=venta-buscar]').fill(texto);
    await p.locator('.modal-productos [data-guide=venta-producto]').filter({ hasText: texto }).first().click();
  };
  await agregar('Jitomate saladet');
  await p.locator('[data-guide=granel-cantidad-kg]').fill('1.25');
  await expect(p.locator('.granel__cobro')).toContainText('$35.00');
  await foto('granel-jitomate');
  await p.locator('[data-guide=granel-agregar]').click();
  await agregar('Limón c/semilla');
  await p.locator('[data-guide=granel-importe]').fill('20');
  await expect(p.locator('.granel__cobro')).toContainText('$20.00');
  await foto('granel-limon');
  await p.locator('[data-guide=granel-agregar]').click();
  await agregar('Aguacate hass');
  await p.locator('.granel__rapido', { hasText: '½' }).click();
  await agregar('Cilantro manojo');
  await expect(p.locator('[data-guide=venta-linea]')).toHaveCount(4);
  await p.waitForTimeout(600);
  await foto('venta-cuenta');

  // ----------------------------------------------------------- asistente
  await p.click('[data-guide=wybix-guide]');
  await expect(p.locator('[data-guide=wybix-chat]')).toBeVisible();
  const campo = p.locator('[data-guide=wybix-campo]');
  await campo.fill('cambia el precio del jitomate saladet a 26');
  await campo.press('Enter');
  const plan = p.locator('[data-guide=wybix-plan]').last();
  await expect(plan).toContainText('$28.00', { timeout: 20000 });
  await foto('asistente-plan');
  await plan.locator('[data-guide=wybix-confirmar]').click();
  await expect(plan).toHaveAttribute('data-guide-estado', 'hecho', { timeout: 20000 });
  await foto('asistente-hecho');
  await expect.poll(async () => Number((await sql(app.base, `SELECT price FROM dbo.products WHERE part_number = N'FRU-001'`))[0].price)).toBe(26);
  await p.keyboard.press('Escape');

  // ---------------------------------------------------------------- Touch
  await app.invocar('modulosSet', 'hospitality', true);
  await app.invocar('setDeviceConfig', { deviceProfile: 'TOUCH_POS' });
  await p.locator('.wx-yo__btn').click();
  await p.locator('.wx-yo__fila').filter({ hasText: 'Cerrar sesión' }).click();
  await p.waitForSelector('#username');
  await login(app, CUENTAS.admin);
  await p.waitForSelector('app-touch-pos .tp-card', { timeout: 60000 });
  const turno = p.getByRole('dialog').filter({ has: p.getByRole('heading', { name: 'Abrir turno', exact: true }) });
  if (await turno.count()) await turno.getByRole('button', { name: 'Abrir turno', exact: true }).click();
  for (const [cat, nombre] of [['Frutas', 'touch-frutas'], ['Verduras', 'touch-verduras'], ['Chiles secos', 'touch-chiles-secos']]) {
    await p.getByRole('button', { name: cat }).first().click();
    await p.locator('[data-guide=touch-producto]').first().waitFor();
    await p.waitForTimeout(500);
    await foto(nombre);
  }
  await app.invocar('setDeviceConfig', { deviceProfile: 'RETAIL_POS' }).catch(() => {});
  console.log('capturas en', SALIDA, fs.readdirSync(SALIDA).join(', '));
});
