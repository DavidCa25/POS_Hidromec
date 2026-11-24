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
  const { ABARROTES, PRESENTACIONES, sqlSembrar } = await import('../scripts/giros/abarrotes.mjs');
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
  const CUANTOS = { 'ABA-MP-PAPEL': 2, 'ABA-MP-REFRESCO': 2, 'ABA-MP-CERVEZA': 2, 'ABA-MP-AGUA': 2 };
  for (const [pn, , , , [, factor, costoPres]] of PRESENTACIONES) {
    const f = porPn[pn];
    expect(f?.presentation_id, `${pn} sin presentación de compra`).toBeTruthy();
    const ganancia = Math.round((f.price / ((costoPres / factor) * 1.16) - 1) * 10000) / 100;
    detalles.push({ product_id: f.id, quantity: CUANTOS[pn] ?? 1, unit_price: costoPres, profit_percent: ganancia, presentation_id: f.presentation_id, _pn: pn, _factor: factor });
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
  /* El catálogo de prueba no vende nada bajo costo (0092): ni pieza ni paquete. */
  const bajoCosto = await app.invocar('alertasCostos', {});
  expect(bajoCosto?.success, JSON.stringify(bajoCosto)).toBeTruthy();
  expect(bajoCosto.data.filter((c) => c.tipo !== 'SUBIO').map((c) => `${c.product_name} ${c.detalle || ''}: ${c.precio} < ${c.minimo}`)).toEqual([]);

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

  /* ------- 3c. un producto, muchas presentaciones, y el paquete de 6 */
  await irPorDock(p, 'Inventario');
  await irPorDock(p, 'Venta');
  await p.waitForSelector('.pos-wrap');
  /* Tocar un producto cierra el buscador: se espera a que termine de cerrarse
     antes de volver a abrirlo (escribir en uno que se está cerrando falla). */
  const abrirBuscador = async (texto) => {
    await p.locator('.modal-productos').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    await p.getByRole('button', { name: /Agregar producto/ }).click();
    await p.locator('[data-guide=venta-buscar]').fill(texto);
  };
  const tocarPaquete = async (texto, pn, nombre) => {
    await abrirBuscador(texto);
    await p.locator(`.modal-productos [data-guide=venta-paquete][data-guide-clave="${pn}|${nombre}"]`).click({ timeout: 30000 });
  };
  /* El rollo suelto y sus cuatro paquetes: cinco renglones del mismo producto. */
  await abrirBuscador('papel higienico rollo doble');
  await expect(p.locator('.modal-productos [data-guide=venta-paquete]', { hasText: 'Papel higiénico rollo doble hoja' })).toHaveCount(4, { timeout: 30000 });
  await foto('4d-buscador-papel-presentaciones');
  await p.locator('.modal-productos [data-guide=venta-producto][data-guide-clave="ABA-MP-PAPEL"]').click();
  const rollo = p.locator(`[data-guide=venta-linea][data-guide-clave="${porPn['ABA-MP-PAPEL'].id}"]`).first();
  await rollo.locator('input[type=number]').first().fill('2');
  await rollo.locator('input[type=number]').first().press('Tab');
  for (const n of ['Paquete 4', 'Paquete 6', 'Paquete 12', 'Paquete 18']) await tocarPaquete('papel higienico doble', 'ABA-MP-PAPEL', n);
  await tocarPaquete('huevo rojo', 'ABA-MP-HUEVO', 'Docena');
  await tocarPaquete('huevo rojo reja', 'ABA-MP-HUEVO', 'Reja 30');
  await tocarPaquete('refresco lata six', 'ABA-MP-REFRESCO', 'Six 6');
  /* El jumbo (venta suelta, paquete de 6): un rollo suelto y un paquete entero. */
  await abrirBuscador('papel higienico jumbo');
  await p.locator('.modal-productos [data-guide=venta-producto][data-guide-clave="ABA-PAPEL6-ROLLO"]').click();
  await abrirBuscador('papel higienico jumbo paquete');
  await p.locator('.modal-productos [data-guide=venta-producto][data-guide-clave="ABA-PAPEL6-ROLLO-PAQ"]').click();
  await expect(p.locator('[data-guide=venta-linea]')).toHaveCount(10);
  /* Papel 2×10 + 36 + 52 + 98 + 150 = 356 · huevo 40 + 95 · six 90 · jumbo 12 + 58 */
  await expect.poll(async () => Number(((await p.locator('#total-venta').innerText()).match(/[\d,.]+/) || ['0'])[0].replace(/,/g, '')),
    { timeout: 20000 }).toBe(651);
  /* El paquete no deja escribir su precio y lo dice claro: $52 el paquete de 6, $8.67 c/u. */
  await expect(p.locator('[data-guide=venta-linea]', { hasText: 'Paquete 6' }).locator('[data-guide=venta-linea-paquete]')).toContainText('$8.67');
  await foto('4e-venta-presentaciones');
  const paqJumboAntes = await stock('ABA-PAPEL6-ROLLO-PAQ');
  await p.locator('[data-guide=venta-cobrar]').click();
  /* «Dinero recibido» llega con el total de la cuenta. */
  await expect(p.locator('[data-guide=venta-recibido]')).toHaveValue('651');
  /* Como una persona: clic en el campo y teclear. Debe quedar 700, no 651700. */
  await p.locator('[data-guide=venta-recibido]').click();
  await p.locator('[data-guide=venta-recibido]').pressSequentially('700', { delay: 50 });
  await expect(p.locator('[data-guide=venta-recibido]')).toHaveValue('700');
  await p.locator('[data-guide=venta-confirmar-cobro]').click();
  await expect.poll(() => stock('ABA-MP-PAPEL'), { timeout: 30000 }).toBe(96 - 42);
  await cerrarAvisos(p);
  expect(await stock('ABA-MP-HUEVO'), 'docena y reja: 42 huevos').toBe(360 - 42);
  expect(await stock('ABA-MP-REFRESCO')).toBe(48 - 6);
  expect(await stock('ABA-PAPEL6-ROLLO-PAQ'), 'un paquete entero y uno abierto').toBe(paqJumboAntes - 2);
  expect(await stock('ABA-PAPEL6-ROLLO'), 'del paquete de 6 quedan 5 rollos').toBe(5);

  /* ------------- 3b. el cartón sin escanear: se busca y se toca (0091) */
  /* El cartón de 24 se vende entero a $430, sin código de barras. */
  await sql(app.base, `UPDATE pp SET pp.sale_price = 430 FROM dbo.product_presentations pp
    JOIN dbo.products p ON p.id = pp.product_id WHERE p.part_number = N'ABA-CERV-CLARA' AND pp.name = N'Cartón 24';`);
  await irPorDock(p, 'Inventario');
  await irPorDock(p, 'Venta');
  await p.waitForSelector('.pos-wrap');
  await p.getByRole('button', { name: /Agregar producto/ }).click();
  /* La pieza suelta y el paquete se distinguen en el buscador. */
  await p.locator('[data-guide=venta-buscar]').fill('cigarro rojo');
  await expect(p.locator('.modal-productos [data-guide=venta-producto][data-guide-clave="ABA-CIG-ROJO"]'))
    .toContainText('Suelto · sale de Cajetilla cigarro rojo 20 (20)', { timeout: 30000 });
  await expect(p.locator('.modal-productos [data-guide=venta-producto][data-guide-clave="ABA-CIG-ROJO-PAQ"]'))
    .toContainText('Paquete · también se vende por pieza');
  await foto('4b-buscador-suelto-y-paquete');
  /* «cartón cerveza»: el cartón aparece aunque el producto no diga «cartón». */
  await p.locator('[data-guide=venta-buscar]').fill('carton cerveza clara');
  const carton = p.locator('.modal-productos [data-guide=venta-paquete]', { hasText: 'Cerveza clara mediana 355 ml · Cartón 24' });
  await expect(carton).toBeVisible({ timeout: 30000 });
  await expect(carton).toContainText('$430.00');
  await foto('4c-buscador-carton');
  await carton.click();
  await expect(p.locator('[data-guide=venta-linea]', { hasText: 'Cartón 24' })).toBeVisible();
  await expect.poll(async () => Number(((await p.locator('#total-venta').innerText()).match(/[\d,.]+/) || ['0'])[0].replace(/,/g, '')),
    { timeout: 20000 }).toBe(430);
  await p.locator('[data-guide=venta-cobrar]').click();
  await p.locator('[data-guide=venta-recibido]').fill('500');
  await p.locator('[data-guide=venta-confirmar-cobro]').click();
  await expect.poll(() => stock('ABA-CERV-CLARA'), { timeout: 30000 }).toBe(18);
  await cerrarAvisos(p);

  /* Cobrar con tarjeta y que la siguiente venta empiece en efectivo. */
  await abrirBuscador('chocolate con leche barra');
  await p.locator('.modal-productos [data-guide=venta-producto][data-guide-clave="ABA-CHOC-BARRA"]').click();
  await p.locator('[data-guide=venta-cobrar]').click();
  await p.locator('.modal-cobro .pay-pill', { hasText: /^\s*Tarjeta\s*$/ }).click();
  await expect(p.locator('[data-guide=venta-recibido]')).toHaveValue('18');
  await p.locator('[data-guide=venta-confirmar-cobro]').click();
  await cerrarAvisos(p);
  await abrirBuscador('chocolate con leche barra');
  await p.locator('.modal-productos [data-guide=venta-producto][data-guide-clave="ABA-CHOC-BARRA"]').click();
  await p.locator('[data-guide=venta-cobrar]').click();
  await expect(p.locator('[data-guide=venta-pago-efectivo]')).toHaveClass(/active/);
  await expect(p.locator('[data-guide=venta-recibido]')).toHaveValue('18');
  await foto('4f-siguiente-venta-en-efectivo');
  await p.locator('[data-guide=venta-confirmar-cobro]').click();
  await cerrarAvisos(p);

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

  /* ------------------------- 6. la compra aprende (0092) ------------- */
  await p.locator('.swal2-container').waitFor({ state: 'detached' }).catch(() => {});
  /* Otra compra de 1 cartón al mismo proveedor: ya hay un «normal» (36 en promedio, 48 la mayor). */
  const centro = Number((await sql(app.base, `SELECT id FROM dbo.CAT_suppliers WHERE nombre = N'Abarrotera del Centro';`))[0].id);
  const cerveza = porPn['ABA-CERV-CLARA'];
  const otraCompra = await app.invocar('registerPurchase', {
    user_id: yo, supplier_id: centro, tax_rate: 0.16, tax_amount: 57.6, subtotal: 360, total: 417.6,
    payment_method: 'CREDITO', register_id: 1, apply_payment_id: null, socio_pago_id: null,
    detalles: [{ product_id: cerveza.id, quantity: 1, unit_price: 360, profit_percent: 14.94, presentation_id: cerveza.presentation_id }],
  });
  expect(otraCompra?.success, JSON.stringify(otraCompra)).toBeTruthy();
  await ir(p, '/dashboard/registrarCompra');
  /* Proveedor primero; la cerveza sin escribir precio nace como la última compra. */
  await p.locator('button', { hasText: 'Selecciona proveedor' }).click();
  await p.locator('.list-group-item', { hasText: 'Abarrotera del Centro' }).click();
  await p.getByRole('button', { name: /Agregar producto/ }).click();
  await p.locator('.modal-productos .buscador').fill('Cerveza clara mediana');
  await p.locator('.modal-productos tr', { hasText: 'Cerveza clara mediana 355 ml' }).getByRole('button', { name: 'Agregar' }).click();
  const otra = p.locator('.venta-table tbody tr', { hasText: 'Cerveza clara mediana' });
  await expect(otra.locator('[data-guide=compra-precio]')).toHaveValue('360', { timeout: 15000 });
  await expect(otra.locator('[data-guide=compra-precio-unidad]')).toContainText('por Cartón 24');
  await expect(otra.locator('[data-guide=compra-memoria]')).toContainText('Última compra: $360.00 por Cartón 24');
  await expect(otra).toContainText('$20.00');   // la ganancia de la última vez: sigue a $20
  /* 100 cartones cuando siempre se compran 2: pregunta antes de registrar. */
  const cuantas = async () => Number((await sql(app.base, `SELECT COUNT(*) n FROM dbo.purchase;`))[0].n);
  const comprasAntes = await cuantas();
  await otra.locator('input[type=number]').first().fill('100');
  await otra.locator('input[type=number]').first().press('Tab');
  await p.locator('button', { hasText: 'Registrar compra' }).last().click();
  await expect(p.locator('.swal2-popup')).toContainText('¿Está bien capturado?', { timeout: 15000 });
  await expect(p.locator('.swal2-popup')).toContainText('2,400 pza. Normalmente compras 36 y la mayor compra fue de 48');
  await foto('10-compra-aviso-captura');
  await p.getByRole('button', { name: 'Corregir' }).click();
  expect(await cuantas(), 'Corregir no registra').toBe(comprasAntes);

  /* El costo subió y el six quedó por debajo del costo: Alertas lo dice. */
  const refresco = porPn['ABA-MP-REFRESCO'];
  const sub = await app.invocar('registerPurchase', {
    user_id: yo, supplier_id: refresco.supplier_id, tax_rate: 0.16, tax_amount: 53.76, subtotal: 336, total: 389.76,
    payment_method: 'CREDITO', register_id: 1, apply_payment_id: null, socio_pago_id: null,
    detalles: [{ product_id: refresco.id, quantity: 1, unit_price: 336, profit_percent: 15, presentation_id: refresco.presentation_id }],
  });
  expect(sub?.success, JSON.stringify(sub)).toBeTruthy();
  await sql(app.base, `UPDATE dbo.product_presentations SET sale_price = 80 WHERE product_id = ${refresco.id} AND name = N'Six 6';`);
  await ir(p, '/dashboard/alertas');
  const costos = p.locator('[data-guide=alertas-costos]');
  await expect(costos).toBeVisible({ timeout: 30000 });
  /* 14 por lata con IVA = 16.24 → el six cuesta 97.44 y se vende a 80. */
  await expect(costos.locator(`[data-guide=alertas-costo][data-guide-clave="PAQUETE|${refresco.id}|Six 6"]`)).toContainText('$97.44');
  await expect(costos.locator(`[data-guide=alertas-costo][data-guide-clave^="SUBIO|${refresco.id}|"]`)).toContainText('+16.7 %');
  await costos.scrollIntoViewIfNeeded();
  await foto('11-alertas-costos');

  /* Pedido: sin proveedor ligado sale el de la última compra, y el ritmo es por días con existencia. */
  const papel = porPn['ABA-MP-PAPEL'];
  await sql(app.base, `DELETE FROM dbo.product_suppliers WHERE product_id = ${papel.id};`);
  const pedido = await app.invocar('comprasPedidoSugerido', { dias_alerta: 30, dias_objetivo: 30 });
  expect(pedido?.success, JSON.stringify(pedido)).toBeTruthy();
  const filaPapel = pedido.data.find((f) => f.product_id === papel.id);
  expect(filaPapel?.supplier_id, 'proveedor aprendido de la compra').toBe(porPn['ABA-CERV-OSCURA'].supplier_id);
  /* 42 rollos vendidos; existe desde hoy: se divide entre 7 días (mínimo), no entre 30. */
  expect(Number(filaPapel.prom_diario)).toBe(6);
  expect(filaPapel.presentation_name, 'la presentación en que se compró').toBe('Bulto 48');

  /* Ciclo y entrega: con 30 rollos se acaba en 5 días. Pidiendo para 3 días no entra… */
  await sql(app.base, `UPDATE dbo.products SET stock = 30 WHERE id = ${papel.id};`);
  const tresDias = async () => {
    const r = await app.invocar('comprasPedidoSugerido', { dias_alerta: 3, dias_objetivo: 3 });
    expect(r?.success, JSON.stringify(r)).toBeTruthy();
    return r.data.find((f) => f.product_id === papel.id);
  };
  expect(await tresDias(), 'sin historial, 5 días de papel alcanzan para 3').toBeUndefined();
  /* …pero a este proveedor se le compra cada 7 días (hace 21, 14 y 7, y hoy) y un
     pedido mandado hace 9 días llegó a los 2: el papel no llega a su próxima visita. */
  const prov = porPn['ABA-CERV-OSCURA'].supplier_id;
  await sql(app.base, `
    INSERT INTO dbo.purchase (datee, useer_id, total, tax_rate, tax_amount, supplier_id, balance, payment_status)
    VALUES (DATEADD(DAY, -21, GETDATE()), ${yo}, 1, 0, 0, ${prov}, 0, 'PAGADO'),
           (DATEADD(DAY, -14, GETDATE()), ${yo}, 1, 0, 0, ${prov}, 0, 'PAGADO'),
           (DATEADD(DAY, -7,  GETDATE()), ${yo}, 1, 0, 0, ${prov}, 0, 'PAGADO');
    INSERT INTO dbo.purchase_order_sent (supplier_id, sent_at, via, lineas, user_id)
    VALUES (${prov}, DATEADD(DAY, -9, SYSDATETIME()), 'WHATSAPP', 3, ${yo});`);
  const conCiclo = await tresDias();
  expect(conCiclo, 'se acaba antes de que el proveedor vuelva').toBeTruthy();
  expect(conCiclo).toMatchObject({ ciclo_dias: 7, entrega_dias: 2, cobertura_dias: 9 });
  /* 6 al día × 9 días = 54; hay 30: faltan 24 → un bulto de 48. */
  expect(Number(conCiclo.pedir)).toBe(48);
  /* Una fecha de SQL (DATE) llega como medianoche UTC: se compara el día. */
  const enSiete = new Date(Date.now() + 7 * 86400000).toLocaleDateString('sv-SE');
  expect(new Date(conCiclo.proxima_compra).toISOString().slice(0, 10), 'próxima compra en 7 días').toBe(enSiete);
  /* Copiar y luego mandar el mismo pedido anota uno solo. */
  const enviadosAntes = Number((await sql(app.base, `SELECT COUNT(*) n FROM dbo.purchase_order_sent WHERE supplier_id = ${prov};`))[0].n);
  expect((await app.invocar('comprasPedidoEnviado', { supplier_id: prov, via: 'COPIA', lineas: 2 }))?.success).toBeTruthy();
  expect((await app.invocar('comprasPedidoEnviado', { supplier_id: prov, via: 'WHATSAPP', lineas: 2 }))?.success).toBeTruthy();
  expect(Number((await sql(app.base, `SELECT COUNT(*) n FROM dbo.purchase_order_sent WHERE supplier_id = ${prov};`))[0].n)).toBe(enviadosAntes + 1);
  /* En Alertas, el pedido lo dice en una línea. «Generar pedido» vive en la
     fila de reorden, que aparece cuando algo se acaba en 7 días: con 5 rollos. */
  await sql(app.base, `UPDATE dbo.products SET stock = 5 WHERE id = ${papel.id};`);
  /* Alertas ya estaba abierta: salir y volver para que se lea de nuevo. */
  await ir(p, '/dashboard/registrarCompra');
  await ir(p, '/dashboard/alertas');
  await p.locator('[data-guide=alertas-generar-pedido]').click();
  await expect(p.locator(`[data-guide=alertas-pedido][data-guide-clave="${prov}"] [data-guide=alertas-pedido-memoria]`))
    .toContainText('Le compras cada ~7 días · tarda 2 días en surtir', { timeout: 30000 });
  await p.locator(`[data-guide=alertas-pedido][data-guide-clave="${prov}"]`).scrollIntoViewIfNeeded();
  await foto('12-alertas-pedido-ciclo');

  /* ------------------------------- 5. Touch: el cartón también se toca */
  await p.locator('.swal2-container').waitFor({ state: 'detached' }).catch(() => {});
  /* Quedan 18 cervezas: con menos de 24, Touch no deja tocar el cartón (lo dice). */
  await sql(app.base, `UPDATE dbo.products SET stock = 48 WHERE part_number = N'ABA-CERV-CLARA';`);
  await app.invocar('modulosSet', 'hospitality', true);
  await app.invocar('setDeviceConfig', { deviceProfile: 'TOUCH_POS' });
  await p.locator('.wx-yo__btn').click();
  await p.locator('.wx-yo__fila').filter({ hasText: 'Cerrar sesión' }).click();
  await p.waitForSelector('#username');
  await login(app, CUENTAS.admin);
  await p.waitForSelector('app-touch-pos .tp-card', { timeout: 60000 });
  const turno = p.getByRole('dialog').filter({ has: p.getByRole('heading', { name: 'Abrir turno', exact: true }) });
  if (await turno.count()) await turno.getByRole('button', { name: 'Abrir turno', exact: true }).click();
  await p.getByRole('button', { name: 'Cigarros' }).first().click();
  await expect(p.locator('[data-guide=touch-producto][data-guide-clave="ABA-CIG-ROJO"]')).toContainText('Suelto · de Cajetilla cigarro rojo 20');
  await expect(p.locator('[data-guide=touch-producto][data-guide-clave="ABA-CIG-ROJO-PAQ"]')).toContainText('Paquete · también por pieza');
  await foto('8-touch-cigarros');
  await p.getByRole('button', { name: 'Cerveza' }).first().click();
  const cartonTouch = p.locator('[data-guide=touch-paquete]', { hasText: 'Cartón 24' });
  await expect(cartonTouch).toContainText('$430.00', { timeout: 30000 });
  await cartonTouch.click();
  await expect(p.locator('[data-guide=touch-cuenta]')).toContainText('Cartón 24');
  await foto('9-touch-carton');
  await app.invocar('setDeviceConfig', { deviceProfile: 'RETAIL_POS' }).catch(() => {});
  console.log(`abarrotes: ${ABARROTES.length} productos de venta suelta, capturas en ${SHOTS}`);
});
