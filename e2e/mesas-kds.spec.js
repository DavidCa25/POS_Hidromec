/**
 * MESAS, COMANDAS Y COCINA, POR LA INTERFAZ.
 *
 *     npx playwright test e2e/mesas-kds.spec.js
 *
 * La preparacion (modulos, estaciones, productos, el salon) va por los
 * canales, como la haria alguien en Configuracion: no es lo que se prueba.
 * Lo que se prueba va por la pantalla:
 *
 *   TOUCH   mesa libre -> abrir -> pedir (latte con avena, croissant, agua)
 *           -> enviar -> pedir mas -> segunda comanda -> cobrar -> libre
 *   KDS     cada estacion ve lo suyo, con sus opciones; el agua no llega;
 *           Nueva -> Preparando -> Lista -> Entregada
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

async function salir(ventana) {
  await ventana.click('.wx-yo__btn');
  await ventana.click('.wx-yo__fila:has-text("Cerrar sesión")');
  await ventana.waitForSelector('#username', { timeout: 30000 });
}

const w = (ventana, fn, arg) => ventana.evaluate(fn, arg);
const filasDe = (r) => Array.isArray(r) ? r : (Array.isArray(r?.recordset) ? r.recordset : (r?.data ?? []));
const ventas = async (app) => ((await app.invocar('getSales')).data ?? []);

/** Todo lo que un local configuraria antes de abrir. Devuelve los nombres. */
async function prepararLocal(app, s) {
  const { ventana } = app;
  for (const m of ['hospitality', 'mesas', 'comandas']) {
    const r = await app.invocar('modulosSet', m, true);
    expect(r?.success, `${m}: ${JSON.stringify(r)}`).toBeTruthy();
  }

  const est = async (nombre) => {
    const r = await w(ventana, (n) => window.wybix.estaciones.guardar({ nombre: n, salida: 'PANTALLA' }), nombre);
    expect(r?.success, JSON.stringify(r)).toBeTruthy();
    return r.data[0].id;
  };
  const barra = await est(`Barra ${s}`);
  const cocina = await est(`Cocina ${s}`);

  /* En una base recien preparada no hay catalogo: se crea lo minimo. */
  let cats = filasDe(await app.invocar('getCategories'));
  if (!cats.length) { await app.invocar('createCategory', { nombre: `Cafeteria ${s}` }); cats = filasDe(await app.invocar('getCategories')); }
  let marcas = filasDe(await app.invocar('getBrands'));
  if (!marcas.length) { await app.invocar('createBrand', { nombre: `Casa ${s}` }); marcas = filasDe(await app.invocar('getBrands')); }
  const idDe = (x) => Number(x?.id ?? x?.category_id ?? x?.brand_id);
  const producto = async (pn, nombre, precio, modo, stock = 0) => {
    await app.invocar('agregarProducto', idDe(marcas[0]), idDe(cats[0]), pn, nombre, precio, stock,
      null, null, '02', 0.16, null, { inventory_mode: modo, sellable: 1, base_uom: 'pza' });
    const p = filasDe(await app.invocar('getActiveProducts')).find(x => x.part_number === pn);
    expect(p, `${nombre} existe`).toBeTruthy();
    return Number(p.id ?? p.product_id);
  };
  const latte = await producto(`LAT-${s}`, `Latte ${s}`, 52, 'NONE');
  const cro = await producto(`CRO-${s}`, `Croissant ${s}`, 45, 'NONE');
  const agua = await producto(`AGU-${s}`, `Agua ${s}`, 20, 'DIRECT', 50);

  for (const [pid, sid] of [[latte, barra], [cro, cocina]]) {
    const r = await w(ventana, ([p, st]) => window.wybix.estaciones.asignar({ productId: p, stationId: st }), [pid, sid]);
    expect(r?.success, JSON.stringify(r)).toBeTruthy();
  }

  /* La leche es OBLIGATORIA: asi Touch abre la hoja de opciones al tocar el latte. */
  const g = await w(ventana, (n) => window.wybix.modifiers.save({
    name: n, role: 'SUBSTITUTION', minSelect: 1, maxSelect: 1, required: true,
    options: [
      { name: 'Leche entera', priceDelta: 0, effect: 'NONE' },
      { name: 'Leche de avena', priceDelta: 8, effect: 'NONE' },
    ],
  }), `Leche ${s}`);
  expect(g?.success, JSON.stringify(g)).toBeTruthy();
  const pg = await w(ventana, ([p, gid]) => window.wybix.modifiers.setProductGroups({ productId: p, groupIds: [gid] }), [latte, g.groupId]);
  expect(pg?.success, JSON.stringify(pg)).toBeTruthy();

  const area = await w(ventana, (n) => window.wybix.salon.guardarArea({ nombre: n }), `Salón ${s}`);
  expect(area?.success, JSON.stringify(area)).toBeTruthy();
  const areaId = area.data[0].id;
  for (const m of [`Mesa A ${s}`, `Mesa B ${s}`]) {
    const r = await w(ventana, ([a, n]) => window.wybix.salon.guardarMesa({ areaId: a, nombre: n }), [areaId, m]);
    expect(r?.success, JSON.stringify(r)).toBeTruthy();
  }

  return { latte, cro, agua, barra, cocina, mesa: `Mesa A ${s}` };
}

