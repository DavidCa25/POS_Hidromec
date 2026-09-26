/**
 * WYBIX GUIDE, UN NEGOCIO POR GIRO.
 *
 *     npx playwright test e2e/wybix-guide-giros.spec.js
 *
 * La guia no es una: cada negocio ve SUS recorridos y, dentro de cada uno,
 * SUS pasos. Aqui se recorren de verdad, con la aplicacion arrancada:
 *
 *   TIENDA          solo lo general: ni Mesas, ni Cocina, ni Servicios
 *   RESTAURANTE     Mesas y Cocina; en escritorio y en una caja Touch;
 *                   con solo comandas (una cafeteria para llevar), Cocina sin Mesas
 *   MANTENIMIENTO   «Recibir un trabajo» con su activo, sus equipos y su agenda
 *   TALLER          «Recibir un trabajo» con el vehiculo; sin agenda
 *   BELLEZA         «Tu agenda»; con y sin clientes dados de alta
 *
 * Como en giros-recorridos.spec.js, cada caso mira DOS cosas: que lo propio
 * este y que lo de otro giro NO. Y en todos, que la guia no crea nada: ni
 * ventas, ni ordenes, ni citas.
 *
 * El letra a letra lo prueba wybix-guide.spec.js; aqui se corre con
 * movimiento reducido para que la frase salga entera y la prueba vaya al paso
 * de la persona, no al de la voz.
 */
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');
const { nuevoPerfil, opcionesDeArranque } = require('./perfil');

// ================================================================== sesion

async function entrar(ventana, cuenta = CUENTAS.admin) {
  await ventana.waitForSelector('#username', { timeout: 60000 });
  await ventana.fill('#username', cuenta.usuario);
  await ventana.fill('#password', cuenta.password);
  await ventana.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await ventana.evaluate(() => window.electronAPI.sesion()))?.data?.usuario ?? null; } catch { return null; }
  }, { timeout: 30000 }).toBe(cuenta.usuario);
  await ventana.emulateMedia({ reducedMotion: 'reduce' });
}

async function salir(ventana) {
  await ventana.click('.wx-yo__btn');
  await ventana.click('.wx-yo__fila:has-text("Cerrar sesión")');
  await ventana.waitForSelector('#username', { timeout: 30000 });
}

/** Una base propia para un giro: se arranca, se apaga el ofrecimiento automatico y se entra. */
async function abrir(base) {
  const perfil = await nuevoPerfil(base);
  const app = await electron.launch(opcionesDeArranque(perfil));
  const ventana = await app.firstWindow({ timeout: 120000 });
  await ventana.waitForFunction(() => !!(window).electronAPI, null, { timeout: 60000 });
  await ventana.waitForSelector('#username', { timeout: 60000 });
  await ventana.evaluate(() => { try { localStorage.setItem('wx-guide:auto', '0'); } catch { /* noop */ } });
  await entrar(ventana);
  const cerrar = async () => {
    await app.close().catch(() => {});
    try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* noop */ }
  };
  return { ventana, cerrar };
}

async function herramientas() {
  const bases = await import('./preparar-bases.mjs');
  const temporal = await import('../scripts/db/lib/temporal.mjs');
  return { bases, temporal };
}

// =================================================================== guia

const franja = (v) => v.locator('.wxgl');
const fase = (v) => v.evaluate(() => window.wybixGuide?.fase?.() ?? 'sin-guia');
const paso = (v) => v.evaluate(() => window.wybixGuide?.paso?.() ?? null);
const fraseDe = async (v) => ((await v.locator('.wxgl .wx-sr-only').textContent()) || '').trim();
/* El objetivo encuadrado; y solo puede haber UNO. */
const encuadrado = (v) => v.evaluate(() => {
  const m = [...document.querySelectorAll('.driver-active-element')];
  return m.length === 1 ? m[0].getAttribute('data-guide') : (m.length ? `varios:${m.length}` : null);
});
/* Lo que la persona toca: exactamente lo que Wybix esta encuadrando. */
const tocarLoEncuadrado = (v) => v.locator('.driver-active-element').click();

