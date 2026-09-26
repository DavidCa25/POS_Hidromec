/**
 * HOSPITALITY, A LA VISTA: un local con vida y las tres pantallas.
 *
 *     npx playwright test e2e/hospitality-visual.spec.js
 *
 * Siembra una cafeteria de verdad -tres areas, mesas libres, abiertas, por
 * cobrar, comandas nuevas, en preparacion y listas- y recorre Mesas, Cocina
 * y Salon y estaciones en claro y en oscuro. Comprueba lo que se puede
 * comprobar sin ojos (cada estado se pinta, nada desborda a lo ancho, nada se
 * corta) y adjunta las capturas al informe para revisarlas con ojos.
 *
 * `WYBIX_CAPTURAS=<carpeta>` guarda ademas las capturas en esa carpeta.
 */
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

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
const ok = (r, que) => expect(r?.success, `${que}: ${JSON.stringify(r)}`).toBeTruthy();

/** Una cafeteria a media manana. Devuelve lo creado para limpiarlo al final. */
async function sembrar(app, s) {
  const { ventana } = app;
  for (const m of ['hospitality', 'mesas', 'comandas']) ok(await app.invocar('modulosSet', m, true), m);

  const estacion = async (nombre, salida = 'PANTALLA') => {
    const r = await w(ventana, ([n, sa]) => window.wybix.estaciones.guardar({ nombre: n, salida: sa }), [nombre, salida]);
    ok(r, nombre); return r.data[0].id;
  };
  const est = { barra: await estacion(`Barra ${s}`), cocina: await estacion(`Cocina ${s}`), postres: await estacion(`Postres ${s}`) };

  let cats = filasDe(await app.invocar('getCategories'));
  if (!cats.length) { await app.invocar('createCategory', { nombre: `Cafeteria ${s}` }); cats = filasDe(await app.invocar('getCategories')); }
  let marcas = filasDe(await app.invocar('getBrands'));
  if (!marcas.length) { await app.invocar('createBrand', { nombre: `Casa ${s}` }); marcas = filasDe(await app.invocar('getBrands')); }
  const idDe = (x) => Number(x?.id ?? x?.category_id ?? x?.brand_id);

  const prod = {};
  for (const [clave, nombre, precio, estKey] of [
    ['latte', 'Latte', 52, 'barra'], ['americano', 'Americano', 38, 'barra'], ['frappe', 'Frappé moka', 68, 'barra'],
    ['chilaquiles', 'Chilaquiles verdes', 115, 'cocina'], ['croissant', 'Croissant jamón y queso', 72, 'cocina'],
    ['pay', 'Pay de queso', 58, 'postres'], ['agua', 'Agua mineral', 25, null],
  ]) {
    const pn = `HV-${clave}-${s}`;
    await app.invocar('agregarProducto', idDe(marcas[0]), idDe(cats[0]), pn, `${nombre} ${s}`, precio, 0,
      null, null, '02', 0.16, null, { inventory_mode: 'NONE', sellable: 1, base_uom: 'pza' });
    const p = filasDe(await app.invocar('getActiveProducts')).find(x => x.part_number === pn);
    expect(p, nombre).toBeTruthy();
    prod[clave] = Number(p.id ?? p.product_id);
    if (estKey) ok(await w(ventana, ([pi, si]) => window.wybix.estaciones.asignar({ productId: pi, stationId: si }), [prod[clave], est[estKey]]), `asignar ${nombre}`);
  }

  const areas = {};
  const mesas = {};
  for (const [area, lista] of [
    [`Salón ${s}`, [['1', 4], ['2', 2], ['3', 4], ['4', 6], ['5', 2], ['6', 4], ['7', 4], ['8', 8]]],
    [`Terraza ${s}`, [['T1', 2], ['T2', 4], ['T3', 4], ['T4', 2]]],
    [`Barra ${s}`, [['B1', 1], ['B2', 1], ['B3', 1]]],
  ]) {
    const r = await w(ventana, (n) => window.wybix.salon.guardarArea({ nombre: n }), area);
    ok(r, area); areas[area] = r.data[0].id;
    for (const [nombre, capacidad] of lista) {
      const m = await w(ventana, ([a, n, c]) => window.wybix.salon.guardarMesa({ areaId: a, nombre: n, capacidad: c }), [areas[area], nombre, capacidad]);
      ok(m, nombre);
    }
  }
  const salon = await w(ventana, () => window.wybix.salon.get());
  for (const m of salon.sets[1] || []) if (Object.values(areas).includes(m.area_id)) mesas[`${m.area_id}:${m.nombre}`] = m.id;
  const mesa = (area, n) => mesas[`${areas[area]}:${n}`];

  const enviar = async (mesaId, lineas) => {
    const ab = await w(ventana, (id) => window.wybix.cuentas.abrir({ mesaId: id }), mesaId);
    ok(ab, 'abrir'); const cuentaId = ab.sets[0][0].id;
    if (lineas.length) ok(await w(ventana, ([c, l]) => window.wybix.cuentas.enviar({ cuentaId: c, lineas: l }), [cuentaId, lineas]), 'enviar');
    return cuentaId;
  };

  const S = `Salón ${s}`, T = `Terraza ${s}`, B = `Barra ${s}`;
  await enviar(mesa(S, '1'), [{ productId: prod.latte, cantidad: 2 }, { productId: prod.croissant, cantidad: 1, nota: 'bien dorado' }]);
  await enviar(mesa(S, '3'), [{ productId: prod.chilaquiles, cantidad: 2, nota: 'sin cebolla' }, { productId: prod.americano, cantidad: 2 }, { productId: prod.agua, cantidad: 1 }]);
  await enviar(mesa(S, '4'), [{ productId: prod.pay, cantidad: 3 }, { productId: prod.frappe, cantidad: 3 }]);
  const c6 = await enviar(mesa(S, '6'), [{ productId: prod.americano, cantidad: 1 }, { productId: prod.agua, cantidad: 1 }]);
  await enviar(mesa(T, 'T2'), [{ productId: prod.frappe, cantidad: 1 }, { productId: prod.chilaquiles, cantidad: 1 }]);
  await enviar(mesa(B, 'B1'), []);

  /* Mueve comandas por el KDS: una en preparacion y otra lista. */
  const kds = await w(ventana, () => window.wybix.kds.listar({ stationId: null }));
  const cab = kds.sets?.[0] || [];
  const deMesa = (n, st) => cab.find(c => c.destino?.endsWith(n) && c.station_id === st) || cab.find(c => String(c.destino).includes(n) && c.station_id === st);
  const prep = deMesa('3', est.cocina);
  if (prep) ok(await w(ventana, (id) => window.wybix.kds.estado({ comandaId: id, estado: 'PREPARANDO' }), prep.id), 'preparando');
  const lista = deMesa('4', est.postres);
  if (lista) ok(await w(ventana, (id) => window.wybix.kds.estado({ comandaId: id, estado: 'LISTA' }), lista.id), 'lista');
  const b6 = deMesa('6', est.barra);
  if (b6) ok(await w(ventana, (id) => window.wybix.kds.estado({ comandaId: id, estado: 'ENTREGADA' }), b6.id), 'entregada');
  ok(await w(ventana, (id) => window.wybix.cuentas.estado({ cuentaId: id, estado: 'POR_COBRAR' }), c6), 'por cobrar');

  return { areas, est };
}

