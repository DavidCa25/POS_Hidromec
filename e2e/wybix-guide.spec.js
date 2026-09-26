/**
 * WYBIX GUIDE, EN UNA INSTALACION NORMAL.
 *
 *     npx playwright test e2e/wybix-guide.spec.js
 *
 * El tablero, el primer uso, un recorrido entero con el presentador, la voz,
 * el foco sobre la pantalla real, las esperas (a que la persona actue, a que
 * algo aparezca), un objetivo que no existe, el dock y la barra, oscuro y
 * claro, el dedo, movimiento reducido... y la guarda: aqui NO hay demo
 * automatica, ni desde el tablero ni pidiendola por fuera.
 *
 * La demo automatica de verdad la prueba e2e/wybix-guide-demos.spec.js.
 */
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

/* Cuantos productos hay de verdad (el canal devuelve el arreglo tal cual). */
async function contarProductos(app) {
  const r = await app.invocar('getActiveProducts');
  return (Array.isArray(r) ? r : (r?.recordset ?? r?.data ?? [])).length;
}

const autoGuia = (ventana, si) => ventana.evaluate((s) => { if (s) localStorage.removeItem('wx-guide:auto'); else localStorage.setItem('wx-guide:auto', '0'); }, si);
const franja = (v) => v.locator('.wxgl');
const texto = (v) => v.locator('.wxgl__texto');
/* La frase completa: la voz la escribe letra a letra; tocarla la completa. */
async function completarFrase(v) {
  await texto(v).click();
  await expect(v.locator('.wxgl .wx-guide-caret')).toHaveCount(0);
}
async function cta(v, nombre) {
  await completarFrase(v);
  await v.locator('.wxgl__btn--cta', { hasText: nombre }).click();
}
/* El objetivo encuadrado; y solo puede haber UNO. */
const activo = (v) => v.evaluate(() => {
  const marcados = [...document.querySelectorAll('.driver-active-element')];
  return marcados.length === 1 ? marcados[0].getAttribute('data-guide') : (marcados.length ? `varios:${marcados.length}` : null);
});