/** Lo que el tablero lista en ESTE negocio. */
async function delTablero(v) {
  await v.click('.wxdock__pulso');
  const hub = v.locator('.wxg');
  await expect(hub).toBeVisible();
  await expect(hub.locator('[data-escenario="core.first_run"]')).toBeVisible();
  const lista = await hub.locator('[data-escenario]').evaluateAll(
    (els) => els.map((e) => ({ id: e.getAttribute('data-escenario'), texto: e.textContent.replace(/\s+/g, ' ').trim() })));
  await v.keyboard.press('Escape');
  await expect(hub).toHaveCount(0);
  return lista;
}

/** Los pasos que le tocarian a este negocio, sin recorrerlos. */
async function pasosDe(v, id) {
  await expect.poll(() => v.evaluate(() => !!window.wybixGuide), { timeout: 30000 }).toBe(true);
  expect(await v.evaluate((i) => window.wybixGuide.iniciar(i), id), `${id} arranca`).toBe(true);
  const p = await paso(v);
  await v.evaluate(() => window.wybixGuide.detener());
  await expect(franja(v)).toHaveCount(0);
  return p.pasos;
}

/* Con WYBIX_CAPTURAS=<carpeta>, cada paso de cada recorrido se fotografia
   ahi: `<escenario>-<nn>-<paso>.png`. Con un prefijo por prueba para que el
   mismo recorrido en dos negocios (escritorio y Touch) no se pise. */
let prefijoFoto = '';
async function foto(v, nombre) {
  if (!process.env.WYBIX_CAPTURAS) return;
  /* El visor y la mirada se asientan tras el foco: una foto a medio mover no dice nada. */
  await v.waitForTimeout(350);
  fs.mkdirSync(process.env.WYBIX_CAPTURAS, { recursive: true });
  await v.screenshot({ path: path.join(process.env.WYBIX_CAPTURAS, `${prefijoFoto}${nombre}.png`) });
}

/**
 * UN RECORRIDO ENTERO, COMO LO HARIA UNA PERSONA.
 *
 * Cada paso se espera hasta que esta listo (hablado y esperando algo). Si
 * espera un boton, se pulsa «Siguiente». Si espera a la persona, lo hace la
 * mano que la prueba da para ese paso; sin mano, se salta. Un objetivo que no
 * aparece es un fallo: en su giro, cada paso tiene donde caer.
 *
 * Devuelve los pasos que le tocaron, los que se VIERON (los opcionales sin
 * objetivo se saltan solos), la frase y lo encuadrado en cada uno.
 */
async function recorrer(v, id, manos = {}) {
  await expect.poll(() => v.evaluate(() => !!window.wybixGuide), { timeout: 30000 }).toBe(true);
  expect(await v.evaluate((i) => window.wybixGuide.iniciar(i), id), `${id} arranca`).toBe(true);
  const pasos = (await paso(v)).pasos;
  const vistos = [];
  const frases = {};
  const guias = {};

  for (let n = 0; n < 40; n++) {
    let listo = null;
    await expect.poll(async () => {
      const f = await fase(v);
      if (f !== 'recorrido') return (listo = { fase: f });
      const p = await paso(v);
      if (p?.perdido) return (listo = { perdido: p.id });
      return (listo = p?.espera ? p : null);
    }, { timeout: 30000, message: `${id}: el paso siguiente queda listo` }).not.toBeNull();

    if (listo.fase) {
      expect(listo.fase, `${id}: termina en el cierre`).toBe('cierre');
      frases.cierre = await fraseDe(v);
      await foto(v, `${id}-${String(vistos.length + 1).padStart(2, '0')}-cierre`);
      await v.locator('.wxgl__btn--cta', { hasText: 'Terminar' }).click();
      await expect(franja(v)).toHaveCount(0);
      return { pasos, vistos, frases, guias };
    }
    if (listo.perdido) throw new Error(`${id}: no encontró el objetivo del paso «${listo.perdido}»`);

    const p = listo;
    vistos.push(p.id);
    frases[p.id] = await fraseDe(v);
    guias[p.id] = await encuadrado(v);
    await foto(v, `${id}-${String(vistos.length).padStart(2, '0')}-${p.id}`);
    if (p.espera === 'boton') await v.locator('.wxgl__btn--cta').click();
    else if (manos[p.id]) await manos[p.id](v);
    else await v.locator('.wxgl__btn', { hasText: 'Saltar' }).click();

    await expect.poll(async () => {
      if ((await fase(v)) !== 'recorrido') return 'fuera';
      return (await paso(v))?.indice !== p.indice ? 'otro' : 'igual';
    }, { timeout: 20000, message: `${id}: sale del paso «${p.id}»` }).not.toBe('igual');
  }
  throw new Error(`${id}: no terminó`);
}

