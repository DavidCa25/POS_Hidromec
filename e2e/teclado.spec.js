/**
 * TECLADO EN PANTALLA: AUTO, SIEMPRE y NUNCA, y el fisico a la vez.
 *
 *     npx playwright test e2e/teclado.spec.js
 *
 * Todo en el panel «Configuracion · Este equipo · Teclado en pantalla», que
 * trae tres campos de prueba (texto, dinero, cantidad). El modo se guarda en
 * el device-config del perfil aislado de la prueba, no en el de esta maquina.
 */
const { test, expect, CUENTAS, irPorMas } = require('./fixtures');

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

async function abrirPanel(ventana) {
  await irPorMas(ventana, 'Configuracion');
  await ventana.waitForSelector('.cs-tile', { timeout: 30000 });
  await ventana.locator('.cs-tile').filter({ hasText: 'Teclado en pantalla' }).click();
  await ventana.waitForSelector('app-teclado-panel', { timeout: 15000 });
}

/* Un toque de dedo: el servicio mira `pointerType` del ultimo pointerdown. */
async function tocar(ventana, selector) {
  await ventana.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true,
      clientX: r.x + 5, clientY: r.y + 5 };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.focus();
    el.dispatchEvent(new PointerEvent('pointerup', o));
  }, selector);
}

const tecla = (ventana, t) => ventana.locator('.wxvk .wxvk__k', { hasText: new RegExp(`^\\s*${t.replace(/[.$]/g, '\\$&')}\\s*$`) }).first();

test('Teclado: SIEMPRE, NUNCA y AUTO; el fisico escribe a la vez', async ({ app }) => {
  test.setTimeout(120000);
  const { ventana } = app;
  await entrar(app, CUENTAS.admin);
  await abrirPanel(ventana);

  const texto = ventana.locator('app-teclado-panel input[data-teclado="TEXT"]');
  const dinero = ventana.locator('app-teclado-panel input[data-teclado="MONEY"]');
  const cantidad = ventana.locator('app-teclado-panel input[data-teclado="QUANTITY"]');
  const radio = (v) => ({ check: () => ventana.locator('app-teclado-panel label.wx-choice').filter({ has: ventana.locator(`input[value="${v}"]`) }).click() });
  const teclado = ventana.locator('.wxvk');

  // --------------------------------------------------------------- SIEMPRE
  await radio('SIEMPRE').check();
  await expect.poll(async () => (await app.invocar('getDeviceConfig'))?.teclado?.modo
    ?? (await app.invocar('getDeviceConfig'))?.data?.teclado?.modo, { message: 'se guarda en este equipo' }).toBe('SIEMPRE');

  await texto.click();
  await expect(teclado, 'con raton tambien aparece').toBeVisible();
  await expect(teclado).toHaveClass(/wxvk--text/);
  await expect(texto, 'y el campo pide no abrir el del sistema').toHaveAttribute('inputmode', 'none');

  await tecla(ventana, 'h').click();
  await tecla(ventana, 'o').click();
  await expect(texto, 'las teclas en pantalla no le quitan el foco').toBeFocused();
  await ventana.keyboard.type('la');
  await tecla(ventana, 's').click();
  await expect(texto, 'pantalla y fisico escriben en el mismo sitio').toHaveValue('holas');
  await ventana.locator('.wxvk [aria-label="Borrar"]').click();
  await expect(texto).toHaveValue('hola');

  /* Tab va al siguiente campo y el teclado cambia de forma. */
  await ventana.keyboard.press('Tab');
  await expect(dinero).toBeFocused();
  await expect(teclado, 'dinero lleva el teclado compacto').toHaveClass(/wxvk--money/);
  for (const k of ['1', '2', '.', '5', '0', '9']) {
    if (k === '.') await ventana.keyboard.type('.'); else await tecla(ventana, k).click();
  }
  await expect(dinero, 'dinero no pasa de dos decimales').toHaveValue('12.50');
  await ventana.locator('.wxvk .wxvk__k', { hasText: 'Borrar todo' }).click();
  await tecla(ventana, '00').click();
  await expect(dinero).toHaveValue('00');

  await cantidad.click();
  await expect(teclado).toHaveClass(/wxvk--quantity/);
  await ventana.locator('.wxvk [aria-label="Uno más"]').click();
  await ventana.locator('.wxvk [aria-label="Uno más"]').click();
  await expect(cantidad, 'mas y menos en cantidades').toHaveValue('2');
  await ventana.locator('.wxvk [aria-label="Uno menos"]').click();
  await ventana.locator('.wxvk [aria-label="Uno menos"]').click();
  await ventana.locator('.wxvk [aria-label="Uno menos"]').click();
  await expect(cantidad, 'nunca por debajo de cero').toHaveValue('0');

  /* El campo no queda debajo del teclado. */
  const tapado = await ventana.evaluate(() => {
    const c = document.activeElement.getBoundingClientRect();
    const k = document.querySelector('.wxvk').getBoundingClientRect();
    return !(c.bottom <= k.top || c.top >= k.bottom || c.right <= k.left || c.left >= k.right);
  });
  expect(tapado, 'el campo activo queda a la vista').toBe(false);

  await ventana.locator('.wxvk .wxvk__k--listo').click();
  await expect(teclado, 'Listo lo cierra').toHaveCount(0);
  await expect(cantidad, 'y restaura el inputmode').not.toHaveAttribute('inputmode', 'none');

  await texto.click();
  await expect(teclado).toBeVisible();
  await ventana.locator('.wxvk [aria-label="Ocultar teclado"]').click();
  await expect(teclado, 'se puede ocultar').toHaveCount(0);

  // ----------------------------------------------------------------- NUNCA
  await radio('NUNCA').check();
  await texto.click();
  await tocar(ventana, 'app-teclado-panel input[data-teclado="MONEY"]');
  await ventana.waitForTimeout(300);
  await expect(teclado, 'NUNCA: ni con raton ni con el dedo').toHaveCount(0);
  await dinero.fill('');
  await ventana.keyboard.type('45.5');
  await expect(dinero, 'el fisico sigue funcionando').toHaveValue('45.5');

  // ------------------------------------------------------------------ AUTO
  await radio('AUTO').check();
  await texto.click();
  await ventana.waitForTimeout(300);
  await expect(teclado, 'AUTO fuera de una caja Touch: con raton no sale').toHaveCount(0);
  await tocar(ventana, 'app-teclado-panel input[data-teclado="QUANTITY"]');
  await expect(teclado, 'AUTO: con el dedo si').toBeVisible();
  await expect(teclado).toHaveClass(/wxvk--quantity/);

  /* Un campo marcado `data-teclado="no"` se respeta en cualquier modo. */
  await radio('SIEMPRE').check();
  await ventana.evaluate(() => {
    const i = document.createElement('input');
    i.type = 'text'; i.id = 'e2e-sin-teclado'; i.dataset.teclado = 'no';
    document.querySelector('app-teclado-panel .panel-content').appendChild(i);
  });
  await ventana.click('#e2e-sin-teclado');
  await ventana.waitForTimeout(300);
  await expect(teclado, 'data-teclado="no" lo excluye').toHaveCount(0);
});

