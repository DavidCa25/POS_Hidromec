/**
 * LOS MODALES SE PUEDEN USAR ENTEROS.
 *
 *     npx playwright test e2e/modales-alcanzables.spec.js
 *
 * 1) EDITAR PRODUCTO. En QA el modal no dejaba llegar a Guardar ni a
 *    Cancelar. Tenia `max-height` y scroll propio, pero vivia DENTRO de
 *    `.castrol-table-container`, que aisla su apilamiento (`isolation:
 *    isolate`, table.css). Ahi dentro su z-index no le ganaba a la cabecera
 *    ni al dock, que se pintaban encima: arriba tapaban el titulo y abajo los
 *    botones, aunque se recorriera el modal hasta el final.
 *
 *    Se comprueba con `elementFromPoint`: que el boton sea lo que hay debajo
 *    del dedo, no solo que exista en el DOM.
 *
 * 2) REGISTRAR COMPRA sin proveedores decia «No hay proveedores registrados»
 *    y no ofrecia nada: habia que salir de la compra a medias.
 *
 * 3) CLIENTE NUEVO / EDITAR. Una columna de 16 campos: en una pantalla chica
 *    «Guardar» quedaba fuera y no habia X. Ahora es horizontal, con cabecera y
 *    pie fijos, y Credito y Facturacion se pliegan con su flecha.
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

/** ¿Lo que hay bajo el centro del elemento es el propio elemento? */
const alAlcance = (ventana, sel) => ventana.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return { ok: false, tapa: 'no existe' };
  const b = el.getBoundingClientRect();
  const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return { ok: !!hit && (hit === el || el.contains(hit)), tapa: hit ? String(hit.className || hit.tagName) : null };
}, sel);

