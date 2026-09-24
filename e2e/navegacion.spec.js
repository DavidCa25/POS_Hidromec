/**
 * DOCK Y BARRA LATERAL: UNA NAVEGACION, DOS FORMAS.
 *
 *     npx playwright test e2e/navegacion.spec.js
 *
 * Todo por la interfaz: se cambia de forma pulsando el tirador del borde, se
 * navega pulsando destinos, y lo que se compara es lo que hay en pantalla.
 * `invocar` solo se usa para preparar (el modulo de Hospitality) y para
 * comprobar la sesion.
 */
const { test, expect, CUENTAS } = require('./fixtures');
const { _electron: electron } = require('@playwright/test');
const { opcionesDeArranque } = require('./perfil');

async function entrar(app, cuenta) {
  const { ventana } = app;
  await ventana.waitForSelector('#username', { timeout: 60000 });
  await ventana.fill('#username', cuenta.usuario);
  await ventana.fill('#password', cuenta.password);
  await ventana.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario ?? null; } catch { return null; }
  }, { timeout: 30000 }).toBe(cuenta.usuario);
  await ventana.waitForSelector('.wxdock, .wxside', { timeout: 30000 });
}

async function salir(ventana) {
  await ventana.click('.wx-yo__btn');
  await ventana.click('.wx-yo__fila:has-text("Cerrar sesión")');
  await ventana.waitForSelector('#username', { timeout: 30000 });
}

const ruta = (ventana) => ventana.evaluate(() => location.pathname.replace(/^.*(\/dashboard\/)/, '$1'));

/** ¿Que forma hay montada? */
async function modo(ventana) {
  const dock = await ventana.locator('.wxdock').count();
  const barra = await ventana.locator('.wxside').count();
  if (dock && !barra) return 'dock';
  if (barra && !dock) return 'sidebar';
  return `ambigua (dock ${dock}, barra ${barra})`;
}

/** Las animaciones del cambio de forma. La mascota y otros tienen las suyas,
    que no son de la navegacion y no terminan nunca. */
const animacionesNav = (ventana) => ventana.evaluate(() => document.getAnimations()
  .filter(a => a.playState === 'running'
    && a.effect?.target?.closest?.('.wxdock, .wxside, .wxmodo, .dashboard-content')
    && !a.effect.target.closest('wx-mascota')).length);

/** Espera a que terminen las animaciones del cambio. */
const quieta = (ventana) => expect.poll(() => animacionesNav(ventana), { timeout: 5000 }).toBe(0);

async function aBarra(ventana) {
  await ventana.click('.wxmodo.es-dock');
  await ventana.waitForSelector('.wxside', { timeout: 5000 });
  await quieta(ventana);
}
async function aDock(ventana) {
  await ventana.click('.wxmodo.es-sidebar');
  await ventana.waitForSelector('.wxdock', { timeout: 5000 });
  await quieta(ventana);
}

/** En Electron el href es la ruta del archivo; lo que importa es el destino. */
const destino = (h) => String(h).replace(/^.*(\/dashboard\/)/, '$1');

/** Todo destino alcanzable pulsando en el dock: areas, sus ventanas y «Mas». */
async function destinosDock(ventana) {
  const set = new Set((await ventana.$$eval('.wxdock a.wxdock__btn', els => els.map(e => e.getAttribute('href')))).map(destino));
  const conPanel = ventana.locator('.wxdock button.wxdock__btn[aria-haspopup="menu"]:not(.wxdock__btn--mas)');
  const n = await conPanel.count();
  for (let i = 0; i < n; i++) {
    await conPanel.nth(i).click();
    await ventana.waitForSelector('.wxdock__panel', { timeout: 5000 });
    for (const h of await ventana.$$eval('.wxdock__panel a.wxdock__pira', els => els.map(e => e.getAttribute('href')))) set.add(destino(h));
    await ventana.keyboard.press('Escape');
  }
  if (await ventana.locator('.wxdock__btn--mas').count()) {
    await ventana.click('.wxdock__btn--mas');
    await ventana.waitForSelector('.wxdock-pop--mas', { timeout: 5000 });
    for (const h of await ventana.$$eval('.wxdock-pop--mas a', els => els.map(e => e.getAttribute('href')))) set.add(destino(h));
    await ventana.keyboard.press('Escape');
  }
  return [...set].sort();
}

