/**
 * UN PRODUCTO DE MENU SIN RECETA SE VENDE.
 *
 *     npx playwright test e2e/menu-sin-receta.spec.js
 *
 * QUE SE VIO EN QA
 * ----------------
 * En Demo Hospitality, «Café Americano» (CAF-AME, $35) entraba por
 * QuickStart, Inventario decia «0 pza» y Touch lo pintaba «Agotado» sin
 * dejar venderlo. El Latte, que tiene receta, si se vendia.
 *
 * EL POS NO TENIA LA CULPA
 * ------------------------
 * `sp_get_menu_catalog` traduce NONE a 999999 disponibles y la venta no
 * consume nada de un NONE. Nunca recibio uno: en la base, CAF-AME era
 * DIRECT con existencia 0, que SI esta agotado.
 *
 * La hoja «Menú» del archivo de QA trae su propia columna «Tipo» con
 * «Producto», y una columna «Vendible» que el mapeo no conoce. Por esa
 * columna la pantalla pregunta; se pulsa «No usar», y eso replanifica la
 * hoja por `quickstart:remapear`, que lo hacia SIN el tipo de la hoja ni el
 * negocio. «Producto» volvia como PRODUCTO/DIRECT.
 *
 * Por eso aqui la hoja Menú entra por la pantalla, pulsando «No usar» como
 * se pulso en QA. `quickstart-modelos.spec.js` cargaba la misma carta con
 * encabezados canonicos y sin pasar por el mapeo: por eso no lo vio.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ExcelJS = require('exceljs');
const { test, expect, CUENTAS, irPorMas, irPorDock } = require('./fixtures');

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

const sufijo = () => Date.now().toString().slice(-6);

const filasDe = (r) => Array.isArray(r) ? r
  : (Array.isArray(r?.recordset) ? r.recordset : (Array.isArray(r?.data) ? r.data : []));

async function producto(app, pn) {
  return filasDe(await app.invocar('getActiveProducts')).find((p) => p.part_number === pn) || null;
}

const ventas = async (app) => ((await app.invocar('getSales')).data ?? []).length;

/** El libro de QA, con los encabezados de QA: «Precio Público», «Vendible», «Tipo». */
async function libroCafeteria(s) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wybix-menu-'));
  const wb = new ExcelJS.Workbook();

  const ins = wb.addWorksheet('Insumos');
  ins.addRow(['Código Insumo', 'Descripción', 'Unidad Base', 'Costo Unit.', 'Existencia Inicial', 'Categoría']);
  ins.addRow([`ING-CAF-${s}`, `Café en grano ${s}`, 'g', 0.42, 5000, 'Café']);

  const menu = wb.addWorksheet('Menú');
  menu.addRow(['Clave', 'Producto', 'Familia', 'Precio Público', 'Vendible', 'Tipo']);
  menu.addRow([`CAF-AME-${s}`, `Café Americano ${s}`, 'Cafés', 35, 'Sí', 'Producto']);
  menu.addRow([`LAT-${s}`, `Latte ${s}`, 'Cafés', 52, 'Sí', 'Producto']);

  const ruta = path.join(dir, `QA_Cafeteria_${s}.xlsx`);
  await wb.xlsx.writeFile(ruta);
  return ruta;
}

async function sinCapturasAbiertas(app) {
  const r = await app.invocar('qsCargas', {});
  for (const c of (r?.data ?? [])) {
    if ((c.origen === 'MANUAL' || c.origen === 'LECTOR') && c.estado !== 'IMPORTADA') {
      await app.invocar('qsDescartar', { batchId: c.id });
    }
  }
}

