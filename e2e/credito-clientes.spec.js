/**
 * CREDITO DE CLIENTES, DE PUNTA A PUNTA.
 *
 *     npx playwright test e2e/credito-clientes.spec.js
 *
 * Lo que estaba roto y ya no puede volver:
 *
 *   - El saldo, las vencidas y las cifras de Clientes salian SIEMPRE en 0:
 *     la pantalla leia columnas que la tabla no tiene. Por eso existian
 *     «Saldo (demo)» y «# vencidos (demo)», que se editaban a mano y no se
 *     guardaban. Ahora los calcula la base desde las ventas.
 *   - El alta perdia los dias de gracia, la mora y el riesgo.
 *   - Nada impedia fiar de mas: ni el limite, ni las vencidas, ni el riesgo
 *     se comprobaban al vender. Ahora lo hace sp_register_sale.
 *   - Una venta a CREDITO sin cliente se registraba como PAGADA.
 *   - Sin fecha, la venta no vencia nunca: ahora vence a los dias de plazo.
 *   - El abono quedaba a nombre del usuario 1, cobrara quien cobrara.
 */
const { test, expect, CUENTAS } = require('./fixtures');
const { BASE_CORE } = require('./perfil');

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

const filas = (r) => Array.isArray(r) ? r : (Array.isArray(r?.recordset) ? r.recordset : (r?.data ?? []));
const hoyMas = (dias) => {
  const d = new Date(); d.setDate(d.getDate() + dias);
  const z = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

test.describe('Crédito de clientes', () => {

  test('el alta guarda todo, la base calcula la deuda y la venta a crédito respeta las reglas', async ({ app }) => {
    test.setTimeout(240000);
    const { ventana } = app;
    const s = Date.now().toString().slice(-6);
    const nombre = `Cliente crédito ${s}`;
    await entrar(app, CUENTAS.admin);

    /* Turno y un producto de $100 sin inventario. */
    const yo = (await app.invocar('sesion')).data.userId;
    const t = await app.invocar('openShift', { user_id: yo, opening_cash: 500 });
    expect(t?.success || /ya existe un turno/i.test(String(t?.error ?? '')), JSON.stringify(t)).toBeTruthy();
    let cats = filas(await app.invocar('getCategories'));
    if (!cats.length) { await app.invocar('createCategory', { nombre: `Cat ${s}` }); cats = filas(await app.invocar('getCategories')); }
    let marcas = filas(await app.invocar('getBrands'));
    if (!marcas.length) { await app.invocar('createBrand', { nombre: `Marca ${s}` }); marcas = filas(await app.invocar('getBrands')); }
    const idDe = (x) => Number(x?.id ?? x?.category_id ?? x?.brand_id);
    await app.invocar('agregarProducto', idDe(marcas[0]), idDe(cats[0]), `CRE-${s}`, `Servicio ${s}`, 100, 0,
      null, null, '02', 0.16, null, { inventory_mode: 'NONE', sellable: 1, base_uom: 'pza' });
    const prod = filas(await app.invocar('getActiveProducts')).find(p => p.part_number === `CRE-${s}`);
    expect(prod).toBeTruthy();
    const linea = (qty) => [{ productId: Number(prod.id ?? prod.product_id), qty, unitPrice: 100 }];

    // ------------------------------------------------ el alta, por la pantalla
    await ventana.locator('.wxdock a', { hasText: 'Clientes' }).click();
    await ventana.locator('button', { hasText: '+ Nuevo cliente' }).click();
    const dlg = ventana.locator('.cli-dlg');
    await dlg.locator('#cli-nombre').fill(nombre);
    const cab = dlg.locator('.cli-sec__cab', { hasText: 'Crédito' });
    if ((await cab.getAttribute('aria-expanded')) !== 'true') await cab.click();
    await expect(dlg, 'ya no hay campos «demo»').not.toContainText('demo');
    await dlg.locator('#cli-limite').fill('300');
    await dlg.locator('#cli-plazo').fill('15');
    await dlg.locator('#cli-gracia').fill('2');
    await dlg.locator('#cli-interes').fill('3');
    await dlg.locator('#cli-recargo').fill('50');
    await dlg.locator('.cli-dlg__pie .btn-primary').click();
    await expect(dlg).toHaveCount(0, { timeout: 15000 });

    const leer = async () => filas(await app.invocar('getCustomers')).find(c => c.customerName === nombre);
    let c = await leer();
    expect(c, 'el cliente existe').toBeTruthy();
    expect({ gracia: c.grace_days, interes: Number(c.late_fee_pct), recargo: Number(c.late_fee_fixed) },
      'el alta guarda gracia y mora (antes se perdian)').toEqual({ gracia: 2, interes: 3, recargo: 50 });
    expect(Number(c.balance), 'sin ventas no debe nada').toBe(0);
    expect(Number(c.available_credit)).toBe(300);

    // --------------------------------------------------- vender a credito
    const vender = (qty, extra = {}) => app.invocar('registerSale', {
      userId: yo, paymentMethod: 'CREDITO', lines: linea(qty), customerId: c.id, dueDate: null, ...extra,
    });

    const sinCliente = await app.invocar('registerSale', { userId: yo, paymentMethod: 'CREDITO', lines: linea(1), customerId: null });
    expect(sinCliente?.success, 'a credito sin cliente no se registra como pagada').toBeFalsy();
    expect(String(sinCliente?.error)).toMatch(/necesita el cliente/i);

    const v1 = await vender(1);
    expect(v1?.success, JSON.stringify(v1)).toBeTruthy();
    let abiertas = filas(await app.invocar('getCustomerOpenSales', c.id));
    expect(String(abiertas[0].due_date).slice(0, 10) >= hoyMas(14), 'sin fecha, vence a los 15 dias de plazo').toBe(true);

    const deMas = await vender(3);
    expect(deMas?.success, 'no se fia de mas').toBeFalsy();
    expect(String(deMas?.error)).toMatch(/supera el credito disponible/i);

    /* Una venta que vencio hace 10 dias: con 2 de gracia, 8 de atraso. */
    const v2 = await vender(1, { dueDate: hoyMas(-10) });
    expect(v2?.success, JSON.stringify(v2)).toBeTruthy();

    c = await leer();
    expect(Number(c.balance), 'la deuda sale de las ventas').toBe(200);
    expect(Number(c.available_credit)).toBe(100);
    expect(c.overdueCount, 'una vencida').toBe(1);
    expect(Number(c.overdue_balance)).toBe(100);
    expect(c.max_days_late, 'vencimiento + gracia').toBe(8);
    expect(Number(c.late_fee_estimate), 'recargo 50 + 100 * 3% * 8/30').toBeCloseTo(50.8, 2);
    expect(c.credit_block).toBe('VENCIDAS');

    const conVencidas = await vender(1);
    expect(conVencidas?.success, 'con vencidas no se le fia').toBeFalsy();
    expect(String(conVencidas?.error)).toMatch(/vencidas/i);

    abiertas = filas(await app.invocar('getCustomerOpenSales', c.id));
    expect(abiertas[0].days_late, 'lo mas vencido primero').toBe(8);
    expect(Number(abiertas[0].late_fee_estimate)).toBeCloseTo(50.8, 2);

    /* En caja, el cliente sale desactivado con su motivo. */
    const enCaja = filas(await app.invocar('getCreditCustomers')).find(x => x.id === c.id);
    expect(enCaja?.credit_block).toBe('VENCIDAS');

    // ------------------------------------------------ la pantalla, con cifras
    /* Salir y volver: la pantalla relee de la base. */
    await ventana.locator('.wxdock a', { hasText: 'Inicio' }).click();
    await ventana.locator('.wxdock a', { hasText: 'Clientes' }).click();
    const fila = ventana.locator('tbody tr', { hasText: nombre });
    await expect(fila, 'la lista ya no dice 0').toContainText('200.00');
    await expect(fila).toContainText('Vencido');
    await fila.locator('button', { hasText: 'Editar' }).click();
    const cred = dlg.locator('.cli-sec__cab', { hasText: 'Crédito' });
    if ((await cred.getAttribute('aria-expanded')) !== 'true') await cred.click();
    const cuenta = dlg.locator('.cli-cuenta');
    await expect(cuenta).toContainText('$200.00');
    await expect(cuenta).toContainText('8 días de atraso');
    await expect(cuenta).toContainText('$50.80');
    await expect(dlg.locator('.cli-aviso'), 'dice por que no se le fia').toContainText('ventas vencidas');
    if (process.env.WYBIX_CAPTURAS) {
      await ventana.waitForTimeout(350);
      require('node:fs').mkdirSync(process.env.WYBIX_CAPTURAS, { recursive: true });
      await ventana.screenshot({ path: require('node:path').join(process.env.WYBIX_CAPTURAS, 'cliente-estado-de-cuenta.png') });
    }
    await ventana.click('.cli-dlg__x');

    // ------------------------------------ el abono, a nombre de quien cobra
    await salir(ventana);
    await entrar(app, CUENTAS.encargado);
    const encargado = (await app.invocar('sesion')).data.userId;
    const vencida = abiertas[0];
    /* La pantalla mandaba `1`: aunque llegue un usuario ajeno, manda la sesion. */
    const ab = await app.invocar('registerCustomerPayment', c.id, vencida.id, 100, 999999, 'EFECTIVO', 'Abono prueba');
    expect(ab?.success, JSON.stringify(ab)).toBeTruthy();
    const { consultar } = await import('../scripts/db/lib/sql.mjs');
    const pago = consultar(BASE_CORE, `SELECT TOP 1 user_id FROM dbo.customer_payments WHERE sale_id = ${Number(vencida.id)} ORDER BY id DESC`);
    expect(Number(pago[0]?.user_id), 'el abono es de quien tiene la sesion').toBe(Number(encargado));

    c = await leer();
    expect(c.overdueCount, 'pagada la vencida, ya no hay vencidas').toBe(0);
    expect(c.credit_block ?? null, 'y se le vuelve a fiar').toBeNull();
  });
});