/** Todo destino de la barra: sus enlaces, incluidos los de grupos plegados. */
const destinosBarra = async (ventana) =>
  [...new Set((await ventana.$$eval('.wxside a[href]', els => els.map(e => e.getAttribute('href')))).map(destino))].sort();

test.describe('Navegación · dock y barra lateral', () => {

  test.afterEach(async ({ app }) => {
    await app.invocar('modulosSet', 'hospitality', false).catch(() => {});
  });

  test('el recorrido: dock por defecto, barra, Inventario, QuickStart, Compras, y de vuelta al dock', async ({ app }) => {
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);

    // 1) Por defecto, dock.
    await ventana.waitForSelector('app-inicio');
    expect(await modo(ventana), 'la primera vez se entra con dock').toBe('dock');
    await expect(ventana.locator('.wxmodo.es-dock'), 'con su tirador en el borde').toHaveCount(1);

    // A Inventario por el dock, y se deja algo escrito en su buscador.
    await ventana.click('.wxdock button.wxdock__btn:has-text("Inventario")');
    await ventana.click('.wxdock__panel a:has-text("Ver inventario")');
    await ventana.waitForSelector('app-inventario tbody tr', { timeout: 30000 });
    await ventana.fill('app-inventario input[type=search]', 'aceite');
    expect(await ruta(ventana)).toBe('/dashboard/inventario');

    // 2) Dock -> barra, y 4) la pantalla sigue donde estaba.
    await aBarra(ventana);
    expect(await modo(ventana)).toBe('sidebar');
    expect(await ruta(ventana), 'no se navego').toBe('/dashboard/inventario');
    expect(await ventana.inputValue('app-inventario input[type=search]'),
      'ni se reinicio la pantalla: lo escrito sigue ahi').toBe('aceite');
    await expect(ventana.locator('.wxside__link.active'), 'Inventario sigue activo').toContainText('Inventario');
    await expect(ventana.locator('.wxside__item.active'), 'y su destino exacto').toContainText('Ver inventario');

    // QuickStart, Compras, desde la barra.
    await ventana.click('.wxside__item:has-text("Importar productos")');
    await ventana.waitForSelector('wx-quickstart', { timeout: 30000 });
    expect(await ruta(ventana)).toBe('/dashboard/quickstart');

    await ventana.click('.wxside__link:has-text("Compras")');
    await ventana.click('.wxside__item:has-text("Registrar compra")');
    await ventana.waitForSelector('app-registrar-compra, .venta-densa', { timeout: 30000 });
    expect(await ruta(ventana)).toBe('/dashboard/registrarCompra');
    await expect(ventana.locator('.wxside__link.active')).toContainText('Compras');

    // 3) Barra -> dock, con la misma ruta activa.
    await aDock(ventana);
    expect(await modo(ventana)).toBe('dock');
    expect(await ruta(ventana), 'la misma ruta').toBe('/dashboard/registrarCompra');
    await expect(ventana.locator('.wxdock__btn.is-on'), 'y Compras encendido en el dock').toContainText('Compras');
  });

  test('la preferencia es de cada persona y sobrevive a cerrar sesión y a cerrar Wybix', async ({ app }) => {
    test.setTimeout(180000);
    const { ventana } = app;

    // David elige barra.
    await entrar(app, CUENTAS.admin);
    await aBarra(ventana);
    await salir(ventana);

    // Otra cuenta en la misma caja: su preferencia, que aun es la de fabrica.
    await entrar(app, CUENTAS.encargado);
    expect(await modo(ventana), 'otra persona sigue con dock').toBe('dock');
    await salir(ventana);

    // 8) Al volver a entrar, David encuentra su barra.
    await entrar(app, CUENTAS.admin);
    expect(await modo(ventana), 'la preferencia vuelve con quien entra').toBe('sidebar');
    await salir(ventana);

    // 7) Cerrar Wybix y abrirlo otra vez, con el mismo perfil de la caja.
    await app.app.close();
    const otra = await electron.launch(opcionesDeArranque(app.perfil));
    try {
      const v2 = await otra.firstWindow({ timeout: 120000 });
      await v2.waitForFunction(() => !!window.electronAPI, null, { timeout: 60000 });
      const app2 = { ventana: v2, invocar: (m, ...a) => v2.evaluate(([mm, aa]) => window.electronAPI[mm](...aa), [m, a]) };

      await entrar(app2, CUENTAS.admin);
      expect(await modo(v2), 'tras reabrir, David sigue con barra').toBe('sidebar');
      await salir(v2);

      await entrar(app2, CUENTAS.encargado);
      expect(await modo(v2), 'y la otra cuenta, con dock').toBe('dock');
    } finally {
      await otra.close().catch(() => {});
    }
  });

  test('las dos formas ofrecen exactamente los mismos destinos, por permisos y por módulos', async ({ app }) => {
    test.setTimeout(180000);
    const { ventana } = app;

    // 9) Permisos: dos roles distintos.
    for (const cuenta of [CUENTAS.admin, CUENTAS.operador]) {
      await entrar(app, cuenta);
      const enDock = await destinosDock(ventana);
      await aBarra(ventana);
      const enBarra = await destinosBarra(ventana);
      expect(enBarra, `${cuenta.etiqueta}: la barra ofrece lo mismo que el dock`).toEqual(enDock);
      await aDock(ventana);
      await salir(ventana);
    }

    // 10) Capabilities: con Hospitality encendido aparecen las recetas, en las dos.
    await entrar(app, CUENTAS.admin);
    expect((await app.invocar('modulosSet', 'hospitality', true))?.success).toBeTruthy();
    await salir(ventana);
    await entrar(app, CUENTAS.admin);
    const conDock = await destinosDock(ventana);
    await aBarra(ventana);
    const conBarra = await destinosBarra(ventana);
    expect(conDock, 'el dock ofrece recetas con Hospitality').toContain('/dashboard/recetas');
    expect(conBarra, 'y la barra, las mismas').toEqual(conDock);
    await aDock(ventana);
  });

  test('atajos: Ctrl+K y Ctrl+1..6 funcionan con la barra, sin el dock montado', async ({ app }) => {
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);
    await aBarra(ventana);
    await expect(ventana.locator('.wxdock'), 'el dock no esta montado').toHaveCount(0);

    // 12) Ctrl+3 -> Inventario, Ctrl+1 -> Inicio.
    await ventana.keyboard.press('Control+3');
    await ventana.waitForSelector('app-inventario', { timeout: 30000 });
    await expect(ventana.locator('.wxside__link.active')).toContainText('Inventario');
    await ventana.keyboard.press('Control+1');
    await ventana.waitForSelector('app-inicio', { timeout: 30000 });

    // 11) Ctrl+K abre la paleta y lleva a donde se escribe.
    await ventana.keyboard.press('Control+k');
    await ventana.waitForSelector('#wxpal-q', { timeout: 5000 });
    await ventana.fill('#wxpal-q', 'proveedores');
    await ventana.keyboard.press('Enter');
    await ventana.waitForSelector('app-proveedores', { timeout: 30000 });
    await expect(ventana.locator('.wxside__item.active'), 'y la barra marca el destino').toContainText('Proveedores');

    // La lupa de la barra abre la misma paleta.
    await ventana.click('.wxside__buscar');
    await expect(ventana.locator('#wxpal-q')).toBeVisible();
    await ventana.keyboard.press('Escape');
    await aDock(ventana);
  });

  test('sin overlays huérfanos al cambiar, con teclado y con el dedo', async ({ app }) => {
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);

    // Un panel del dock fijado y el panel de Wybix abierto...
    await ventana.click('.wxdock button.wxdock__btn:has-text("Venta")');
    await ventana.waitForSelector('.wxdock__panel');
    await ventana.click('.wxdock__pulso');
    await ventana.waitForSelector('.wxg');

    // ...y se cambia con el TECLADO: foco en el tirador y Enter.
    /* Una tecla antes: el foco que llega DESPUES de usar el teclado es el que
       el navegador marca como visible, igual que al llegar tabulando. */
    await ventana.keyboard.press('Shift');
    await ventana.focus('.wxmodo.es-dock');
    await expect(ventana.locator('.wxmodo.es-dock .wxmodo__tip'), 'el tooltip sale con el foco').toHaveCSS('opacity', '1');
    await ventana.keyboard.press('Enter');
    await ventana.waitForSelector('.wxside');
    await quieta(ventana);
    for (const sel of ['.wxdock__panel', '.wxdock-pop', '.wxg', '.wxpal']) {
      await expect(ventana.locator(sel), `no queda ${sel} flotando`).toHaveCount(0);
    }

    // El panel de Wybix se abre desde la barra, y el cambio -de vuelta, con
    // el teclado- tambien lo cierra.
    await ventana.click('.wxside__pulso');
    await ventana.waitForSelector('.wxg');
    await expect(ventana.locator('wx-dock, wx-sidebar'), 'una sola forma montada').toHaveCount(1);
    /* El panel abierto lleva su propia cara junto a la frase -en el dock
       tambien-; lo que no puede haber es dos Wybix en la navegacion. */
    const figuras = () => ventana.evaluate(() => [...document.querySelectorAll('wx-dock wx-mascota, wx-sidebar wx-mascota')]
      .filter(m => !m.closest('.wxg')).length);
    expect(await figuras(), 'y una sola figura de Wybix en ella').toBe(1);
    await ventana.keyboard.press('Shift');
    await ventana.focus('.wxmodo.es-sidebar');
    await ventana.keyboard.press('Enter');
    await ventana.waitForSelector('.wxdock');
    await quieta(ventana);
    await expect(ventana.locator('.wxg'), 'el panel de Wybix no se queda').toHaveCount(0);
    expect(await figuras(), 'Wybix vuelve al dock, uno solo').toBe(1);

    // 15) Con el DEDO, en los dos sentidos: un toque de verdad, sin hover.
    const cdp = await ventana.context().newCDPSession(ventana);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    /* Sin raton `(hover: none)` es cierto: el tirador queda asomado y se
       ensancha a zona de dedo. Se mide DESPUES de encender el tactil. */
    expect(await ventana.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
    const tocar = async (sel) => {
      await expect(ventana.locator(sel), 'zona de dedo de 44 px').toHaveCSS('width', '44px');
      const c = await ventana.locator(sel).boundingBox();
      const x = c.x + c.width / 2, y = c.y + c.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await ventana.waitForTimeout(80);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await tocar('.wxmodo.es-dock');
    await ventana.waitForSelector('.wxside', { timeout: 5000 });
    await quieta(ventana);
    await tocar('.wxmodo.es-sidebar');
    await ventana.waitForSelector('.wxdock', { timeout: 5000 });
    await quieta(ventana);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  });

  test('oscuro, movimiento reducido y resoluciones', async ({ app }) => {
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);

    // 14) Movimiento normal: el cambio se anima...
    await ventana.click('.wxmodo.es-dock');
    const animadas = await animacionesNav(ventana);
    expect(animadas, 'con movimiento normal, hay transicion').toBeGreaterThan(0);
    await ventana.waitForSelector('.wxside');
    await quieta(ventana);

    // ...con movimiento reducido, es inmediato y sin desplazamientos.
    await ventana.emulateMedia({ reducedMotion: 'reduce' });
    await ventana.click('.wxmodo.es-sidebar');
    await ventana.waitForSelector('.wxdock', { timeout: 2000 });
    expect(await animacionesNav(ventana), 'sin animaciones de traslado').toBe(0);
    await ventana.emulateMedia({ reducedMotion: null });

    // 13) Oscuro: la barra conserva el navy del rail y el tirador se ve.
    await aBarra(ventana);
    await ventana.click('.dark-toggle-btn');
    const colores = await ventana.evaluate(() => {
      const ref = document.createElement('div');
      ref.style.background = 'var(--wx-rail)';
      document.body.appendChild(ref);
      const rail = getComputedStyle(ref).backgroundColor;
      ref.remove();
      const barra = document.querySelector('.wxside');
      const link = document.querySelector('.wxside__link');
      return {
        oscuro: document.documentElement.classList.contains('dark'),
        rail, fondo: getComputedStyle(barra).backgroundColor, texto: getComputedStyle(link).color,
      };
    });
    expect(colores.oscuro).toBe(true);
    expect(colores.fondo, 'la barra es navy en oscuro').toBe(colores.rail);
    expect(colores.texto, 'con su texto claro').not.toBe(colores.fondo);
    await ventana.click('.dark-toggle-btn');

    // Resoluciones: la barra ocupa sus 250 px y el contenido el resto.
    for (const [w, h] of [[1366, 768], [1600, 900], [1920, 1080]]) {
      await ventana.setViewportSize({ width: w, height: h });
      const m = await ventana.evaluate(() => ({
        barra: document.querySelector('.wxside').getBoundingClientRect().width,
        contenido: document.querySelector('.dashboard-content').getBoundingClientRect().width,
        vw: document.documentElement.clientWidth,
        desborda: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));
      expect(m.barra, `${w}x${h}: la barra mide lo que media la anterior`).toBe(250);
      expect(Math.round(m.barra + m.contenido), `${w}x${h}: el contenido ocupa el resto`).toBe(m.vw);
      expect(m.desborda, `${w}x${h}: sin scroll horizontal`).toBe(false);
    }

    // Plegada: 68 px, y ningun destino desaparece.
    const antes = await destinosBarra(ventana);
    await ventana.click('.wxside__plegar');
    await expect.poll(() => ventana.evaluate(() => document.querySelector('.wxside').getBoundingClientRect().width)).toBe(68);
    expect(await destinosBarra(ventana), 'plegada ofrece lo mismo').toEqual(antes);
    await ventana.click('.wxside__plegar');
    await aDock(ventana);
  });

  test('con Servicios encendido: sus pantallas en las dos formas, y la ruta se conserva', async ({ appServicios: app }) => {
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);

    const enDock = await destinosDock(ventana);
    expect(enDock, 'el dock ofrece las ordenes de servicio').toContain('/dashboard/ordenes-de-servicio/ordenes');
    await aBarra(ventana);
    expect(await destinosBarra(ventana), 'la barra, exactamente las mismas pantallas').toEqual(enDock);

    await ventana.click('.wxside__link:has-text("Servicios")');
    await ventana.click('.wxside__item:has-text("Ordenes")');
    await expect.poll(() => ruta(ventana)).toBe('/dashboard/ordenes-de-servicio/ordenes');
    await expect(ventana.locator('.wxside__link.active')).toContainText('Servicios');

    await aDock(ventana);
    expect(await ruta(ventana), 'la misma ruta').toBe('/dashboard/ordenes-de-servicio/ordenes');
    await expect(ventana.locator('.wxdock__btn.is-on'), 'Servicios encendido en el dock').toContainText('Servicios');
  });
});