/** Lo que una tienda NO debe ver nunca en su recorrido inicial. */
const DE_OTROS_GIROS = ['mesas-cocina', 'mesas', 'cocina', 'servicios-agenda', 'servicios-ordenes'];

const filas = (r) => Array.isArray(r) ? r : (Array.isArray(r?.recordset) ? r.recordset : (r?.data ?? []));

// ================================================================= tienda

test.describe('Wybix Guide por giro · tienda', () => {

  test('una tienda ve solo lo general: ni Mesas, ni Cocina, ni Servicios', async ({ app }) => {
    prefijoFoto = 'tienda-';
    test.setTimeout(120000);
    const { ventana } = app;
    await entrar(ventana);

    const hub = (await delTablero(ventana)).map((e) => e.id);
    expect(hub).toEqual(expect.arrayContaining(['core.first_run', 'core.venta', 'core.producto']));
    expect(hub.filter((id) => /^(hospitality|servicios|demo)\./.test(id)), 'nada de otro giro').toEqual([]);

    const r = await recorrer(ventana, 'core.first_run');
    expect(r.pasos.length, 'corto').toBeLessThanOrEqual(9);
    expect(r.pasos.filter((id) => DE_OTROS_GIROS.includes(id)), 'el recorrido inicial no habla de mesas ni de servicios').toEqual([]);
    expect(r.guias.venta).toBe('area-venta');
    expect(Object.values(r.frases).join(' '), 'ni las nombra').not.toMatch(/Mesas|Cocina|Servicios/);
  });
});

// ============================================================ restaurante

const w = (ventana, fn, arg) => ventana.evaluate(fn, arg);

/** Lo que un local configuraria antes de abrir: modulos, una estacion y, si hay mesas, el salon. */
async function prepararLocal(app, s, { mesas = true } = {}) {
  const { ventana } = app;
  for (const m of ['hospitality', 'comandas', ...(mesas ? ['mesas'] : [])]) {
    const r = await app.invocar('modulosSet', m, true);
    expect(r?.success, `${m}: ${JSON.stringify(r)}`).toBeTruthy();
  }
  const est = await w(ventana, (n) => window.wybix.estaciones.guardar({ nombre: n, salida: 'PANTALLA' }), `Barra ${s}`);
  expect(est?.success, JSON.stringify(est)).toBeTruthy();
  if (!mesas) return;
  const area = await w(ventana, (n) => window.wybix.salon.guardarArea({ nombre: n }), `Salón ${s}`);
  expect(area?.success, JSON.stringify(area)).toBeTruthy();
  for (const m of [`Mesa A ${s}`, `Mesa B ${s}`]) {
    const r = await w(ventana, ([a, n]) => window.wybix.salon.guardarMesa({ areaId: a, nombre: n }), [area.data[0].id, m]);
    expect(r?.success, JSON.stringify(r)).toBeTruthy();
  }
}

async function abrirTurno(app) {
  const userId = (await app.invocar('sesion')).data.userId;
  const r = await app.invocar('openShift', { user_id: userId, opening_cash: 1000 });
  expect(r?.success || /ya existe un turno/i.test(String(r?.error ?? '')), JSON.stringify(r)).toBeTruthy();
}