async function limpiar(app, creado) {
  const { ventana } = app;
  for (const [nombre, id] of Object.entries(creado?.areas || {})) {
    await w(ventana, ([i, n]) => window.wybix.salon.guardarArea({ id: i, nombre: n, activa: false }), [id, nombre]).catch(() => {});
  }
  for (const m of ['comandas', 'mesas', 'hospitality']) await app.invocar('modulosSet', m, false).catch(() => {});
}

/** Nada de la pagina se sale a lo ancho, y ningun texto visible se recorta. */
async function sinDesbordes(ventana, raiz) {
  return ventana.evaluate((sel) => {
    const r = document.querySelector(sel);
    if (!r) return ['no hay ' + sel];
    const malos = [];
    if (r.scrollWidth > r.clientWidth + 1) malos.push(`${sel} desborda a lo ancho (${r.scrollWidth} > ${r.clientWidth})`);
    const caja = r.getBoundingClientRect();
    for (const el of r.querySelectorAll('*')) {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      if (b.right > caja.right + 2 && getComputedStyle(el).position !== 'fixed') {
        malos.push(`${el.className || el.tagName} se sale por la derecha`);
      }
    }
    return [...new Set(malos)].slice(0, 8);
  }, raiz);
}

async function capturar(ventana, testInfo, nombre) {
  await ventana.waitForTimeout(450); // que terminen las entradas suaves
  const png = await ventana.screenshot({ fullPage: true });
  await testInfo.attach(nombre, { body: png, contentType: 'image/png' });
  const dir = process.env.WYBIX_CAPTURAS;
  if (dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${nombre}.png`), png); }
}

const tema = (ventana, oscuro) => ventana.evaluate((o) => document.documentElement.classList.toggle('dark', o), oscuro);
/* Por el dock, como una persona. Desde Cocina -que va sin panel- se sale primero. */
async function ir(ventana, destino) {
  if (await ventana.locator('app-kds').count()) {
    await ventana.click('.kds-salir');
    await ventana.waitForSelector('.wxdock', { timeout: 30000 });
  }
  await irPorDock(ventana, 'Venta', destino);
}

test('Hospitality a la vista: Mesas, Cocina y Salon con un local en marcha', async ({ app }, testInfo) => {
  test.setTimeout(300000);
  const { ventana } = app;
  const s = Date.now().toString().slice(-4);
  let creado = null;
  await ventana.setViewportSize({ width: 1440, height: 900 }).catch(() => {});

  try {
    await entrar(app, CUENTAS.admin);
    creado = await sembrar(app, s);
    await salir(ventana);
    await entrar(app, CUENTAS.admin);
    await ventana.waitForSelector('.wxdock', { timeout: 30000 });

    for (const oscuro of [false, true]) {
      const t = oscuro ? 'oscuro' : 'claro';
      await tema(ventana, oscuro);

      // ------------------------------------------------------------ MESAS
      await ir(ventana, 'Mesas');
      await ventana.waitForSelector('app-mesas .mesa', { timeout: 30000 });
      for (const e of ['es-libre', 'es-abierta', 'es-por_cobrar']) {
        await expect(ventana.locator(`app-mesas .mesa.${e}`).first(), `Mesas pinta ${e}`).toBeVisible();
      }
      expect(await sinDesbordes(ventana, 'app-mesas'), 'Mesas sin desbordes').toEqual([]);
      await capturar(ventana, testInfo, `mesas-${t}`);

      // ----------------------------------------------------------- COCINA
      await ir(ventana, 'Cocina');
      await ventana.waitForSelector('app-kds .kds-card', { timeout: 30000 });
      await ventana.locator('.kds-est button').first().click();
      for (const e of ['es-nueva', 'es-preparando', 'es-lista']) {
        await expect(ventana.locator(`app-kds .kds-card.${e}`).first(), `KDS pinta ${e}`).toBeVisible();
      }
      expect(await sinDesbordes(ventana, 'app-kds'), 'KDS sin desbordes').toEqual([]);
      await capturar(ventana, testInfo, `kds-${t}`);

      // ------------------------------------------------- SALON Y ESTACIONES
      await ir(ventana, 'Salon y estaciones');
      await ventana.waitForSelector('app-salon-admin .sa-area', { timeout: 30000 });
      expect(await sinDesbordes(ventana, 'app-salon-admin'), 'Salon sin desbordes').toEqual([]);
      await capturar(ventana, testInfo, `salon-${t}`);

      await ventana.locator('app-salon-admin .sa-tabs button', { hasText: 'Estaciones' }).click();
      await ventana.waitForSelector('app-salon-admin .sa-estacion', { timeout: 30000 });
      expect(await sinDesbordes(ventana, 'app-salon-admin'), 'Estaciones sin desbordes').toEqual([]);
      await capturar(ventana, testInfo, `estaciones-${t}`);
    }

    await tema(ventana, false);

    // ------------------------------------------ SALON: el plano se edita en su sitio
    await ir(ventana, 'Salon y estaciones');
    await ventana.locator('app-salon-admin .sa-tabs button', { hasText: 'Salón' }).click();
    await ventana.waitForSelector('app-salon-admin .sa-area', { timeout: 30000 });
    const salon = ventana.locator('app-salon-admin .sa-area', { hasText: `Salón ${s}` });
    await salon.locator('.sa-mesa', { hasText: '2' }).first().click();
    const editor = salon.locator('.sa-editor');
    await expect(editor, 'tocar una mesa abre su editor, sin ventana encima').toBeVisible();
    await expect(editor.locator('#sa-mesa-nombre')).toHaveValue('2');
    await expect(editor.locator('.sa-pasos output')).toHaveText('2');
    await editor.getByRole('button', { name: 'Un lugar más' }).click();
    await editor.getByRole('button', { name: 'Un lugar más' }).click();
    await expect(editor.locator('.sa-pasos output')).toHaveText('4');
    await capturar(ventana, testInfo, 'salon-editor-claro');
    await editor.getByRole('button', { name: 'Guardar' }).click();
    await expect(editor, 'guardar cierra el editor').toHaveCount(0);
    await expect.poll(async () => {
      const r = await w(ventana, () => window.wybix.salon.get());
      return (r.sets[1] || []).find(x => x.area_id === creado.areas[`Salón ${s}`] && x.nombre === '2')?.capacidad;
    }, { message: 'los lugares se guardan' }).toBe(4);

    /* Una mesa en uso se puede renombrar, no quitar. */
    await salon.locator('.sa-mesa.en-uso').first().click();
    await expect(salon.locator('.sa-editor__quitar'), 'con cuenta abierta no se quita').toBeDisabled();
    await salon.locator('.sa-editor').getByRole('button', { name: 'Cancelar' }).click();

    /* Agregar mesa sigue el patron del area y la abre para editarla. */
    const terraza = ventana.locator('app-salon-admin .sa-area', { hasText: `Terraza ${s}` });
    await expect(terraza.locator('.sa-mesa--nueva'), 'anuncia el nombre que tendra').toContainText('T5');
    await terraza.locator('.sa-mesa--nueva').click();
    await expect(terraza.locator('.sa-mesa:not(.sa-mesa--nueva)', { hasText: 'T5' })).toHaveCount(1);
    await expect(terraza.locator('#sa-mesa-nombre'), 'y queda abierta').toHaveValue('T5');
    await terraza.locator('.sa-editor .sa-editor__quitar').click();
    await expect(terraza.locator('.sa-mesa:not(.sa-mesa--nueva)', { hasText: 'T5' }), 'y se puede quitar').toHaveCount(0);

    // --------------------------------- ESTACIONES: se nota lo que falta guardar
    await ventana.locator('app-salon-admin .sa-tabs button', { hasText: 'Estaciones' }).click();
    const barra = ventana.locator('app-salon-admin .sa-estacion').filter({ has: ventana.locator(`input[aria-label="Nombre de la estación"]`) }).first();
    await expect(barra.locator('.sa-estacion__estado')).toHaveText(/Al día/);
    await barra.getByRole('radio', { name: 'Impresora' }).click();
    await expect(barra.locator('.sa-estacion__estado'), 'un cambio se nota').toHaveText(/sin guardar/);
    await expect(barra.locator('wx-select'), 'y pide la impresora').toBeVisible();
    await barra.getByRole('radio', { name: 'Pantalla' }).click();
    await expect(barra.locator('.sa-estacion__estado'), 'deshacerlo tambien').toHaveText(/Al día/);

    const filtro = ventana.locator('app-salon-admin .sa-prod__filtros .wx-seg__op', { hasText: 'Sin preparación' });
    await filtro.click();
    await expect(ventana.locator('app-salon-admin .sa-prod__fila', { hasText: `Agua mineral ${s}` }), 'el filtro por estacion funciona').toHaveCount(1);
    await expect(ventana.locator('app-salon-admin .sa-prod__fila', { hasText: `Latte ${s}` })).toHaveCount(0);

    // -------------------------------------------- COCINA: al dia, y angosta
    const nueva = await w(ventana, (n) => window.wybix.estaciones.guardar({ nombre: n, salida: 'PANTALLA' }), `Vacía ${s}`);
    ok(nueva, 'estacion vacia');
    await ir(ventana, 'Cocina');
    await ventana.waitForSelector('app-kds .kds-est', { timeout: 30000 });
    await ventana.locator('.kds-est button', { hasText: `Vacía ${s}` }).click();
    await expect(ventana.locator('app-kds .kds-vacio'), 'estado vacio').toBeVisible();
    await expect(ventana.locator('app-kds .kds-est button', { hasText: `Barra ${s}` }).locator('.wx-seg__n'),
      'cada estacion dice cuantas tiene').not.toHaveText('0');
    await capturar(ventana, testInfo, 'kds-vacio');
    await w(ventana, ([i, n]) => window.wybix.estaciones.guardar({ id: i, nombre: n, salida: 'PANTALLA', activa: false }), [nueva.data[0].id, `Vacía ${s}`]);
    await ventana.locator('.kds-est button').first().click();

    await ventana.setViewportSize({ width: 820, height: 1000 }).catch(() => {});
    await ventana.waitForTimeout(300);
    expect(await sinDesbordes(ventana, 'app-kds'), 'KDS angosto sin desbordes').toEqual([]);
    await capturar(ventana, testInfo, 'kds-angosto');
    await ir(ventana, 'Mesas');
    await ventana.waitForSelector('app-mesas .mesa', { timeout: 30000 });
    expect(await sinDesbordes(ventana, 'app-mesas'), 'Mesas angosta sin desbordes').toEqual([]);
    await capturar(ventana, testInfo, 'mesas-angosto');
    await ir(ventana, 'Salon y estaciones');
    await ventana.locator('app-salon-admin .sa-tabs button', { hasText: 'Estaciones' }).click();
    await ventana.waitForSelector('app-salon-admin .sa-estacion', { timeout: 30000 });
    expect(await sinDesbordes(ventana, 'app-salon-admin'), 'Estaciones angosta sin desbordes').toEqual([]);
    await capturar(ventana, testInfo, 'estaciones-angosto');
  } finally {
    await limpiar(app, creado);
  }
});