test.describe('Modales que se pueden usar enteros', () => {

  test('cliente: horizontal, con X, Guardar siempre al alcance y el crédito plegable', async ({ app }, info) => {
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);
    /* Una caja de 10": ancha pero baja. */
    await ventana.setViewportSize({ width: 1024, height: 600 });
    await ventana.evaluate(() => { try { localStorage.removeItem('wx-clientes:pliegue:credito'); localStorage.removeItem('wx-clientes:pliegue:facturacion'); } catch { /* noop */ } });
    const foto = async (nombre) => {
      /* Tras la entrada del dialogo (230 ms): una foto a medio aparecer engaña. */
      await ventana.waitForTimeout(350);
      const png = await ventana.screenshot();
      await info.attach(`${nombre}.png`, { body: png, contentType: 'image/png' });
      if (process.env.WYBIX_CAPTURAS) {
        fs.mkdirSync(process.env.WYBIX_CAPTURAS, { recursive: true });
        fs.writeFileSync(path.join(process.env.WYBIX_CAPTURAS, `${nombre}.png`), png);
      }
    };

    await ventana.locator('.wxdock a', { hasText: 'Clientes' }).click();
    await ventana.locator('button', { hasText: '+ Nuevo cliente' }).click();
    const dlg = ventana.locator('.cli-dlg');
    await expect(dlg).toBeVisible();

    /* Horizontal: mas ancho que alto, y cabe en la ventana. */
    const caja = await dlg.boundingBox();
    expect(caja.width, 'mas ancho que alto').toBeGreaterThan(caja.height);
    expect(caja.y + caja.height, 'no pasa del borde').toBeLessThanOrEqual(600);

    /* Plegado por defecto: dice lo que tiene. */
    const credito = dlg.locator('.cli-sec__cab', { hasText: 'Crédito' });
    await expect(credito).toHaveAttribute('aria-expanded', 'false');
    await expect(credito.locator('.cli-sec__resumen')).toHaveText('Sin crédito');
    await foto('cliente-nuevo-plegado');

    /* Sin desplazar nada: la X, Guardar y Cancelar se pueden pulsar. */
    for (const sel of ['.cli-dlg__x', '.cli-dlg__pie .btn-primary', '.cli-dlg__pie .btn-ghost']) {
      const r = await alAlcance(ventana, sel);
      expect(r.ok, `${sel} se puede pulsar (lo tapa: ${r.tapa})`).toBe(true);
    }

    /* La flecha lo abre; con TODO abierto, el pie sigue al alcance. */
    await credito.click();
    await expect(credito).toHaveAttribute('aria-expanded', 'true');
    await dlg.locator('#cli-limite').fill('5000');
    await dlg.locator('#cli-plazo').fill('30');
    await dlg.locator('.cli-sec__cab', { hasText: 'Datos de facturación' }).click();
    await foto('cliente-nuevo-abierto');
    const cuerpo = await ventana.evaluate(() => {
      const el = document.querySelector('.cli-dlg__cuerpo');
      return { sh: el.scrollHeight, ch: el.clientHeight };
    });
    expect(cuerpo.sh, 'todo abierto no cabe: el cuerpo desplaza').toBeGreaterThan(cuerpo.ch);
    const guardar = await alAlcance(ventana, '.cli-dlg__pie .btn-primary');
    expect(guardar.ok, `Guardar sigue al alcance (lo tapa: ${guardar.tapa})`).toBe(true);

    /* Plegado otra vez: el resumen dice el limite y el plazo. */
    await credito.click();
    await expect(credito.locator('.cli-sec__resumen')).toHaveText(/5,000\.00 · 30 días/);

    /* Escape cierra; la X tambien. */
    await ventana.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await ventana.locator('button', { hasText: '+ Nuevo cliente' }).click();
    await expect(dlg).toBeVisible();
    await ventana.click('.cli-dlg__x');
    await expect(dlg).toHaveCount(0);

    /* Y en un telefono-tableta angosta (1 columna) sigue cabiendo. */
    await ventana.setViewportSize({ width: 800, height: 600 });
    await ventana.locator('button', { hasText: '+ Nuevo cliente' }).click();
    await expect(dlg).toBeVisible();
    await foto('cliente-nuevo-800');
    const pie = await alAlcance(ventana, '.cli-dlg__pie .btn-primary');
    expect(pie.ok, `en 800 px Guardar sigue al alcance (lo tapa: ${pie.tapa})`).toBe(true);
    await ventana.click('.cli-dlg__x');
  });

  test('editar producto: título, Guardar y Cancelar quedan al alcance en una pantalla baja', async ({ app }) => {
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);
    /* Mas baja que la caja objetivo, para que el formulario NO quepa. */
    await ventana.setViewportSize({ width: 1280, height: 600 });

    await irPorDock(ventana, 'Inventario', 'Ver inventario');
    await ventana.waitForSelector('app-inventario tbody tr', { timeout: 30000 });
    await ventana.locator('app-inventario tbody tr .btn-editar').first().click();
    await ventana.waitForSelector('.producto-modal', { timeout: 10000 });

    const titulo = await alAlcance(ventana, '.producto-modal-title');
    expect(titulo.ok, `la cabecera no tapa el título (lo tapa: ${titulo.tapa})`).toBe(true);

    const m = await ventana.evaluate(() => {
      const el = document.querySelector('.producto-modal');
      return { sh: el.scrollHeight, ch: el.clientHeight, alto: innerHeight };
    });
    expect(m.sh, 'el formulario no cabe: esta prueba tiene que ejercitar el scroll').toBeGreaterThan(m.ch);
    expect(m.ch, 'y el modal no pasa de la ventana').toBeLessThanOrEqual(m.alto);

    await ventana.evaluate(() => {
      const el = document.querySelector('.producto-modal');
      el.scrollTop = el.scrollHeight;
    });
    for (const sel of ['.producto-save-btn', '.producto-cancel-btn']) {
      const r = await alAlcance(ventana, sel);
      expect(r.ok, `${sel} se puede pulsar (lo tapa: ${r.tapa})`).toBe(true);
    }

    await ventana.click('.producto-cancel-btn');
    await expect(ventana.locator('.producto-modal'), 'Cancelar cierra el modal').toHaveCount(0);
  });

  test('registrar compra: el proveedor se da de alta ahí mismo y queda elegido', async ({ app }) => {
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);
    const nombre = `Proveedor QA ${Date.now().toString().slice(-6)}`;

    await irPorDock(ventana, 'Compras', 'Registrar compra');
    const campo = ventana.locator('button.form-control', { hasText: /proveedor/i }).first();
    await campo.waitFor({ timeout: 30000 });
    await campo.click();

    await ventana.click('.compra-prov-nuevo');
    const dialogo = ventana.locator('app-proveedor-form .cierre-dialog');
    await expect(dialogo, 'se abre el alta de proveedor').toBeVisible();

    await dialogo.locator('#prov-nombre').fill(nombre);
    await dialogo.locator('#prov-rfc').fill('xaxx010101000');
    const guardar = await alAlcance(ventana, 'app-proveedor-form button[type=submit]');
    expect(guardar.ok, `Guardar se puede pulsar (lo tapa: ${guardar.tapa})`).toBe(true);
    await dialogo.locator('button[type=submit]').click();

    await expect(ventana.locator('app-proveedor-form'), 'el alta se cierra al guardar').toHaveCount(0);
    await expect(campo, 'y el proveedor nuevo queda elegido en la compra').toContainText(nombre);

    const lista = await app.invocar('getSuppliers');
    const filas = Array.isArray(lista) ? lista : (lista?.data ?? []);
    expect(filas.some((p) => p.nombre === nombre), 'y existe en el catálogo').toBe(true);
  });

  test('la pantalla Proveedores sigue dando de alta con el mismo formulario', async ({ app }) => {
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);
    const nombre = `Proveedor lista ${Date.now().toString().slice(-6)}`;

    await irPorDock(ventana, 'Compras', 'Proveedores');
    await ventana.click('button:has-text("+ Nuevo proveedor")');
    const dialogo = ventana.locator('app-proveedor-form .cierre-dialog');
    await dialogo.locator('#prov-nombre').fill(nombre);
    await dialogo.locator('button[type=submit]').click();

    await expect(ventana.locator('app-proveedor-form')).toHaveCount(0);
    await expect(ventana.locator('app-proveedores'), 'aparece en la lista').toContainText(nombre, { timeout: 15000 });
  });
});