// ===========================================================================
// AUTO sigue a la MODALIDAD real, y el teclado fisico no cierra el virtual.
// ===========================================================================

async function salir(ventana) {
  await ventana.click('.wx-yo__btn');
  await ventana.click('.wx-yo__fila:has-text("Cerrar sesión")');
  await ventana.waitForSelector('#username', { timeout: 30000 });
}

/* Un toque de dedo sobre un boton: pointerdown tactil y luego el clic. */
async function tocarBoton(ventana, selector) {
  await ventana.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, clientX: r.x + 5, clientY: r.y + 5 };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.click();
  }, selector);
}

/* Una tecla del teclado en pantalla, pulsada con el dedo. */
async function tocarTecla(ventana, t) {
  await ventana.evaluate((k) => {
    const b = [...document.querySelectorAll('.wxvk .wxvk__k')].find(x => x.textContent.trim() === k);
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true }));
  }, t);
}

async function aTouch(app) {
  const { ventana } = app;
  await entrar(app, CUENTAS.admin);
  const userId = (await app.invocar('sesion')).data.userId;
  const r = await app.invocar('openShift', { user_id: userId, opening_cash: 500 });
  expect(r?.success || /ya existe un turno/i.test(String(r?.error ?? ''))).toBeTruthy();
  await app.invocar('setDeviceConfig', { deviceProfile: 'TOUCH_POS', teclado: { modo: 'AUTO' } });
  await salir(ventana);
  await entrar(app, CUENTAS.admin);
  await ventana.waitForSelector('app-touch-pos .tp-card', { timeout: 60000 });
}

