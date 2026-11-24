/**
 * Una tienda de abarrotes: COMPRAR por caja y VENDER suelto, en la app de verdad.
 *
 *     npm run e2e:abarrotes
 *
 * Catálogo en scripts/giros/abarrotes.mjs: más de 50 productos que llegan en
 * cartón, caja, exhibidor, paquete o tira y se venden por pieza (cerveza,
 * chocolates en barra, tés, cigarros, rollos de baño, vasos y charolas…).
 * Capturas en tmp/e2e-abarrotes/.
 *
 *   1. La compra de la cerveza en pantalla, como la hace una persona: escribe
 *      que la mediana le cuesta $15 la pieza y la agrega. La línea queda en
 *      «Cartón 24» a $360 el cartón (no a $15 el cartón, que era el error),
 *      dice «$15.00 por pza», 2 cartones entran 48 piezas y se pagan $720.
 *      Cambiar a «Por pza» y de vuelta conserva lo que vale cada pieza.
 *   2. La compra de todo lo demás por su presentación: cada producto sube
 *      factor × cantidad piezas y su costo queda por pieza.
 *   3. Una venta de mostrador de cosas sueltas: 6 cervezas, 3 cigarros, 10
 *      vasos, 2 chocolates, 4 tés y un rollo. Los sueltos sin piezas abren
 *      sus paquetes justos (una cajetilla, un paquete de vasos, uno de rollos).
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-abarrotes');

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

const ir = (p, ruta) => p.evaluate((r) => {
  history.pushState({}, '', location.href.replace(/\/dashboard(\/.*)?$/, '') + r);
  dispatchEvent(new PopStateEvent('popstate', { state: {} }));
}, ruta);

async function cerrarAvisos(p) {
  for (let i = 0; i < 2; i++) {
    for (const b of [p.getByRole('button', { name: 'Nada más, cerrar' }), p.locator('app-premios-venta').getByRole('button', { name: 'Continuar' }).first(),
      p.locator('.swal2-confirm')]) {
      try { await b.click({ timeout: 2000 }); } catch { /* no está */ }
    }
  }
}