test.describe('Wybix Guide', () => {

  test('el tablero: se abre desde Wybix, lista lo que existe en este negocio, y se cierra', async ({ app }) => {
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);
    await ventana.click('.wxdock__pulso');
    const hub = ventana.locator('.wxg');
    await expect(hub, 'se abre').toBeVisible();
    await expect(hub.locator('h2')).toHaveText('Wybix Guide');
    await expect(hub.locator('[data-escenario="core.first_run"]')).toContainText('Recorrido inicial');
    await expect(hub.locator('[data-escenario="core.venta"]')).toBeVisible();
    await expect(hub.locator('[data-escenario="core.producto"]')).toBeVisible();
    await expect(hub.locator('[data-escenario^="hospitality."]'), 'una tienda no ve Mesas ni Cocina').toHaveCount(0);
    await expect(hub.locator('[data-escenario^="servicios."]'), 'ni recorridos de Servicios').toHaveCount(0);
    await expect(hub.locator('[data-escenario^="demo."]'), 'y en una instalacion normal no hay demos automaticas').toHaveCount(0);
    await expect(hub.locator('.wxg__avance')).toHaveText(/0 de \d+ recorridos/);
    await expect(hub.locator('.wxg__check input'), '«Mostrar al iniciar» encendido').toBeChecked();
    await testInfoCaptura(ventana, 'tablero-claro');

    await ventana.evaluate(() => document.documentElement.classList.add('dark'));
    await expect(hub).toBeVisible();
    const fondo = await hub.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fondo, 'en oscuro el tablero no es blanco').not.toBe('rgb(255, 255, 255)');
    await testInfoCaptura(ventana, 'tablero-oscuro');
    await ventana.evaluate(() => document.documentElement.classList.remove('dark'));

    await ventana.keyboard.press('Escape');
    await expect(hub, 'Escape lo cierra').toHaveCount(0);
    await ventana.click('.wxdock__pulso');
    await expect(hub).toBeVisible();
    await ventana.mouse.click(20, 400);
    await expect(hub, 'un toque fuera lo cierra').toHaveCount(0);

    /* Con permisos de cajero: no ve «Crear un producto» si no opera inventario. */
    await salir(ventana);
    await entrar(app, CUENTAS.operador);
    /* El cajero aterriza en Venta, que le pide abrir turno con un modal; el
       tablero se abre igual desde Wybix. */
    await ventana.locator('.wxdock__pulso').dispatchEvent('click');
    await expect(ventana.locator('.wxg [data-escenario="core.venta"]'), 'el cajero aprende a vender').toBeVisible();
    const inventario = await app.invocar('sesion').then(r => (r?.data?.paquetes || []).includes('INVENTARIO_OPERAR'));
    if (!inventario) {
      await expect(ventana.locator('.wxg [data-escenario="core.producto"]'), 'y no a crear productos que no puede crear').toHaveCount(0);
    }
  });

  test('primer uso: se ofrece, «Ahora no» con «no volver», y es por persona', async ({ app }) => {
    const { ventana } = app;
    await autoGuia(ventana, true);
    await entrar(app, CUENTAS.admin);
    await expect(ventana.locator('.wxgl.fase-saludo'), 'Wybix se ofrece al entrar').toBeVisible({ timeout: 20000 });
    await expect(ventana.locator('.wxgl.wxgl--compacto'), 'en su forma compacta').toHaveCount(1);
    await completarFrase(ventana);
    await expect(texto(ventana)).toHaveText(/Hola, e2e_admin\. Tu negocio ya está listo\. ¿Te enseño Wybix\?/);
    await expect(ventana.locator('.wxdock'), 'no bloquea: el dock sigue ahi').toBeVisible();

    await ventana.locator('.wxgl__check input').check();
    await ventana.locator('.wxgl__btn', { hasText: 'Ahora no' }).click();
    await expect(franja(ventana)).toHaveCount(0);

    await salir(ventana);
    await entrar(app, CUENTAS.admin);
    await ventana.waitForTimeout(2500);
    await expect(franja(ventana), '«no volver a mostrar» se respeta').toHaveCount(0);

    await salir(ventana);
    await entrar(app, CUENTAS.encargado);
    await expect(ventana.locator('.wxgl.fase-saludo'), 'pero es de ESA persona: a otra se le ofrece').toBeVisible({ timeout: 20000 });
    await ventana.locator('.wxgl__btn', { hasText: 'Ahora no' }).click();
  });

  test('recorrido inicial: presentador, voz, foco, avance, volver, terminar y queda hecho', async ({ app }, info) => {
    test.setTimeout(180000);
    const { ventana } = app;
    await autoGuia(ventana, true);
    await entrar(app, CUENTAS.admin);
    await expect(ventana.locator('.wxgl.fase-saludo')).toBeVisible({ timeout: 20000 });
    await cta(ventana, 'Sí, enséñame');

    await expect(ventana.locator('.wxgl.fase-recorrido.wxgl--presentador'), 'el recorrido va en el presentador').toBeVisible();
    await expect(ventana.locator('.wxgl__cuenta')).toHaveText(/1 de \d+/);
    const total = Number((await ventana.locator('.wxgl__cuenta').textContent()).match(/de (\d+)/)[1]);
    expect(total, 'corto').toBeLessThanOrEqual(9);
    await expect(ventana.locator('.wxgl__segs i'), 'un segmento por paso').toHaveCount(total);

    /* La voz escribe: al principio la frase no esta entera y se ve el cursor. */
    await expect(ventana.locator('.wxgl .wx-guide-caret'), 'escribiendo').toHaveCount(1);
    const parcial = (await texto(ventana).textContent()).trim();
    expect(parcial.length, 'no aparece de golpe').toBeLessThan(40);
    await texto(ventana).click();
    await expect(texto(ventana), 'un toque la completa').toHaveText(/Tú decides el ritmo\./);

    await ventana.locator('.wxgl__btn--cta', { hasText: 'Empezar' }).click();
    await expect.poll(() => activo(ventana), { message: 'el foco cae sobre Inicio, en el dock' }).toBe('area-inicio');
    await expect(ventana.locator('.wxgl-visor'), 'con el visor encima').toBeVisible();
    await expect(ventana.locator('.wxgl__cuenta')).toHaveText(new RegExp(`2 de ${total}`));
    await info.attach('recorrido-paso-2.png', { body: await ventana.screenshot(), contentType: 'image/png' });

    await cta(ventana, 'Siguiente');
    await expect.poll(() => activo(ventana)).toBe('area-venta');
    /* Volver un paso. */
    await ventana.locator('.wxgl__btn[aria-label="Paso anterior"]').click();
    await expect.poll(() => activo(ventana), { message: 'Anterior vuelve al paso de antes' }).toBe('area-inicio');

    /* El resto, con el DEDO: un toque tactil real sobre el boton. */
    for (let i = 0; i < total; i++) {
      if (await ventana.locator('.wxgl.fase-cierre').count()) break;
      await completarFrase(ventana);
      const boton = ventana.locator('.wxgl__btn--cta');
      if (!(await boton.count())) break;
      await boton.evaluate((b) => {
        const o = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true };
        b.dispatchEvent(new PointerEvent('pointerdown', o));
        b.dispatchEvent(new PointerEvent('pointerup', o));
        b.click();
      });
      await ventana.waitForTimeout(150);
    }
    await expect(ventana.locator('.wxgl.fase-cierre'), 'llega al cierre').toBeVisible({ timeout: 20000 });
    await expect(texto(ventana)).toContainText('Aquí me encuentras cuando quieras');
    await expect(ventana.locator('.wxgl__check input'), '«no mostrar otra vez» viene marcado').toBeChecked();
    await ventana.locator('.wxgl__btn--cta', { hasText: 'Terminar' }).click();
    await expect(franja(ventana)).toHaveCount(0);
    await expect(ventana.locator('.driver-active-element'), 'y el foco se apaga').toHaveCount(0);

    await ventana.click('.wxdock__pulso');
    await expect(ventana.locator('.wxg [data-escenario="core.first_run"]'), 'queda hecho').toContainText('Hecho');
    await expect(ventana.locator('.wxg__avance')).toHaveText(/1 de \d+ recorridos/);
    await ventana.keyboard.press('Escape');

    /* Persistencia por persona: al volver a entrar no se ofrece otra vez. */
    await salir(ventana);
    await entrar(app, CUENTAS.admin);
    await ventana.waitForTimeout(2500);
    await expect(franja(ventana), 'terminado, no se vuelve a ofrecer solo').toHaveCount(0);

    /* Reiniciar recorridos lo deja como el primer dia. */
    await ventana.click('.wxdock__pulso');
    await ventana.locator('.wxg__reiniciar').click();
    await expect(ventana.locator('.wxg__avance')).toHaveText(/0 de \d+ recorridos/);
  });

  test('crear un producto (guía): navega, espera a la persona y no crea nada por ella', async ({ app }) => {
    test.setTimeout(150000);
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);
    /* Un producto de verdad, para que «no creo nada» se mida sobre algo. */
    await app.invocar('createCategory', { nombre: 'Guía' });
    await app.invocar('createBrand', { nombre: 'Guía' });
    const antes = await contarProductos(app);

    await ventana.click('.wxdock__pulso');
    await ventana.locator('.wxg [data-escenario="core.producto"]').click();

    /* Esta en Inicio: el recorrido navega solo a Inventario con el router. */
    await expect.poll(() => activo(ventana), { timeout: 20000, message: 'navega y encuadra «Agregar producto»' }).toBe('agregar-producto');
    await completarFrase(ventana);
    await expect(ventana.locator('.wxgl__turno'), 'espera a la persona').toBeVisible();
    await expect(ventana.locator('.wxgl__btn--cta'), 'sin «Siguiente»: le toca a ella').toHaveCount(0);

    /* La persona lo pulsa: el formulario tarda en aparecer, y el motor lo espera. */
    await ventana.locator('[data-guide="agregar-producto"]').click();
    await expect.poll(() => activo(ventana), { timeout: 15000, message: 'el campo Nombre, cuando aparece' }).toBe('producto-nombre');
    await ventana.locator('[data-guide="producto-nombre"]').fill('Hecho por la persona');
    await expect.poll(() => activo(ventana), { timeout: 15000, message: 'escribir hace avanzar al precio' }).toBe('producto-precio');
    await ventana.locator('.wxgl__btn', { hasText: 'Omitir' }).click();
    await expect(franja(ventana), 'Omitir detiene').toHaveCount(0);
    await expect(ventana.locator('[data-guide="producto-form"]'), 'y deja el formulario de la persona como estaba').toBeVisible();
    await expect(ventana.locator('[data-guide="producto-nombre"]')).toHaveValue('Hecho por la persona');

    const despues = await contarProductos(app);
    expect(despues, 'la guia no creo ningun producto').toBe(antes);
  });

  test('un objetivo que no existe: Wybix lo dice y deja salir, sin romperse', async ({ app }) => {
    test.setTimeout(120000);
    const { ventana } = app;
    const errores = [];
    ventana.on('pageerror', (e) => errores.push(e.message));
    await entrar(app, CUENTAS.admin);
    /* El objetivo existe pero no se ve (oculto por otra configuracion). */
    await ventana.addStyleTag({ content: '[data-guide="agregar-producto"] { display: none !important; }' });
    await ventana.evaluate(() => window.wybixGuide.iniciar('core.producto'));
    await expect(texto(ventana), 'lo dice como una persona').toContainText('No encontré esta parte de Wybix', { timeout: 25000 });
    /* Y nunca el nombre interno ni el error tecnico. */
    await expect(texto(ventana)).not.toContainText(/agregar-producto|limite|no-encontrado|objetivo/);
    await expect(ventana.locator('.wxgl.es-attention'), 'Wybix pone cara de atencion').toHaveCount(1);
    await ventana.locator('.wxgl__btn', { hasText: 'Salir' }).click();
    await expect(franja(ventana)).toHaveCount(0);
    expect(errores, 'sin errores en la pagina').toEqual([]);
  });

  test('barra lateral: el mismo recorrido encuadra la barra; y movimiento reducido', async ({ app }) => {
    test.setTimeout(120000);
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);
    await ventana.focus('.wxmodo.es-dock');
    await ventana.keyboard.press('Enter');
    await ventana.waitForSelector('.wxside');

    await ventana.emulateMedia({ reducedMotion: 'reduce' });
    await ventana.click('.wxside__pulso');
    await ventana.locator('.wxg [data-escenario="core.first_run"]').click();
    /* Movimiento reducido: la frase sale entera, sin cursor. */
    await expect(texto(ventana)).toContainText('Tú decides el ritmo.');
    await expect(ventana.locator('.wxgl .wx-guide-caret'), 'sin letra a letra').toHaveCount(0);
    await ventana.locator('.wxgl__btn--cta', { hasText: 'Empezar' }).click();
    await expect.poll(() => activo(ventana), { message: 'el foco cae en Inicio, ahora en la BARRA' }).toBe('area-inicio');
    const enBarra = await ventana.evaluate(() => !!document.querySelector('.driver-active-element')?.closest('.wxside'));
    expect(enBarra, 'y ese Inicio es el de la barra lateral').toBe(true);
    await ventana.keyboard.press('Escape');
    await expect(franja(ventana), 'Escape detiene el recorrido').toHaveCount(0);
    await ventana.emulateMedia({ reducedMotion: null });
  });

  test('la guarda: en una base normal no hay demo automatica, ni pidiendola por fuera', async ({ app }) => {
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);
    const ctx = await ventana.evaluate(() => window.wybix.guide.contexto());
    expect(ctx.data.autopilot, 'el proceso principal dice que no').toBe(false);
    const aut = await ventana.evaluate(() => window.wybix.guide.autorizar({ paso: 'crear' }));
    expect(aut.success, 'y no autoriza ningun paso').toBe(false);

    const antes = await contarProductos(app);
    await ventana.evaluate(() => window.wybixGuide.iniciar('demo.retail'));
    await expect(ventana.locator('.wxgl.fase-rechazo'), 'la demo se rechaza, con explicacion').toBeVisible();
    await completarFrase(ventana);
    await expect(texto(ventana)).toContainText('no creo datos por ti');
    await ventana.waitForTimeout(1500);
    await expect(ventana.locator('[data-guide="producto-form"]'), 'ni abrio el formulario').toHaveCount(0);
    expect(await contarProductos(app), 'ni creo nada').toBe(antes);
    await ventana.locator('.wxgl__btn', { hasText: 'Entendido' }).click();
  });
});

async function testInfoCaptura(ventana, nombre) {
  const info = test.info();
  await info.attach(`${nombre}.png`, { body: await ventana.screenshot(), contentType: 'image/png' });
}