const ventas = async (app) => filas(await app.invocar('getSales')).length;

test.describe('Wybix Guide por giro · restaurante', () => {

  test.afterEach(async ({ app }) => {
    for (const m of ['comandas', 'mesas', 'hospitality']) await app.invocar('modulosSet', m, false).catch(() => {});
  });

  test('con mesas y cocina: el tablero, el recorrido inicial, Cocina y Mesas en escritorio', async ({ app }) => {
    prefijoFoto = 'restaurante-escritorio-';
    test.setTimeout(240000);
    const { ventana } = app;
    const s = Date.now().toString().slice(-6);
    await entrar(ventana);
    await prepararLocal(app, s);
    await abrirTurno(app);
    /* Las capacidades se leen al entrar: se vuelve a entrar, como tras configurar. */
    await salir(ventana);
    await entrar(ventana);

    const hub = await delTablero(ventana);
    const ids = hub.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['hospitality.mesas', 'hospitality.cocina']));
    expect(hub.find((e) => e.id === 'hospitality.mesas').texto).toContain('Mesas');
    expect(hub.find((e) => e.id === 'hospitality.cocina').texto).toContain('Cocina');
    expect(ids.filter((id) => id.startsWith('servicios.')), 'un restaurante no ve Servicios').toEqual([]);

    // ---------------------------------------------------- recorrido inicial
    const inicial = await pasosDe(ventana, 'core.first_run');
    expect(inicial, 'menciona Mesas y Cocina').toContain('mesas-cocina');
    expect(inicial.filter((id) => ['mesas', 'cocina', 'servicios-agenda', 'servicios-ordenes'].includes(id))).toEqual([]);
    expect(inicial.length).toBeLessThanOrEqual(9);

    const antes = await ventas(app);

    // --------------------------------------------------------------- cocina
    const cocina = await recorrer(ventana, 'hospitality.cocina');
    expect(ventana.url(), 'la guia llevo a la pantalla de cocina').toContain('/cocina');
    /* «Avanzar una comanda» se enseña solo si hay alguna que avanzar: la base
       compartida puede traer las de otras pruebas. Lo que se exige es que el
       paso aparezca SI Y SOLO SI hay donde caer. */
    const hayComandas = (await ventana.locator('[data-guide="kds-paso"]').count()) > 0;
    expect(cocina.vistos).toEqual(['estaciones', 'comandas', ...(hayComandas ? ['paso'] : []), 'salir']);
    expect(cocina.guias).toMatchObject({ estaciones: 'kds-estaciones', comandas: 'kds-comandas', salir: 'kds-salir' });
    expect(cocina.frases.comandas).toMatch(/Nuevas.*En preparación.*Listas/);

    // ---------------------------------------------------------------- mesas
    const mesas = await recorrer(ventana, 'hospitality.mesas');
    expect(mesas.pasos, 'en escritorio: sin los pasos de la caja Touch').not.toContain('aqui');
    expect(mesas.vistos, 'con mesas creadas no dice «todavia no hay»').toEqual(['salon', 'sin-mesa', 'abrir', 'venta', 'cobro']);
    expect(mesas.guias).toMatchObject({ salon: 'mesas-salon', 'sin-mesa': 'mesas-cuenta-sin-mesa', abrir: 'salon-mesa', venta: 'venta-agregar', cobro: 'venta-cobrar' });
    expect(mesas.frases.salon).toMatch(/Libres.*abiertas.*por cobrar/);

    expect(await ventas(app), 'la guia no vendio nada').toBe(antes);
    /* Encuadro las mesas pero no abrio ninguna de las suyas. */
    await irPorDock(ventana, 'Venta', 'Mesas');
    for (const m of [`Mesa A ${s}`, `Mesa B ${s}`]) {
      /* La clave del ancla es el id de la mesa (estable); aqui se busca por su
         nombre visible, que es lo que la prueba creo. */
      await expect(ventana.locator('[data-guide="salon-mesa"]').filter({ hasText: m }), `${m} sigue libre`)
        .toHaveAttribute('data-guide-estado', 'LIBRE');
    }
  });

  test('solo comandas (sin mesas): ve Cocina y no Mesas', async ({ app }) => {
    prefijoFoto = 'solo-cocina-';
    test.setTimeout(150000);
    const { ventana } = app;
    const s = Date.now().toString().slice(-6);
    await entrar(ventana);
    await prepararLocal(app, s, { mesas: false });
    await salir(ventana);
    await entrar(ventana);

    const ids = (await delTablero(ventana)).map((e) => e.id);
    expect(ids).toContain('hospitality.cocina');
    expect(ids, 'sin salon no hay recorrido de Mesas').not.toContain('hospitality.mesas');

    const inicial = await pasosDe(ventana, 'core.first_run');
    expect(inicial, 'y el recorrido inicial habla solo de la Cocina').toContain('cocina');
    expect(inicial).not.toContain('mesas-cocina');
    expect(inicial).not.toContain('mesas');
  });

  test('en una caja Touch: la mesa se elige sin salir de Venta', async ({ app }) => {
    prefijoFoto = 'restaurante-touch-';
    test.setTimeout(240000);
    const { ventana } = app;
    const s = Date.now().toString().slice(-6);
    await entrar(ventana);
    await prepararLocal(app, s);
    await abrirTurno(app);
    await app.invocar('setDeviceConfig', { deviceProfile: 'TOUCH_POS' });
    await salir(ventana);
    await entrar(ventana);
    await ventana.waitForSelector('[data-guide="touch-cuenta"]', { timeout: 60000 });
    const antes = await ventas(app);

    const r = await recorrer(ventana, 'hospitality.mesas', {
      /* «Aqui» abre el selector de mesas encima de Venta... */
      aqui: async (v) => {
        await tocarLoEncuadrado(v);
        await expect(v.locator('hx-selector-mesas [data-guide="mesas-selector"]')).toBeVisible();
      },
      /* ...y «Sin mesa» lo cierra: la persona elige, la guia sigue. */
      elige: async (v) => {
        await v.locator('hx-selector-mesas button', { hasText: 'Sin mesa' }).click();
      },
    });
    expect(r.pasos, 'en la caja: sin los pasos de escritorio').not.toContain('venta');
    expect(r.vistos).toEqual(['salon', 'sin-mesa', 'aqui', 'elige', 'cuenta', 'cobrar']);
    expect(r.guias).toMatchObject({ salon: 'mesas-salon', aqui: 'venta-servicio', elige: 'mesas-selector', cuenta: 'touch-cuenta', cobrar: 'touch-cobrar' });
    expect(r.frases.cuenta).toContain('Enviar a preparación');
    expect(ventana.url(), 'termina en la caja').toContain('/touch');
    expect(await ventas(app), 'la guia no vendio nada').toBe(antes);
  });
});

