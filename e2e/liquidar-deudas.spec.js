/**
 * LIQUIDAR DEUDAS CON UN ABONO, DE PUNTA A PUNTA.
 *
 *     npm run e2e:liquidar
 *
 * Electron, IPC y SQL de verdad, con clics en Clientes › Abonar:
 *
 *   · el modal abre en «Liquidar deudas» con las notas, lo más vencido arriba;
 *   · al escribir el monto, la vista previa dice qué nota se liquida, cuál queda
 *     con faltante y cuánto debe después;
 *   · más de lo que debe no deja confirmar;
 *   · confirmar guarda en la base exactamente lo que se vio;
 *   · el aviso de éxito sale en la esquina, con Wybix Guide, sin velo;
 *   · «Toda la deuda» liquida el resto;
 *   · «A una venta» abona solo a la nota elegida.
 *
 * Las notas: $500 vencida, $300, $100 y $24.70 (con centavos). Debe $924.70.
 */
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

const filas = (r) => Array.isArray(r) ? r : (Array.isArray(r?.recordset) ? r.recordset : (r?.data ?? []));
const hoyMas = (dias) => {
  const d = new Date(); d.setDate(d.getDate() + dias);
  const z = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

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

test.describe('Liquidar deudas', () => {
  test('un abono liquida las notas que alcanza, la siguiente queda con faltante, y la base guarda lo que se vio', async ({ app }) => {
    test.setTimeout(240000);
    const { ventana } = app;
    const s = Date.now().toString().slice(-6);
    await entrar(app, CUENTAS.admin);

    // ------------------------------------------------------------ escenario
    const yo = (await app.invocar('sesion')).data.userId;
    const t = await app.invocar('openShift', { user_id: yo, opening_cash: 500 });
    expect(t?.success || /ya existe un turno/i.test(String(t?.error ?? '')), JSON.stringify(t)).toBeTruthy();
    let cats = filas(await app.invocar('getCategories'));
    if (!cats.length) { await app.invocar('createCategory', { nombre: `Cat ${s}` }); cats = filas(await app.invocar('getCategories')); }
    let marcas = filas(await app.invocar('getBrands'));
    if (!marcas.length) { await app.invocar('createBrand', { nombre: `Marca ${s}` }); marcas = filas(await app.invocar('getBrands')); }
    const idDe = (x) => Number(x?.id ?? x?.category_id ?? x?.brand_id);
    const producto = async (clave, precio) => {
      await app.invocar('agregarProducto', idDe(marcas[0]), idDe(cats[0]), clave, `Servicio ${clave}`, precio, 0,
        null, null, '02', 0.16, null, { inventory_mode: 'NONE', sellable: 1, base_uom: 'pza' });
      const p = filas(await app.invocar('getActiveProducts')).find((x) => x.part_number === clave);
      expect(p, clave).toBeTruthy();
      return { id: Number(p.id ?? p.product_id), precio };
    };
    const cien = await producto(`LIQ-${s}-100`, 100);
    const centavos = await producto(`LIQ-${s}-1235`, 12.35);

    const nombre = `Cliente liquidar ${s}`;
    const alta = await app.invocar('createCustomer', `LIQ${s}`, nombre, null, null, null, 5000, 15, 1, null, null, null, 0, 0, 0, 0);
    expect(alta?.success ?? true, JSON.stringify(alta)).toBeTruthy();
    const cliente = filas(await app.invocar('getCustomers')).find((c) => c.customerName === nombre);
    expect(cliente, 'el cliente existe').toBeTruthy();

    const vender = async (p, qty, dueDate) => {
      const v = await app.invocar('registerSale', {
        userId: yo, paymentMethod: 'CREDITO', customerId: cliente.id, dueDate,
        lines: [{ productId: p.id, qty, unitPrice: p.precio }],
      });
      expect(v?.success, JSON.stringify(v)).toBeTruthy();
    };
    /* La vencida al final: con una vencida la caja ya no le fía otra. */
    await vender(cien, 3, hoyMas(5));       // $300
    await vender(cien, 1, hoyMas(20));      // $100
    await vender(centavos, 2, hoyMas(30));  // $24.70
    await vender(cien, 5, hoyMas(-10));     // $500, vencida

    const abiertas = async () => filas(await app.invocar('getCustomerOpenSales', cliente.id))
      .map((x) => ({ id: x.id, saldo: Math.round(Number(x.balance) * 100) }));
    const inicio = await abiertas();
    expect(inicio.map((x) => x.saldo), 'lo más vencido primero').toEqual([50000, 30000, 10000, 2470]);

    // ------------------------------------------------------------ el modal
    await irPorDock(ventana, 'Inicio');
    await ventana.locator('.wxdock a', { hasText: 'Clientes' }).click();
    const fila = ventana.locator('tbody tr', { hasText: nombre });
    await expect(fila).toContainText('924.70');
    await fila.locator('button', { hasText: 'Abonar' }).click();

    const dlg = ventana.locator('.ab-dialogo');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.wx-seg__op.on'), 'abre en Liquidar deudas').toHaveText('Liquidar deudas');
    await expect(dlg.locator('.ab-cab')).toContainText('924.70');
    const notas = dlg.locator('.ab-nota');
    await expect(notas).toHaveCount(4);
    await expect(notas.first(), 'la vencida arriba').toContainText('vencida');

    /* $650: liquida la de $500; la de $300 queda con $150. */
    await dlg.locator('#ab-monto').fill('650');
    await expect(dlg.locator('.ab-nota.liquida')).toHaveCount(1);
    await expect(dlg.locator('.ab-nota.parcial')).toHaveCount(1);
    await expect(notas.nth(0)).toContainText('Se liquida');
    await expect(notas.nth(1)).toContainText('queda $ 150.00');
    await expect(notas.nth(2)).toContainText('Sin abono');
    await expect(dlg.locator('.ab-resumen')).toContainText('274.70');

    /* Más de lo que debe: no deja confirmar. */
    await dlg.locator('#ab-monto').fill('924.71');
    await expect(dlg.locator('.ab-resumen.mal')).toContainText('924.70');
    await expect(dlg.locator('.ab-confirmar')).toBeDisabled();

    await dlg.locator('#ab-monto').fill('650');
    await expect(dlg.locator('.ab-confirmar')).toBeEnabled();
    await dlg.locator('.ab-confirmar').click();

    // ------------------------------------------- el aviso, con Wybix Guide
    const aviso = ventana.locator('.swal2-toast.wx-aviso');
    await expect(aviso, 'el éxito sale como aviso de esquina').toBeVisible();
    await expect(aviso).toContainText('Abono aplicado');
    await expect(aviso.locator('.wx-guide-cara svg'), 'con la cara de Guide').toHaveCount(1);
    const velo = await ventana.locator('.swal2-container').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(velo, 'el aviso no oscurece la pantalla').toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    await expect(dlg).toHaveCount(0);
    if (process.env.WYBIX_CAPTURAS) {
      require('node:fs').mkdirSync(process.env.WYBIX_CAPTURAS, { recursive: true });
      await ventana.screenshot({ path: require('node:path').join(process.env.WYBIX_CAPTURAS, 'liquidar-aviso.png') });
    }

    // ------------------------------------------------ la base, lo que se vio
    let ahora = await abiertas();
    expect(ahora.map((x) => x.saldo), 'la vencida liquidada; la de $300 con $150').toEqual([15000, 10000, 2470]);

    // ---------------------------------------------------- «A una venta»
    await fila.locator('button', { hasText: 'Abonar' }).click();
    await expect(dlg).toBeVisible();
    await dlg.locator('.wx-seg__op', { hasText: 'A una venta' }).click();
    await notas.filter({ hasText: '24.70' }).click();
    await expect(dlg.locator('.ab-nota.elegida')).toContainText('24.70');
    await dlg.locator('#ab-monto').fill('10');
    await expect(dlg.locator('.ab-resumen')).toContainText('264.70');
    await dlg.locator('.ab-confirmar').click();
    await expect(dlg).toHaveCount(0, { timeout: 15000 });
    ahora = await abiertas();
    expect(ahora.map((x) => x.saldo), 'solo la elegida bajó $10').toEqual([15000, 10000, 1470]);

    // -------------------------------------------------- «Toda la deuda»
    await ventana.locator('.swal2-container').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    await fila.locator('button', { hasText: 'Abonar' }).click();
    await expect(dlg).toBeVisible();
    await dlg.locator('.ab-chip', { hasText: 'Toda la deuda' }).click();
    await expect(dlg.locator('#ab-monto')).toHaveValue('264.7');
    await expect(dlg.locator('.ab-nota.liquida')).toHaveCount(3);
    await expect(dlg.locator('.ab-confirmar')).toHaveText('Liquidar todo');
    await dlg.locator('.ab-metodos button', { hasText: 'Tarjeta' }).click();
    await dlg.locator('.ab-confirmar').click();
    await expect(ventana.locator('.swal2-toast.wx-aviso')).toContainText('Deuda liquidada');
    expect(await abiertas(), 'ya no debe nada').toEqual([]);
    await expect(fila).not.toContainText('924.70');
  });
});