test.describe('Hospitality · un producto de menú sin receta', () => {

  test.afterEach(async ({ app }) => {
    await app.invocar('modulosSet', 'hospitality', false).catch(() => {});
  });

  test('Café Americano se vende en Retail y en Touch; el Latte sigue con su receta', async ({ app }) => {
    test.setTimeout(240000);
    const { ventana } = app;
    await entrar(app, CUENTAS.admin);

    expect((await app.invocar('modulosSet', 'hospitality', true))?.success).toBeTruthy();
    await sinCapturasAbiertas(app);

    const userId = (await app.invocar('sesion')).data.userId;
    const abierto = await app.invocar('openShift', { user_id: userId, opening_cash: 1000 });
    expect(abierto?.success || /ya existe un turno/i.test(String(abierto?.error ?? '')),
      `no hay turno para cobrar: ${JSON.stringify(abierto)}`).toBeTruthy();

    const s = sufijo();
    const ruta = await libroCafeteria(s);

    // ------------------------------------------------ PREPARACION (no es lo que se prueba)
    /* El almacen, por el canal: lo que se prueba aqui es la carta. La revision
       de insumos por la pantalla ya la cubre `quickstart-revision-ui.spec.js`. */
    const ins = await app.invocar('qsAnalizarArchivo', { ruta, hoja: 'Insumos' });
    expect(ins?.success, JSON.stringify(ins)).toBeTruthy();
    expect((await app.invocar('qsEjecutar', { batchId: ins.data.batchId }))?.success).toBeTruthy();
    const grano = await producto(app, `ING-CAF-${s}`);
    expect(grano, 'el café en grano está en el almacén').toBeTruthy();

    /* El Latte ya existe, con receta: 18 g de café por taza. Es el caso de
       QA «Latte existente conserva RECIPE al actualizar». */
    const cats = await app.invocar('getCategories');
    const marcas = await app.invocar('getBrands');
    const idDe = (x) => Number(x?.id ?? x?.category_id ?? x?.brand_id);
    const alta = await app.invocar('agregarProducto',
      idDe(filasDe(marcas)[0]), idDe(filasDe(cats)[0]), `LAT-${s}`, `Latte ${s}`, 48, 0,
      null, null, '02', 0.16, null,
      { inventory_mode: 'RECIPE', sellable: 1, base_uom: 'pza' });
    expect(alta?.success ?? true, JSON.stringify(alta)).toBeTruthy();
    const latte0 = await producto(app, `LAT-${s}`);
    expect(String(latte0?.inventory_mode), 'el Latte nace como receta').toBe('RECIPE');

    const receta = await ventana.evaluate(([pid, iid]) => window.wybix.recipes.save({
      productId: pid,
      lines: [{ ingredientProductId: iid, inputQty: 18, inputUom: 'g', wastePct: 0 }],
    }), [Number(latte0.id ?? latte0.product_id), Number(grano.id ?? grano.product_id)]);
    expect(receta?.success, JSON.stringify(receta)).toBeTruthy();

    // ======================================== LA CARTA, POR LA PANTALLA
    await irPorMas(ventana, 'Migracion');
    await ventana.waitForSelector('.mig-vacio', { timeout: 30000 });
    await ventana.click('.mig-vacio .mig-btn');
    await ventana.waitForSelector('.qs__pozo', { timeout: 30000 });
    await ventana.setInputFiles('.qs__pozo input[type=file]', ruta);

    await ventana.waitForSelector('.qs__hojacard', { timeout: 60000 });
    await ventana.locator('.qs__hojacard').filter({ hasText: /Menú/ }).first().click({ timeout: 30000 });

    /* «Vendible» no es un campo de Wybix: la pantalla pregunta. «No usar»
       es lo que se pulso en QA, y es lo que replanifica la hoja. */
    const vendible = ventana.locator('.qs__par', { hasText: 'Vendible' });
    await vendible.waitFor({ timeout: 60000 });
    await vendible.locator('.qs__op', { hasText: 'No usar' }).click();

    await ventana.waitForSelector('.qs__th.es-dinamica', { timeout: 60000 });
    const cta = ventana.locator('.qs__cab .qs__btn.es-primario');
    await expect(cta, 'la carta entra sin nada que decidir').toHaveText(/Importar 2/);
    await cta.click();
    await ventana.waitForSelector('.swal2-confirm', { timeout: 30000 });
    await ventana.click('.swal2-confirm');

    // =============================================== 1) EN LA BASE
    await expect.poll(() => producto(app, `CAF-AME-${s}`), { timeout: 60000 }).not.toBeNull();
    const ame = await producto(app, `CAF-AME-${s}`);
    expect(String(ame.inventory_mode), 'LO QUE FALLABA: sin existencia propia, no DIRECT').toBe('NONE');
    expect(Number(ame.sellable), 'y se vende').toBe(1);
    expect(Number(ame.price), 'a $35').toBe(35);

    const latte = await producto(app, `LAT-${s}`);
    expect(String(latte.inventory_mode), 'el Latte conserva su receta al actualizarse').toBe('RECIPE');
    expect(Number(latte.price), 'y toma el precio nuevo').toBe(52);
    expect(Number(latte.available_units), 'y calcula: 5000 g / 18 g por taza').toBe(277);

    const grano2 = await producto(app, `ING-CAF-${s}`);
    expect(String(grano2.inventory_mode), 'el café en grano sigue siendo almacén').toBe('DIRECT');
    expect(Number(grano2.sellable), 'y no se vende').toBe(0);

    // =============================================== 2) INVENTARIO
    await irPorDock(ventana, 'Inventario', 'Ver inventario');
    await ventana.waitForSelector('app-inventario tbody tr', { timeout: 30000 });
    /* La base de pruebas trae cientos de productos y la tabla pagina. */
    await ventana.fill('app-inventario input[type=search]', `Café Americano ${s}`);
    const filaInv = ventana.locator('app-inventario tbody tr', { hasText: `Café Americano ${s}` });
    await expect(filaInv, 'el americano está en inventario').toHaveCount(1);
    await expect(filaInv.locator('.stock-na'), 'dice que la existencia no aplica').toHaveText('No aplica');
    expect(await filaInv.innerText(), 'y no dice «0 pza», que se lee como agotado').not.toMatch(/\b0\s*pza/);

    // =============================================== 3) RETAIL
    const antesRetail = await ventas(app);
    await irPorDock(ventana, 'Venta', 'Nueva venta');
    await ventana.waitForSelector('app-venta .pos-shortcut', { timeout: 30000 });
    await ventana.locator('app-venta .pos-shortcut', { hasText: 'Buscar / Agregar producto' }).click();
    await ventana.waitForSelector('.modal-productos', { timeout: 20000 });
    await ventana.fill('.modal-productos .buscador', s);

    const itemAme = ventana.locator('.modal-productos .prod-item:visible', { hasText: `Café Americano ${s}` });
    await expect(itemAme, 'el americano aparece en Venta').toHaveCount(1);
    await expect(itemAme.locator('.pi-stock'), 'con «No aplica», no con 999999').toHaveText('No aplica');
    await expect(ventana.locator('.modal-productos .prod-item:visible', { hasText: `Café en grano ${s}` }),
      'el café en grano no se ofrece en Venta').toHaveCount(0);

    await itemAme.click();
    await expect(ventana.locator('.venta-card'), 'queda en la cuenta').toContainText(`Café Americano ${s}`);

    await ventana.click('.pos-footer-actions button:has-text("Cobrar")');
    await ventana.waitForSelector('.modal-cobro', { state: 'visible', timeout: 20000 });
    await ventana.fill('.modal-cobro input[name="dineroRecibido"]', '100');
    await ventana.click('.modal-cobro button.btn-cobrar');
    await expect.poll(() => ventas(app), { timeout: 30000, message: 'Retail no cobró el americano' })
      .toBe(antesRetail + 1);
    await ventana.click('button:has-text("Nada más, cerrar")');

    // =============================================== 4) TOUCH
    /* La caja pasa a Touch como la configuraria alguien, y se vuelve a
       entrar: el login es quien lleva a cada caja a su pantalla de venta. */
    expect((await app.invocar('setDeviceConfig', { deviceProfile: 'TOUCH_POS' }))?.success ?? true).toBeTruthy();
    await ventana.click('.wx-yo__btn');
    await ventana.click('.wx-yo__fila:has-text("Cerrar sesión")');
    await entrar(app, CUENTAS.admin);
    await ventana.waitForSelector('app-touch-pos .tp-card', { timeout: 60000 });

    const cardAme = ventana.locator('.tp-card', { hasText: `Café Americano ${s}` });
    await expect(cardAme, 'el americano aparece en Touch').toHaveCount(1);
    await expect(cardAme, 'LO QUE FALLABA: no está agotado').not.toHaveClass(/\boff\b/);
    await expect(cardAme.locator('.tp-card__estado--off'), 'ni dice «Agotado»').toHaveCount(0);
    await expect(cardAme).toBeEnabled();

    const cardLatte = ventana.locator('.tp-card', { hasText: `Latte ${s}` });
    await expect(cardLatte, 'el Latte sigue disponible por receta').not.toHaveClass(/\boff\b/);
    await expect(cardLatte.locator('.tp-card__estado'), 'con las tazas que alcanzan').toContainText('277');

    await expect(ventana.locator('.tp-card', { hasText: `Café en grano ${s}` }),
      'el café en grano no se ofrece en Touch').toHaveCount(0);

    const antesTouch = await ventas(app);
    await cardAme.click();
    await expect(ventana.locator('.tp-cart'), 'queda en la cuenta').toContainText(`Café Americano ${s}`);
    await ventana.click('.tp-cart__foot .tp-primaria');
    /* En efectivo, con el billete exacto: el camino por defecto de Touch.
       Tarjeta y transferencia las cubre `touch-cobro.spec.js`. */
    await ventana.locator('.tp-rapidas button').first().click();
    await ventana.evaluate(() => {
      window.__avisos = [];
      new MutationObserver(() => {
        const t = document.querySelector('.tp-aviso')?.textContent?.trim();
        if (t && window.__avisos[window.__avisos.length - 1] !== t) window.__avisos.push(t);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await ventana.click('.tp-cobro__confirmar');
    await expect.poll(() => ventas(app), { timeout: 30000 }).toBe(antesTouch + 1)
      .catch(async (e) => {
        /* El aviso de Touch se va solo: se recoge para que el fallo diga POR QUE. */
        const avisos = await ventana.evaluate(() => window.__avisos);
        throw new Error(`Touch no cobró el americano. Avisos: ${JSON.stringify(avisos)}
${e.message}`);
      });
  });
});