// ============================================================== servicios

async function unCliente(ventana, codigo, nombre) {
  await ventana.evaluate(([c, n]) => window.electronAPI.createCustomer(
    c, n, null, null, '3330000000', 0, 0, 1, null, null, null, 0, 0, 0, 0), [codigo, nombre]);
}
const ordenes = async (v) => filas(await v.evaluate(() => window.electronAPI.serviciosOrdenes({ top: 1000 }))).length;
const citas = async (v) => filas(await v.evaluate(() => window.electronAPI.serviciosCitas({
  desde: new Date(Date.now() - 864e5 * 30).toISOString(), hasta: new Date(Date.now() + 864e5 * 60).toISOString(),
}))).length;

/* La recepcion de un trabajo: tocar «Nueva orden» y ver el formulario. */
const manosDeOrden = {
  nueva: async (v) => { await tocarLoEncuadrado(v); },
};

test.describe('Wybix Guide por giro · mantenimiento', () => {

  test('«Recibir un trabajo» con su activo, sus equipos y su agenda; y no abre ninguna orden', async ({ appServicios: app }) => {
    prefijoFoto = 'mantenimiento-';
    test.setTimeout(180000);
    const { ventana } = app;
    await entrar(ventana);
    await unCliente(ventana, `GUIA-${Date.now().toString().slice(-6)}`, 'Cliente de la guía');

    const ids = (await delTablero(ventana)).map((e) => e.id);
    expect(ids, 'entra por las ordenes').toContain('servicios.ordenes');
    expect(ids, 'y no por la agenda, aunque la tenga').not.toContain('servicios.agenda');
    expect(ids.filter((id) => id.startsWith('hospitality.'))).toEqual([]);

    const inicial = await pasosDe(ventana, 'core.first_run');
    expect(inicial).toContain('servicios-ordenes');
    expect(inicial).not.toContain('servicios-agenda');
    expect(inicial.length).toBeLessThanOrEqual(9);

    const antes = await ordenes(ventana);
    const r = await recorrer(ventana, 'servicios.ordenes', manosDeOrden);
    expect(r.vistos).toEqual(['ordenes', 'nueva', 'cliente-activo', 'reportado', 'abrir', 'activos', 'agenda', 'fin']);
    /* La base compartida de Servicios puede venir en MANTENIMIENTO u OTRO
       (otras pruebas cambian el giro): la guia tiene que llamarlo como lo
       llama la pestaña, sea cual sea. El taller y la estetica, abajo, fijan
       el giro con su propia base. */
    const pestana = ((await ventana.locator('[data-guide="srv-tab-activos"]').textContent()) || '').trim();
    expect(pestana.length).toBeGreaterThan(0);
    expect(r.frases['cliente-activo'], 'lo llama como este giro').toContain('su activo');
    expect(r.frases.activos, 'como su pestaña').toContain(`En ${pestana}`);
    expect(r.guias).toMatchObject({ nueva: 'srv-nueva-orden', 'cliente-activo': 'srv-orden-cliente', abrir: 'srv-orden-abrir', activos: 'srv-tab-activos', agenda: 'srv-tab-agenda' });
    expect(await ordenes(ventana), 'la guia no abrio ninguna orden').toBe(antes);
  });
});

