/**
 * TOUCH COBRA CON TARJETA Y CON TRANSFERENCIA.
 *
 *     npx playwright test e2e/touch-cobro.spec.js
 *
 * Touch mandaba `received: null` fuera de efectivo, y `SaleService.validate`
 * -el mismo que usa Retail- lo rechazaba: «El dinero recibido debe ser mayor
 * o igual al total de la venta». El aviso se iba solo y la pantalla se quedaba
 * en Cobrar: en Touch solo se podia cobrar en efectivo.
 *
 * Se corrige en Touch y no en `validate`: Retail pasa por la misma regla con
 * tarjeta y el cajero escribe el importe; relajarla le dejaria cobrar una
 * tarjeta con «pagado $0» en el ticket.
 */
const { test, expect, CUENTAS } = require('./fixtures');

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

const filasDe = (r) => Array.isArray(r) ? r
  : (Array.isArray(r?.recordset) ? r.recordset : (Array.isArray(r?.data) ? r.data : []));

const ventas = async (app) => (await app.invocar('getSales')).data ?? [];

test.describe('Touch · cobro fuera de efectivo', () => {

  test('cobra con tarjeta y con transferencia, y el efectivo sigue pidiendo que alcance', async ({ app }) => {
    test.setTimeout(180000);
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);

    /* Un producto propio de esta corrida, con existencia de sobra. */
    const s = Date.now().toString().slice(-6);
    const nombre = `Galleta Touch ${s}`;
    const cats = filasDe(await app.invocar('getCategories'));
    const marcas = filasDe(await app.invocar('getBrands'));
    const idDe = (x) => Number(x?.id ?? x?.category_id ?? x?.brand_id);
    const alta = await app.invocar('agregarProducto',
      idDe(marcas[0]), idDe(cats[0]), `TCH-${s}`, nombre, 40, 50,
      null, null, '02', 0.16, null, null);
    expect(alta?.success ?? true, JSON.stringify(alta)).toBeTruthy();

    const userId = (await app.invocar('sesion')).data.userId;
    const abierto = await app.invocar('openShift', { user_id: userId, opening_cash: 1000 });
    expect(abierto?.success || /ya existe un turno/i.test(String(abierto?.error ?? '')),
      `no hay turno para cobrar: ${JSON.stringify(abierto)}`).toBeTruthy();

    /* La caja pasa a Touch y se vuelve a entrar: el login lleva a cada caja
       a su pantalla de venta. */
    await app.invocar('setDeviceConfig', { deviceProfile: 'TOUCH_POS' });
    await ventana.click('.wx-yo__btn');
    await ventana.click('.wx-yo__fila:has-text("Cerrar sesión")');
    await entrar(app, CUENTAS.admin);
    await ventana.waitForSelector('app-touch-pos .tp-card', { timeout: 60000 });

    const tarjetaProducto = ventana.locator('.tp-card', { hasText: nombre });
    await expect(tarjetaProducto, 'el producto está en Touch').toHaveCount(1);

    // ------------------------------------------ efectivo: la regla sigue en pie
    await tarjetaProducto.click();
    await ventana.click('.tp-cart__foot .tp-primaria');
    await expect(ventana.locator('.tp-cobro__confirmar'),
      'en efectivo, sin dinero recibido, no se puede confirmar').toBeDisabled();

    for (const [boton, metodo] of [['Tarjeta', 'TARJETA'], ['Transferencia', 'TRANSFERENCIA']]) {
      const antes = await ventas(app);

      /* La primera vuelta ya tiene la galleta en la cuenta; la segunda la
         vuelve a agregar tras cobrar la anterior. */
      if (!(await ventana.locator('.tp-cobro__confirmar').count())) {
        await tarjetaProducto.click();
        await ventana.click('.tp-cart__foot .tp-primaria');
      }
      await ventana.click(`.tp-metodo:has-text("${boton}")`);
      await expect(ventana.locator('.tp-cobro__confirmar'), `con ${boton} se puede confirmar`).toBeEnabled();
      await ventana.click('.tp-cobro__confirmar');

      await expect.poll(async () => (await ventas(app)).length,
        { timeout: 30000, message: `Touch no cobró con ${boton}` }).toBe(antes.length + 1);

      const nueva = (await ventas(app))[0];
      expect(String(nueva.payment_method), `la venta queda registrada como ${metodo}`).toBe(metodo);
      expect(Number(nueva.total), 'por el total de la cuenta').toBe(40);
      await expect(ventana.locator('.tp-cobro__confirmar'), 'y Touch vuelve al menú').toHaveCount(0);
    }
  });
});