test.describe('Mesas y cocina', () => {

  test.afterEach(async ({ app }) => {
    for (const m of ['comandas', 'mesas', 'hospitality']) {
      await app.invocar('modulosSet', m, false).catch(() => {});
    }
  });

  test('una mesa desde Venta: pedir, Aqui, elegir mesa, enviar solo lo nuevo, cobrar y queda libre', async ({ app }) => {
    test.setTimeout(240000);
    const { ventana } = app;
    const s = Date.now().toString().slice(-6);
    await entrar(app, CUENTAS.admin);
    const local = await prepararLocal(app, s);

    const userId = (await app.invocar('sesion')).data.userId;
    const abierto = await app.invocar('openShift', { user_id: userId, opening_cash: 1000 });
    expect(abierto?.success || /ya existe un turno/i.test(String(abierto?.error ?? ''))).toBeTruthy();

    await app.invocar('setDeviceConfig', { deviceProfile: 'TOUCH_POS' });
    await salir(ventana);
    await entrar(app, CUENTAS.admin);
    await ventana.waitForSelector('app-touch-pos .tp-card', { timeout: 60000 });

    const lineasEnBase = async (cuentaId) => ((await w(ventana, (c) => window.wybix.cuentas.obtener({ cuentaId: c }), cuentaId)).sets?.[1] || []);
    const estado = (nombre) => ventana.locator('.tp-linea', { hasText: nombre }).locator('.tp-linea__estado');

    // ------------------------------------ se pide primero, la mesa despues
    /* El mesero toma el pedido y LUEGO dice en que mesa: todo sin salir de Venta. */
    const pestanas = await ventana.locator('.tp-cuenta:not(.tp-cuenta--add)').count();
    await ventana.locator('.tp-card', { hasText: `Latte ${s}` }).click();
    await ventana.locator('.tp-opcion', { hasText: 'Leche de avena' }).click();
    await ventana.click('.tp-hoja__add');
    await ventana.locator('.tp-card', { hasText: `Croissant ${s}` }).click();
    await ventana.locator('.tp-card', { hasText: `Agua ${s}` }).click();
    await expect(ventana.locator('.tp-linea'), 'tres lineas tomadas').toHaveCount(3);
    await expect(ventana.locator('.tp-enviar'), 'sin mesa todavia no hay nada que enviar').toHaveCount(0);

    await ventana.locator('.tp-servicio button', { hasText: 'Aquí' }).click();
    const selector = ventana.locator('hx-selector-mesas');
    await expect(selector, '«Aqui» sin mesa abre el selector, sin salir de Venta').toBeVisible();
    await expect(ventana.locator('app-touch-pos .tp-card').first(), 'Venta sigue debajo').toBeAttached();
    const libre = selector.locator('.sm-mesa', { hasText: local.mesa });
    await expect(libre.locator('.sm-mesa__est'), 'la mesa esta libre').toHaveText('Libre');
    await libre.click();
    await expect(selector, 'elegir la cierra').toHaveCount(0);

    await expect(ventana.locator('.tp-cart__mesa'), 'la cuenta dice de que mesa es').toContainText(local.mesa);
    await expect(ventana.locator('.tp-linea'), 'lo tomado pasa a la mesa').toHaveCount(3);
    await expect(ventana.locator('.tp-cuenta:not(.tp-cuenta--add)'), 'en la MISMA pestana: no se duplica la cuenta').toHaveCount(pestanas);
    await expect(ventana.locator('.tp-linea__estado.es-pendiente'), 'las tres, pendientes').toHaveCount(3);

    // ------------------------------------------------------------- enviar
    const enviar = ventana.locator('.tp-enviar');
    await expect(enviar, 'Enviar a preparación, con lo pendiente').toContainText('Enviar a preparación');
    await expect(enviar).toContainText('3');
    await enviar.click();
    await expect(ventana.locator('.tp-linea.es-enviada'), 'las tres quedan enviadas').toHaveCount(3);
    await expect(enviar, 'y ya no hay nada pendiente').toHaveCount(0);
    await expect(estado(`Latte ${s}`), 'el latte, a la barra').toHaveText(`Enviado a Barra ${s}`);
    await expect(estado(`Croissant ${s}`), 'el croissant, a la cocina').toHaveText(`Enviado a Cocina ${s}`);
    await expect(estado(`Agua ${s}`), 'el agua no se prepara').toHaveText('Enviado');

    let cuenta = await w(ventana, () => window.wybix.salon.get());
    let m = (cuenta.sets[1] || []).find(x => x.nombre === local.mesa);
    expect(m.estado, 'la mesa queda ABIERTA').toBe('ABIERTA');
    expect(m.comandas_pendientes, 'con dos comandas: barra y cocina, el agua no').toBe(2);
    const cuentaId = m.cuenta_id;

    // ---------------------------------------------- lo enviado no se toca
    const enviada = ventana.locator('.tp-linea.es-enviada', { hasText: `Croissant ${s}` });
    await expect(enviada.locator('.tp-linea__qty button'), 'sin botones de cantidad').toHaveCount(0);

    // ------------------------------------ segunda ronda: solo lo nuevo sale
    await ventana.locator('.tp-card', { hasText: `Croissant ${s}` }).click();
    await expect(ventana.locator('.tp-linea'), 'lo nuevo va aparte de lo enviado').toHaveCount(4);
    await expect(ventana.locator('.tp-linea__estado.es-pendiente'), 'UNA pendiente').toHaveCount(1);
    await expect(enviar).toContainText('1');
    await enviar.click();
    await expect(ventana.locator('.tp-linea.es-enviada')).toHaveCount(4);
    const enBase = await lineasEnBase(cuentaId);
    expect(enBase.filter(l => l.nombre === `Latte ${s}`).length, 'el latte NO se reenvia').toBe(1);
    expect(enBase.length, 'la base tiene cuatro lineas, no siete').toBe(4);
    cuenta = await w(ventana, () => window.wybix.salon.get());
    m = (cuenta.sets[1] || []).find(x => x.nombre === local.mesa);
    expect(m.comandas_pendientes, 'la segunda ronda genera UNA comanda').toBe(3);
    expect(Number(m.total), 'el total cuenta la avena').toBe(52 + 8 + 45 + 20 + 45);

    /* Reintentar el mismo envio -una respuesta perdida- no duplica nada. */
    const latte = enBase.find(l => l.nombre === `Latte ${s}`);
    const reintento = await w(ventana, ([c, l]) => window.wybix.cuentas.enviar({
      cuentaId: c, lineas: [{ productId: l.product_id, cantidad: 1, origen: l.origen }],
    }), [cuentaId, latte]);
    expect(reintento?.success, 'el reintento no falla').toBeTruthy();
    expect(reintento.data.orden?.repetidas, 'lo reconoce como repetido').toBe(1);
    expect((await lineasEnBase(cuentaId)).length, 'y la cuenta sigue con cuatro').toBe(4);

    // --------------------------------------------------- la cocina avisa
    const kds = await w(ventana, () => window.wybix.kds.listar({ stationId: null }));
    const comandaLatte = (kds.sets[0] || []).find(c => c.id === latte.comanda_id);
    await w(ventana, (id) => window.wybix.kds.estado({ comandaId: id, estado: 'LISTA' }), comandaLatte.id);
    await expect(estado(`Latte ${s}`), 'lo que la barra marco listo se ve en la cuenta').toHaveText('Listo', { timeout: 15000 });

    // ------------------------ una mesa OCUPADA trae su cuenta, no otra nueva
    await ventana.click('.tp-cuenta--add');
    await expect(ventana.locator('.tp-linea'), 'pestana nueva, vacia').toHaveCount(0);
    await ventana.click('.tp-iconbtn--txt:has-text("Mesas")');
    const ocupada = ventana.locator('hx-selector-mesas .sm-mesa', { hasText: local.mesa });
    await expect(ocupada, 'el boton Mesas abre el selector rapido').toBeVisible();
    await expect(ocupada).toHaveClass(/es-abierta/);
    await ocupada.click();
    await expect(ventana.locator('.tp-cart__mesa')).toContainText(local.mesa);
    await expect(ventana.locator('.tp-linea.es-enviada'), 'con lo que ya tenia').toHaveCount(4);
    expect((await w(ventana, () => window.wybix.salon.get())).sets[1].filter(x => x.cuenta_id === cuentaId).length,
      'sigue siendo la MISMA cuenta').toBe(1);

    // ------------------------------------------------------------- cobrar
    const antes = (await ventas(app)).length;
    await ventana.click('.tp-cart__foot .tp-primaria');
    await ventana.locator('.tp-rapidas button').first().click();
    await ventana.click('.tp-cobro__confirmar');
    await expect.poll(async () => (await ventas(app)).length, { timeout: 30000 }).toBe(antes + 1);
    const venta = (await ventas(app))[0];
    expect(Number(venta.total), 'se cobra lo de la cuenta').toBe(170);

    await expect.poll(async () => {
      const r = await w(ventana, () => window.wybix.salon.get());
      return (r.sets[1] || []).find(x => x.nombre === local.mesa)?.estado;
    }, { timeout: 15000, message: 'la mesa se libera al cobrar' }).toBe('LIBRE');

    await ventana.click('.tp-iconbtn--txt:has-text("Mesas")');
    await expect(ventana.locator('hx-selector-mesas .sm-mesa', { hasText: local.mesa }).locator('.sm-mesa__est'),
      'y el selector la ensena libre').toHaveText('Libre');
    await ventana.locator('hx-selector-mesas').getByRole('button', { name: 'Ver el salón completo' }).click();
    await expect(ventana.locator('app-mesas .mesa', { hasText: local.mesa }).locator('.mesa__estado'),
      'la pantalla completa de Mesas sigue ahi').toHaveText('Libre');
  });

  test('para llevar: no pide mesa, no envia solo, y va a su estacion al pulsar enviar', async ({ app }) => {
    test.setTimeout(180000);
    const { ventana } = app;
    const s = Date.now().toString().slice(-6);
    await entrar(app, CUENTAS.admin);
    await prepararLocal(app, s);
    const userId = (await app.invocar('sesion')).data.userId;
    const abierto = await app.invocar('openShift', { user_id: userId, opening_cash: 1000 });
    expect(abierto?.success || /ya existe un turno/i.test(String(abierto?.error ?? ''))).toBeTruthy();
    await app.invocar('setDeviceConfig', { deviceProfile: 'TOUCH_POS' });
    await salir(ventana);
    await entrar(app, CUENTAS.admin);
    await ventana.waitForSelector('app-touch-pos .tp-card', { timeout: 60000 });

    const comandasDeBarra = async () => ((await w(ventana, () => window.wybix.kds.listar({ stationId: null }))).sets?.[0] || [])
      .filter(c => c.estacion === `Barra ${s}`).length;
    const antes = await comandasDeBarra();

    await ventana.locator('.tp-servicio button', { hasText: 'Para llevar' }).click();
    await expect(ventana.locator('hx-selector-mesas'), 'para llevar no pide mesa').toHaveCount(0);
    await ventana.locator('.tp-card', { hasText: `Latte ${s}` }).click();
    await ventana.locator('.tp-opcion', { hasText: 'Leche entera' }).click();
    await ventana.click('.tp-hoja__add');
    await ventana.waitForTimeout(800);
    expect(await comandasDeBarra(), 'elegir para llevar y agregar NO envia nada').toBe(antes);
    await expect(ventana.locator('.tp-linea__estado.es-pendiente')).toHaveCount(1);

    await ventana.locator('.tp-enviar').click();
    await expect(ventana.locator('.tp-linea.es-enviada'), 'enviado').toHaveCount(1);
    await expect(ventana.locator('.tp-linea__estado'), 'a su estacion').toHaveText(`Enviado a Barra ${s}`);
    await expect(ventana.locator('.tp-cart__mesa'), 'la cuenta dice que es para llevar').toContainText('Para llevar');
    await expect(ventana.locator('.tp-cart__mesa'), 'y lleva su número de pedido del día').toContainText(/Pedido \d+/);
    await expect(ventana.locator('.tp-aviso'), 'la caja dice el número para decírselo al cliente').toContainText(/Pedido \d+ enviado a preparación/);
    expect(await comandasDeBarra(), 'la barra recibe UNA comanda').toBe(antes + 1);
    const kds = await w(ventana, () => window.wybix.kds.listar({ stationId: null }));
    expect((kds.sets[0] || []).some(c => /^Pedido \d+ · Para llevar$/.test(c.destino)), 'la cocina la canta por su número, como para llevar').toBeTruthy();
    await expect(ventana.locator('.tp-enviar'), 'nada pendiente: no hay nada que reenviar').toHaveCount(0);
  });

  test('la cocina: cada estacion ve lo suyo, con sus opciones, y lo lleva hasta entregado', async ({ app }) => {
    test.setTimeout(180000);
    const { ventana } = app;
    const s = Date.now().toString().slice(-6);
    await entrar(app, CUENTAS.admin);
    const local = await prepararLocal(app, s);

    /* La orden se toma por el canal: aqui lo que se prueba es la pantalla
       de cocina. La toma por pantalla la prueba el caso anterior. */
    const mesas = await w(ventana, () => window.wybix.salon.get());
    const mesaId = (mesas.sets[1] || []).find(x => x.nombre === local.mesa).id;
    const ab = await w(ventana, (id) => window.wybix.cuentas.abrir({ mesaId: id }), mesaId);
    const cuentaId = ab.sets[0][0].id;
    const opciones = await w(ventana, (p) => window.wybix.modifiers.list({ productId: p }), local.latte);
    const avena = (opciones?.data?.opciones || []).find(o => o.name === 'Leche de avena');
    expect(avena, 'la opcion de avena existe').toBeTruthy();
    const env = await w(ventana, ([c, l, cr, ag, op]) => window.wybix.cuentas.enviar({
      cuentaId: c,
      lineas: [
        { productId: l, cantidad: 2, opciones: [{ optionId: op, quantity: 1 }] },
        { productId: cr, cantidad: 1, nota: 'bien dorado' },
        { productId: ag, cantidad: 1 },
      ],
    }), [cuentaId, local.latte, local.cro, local.agua, Number(avena.id ?? avena.option_id)]);
    expect(env?.success, JSON.stringify(env)).toBeTruthy();
    expect(env.data.comandas.length, 'dos comandas').toBe(2);

    /* Los modulos se encendieron por el canal: se vuelve a entrar para que
       la interfaz los lea, como tras activarlos en Aplicaciones. */
    await salir(ventana);
    await entrar(app, CUENTAS.admin);
    await ventana.waitForSelector('.wxdock', { timeout: 30000 });

    // ------------------------------------------------ por el dock, a cocina
    await ventana.click('.wxdock button.wxdock__btn:has-text("Venta")');
    await ventana.click('.wxdock__panel a:has-text("Cocina")');
    await ventana.waitForSelector('app-kds', { timeout: 30000 });

    await ventana.locator('.kds-est button', { hasText: `Barra ${s}` }).click();
    const barra = ventana.locator('.kds-card', { hasText: local.mesa });
    await expect(barra, 'la barra ve UNA comanda de esa mesa').toHaveCount(1);
    await expect(barra.locator('.kds-l__nom'), 'con el latte').toHaveText(`Latte ${s}`);
    await expect(barra.locator('.kds-l__cant')).toHaveText('2');
    await expect(barra.locator('.kds-l__op'), 'y la leche de avena a la vista').toContainText('Leche de avena');
    await expect(ventana.locator('.kds-card', { hasText: `Agua ${s}` }), 'el agua no llega a ninguna estacion').toHaveCount(0);

    await ventana.locator('.kds-est button', { hasText: `Cocina ${s}` }).click();
    const cocina = ventana.locator('.kds-card', { hasText: local.mesa });
    await expect(cocina.locator('.kds-l__nom'), 'la cocina ve el croissant').toHaveText(`Croissant ${s}`);
    await expect(cocina.locator('.kds-l__nota'), 'con su nota').toContainText('bien dorado');

    // --------------------------------------------------------- los pasos
    await ventana.locator('.kds-est button', { hasText: `Barra ${s}` }).click();
    const paso = barra.locator('.kds-paso');
    await expect(barra.locator('.kds-card__estado')).toHaveText('Nueva');
    await expect(paso).toHaveText('Empezar');
    await paso.click();
    await expect(barra.locator('.kds-card__estado'), 'Nueva -> Preparando').toHaveText('Preparando');
    await expect(paso).toHaveText('Lista');
    await paso.click();
    await expect(barra.locator('.kds-card__estado'), 'Preparando -> Lista').toHaveText('Lista');
    await expect(paso).toHaveText('Entregada');
    await paso.click();
    await expect(barra, 'Lista -> Entregada, y sale de la pantalla').toHaveCount(0);

    const k = await w(ventana, () => window.wybix.salon.get());
    expect((k.sets[1] || []).find(x => x.nombre === local.mesa).comandas_pendientes,
      'en el salon queda solo la de cocina').toBe(1);
  });
});