test('AUTO en una caja Touch: raton y teclado no lo abren; el dedo si', async ({ app }) => {
  test.setTimeout(150000);
  const { ventana } = app;
  await aTouch(app);
  const teclado = ventana.locator('.wxvk');
  const buscar = ventana.locator('#tp-buscar');
  const boton = 'app-touch-pos .tp-iconbtn[aria-label="Buscar producto"]';

  /* Con RATON: la caja es Touch, pero se esta usando con raton y teclado. */
  await ventana.click(boton);
  await expect(buscar).toBeFocused();
  await ventana.waitForTimeout(400);
  await expect(teclado, 'AUTO + raton: no aparece aunque la caja sea Touch').toHaveCount(0);
  await ventana.keyboard.type('lat');
  await expect(buscar, 'el fisico escribe').toHaveValue('lat');
  await expect(teclado, 'y teclear tampoco lo abre').toHaveCount(0);
  await ventana.keyboard.press('Escape');
  await expect(buscar).toHaveCount(0);

  /* Con el DEDO: aparece. */
  await tocarBoton(ventana, boton);
  await expect(buscar).toBeFocused();
  await expect(teclado, 'AUTO + dedo: aparece').toBeVisible();
  await ventana.keyboard.press('Escape');

  /* Volver al raton: la siguiente vez ya no. */
  await ventana.click(boton);
  await expect(buscar).toBeFocused();
  await ventana.waitForTimeout(400);
  await expect(teclado, 'de vuelta al raton, de vuelta sin teclado').toHaveCount(0);
});

test('Teclado visible + teclado fisico: no se cierra al teclear, ni al reenfocar, y se muda con Tab', async ({ app }) => {
  test.setTimeout(150000);
  const { ventana } = app;
  /* Un equipo NORMAL con pantalla tactil: ahi AUTO dependia de una ventana
     de 1.5 s desde el ultimo toque, y el teclado se cerraba al teclear. */
  await entrar(app, CUENTAS.admin);
  await app.invocar('setDeviceConfig', { teclado: { modo: 'AUTO' } });
  await abrirPanel(ventana);
  const teclado = ventana.locator('.wxvk');
  const texto = ventana.locator('app-teclado-panel input[data-teclado="TEXT"]');
  const dinero = ventana.locator('app-teclado-panel input[data-teclado="MONEY"]');
  const cantidad = ventana.locator('app-teclado-panel input[data-teclado="QUANTITY"]');

  await tocar(ventana, 'app-teclado-panel input[data-teclado="TEXT"]');
  await expect(teclado, 'el dedo lo abre').toBeVisible();

  /* Letras sueltas del fisico, con pausas mas largas que aquella ventana, y
     reenfocando el campo entre una y otra como hacen algunas pantallas. */
  for (const letra of ['c', 'r', 'o']) {
    await ventana.keyboard.type(letra);
    await ventana.waitForTimeout(1700);
    await ventana.evaluate(() => {
      const i = document.querySelector('app-teclado-panel input[data-teclado="TEXT"]');
      i.blur(); i.focus();
    });
    await ventana.waitForTimeout(250);
    await expect(teclado, `sigue abierto tras teclear «${letra}»`).toBeVisible();
  }
  await expect(texto).toHaveValue('cro');

  /* Los dos a la vez, en el mismo campo. */
  await tocarTecla(ventana, 'i');
  await ventana.keyboard.type('s');
  await expect(texto, 'dedo y fisico escriben juntos').toHaveValue('crois');
  await expect(teclado).toBeVisible();

  /* Tab del fisico con el teclado abierto: se muda al siguiente campo. */
  await ventana.keyboard.press('Tab');
  await expect(dinero).toBeFocused();
  await expect(teclado, 'Tab no lo cierra: se muda').toBeVisible();
  await expect(teclado).toHaveClass(/wxvk--money/);
  await ventana.keyboard.type('12.5');
  await expect(dinero).toHaveValue('12.5');
  await expect(teclado).toBeVisible();

  /* Un clic de RATON en otro campo si lo cierra: la persona cambio al raton. */
  await cantidad.click();
  await ventana.waitForTimeout(400);
  await expect(teclado, 'AUTO + clic de raton en otro campo: se va').toHaveCount(0);
  await ventana.keyboard.type('3');
  await expect(cantidad, 'y el fisico sigue escribiendo').toHaveValue('3');
});