/**
 * TALLER Y BELLEZA, CADA UNO EN SU BASE.
 *
 * El giro se guarda por negocio: cada uno levanta la suya y la borra. Nombres
 * propios (no los de giros-recorridos.spec.js) para que las dos pruebas no se
 * pisen la base si alguien las corre a la vez.
 */
const TALLER = 'Wybix_E2E_GuiaTaller';
const BELLEZA = 'Wybix_E2E_GuiaBelleza';

test.describe('Wybix Guide por giro · taller', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async () => {
    const { bases } = await herramientas();
    bases.prepararBase(TALLER, { perfil: 'RETAIL', modulos: ['servicios'], giroServicios: 'TALLER_AUTOMOTRIZ' });
  });
  test.afterAll(async () => {
    const { temporal } = await herramientas();
    try { temporal.eliminar(TALLER); } catch { /* ya no estaba */ }
  });

  test('«Recibir un trabajo» habla del vehículo; sin agenda', async () => {
    prefijoFoto = 'taller-';
    test.setTimeout(180000);
    const { ventana, cerrar } = await abrir(TALLER);
    try {
      await unCliente(ventana, 'GUIA-T', 'Cliente del taller');
      const hub = await delTablero(ventana);
      const ids = hub.map((e) => e.id);
      expect(hub.find((e) => e.id === 'servicios.ordenes')?.texto).toContain('Recibir un trabajo');
      expect(ids, 'un taller no tiene «Tu agenda»').not.toContain('servicios.agenda');

      const inicial = await recorrer(ventana, 'core.first_run');
      expect(inicial.vistos).toContain('servicios-ordenes');
      expect(inicial.frases['servicios-ordenes']).toContain('tus órdenes');
      expect(inicial.pasos.length).toBeLessThanOrEqual(9);

      const antes = await ordenes(ventana);
      const r = await recorrer(ventana, 'servicios.ordenes', manosDeOrden);
      expect(r.pasos, 'sin agenda').not.toContain('agenda');
      expect(r.vistos).toEqual(['ordenes', 'nueva', 'cliente-activo', 'reportado', 'abrir', 'activos', 'fin']);
      expect(r.frases['cliente-activo']).toContain('su vehículo');
      expect(r.frases.activos).toContain('En Vehículos');
      expect(await ordenes(ventana), 'la guia no abrio ninguna orden').toBe(antes);
    } finally { await cerrar(); }
  });
});

