/**
 * Avisos por WhatsApp (0068), lo que se puede ver sin la nube.
 *
 * Los avisos los manda la nube y su configuracion vive alli. Una caja sin
 * vincular (como la de estas pruebas y la del demo) no puede configurarlos, y
 * el panel lo tiene que DECIR, no mostrar interruptores que no guardan nada.
 *
 * Conectar el numero, guardar que avisar y enviar de verdad necesita la caja
 * vinculada y Meta (docs/whatsapp-avisos.md): eso lo prueban las pruebas de la
 * nube (wybix-owner) y test:whatsapp.
 *
 *     npm run e2e:whatsapp
 */
const { test, expect, CUENTAS, irPorMas } = require('./fixtures');

async function login(app, c) {
  const p = app.ventana;
  await p.fill('#username', c.usuario);
  await p.fill('#password', c.password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }).toBe(c.usuario);
}

test('WhatsApp sin nube: el panel dice por qué no se puede configurar', async ({ app }) => {
  test.setTimeout(120000);
  const p = app.ventana;
  await login(app, CUENTAS.admin);
  await irPorMas(p, 'Configuración');
  await p.waitForSelector('.cs-tile', { timeout: 30000 });
  await p.locator('.cs-tile').filter({ hasText: 'Avisos por WhatsApp' }).click();
  const panel = p.getByRole('dialog').filter({ hasText: 'Avisos por WhatsApp' });
  await expect(panel.getByRole('status')).toContainText('no está vinculada con Wybix en la nube');
  await expect(panel.locator('[data-guide="wa-cuenta"]')).toHaveCount(0);
  await expect(panel.locator('[data-guide="wa-guardar"]')).toHaveCount(0);
  const cfg = await app.invocar('whatsappConfig');
  expect(cfg?.success).toBe(true);
});