test('abarrotes: comprar por caja y vender suelto', async ({ app }) => {
  test.setTimeout(480000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1440, height: 900 });
  const { ABARROTES, sqlSembrar } = await import('../scripts/giros/abarrotes.mjs');
  const filas = await sql(app.base, sqlSembrar());
  const porPn = Object.fromEntries(filas.map((f) => [f.part_number, f]));
  expect(ABARROTES.length).toBeGreaterThanOrEqual(50);
  const stock = async (pn) => Number((await sql(app.base, `SELECT CAST(stock AS FLOAT) s FROM dbo.products WHERE part_number = N'${pn}';`))[0].s);
  const costo = async (pn) => Number((await sql(app.base, `SELECT CAST(cost AS FLOAT) c FROM dbo.products WHERE part_number = N'${pn}';`))[0].c);
  const foto = (n) => p.screenshot({ path: path.join(SHOTS, `${n}.png`) });

  await login(app, CUENTAS.admin);
  const yo = (await app.invocar('sesion')).data.userId;
  await app.invocar('openShift', { user_id: yo, opening_cash: 500, register_id: 1 });

  /* ------------------------------------- 1. la cerveza, en pantalla */
  await ir(p, '/dashboard/registrarCompra');
  await p.getByRole('button', { name: /Agregar producto/ }).click();
  await p.locator('.modal-productos .buscador').fill('Cerveza clara mediana');
  const filaModal = p.locator('.modal-productos tr', { hasText: 'Cerveza clara mediana 355 ml' });
  await filaModal.locator('input[type=number]').first().fill('15');
  await filaModal.getByRole('button', { name: 'Agregar' }).click();
  const linea = p.locator('.venta-table tbody tr', { hasText: 'Cerveza clara mediana' });
  /* El precio escrito es por pieza: la línea pasa al cartón y lo multiplica. */
  await expect(linea.locator('[data-guide=compra-precio]')).toHaveValue('360', { timeout: 15000 });
  await expect(linea.locator('[data-guide=compra-precio-unidad]')).toContainText('por Cartón 24 · $15.00 por pza');
  const cantidad = linea.locator('input[type=number]').first();
  await cantidad.fill('2');
  await cantidad.press('Tab');
  await expect(linea).toContainText('Entran 48 pza');
  await expect(linea).toContainText('$720.00');
  /* La ganancia arranca en la que deja el precio de hoy: sigue a $20. */
  await expect(linea).toContainText('$20.00');
  await foto('1-compra-cerveza-carton');
  /* Por pieza y de vuelta: lo que vale cada cerveza no cambia. */
  await linea.locator('[data-guide=compra-presentacion]').getByRole('combobox').click();
  await p.getByRole('option', { name: /Por pza/ }).click();
  await expect(linea.locator('[data-guide=compra-precio]')).toHaveValue('15');
  await linea.locator('[data-guide=compra-presentacion]').getByRole('combobox').click();
  await p.getByRole('option', { name: /Cartón 24/ }).click();
  await expect(linea.locator('[data-guide=compra-precio]')).toHaveValue('360');
  await p.locator('button', { hasText: 'Selecciona proveedor' }).click();
  await p.locator('.list-group-item', { hasText: 'Abarrotera del Centro' }).click();
  await p.locator('button', { hasText: 'Registrar compra' }).last().click();
  await expect(p.locator('.swal2-popup')).toContainText('Compra registrada', { timeout: 20000 });
  await foto('2-compra-registrada');
  await p.locator('.swal2-confirm').click().catch(() => {});
  expect(await stock('ABA-CERV-CLARA')).toBe(48);
  expect(await costo('ABA-CERV-CLARA'), 'el costo queda por pieza').toBe(15);

  /* -------------------------- 2. todo lo demás, por su presentación */
  const detalles = [];
  for (const [pn, , , , , factor, costoPres, suelto] of ABARROTES) {
    if (pn === 'ABA-CERV-CLARA') continue;
    const clave = suelto ? `${pn}-PAQ` : pn;
    const f = porPn[clave];
    expect(f?.presentation_id, `${clave} sin presentación`).toBeTruthy();
    /* Como en pantalla: la ganancia que conserva el precio de venta de hoy. */
    const ganancia = Math.round((f.price / ((costoPres / factor) * 1.16) - 1) * 10000) / 100;
    detalles.push({ product_id: f.id, quantity: suelto ? 1 : 2, unit_price: costoPres, profit_percent: ganancia, presentation_id: f.presentation_id, _pn: clave, _factor: factor });
  }
  const subtotal = detalles.reduce((a, d) => a + d.quantity * d.unit_price, 0);
  const compra = await app.invocar('registerPurchase', {
    user_id: yo, supplier_id: porPn['ABA-CERV-OSCURA'].supplier_id, tax_rate: 0.16, tax_amount: Math.round(subtotal * 0.16 * 100) / 100,
    subtotal, total: Math.round(subtotal * 1.16 * 100) / 100, payment_method: 'CREDITO', register_id: 1, apply_payment_id: null, socio_pago_id: null,
    detalles: detalles.map(({ _pn, _factor, ...d }) => d),
  });
  expect(compra?.success, JSON.stringify(compra)).toBeTruthy();
  const mal = [];
  for (const d of detalles) {
    const s = await stock(d._pn), c = await costo(d._pn);
    if (s !== d.quantity * d._factor) mal.push(`${d._pn}: stock ${s}, esperaba ${d.quantity * d._factor}`);
    if (Math.abs(c - d.unit_price / d._factor) > 0.01) mal.push(`${d._pn}: costo ${c}, esperaba ${(d.unit_price / d._factor).toFixed(4)}`);
  }
  expect(mal).toEqual([]);

  /* ----------------------------------- 3. una venta de cosas sueltas */
  await irPorDock(p, 'Venta');
  await p.waitForSelector('.pos-wrap');
  const VENTA = [
    ['ABA-CERV-CLARA', 'Cerveza clara mediana 355 ml', 6],
    ['ABA-CIG-ROJO', 'Cigarro rojo suelto', 3],
    ['ABA-VASO-8', 'Vaso desechable #8 suelto', 10],
    ['ABA-CHOC-BARRA', 'Chocolate con leche barra 40 g', 2],
    ['ABA-TE-MANZ', 'Té de manzanilla sobre', 4],
    ['ABA-PAPEL-ROLLO', 'Papel higiénico rollo suelto', 1],
  ];
  const antes = {};
  for (const pn of ['ABA-CIG-ROJO-PAQ', 'ABA-VASO-8-PAQ', 'ABA-PAPEL-ROLLO-PAQ', 'ABA-CHOC-BARRA', 'ABA-TE-MANZ']) antes[pn] = await stock(pn);
  for (const [pn, nombre, n] of VENTA) {
    if (!(await p.locator('.modal-productos').count())) await p.getByRole('button', { name: /Agregar producto/ }).click();
    await p.locator('[data-guide=venta-buscar]').fill(nombre);
    await p.locator(`.modal-productos [data-guide=venta-producto][data-guide-clave="${pn}"]`).click();
    const l = p.locator(`[data-guide=venta-linea][data-guide-clave="${porPn[pn].id}"]`);
    await expect(l).toBeVisible();
    const q = l.locator('input[type=number]').first();
    await q.fill(String(n));
    await q.press('Tab');
  }
  await expect(p.locator('[data-guide=venta-linea]')).toHaveCount(VENTA.length);
  const total = Number(((await p.locator('#total-venta').innerText()).match(/[\d,.]+/) || ['0'])[0].replace(/,/g, ''));
  /* 6×20 + 3×6 + 10×1 + 2×18 + 4×3 + 1×10 */
  expect(total).toBe(206);
  await foto('3-venta-sueltos');
  await p.locator('[data-guide=venta-cobrar]').click();
  await p.locator('[data-guide=venta-recibido]').fill('300');
  await p.locator('[data-guide=venta-confirmar-cobro]').click();
  await expect.poll(() => stock('ABA-CERV-CLARA'), { timeout: 30000 }).toBe(42);
  await cerrarAvisos(p);
  await foto('4-venta-cobrada');

  /* Los sueltos abrieron sus paquetes justos; lo demás bajó por pieza. */
  expect(await stock('ABA-CIG-ROJO-PAQ'), 'abrió una cajetilla').toBe(antes['ABA-CIG-ROJO-PAQ'] - 1);
  expect(await stock('ABA-CIG-ROJO'), 'quedan 17 cigarros sueltos').toBe(17);
  expect(await stock('ABA-VASO-8-PAQ'), 'abrió un paquete de vasos').toBe(antes['ABA-VASO-8-PAQ'] - 1);
  expect(await stock('ABA-VASO-8')).toBe(40);
  expect(await stock('ABA-PAPEL-ROLLO-PAQ'), 'abrió un paquete de 4').toBe(antes['ABA-PAPEL-ROLLO-PAQ'] - 1);
  expect(await stock('ABA-PAPEL-ROLLO')).toBe(3);
  expect(await stock('ABA-CHOC-BARRA')).toBe(antes['ABA-CHOC-BARRA'] - 2);
  expect(await stock('ABA-TE-MANZ')).toBe(antes['ABA-TE-MANZ'] - 4);

  /* Un paquete sin pieza, para crearla desde su ficha (paso 4). */
  await sql(app.base, `
    DECLARE @c INT = (SELECT TOP 1 id FROM dbo.CAT_categories WHERE namee = N'Dulces');
    DECLARE @b INT = (SELECT id FROM dbo.CAT_brands WHERE namee = N'Abarrotes');
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'ABA-CHICLE-TIRA')
      INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date, base_uom)
      VALUES (N'ABA-CHICLE-TIRA', N'Chicle de hierbabuena tira 10', 15, 6, 1, 1, 'DIRECT', @c, @b, 8, '02', 0.16, GETDATE(), 'pza');`);
  /* La hoja de inventario, para revisarla a ojo. */
  await irPorDock(p, 'Inventario');
  await p.locator('tbody tr').nth(5).waitFor({ timeout: 60000 });
  await p.locator('.ventas-search input[type=search]').fill('suelt');
  await foto('5-inventario-sueltos');

  /* ------------- 4. la ficha: crear la pieza desde su paquete, y el costo */
  await p.locator('.ventas-search input[type=search]').fill('Chicle de hierbabuena tira');
  await p.locator('tr', { hasText: 'Chicle de hierbabuena tira 10' }).locator('button.btn-editar').click();
  const guia = p.locator('[data-guide=producto-suelto-guia]');
  await expect(guia).toBeVisible();
  await guia.locator('summary').click();
  await expect(guia).toContainText('La pieza es otro producto');
  await p.locator('[data-guide=producto-suelto-crear-abrir]').click();
  await p.locator('[data-guide=producto-suelto-crear-piezas] ').fill('10');
  await p.locator('[data-guide=producto-suelto-crear-precio]').fill('2');
  await expect(p.locator('[data-guide=producto-suelto-crear]')).toContainText('cada pieza sale en $1.50');
  await foto('6-crear-pieza-suelta');
  await p.locator('[data-guide=producto-suelto-crear-guardar]').click();
  await expect(p.locator('.swal2-popup')).toContainText('Pieza suelta creada', { timeout: 15000 });
  const pieza = await sql(app.base, `
    SELECT p.nombre, CAST(p.price AS FLOAT) AS price, v.piezas FROM dbo.venta_suelta v JOIN dbo.products p ON p.id = v.product_id
     WHERE v.parent_product_id = (SELECT id FROM dbo.products WHERE part_number = N'ABA-CHICLE-TIRA');`);
  expect(pieza[0]).toMatchObject({ nombre: 'Chicle de hierbabuena tira 10 (pieza suelta)', price: 2, piezas: 10 });
  await p.locator('.swal2-container').waitFor({ state: 'detached' }).catch(() => {});
  await expect(p.locator('[data-guide=producto-suelto-es-paquete]')).toContainText('(10 piezas por paquete)');

  /* El costo del ticket ya trae IVA: $11.60 son $10 sin IVA; con 30% de
     ganancia el público paga 10 × 1.16 × 1.30 = $15.08. */
  await p.locator('[data-guide=producto-costo-iva] button', { hasText: 'Con IVA' }).click();
  await p.locator('[data-guide=producto-costo]').fill('11.60');
  await expect(p.locator('[data-guide=producto-costo-sin-iva]')).toContainText('$10.00 sin IVA');
  await p.locator('[data-guide=producto-precio-publico] input').fill('30');
  await expect(p.locator('[data-guide=producto-precio-publico]')).toContainText('$15.08');
  await p.locator('[data-guide=producto-usar-precio]').click();
  await expect(p.locator('[data-guide=producto-precio]')).toHaveValue('15.08');
  await foto('7-costo-con-iva');
  await p.locator('[data-guide="producto-guardar"]').click();
  await expect(p.locator('.swal2-popup')).toContainText('Producto actualizado', { timeout: 15000 });
  const tira = await sql(app.base, `SELECT CAST(price AS FLOAT) AS price, CAST(cost AS FLOAT) AS cost FROM dbo.products WHERE part_number = N'ABA-CHICLE-TIRA';`);
  expect(tira[0]).toMatchObject({ price: 15.08, cost: 10 });
  console.log(`abarrotes: ${ABARROTES.length} productos de venta suelta, capturas en ${SHOTS}`);
});