test.describe('Wybix Guide por giro · belleza', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async () => {
    const { bases } = await herramientas();
    bases.prepararBase(BELLEZA, { perfil: 'RETAIL', modulos: ['servicios'], giroServicios: 'BELLEZA' });
  });
  test.afterAll(async () => {
    const { temporal } = await herramientas();
    try { temporal.eliminar(BELLEZA); } catch { /* ya no estaba */ }
  });

  test('sin clientes todavía: «Tu agenda» avisa, deja cerrar el aviso y sigue', async () => {
    prefijoFoto = 'belleza-sin-clientes-';
    test.setTimeout(180000);
    const { ventana, cerrar } = await abrir(BELLEZA);
    try {
      const hub = await delTablero(ventana);
      const ids = hub.map((e) => e.id);
      expect(hub.find((e) => e.id === 'servicios.agenda')?.texto).toContain('Tu agenda');
      expect(ids, 'una barberia no «recibe trabajos»').not.toContain('servicios.ordenes');

      const inicial = await recorrer(ventana, 'core.first_run');
      expect(inicial.vistos).toContain('servicios-agenda');
      expect(inicial.vistos).not.toContain('servicios-ordenes');
      expect(inicial.frases['servicios-agenda']).toContain('tu agenda');
      expect(inicial.pasos.length).toBeLessThanOrEqual(9);

      const r = await recorrer(ventana, 'servicios.agenda', {
        nueva: async (v) => {
          await tocarLoEncuadrado(v);
          /* El aviso va por encima de la guia y se puede cerrar con ella abierta. */
          await expect(v.locator('.swal2-title')).toHaveText('Primero, un cliente');
          await v.locator('.swal2-confirm').click();
          await expect(v.locator('.swal2-container')).toHaveCount(0);
        },
      });
      expect(r.vistos, 'el formulario no se abrio: sus pasos se saltan').toEqual(['dia', 'rejilla', 'nueva', 'clientes', 'fin']);
      expect(r.guias.clientes).toBe('area-clientes');
      expect(r.frases.clientes).toContain('Clientes');
    } finally { await cerrar(); }
  });

  test('con un cliente: la cita se enseña campo por campo y no se agenda', async () => {
    prefijoFoto = 'belleza-';
    test.setTimeout(180000);
    const { ventana, cerrar } = await abrir(BELLEZA);
    try {
      await unCliente(ventana, 'GUIA-B', 'Clienta de la estética');
      const antes = await citas(ventana);
      const r = await recorrer(ventana, 'servicios.agenda', { nueva: tocarLoEncuadrado });
      expect(r.pasos, 'sin vehiculos ni activos').not.toContain('activos');
      expect(r.vistos).toEqual(['dia', 'rejilla', 'nueva', 'cliente', 'servicio', 'agendar', 'clientes', 'fin']);
      expect(r.guias).toMatchObject({ cliente: 'srv-cita-cliente', servicio: 'srv-cita-servicio', agendar: 'srv-cita-agendar' });
      expect(Object.values(r.frases).join(' '), 'y nunca habla de vehiculos').not.toMatch(/vehículo|Vehículos/i);
      expect(await citas(ventana), 'la guia no agendo nada').toBe(antes);
    } finally { await cerrar(); }
  });
});
