/**
 * A DONDE SE ENTRA.
 *
 *     npx playwright test e2e/arranque.spec.js
 *
 * En QA, abrir Wybix e iniciar sesion llevaba a Estadisticas. No habia
 * ninguna ruta guardada: `login.ts` mandaba ahi en duro a todo el que puede
 * ver los numeros. La ruta vacia del dashboard ya redirigia a Inicio, pero
 * el login nunca pasaba por ella.
 *
 * La regla: Inicio es el destino por defecto. Quien no puede ver los numeros
 * sigue entrando directo a su caja, como antes.
 */
const { test, expect, CUENTAS, irPorMas } = require('./fixtures');

async function entrar(app, cuenta) {
  const { ventana } = app;
  await ventana.waitForSelector('#username', { timeout: 60000 });
  await ventana.fill('#username', cuenta.usuario);
  await ventana.fill('#password', cuenta.password);
  await ventana.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario ?? null; } catch { return null; }
  }, { timeout: 30000 }).toBe(cuenta.usuario);
}

async function salir(ventana) {
  await ventana.click('.wx-yo__btn');
  await ventana.click('.wx-yo__fila:has-text("Cerrar sesión")');
  await ventana.waitForSelector('#username', { timeout: 30000 });
}

test.describe('Arranque · la pantalla inicial es Inicio', () => {

  test('entrar lleva a Inicio, y volver a entrar también', async ({ app }) => {
    const { ventana } = app;

    await entrar(app, CUENTAS.admin);
    await expect(ventana.locator('app-inicio'), 'al entrar se llega a Inicio').toBeVisible({ timeout: 30000 });
    await expect(ventana.locator('app-estadisticas'), 'y no a Estadísticas').toHaveCount(0);

    /* La última pantalla no manda: quien sale desde Estadísticas vuelve a
       entrar por Inicio. */
    await irPorMas(ventana, 'Estadisticas');
    await ventana.waitForSelector('app-estadisticas', { timeout: 30000 });

    await salir(ventana);
    await expect(ventana.locator('#username'), 'cerrar sesión lleva al acceso').toBeVisible();

    await entrar(app, CUENTAS.admin);
    await expect(ventana.locator('app-inicio'), 'volver a entrar lleva a Inicio, no a donde se salió')
      .toBeVisible({ timeout: 30000 });
    await expect(ventana.locator('app-estadisticas')).toHaveCount(0);
  });

  test('quien no ve los números sigue entrando directo a su caja', async ({ app }) => {
    const { ventana } = app;
    await entrar(app, CUENTAS.operador);
    await expect(ventana.locator('app-venta'), 'el Operador abre en la venta').toBeVisible({ timeout: 30000 });
    await expect(ventana.locator('app-inicio')).toHaveCount(0);
  });
});