/*
 * TOUCH · EL CLIENTE DE LA VENTA Y COBRAR SIN ENVIAR.
 *
 * El cliente vive en el carrito (el mismo `cart.customer` de Venta) y, con
 * una cuenta de Hospitality, en la cuenta (`hosp_cuentas.customer_id`). La
 * pantalla del cliente se abre de verdad y se lee: numero, nombre completo.
 */
test.describe('Touch · cliente de la venta', () => {

  test.afterEach(async ({ app }) => {
    for (const m of ['comandas', 'mesas', 'hospitality']) {
      await app.invocar('modulosSet', m, false).catch(() => {});
    }
  });

  async function aTouch(app, s) {
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);
    const local = await prepararLocal(app, s);
    const userId = (await app.invocar('sesion')).data.userId;
    const abierto = await app.invocar('openShift', { user_id: userId, opening_cash: 1000 });
    expect(abierto?.success || /ya existe un turno/i.test(String(abierto?.error ?? ''))).toBeTruthy();
    await app.invocar('setDeviceConfig', { deviceProfile: 'TOUCH_POS' });
    await salir(ventana);
    await entrar(app, CUENTAS.admin);
    await ventana.waitForSelector('app-touch-pos .tp-card', { timeout: 60000 });
    return local;
  }

  /* Capturas para revisar a ojo, solo si se piden (WYBIX_CAPTURAS). */
  const foto = async (pag, n) => { if (process.env.WYBIX_CAPTURAS) await pag.screenshot({ path: `${process.env.WYBIX_CAPTURAS}/${n}.png` }); };

  const cuentaDeBarra = async (ventana, s) =>
    ((await w(ventana, () => window.wybix.kds.listar({ stationId: null }))).sets?.[0] || [])
      .filter(c => c.estacion === `Barra ${s}`);

  async function pedirLatte(ventana, s) {
    await ventana.locator('.tp-card', { hasText: `Latte ${s}` }).click();
    await ventana.locator('.tp-opcion', { hasText: 'Leche entera' }).click();
    await ventana.click('.tp-hoja__add');
  }

  async function cobrarEnEfectivo(app, ventana) {
    const antes = (await ventas(app)).length;
    await ventana.locator('.tp-rapidas button').first().click();
    await ventana.click('.tp-cobro__confirmar');
    await expect.poll(async () => (await ventas(app)).length, { timeout: 30000 }).toBe(antes + 1);
    return (await ventas(app))[0];
  }

  test('elegir, crear, cambiar y quitar cliente; viaja a la cuenta, a la pantalla del cliente y a la venta', async ({ app }) => {
    test.setTimeout(240000);
    const { ventana } = app;
    const s = Date.now().toString().slice(-6);
    await aTouch(app, s);
    const davidNombre = `David Casillas ${s}`;
    const alta = await app.invocar('createCustomer', null, davidNombre, 'CAKD800101AB1', 'david@correo.mx', '5512345678', 0, 0, true, null, null, null, 0, 0, 0, 0);
    expect(alta?.success, JSON.stringify(alta)).toBeTruthy();
    const david = Number(alta.id);

    /* La pantalla del cliente, abierta de verdad. */
    const ab = await app.invocar('customerDisplayOpen', null);
    expect(ab?.ok, JSON.stringify(ab)).toBeTruthy();
    await expect.poll(() => app.app.windows().some(x => x.url().includes('customer.html')), { timeout: 20000 }).toBeTruthy();
    const pantalla = app.app.windows().find(x => x.url().includes('customer.html'));
    await pantalla.waitForLoadState('domcontentloaded');

    // 1. Touch abre sin cliente
    await expect(ventana.locator('.tp-cliente__vacio'), 'Touch abre sin cliente').toHaveText('Seleccionar');

    // 2-3. buscar y seleccionar a David
    await ventana.locator('.tp-servicio button', { hasText: 'Para llevar' }).click();
    await pedirLatte(ventana, s);
    await ventana.click('.tp-cliente');
    await ventana.fill('#tp-buscar-cliente', `Casillas ${s}`);
    await ventana.locator('.tp-res--cliente', { hasText: davidNombre }).click();
    await expect(ventana.locator('.tp-hoja--cliente'), 'la hoja se cierra al elegir').toHaveCount(0);
    await expect(ventana.locator('.tp-cliente__nombre')).toHaveText(davidNombre);
    await foto(ventana, 'touch-cliente-elegido');

    // 5. la pantalla del cliente dice su nombre (solo el nombre)
    await expect(pantalla.locator('#saleCliente'), 'la pantalla del cliente muestra a David').toHaveText(davidNombre);
    expect(await pantalla.locator('body').innerText(), 'y nada privado').not.toMatch(/5512345678|david@correo|CAKD/);

    // cerrar la hoja sin elegir NO pierde la seleccion
    await ventana.click('.tp-cliente');
    await ventana.locator('.tp-hoja--cliente .tp-iconbtn').click();
    await expect(ventana.locator('.tp-cliente__nombre')).toHaveText(davidNombre);

    // 6. enviar a preparacion: la cuenta nace con el cliente (4: el estado real, no la vista)
    await ventana.locator('.tp-enviar').click();
    await expect(ventana.locator('.tp-linea.es-enviada')).toHaveCount(1);
    await expect(ventana.locator('.tp-aviso')).toContainText(/Pedido \d+ enviado a preparación/);
    const comanda = (await cuentaDeBarra(ventana, s))[0];
    const numero = Number(/^Pedido (\d+)/.exec(comanda.destino)[1]);
    const cuenta = async () => (await w(ventana, (id) => window.wybix.cuentas.obtener({ cuentaId: id }), comanda.cuenta_id)).sets[0][0];
    expect((await cuenta()).customer_id, 'la cuenta guarda al cliente').toBe(david);

    // 10. cambiar David -> María (alta minima desde Touch)
    const mariaNombre = `María López ${s}`;
    await ventana.click('.tp-cliente');
    await ventana.fill('#tp-buscar-cliente', mariaNombre);
    await expect(ventana.locator('.tp-res__vacio')).toContainText('Puedes darlo de alta');
    await foto(ventana, 'touch-cliente-buscar');
    await ventana.getByRole('button', { name: 'Nuevo cliente' }).click();
    await expect(ventana.locator('#tp-cli-nombre'), 'lo buscado se vuelve el nombre').toHaveValue(mariaNombre);
    await foto(ventana, 'touch-cliente-alta');
    await ventana.getByRole('button', { name: 'Guardar y asignar' }).click();
    await expect(ventana.locator('.tp-cliente__nombre')).toHaveText(mariaNombre);
    const maria = (await cuenta()).customer_id;
    expect(maria && maria !== david, 'la cuenta cambia a María').toBeTruthy();
    const creadas = ((await app.invocar('getCustomers')).data || []).filter(c => c.customerName === mariaNombre);
    expect(creadas.length, 'un solo cliente nuevo, del modelo real').toBe(1);

    // 11. quitar cliente
    await ventana.click('.tp-cliente');
    await ventana.getByRole('button', { name: 'Quitar cliente' }).click();
    await expect(ventana.locator('.tp-cliente__vacio')).toHaveText('Seleccionar');
    expect((await cuenta()).customer_id, 'la cuenta se queda sin cliente').toBeNull();
    await expect(pantalla.locator('#saleCliente')).toHaveText('');

    // y de vuelta a David, para cobrar
    await ventana.click('.tp-cliente');
    await ventana.fill('#tp-buscar-cliente', davidNombre);
    await ventana.locator('.tp-res--cliente', { hasText: davidNombre }).click();
    await expect(ventana.locator('.tp-cliente__nombre')).toHaveText(davidNombre);
    expect((await cuenta()).customer_id).toBe(david);

    // 7-8. cobrar: la venta conserva al cliente; la pantalla ensena numero y nombre
    await ventana.click('.tp-cart__foot .tp-primaria');
    await expect(ventana.locator('[role="alertdialog"]'), 'todo estaba enviado: cobra sin preguntar').toHaveCount(0);
    const venta = await cobrarEnEfectivo(app, ventana);
    expect(Number(venta.customer_id), 'la venta conserva al cliente').toBe(david);
    await expect(pantalla.locator('#pedidoNum')).toHaveText(`#${numero}`);
    await expect(pantalla.locator('#pedidoCliente')).toHaveText(davidNombre);
    await foto(pantalla, 'display-cobro-cliente');
    await expect.poll(async () => { const c = await cuenta(); return `${c.estado}:${c.customer_id}`; },
      { timeout: 15000, message: 'la cuenta cobrada queda con el cliente de la venta' }).toBe(`COBRADA:${david}`);

    // 9. el carrito nuevo NO conserva a David
    await expect(ventana.locator('.tp-cliente__vacio'), 'la venta siguiente empieza sin cliente').toHaveText('Seleccionar');

    // 12. una venta sin cliente sigue funcionando (y el agua no va a cocina ni pregunta)
    const barraAntes = (await cuentaDeBarra(ventana, s)).length;
    await ventana.locator('.tp-servicio button', { hasText: 'Para llevar' }).click();
    await ventana.locator('.tp-card', { hasText: `Agua ${s}` }).click();
    await ventana.click('.tp-cart__foot .tp-primaria');
    await expect(ventana.locator('[role="alertdialog"]'), 'un producto sin estación no pide enviar').toHaveCount(0);
    const sinCliente = await cobrarEnEfectivo(app, ventana);
    expect(sinCliente.customer_id ?? null, 'sin cliente').toBeNull();
    expect((await cuentaDeBarra(ventana, s)).length, 'nada llegó a cocina').toBe(barraAntes);
  });

  test('cobrar un para llevar sin enviar: pregunta, envía una sola vez y cobra', async ({ app }) => {
    test.setTimeout(200000);
    const { ventana } = app;
    const s = Date.now().toString().slice(-6);
    await aTouch(app, s);

    await ventana.locator('.tp-servicio button', { hasText: 'Para llevar' }).click();
    await pedirLatte(ventana, s);
    await ventana.locator('.tp-card', { hasText: `Agua ${s}` }).click();
    const antes = (await cuentaDeBarra(ventana, s)).length;

    await ventana.click('.tp-cart__foot .tp-primaria');
    const aviso = ventana.locator('[role="alertdialog"]');
    await expect(aviso, 'no cobra en silencio').toContainText('Hay productos sin enviar a preparación');
    await expect(aviso, 'cuenta solo lo que va a preparación (el agua no)').toContainText('1 producto');
    await foto(ventana, 'touch-sin-enviar');

    // Volver: no envia ni cobra
    await aviso.getByRole('button', { name: 'Volver' }).click();
    expect((await cuentaDeBarra(ventana, s)).length).toBe(antes);
    await expect(ventana.locator('.tp-cobro__confirmar')).toHaveCount(0);

    // Enviar y cobrar
    await ventana.click('.tp-cart__foot .tp-primaria');
    await ventana.locator('[role="alertdialog"]').getByRole('button', { name: 'Enviar y cobrar' }).click();
    await expect(ventana.locator('.tp-cobro__confirmar'), 'pasa al cobro').toBeVisible({ timeout: 20000 });
    const venta = await cobrarEnEfectivo(app, ventana);
    expect(Number(venta.total), 'se cobra todo').toBeGreaterThan(52);
    const barra = await cuentaDeBarra(ventana, s);
    expect(barra.length, 'la barra recibe exactamente una comanda').toBe(antes + 1);
    expect(barra.some(c => /^Pedido \d+ · Para llevar$/.test(c.destino)), 'con su número de pedido').toBeTruthy();
    const ctaId = barra.find(c => /^Pedido \d+ · Para llevar$/.test(c.destino)).cuenta_id;
    await expect.poll(async () => (await w(ventana, (id) => window.wybix.cuentas.obtener({ cuentaId: id }), ctaId)).sets[0][0].estado,
      { timeout: 15000, message: 'la cuenta queda cobrada' }).toBe('COBRADA');
  });
});
