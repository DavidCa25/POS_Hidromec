/**
 * CARNE POR RENDIMIENTO, CON CLICS (0095).
 *
 *     npm run e2e:carne
 *
 * Una taquería sin recetas, de punta a punta, con Electron e IPC de verdad:
 *
 *   · Inventario › Carne por rendimiento: sin carnes, invita a elegirlas;
 *   · arranque: un toque por carne y − / + en los tacos por kilo;
 *   · «Llegó la carne»: teclado de kilos y precio por kilo; sube en gramos;
 *   · el corte pregunta primero cuánta quedó: botones de kilos, veredicto en
 *     vivo, «cómo rindió hoy» y después el efectivo de siempre;
 *   · la base guarda el conteo y la carne entra al costo de ventas;
 *   · el reporte del mes dice cuántos tacos se fueron.
 *
 * Base propia (Wybix_E2E_Carne, giro HOSPITALITY): nace aquí y se borra.
 */
const fs = require('node:fs');
const { test, expect, _electron: electron } = require('@playwright/test');
const { nuevoPerfil, opcionesDeArranque } = require('./perfil');
const { CUENTAS, irPorDock } = require('./fixtures');

const DB = 'Wybix_E2E_Carne';
const filas = (r) => Array.isArray(r) ? r : (Array.isArray(r?.recordset) ? r.recordset : (r?.data ?? []));

test('una taquería lleva su carne sin recetas: arranque, llegada, cierre con lo que quedó y reporte', async () => {
  test.setTimeout(300000);
  const bases = await import('./preparar-bases.mjs');
  const temporal = await import('../scripts/db/lib/temporal.mjs');
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  bases.prepararBase(DB, { perfil: 'HOSPITALITY', modulos: ['hospitality'] });
  const sql = (t) => { const r = consultarTemporal(DB, t); if (!r.ok) throw new Error(r.error); return r.sets[r.sets.length - 1] ?? []; };

  const perfil = await nuevoPerfil(DB);
  const app = await electron.launch(opcionesDeArranque(perfil));
  try {
    const v = await app.firstWindow({ timeout: 120000 });
    await v.waitForFunction(() => !!window.electronAPI, null, { timeout: 60000 });
    await v.evaluate(() => { try { localStorage.setItem('wx-guide:auto', '0'); } catch { /* noop */ } });
    await v.waitForSelector('#username', { timeout: 60000 });
    await v.fill('#username', CUENTAS.admin.usuario);
    await v.fill('#password', CUENTAS.admin.password);
    await v.click('#btnLogin');
    const api = (m, ...a) => v.evaluate(([mm, aa]) => window.electronAPI[mm](...aa), [m, a]);
    await expect.poll(async () => { try { return (await api('sesion'))?.data?.usuario ?? null; } catch { return null; } }, { timeout: 30000 }).toBe(CUENTAS.admin.usuario);
    const yo = (await api('sesion')).data.userId;

    /* El menú, como lo da de alta el dueño: tacos sin inventario. */
    await api('createCategory', { nombre: 'Tacos' });
    await api('createBrand', { nombre: 'Casa' });
    const cat = Number(filas(await api('getCategories')).find((c) => (c.namee ?? c.name) === 'Tacos')?.id);
    const marca = Number(filas(await api('getBrands'))[0]?.id);
    for (const [pn, nombre, precio] of [['TAC-PAS', 'Taco al pastor', 22], ['ORD-PAS', 'Orden de 5 al pastor', 100], ['TAC-BIS', 'Taco de bistec', 25]]) {
      await api('agregarProducto', marca, cat, pn, nombre, precio, 0, null, null, '02', 0.16, null, { inventory_mode: 'NONE', sellable: 1, base_uom: 'pza' });
    }
    await api('addSupplier', 'Carnes Don Beto');
    const id = (pn) => Number(sql(`SELECT id FROM dbo.products WHERE part_number = N'${pn}'`)[0]?.id);

    // ------------------------------------------------------------ arranque
    await irPorDock(v, 'Inventario', 'Carne por rendimiento');
    await expect(v.locator('[data-guide="carne-mes"]')).toContainText('¿Llevas tu carne a ojo?');
    await v.locator('[data-guide="carne-empezar"]').click();
    const arranque = v.locator('[data-guide="carne-arranque"]');
    await expect(arranque).toBeVisible();
    await arranque.locator('[data-guide-clave="suadero"] .cr-carne__toque').click();                 // no usa suadero
    await expect(arranque.locator('.cr-carne.on')).toHaveCount(2);
    await arranque.locator('[data-guide-clave="bistec"] button[aria-label^="Más"]').click();          // 12 -> 13
    await arranque.locator('[data-guide-clave="bistec"] button[aria-label^="Menos"]').click();        // 13 -> 12
    await expect(arranque.locator('[data-guide-clave="pastor"]')).toContainText('≈ 71 g de carne por taco');
    await v.locator('[data-guide="carne-arranque-listo"]').click();
    await expect(v.locator('.swal2-toast')).toContainText('Carnes listas');
    await expect(v.locator('[data-guide="carne-mes"]')).toBeVisible();

    const pastor = sql(`SELECT p.id, p.base_uom, p.sellable FROM dbo.products p WHERE p.part_number = N'CARNE-PASTOR'`)[0];
    expect(pastor?.base_uom, 'el pastor nace en gramos').toBe('g');
    const mapa = sql(`SELECT product_id, tacos FROM dbo.rendimiento_platillos`);
    expect(Number(mapa.find((x) => Number(x.product_id) === id('ORD-PAS'))?.tacos), 'la orden de 5 cuenta 5').toBe(5);

    // ------------------------------------------------------ llegó la carne
    await v.locator('[data-guide="carne-ir-llegada"]').click();
    const llegada = v.locator('[data-guide="carne-llegada"]');
    await expect(llegada).toBeVisible();
    const tecla = (t) => llegada.locator('.cr-tecla', { hasText: new RegExp(`^${t.replace('.', '\\.')}$`) }).click();
    await llegada.locator('.cr-lista button', { hasText: 'Pastor' }).click();
    await tecla('1'); await tecla('6');
    await llegada.locator('#cr-precio-kg').fill('170');
    await llegada.locator('.cr-lista button', { hasText: 'Bistec' }).click();
    await tecla('7');
    await llegada.locator('#cr-precio-kg').fill('218');
    await expect(llegada.locator('.cr-total')).toContainText('4,246.00');
    await v.locator('[data-guide="carne-llegada-guardar"]').click();
    await expect(v.locator('.swal2-toast')).toContainText('Entrega guardada');
    expect(Number(sql(`SELECT stock FROM dbo.products WHERE id = ${pastor.id}`)[0].stock), '16 kg son 16,000 g').toBe(16000);

    // --------------------------------------------------------- un día de venta
    const t = await api('openShift', { user_id: yo, opening_cash: 500 });
    expect(t?.success, JSON.stringify(t)).toBeTruthy();
    const vender = async (lineas) => {
      const r = await api('registerSaleV2', { userId: yo, paymentMethod: 'TARJETA', registerId: null,
        lines: lineas.map(([pn, qty, precio]) => ({ productId: id(pn), qty, unitPrice: precio, options: [] })) });
      expect(r?.success, JSON.stringify(r)).toBeTruthy();
    };
    for (let i = 0; i < 19; i++) await vender([['TAC-PAS', 8, 22]]);    // 152
    await vender([['ORD-PAS', 4, 100]]);                                   // +20 = 172
    for (let i = 0; i < 10; i++) await vender([['TAC-BIS', 7, 25]]);    // 70

    // ------------------------------------------------- el corte, con la carne
    await irPorDock(v, 'Venta', 'Corte del día');
    const seguir = v.getByRole('button', { name: /Continuar/ });
    if (await seguir.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) {
      if (await seguir.isDisabled()) await v.locator('button', { hasText: 'ID: ' }).first().click();
      await seguir.click();
    }
    const consultar = v.getByRole('button', { name: /Consultar movimientos/ });
    if (await consultar.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) {
      await v.locator('button.mode-card', { hasText: 'Cerrar turno' }).click();
      await consultar.click();
    }
    const cerrar = v.locator('button.btn-success', { hasText: 'Cerrar turno' });
    await expect(cerrar).toBeEnabled({ timeout: 20000 });
    await cerrar.click();

    const cierre = v.locator('[data-guide="carne-cierre"]');
    await expect(cierre, 'el corte pregunta primero por la carne').toBeVisible();
    await expect(cierre).toContainText('¿Cuánta carne te quedó?');
    const fila = (n) => cierre.locator(`[data-guide-clave="${n}"]`);
    await expect(fila('Pastor')).toContainText('Tenías 16 kg');
    await expect(fila('Pastor')).toContainText('vendiste 172');
    await fila('Pastor').locator('.cr-chip', { hasText: /^3 kg$/ }).click();
    await expect(fila('Pastor').locator('.cr-veredicto')).toContainText('Faltan 10 tacos');
    await fila('Bistec').locator('.cr-chip', { hasText: /^1 kg$/ }).click();
    await expect(fila('Bistec').locator('.cr-veredicto')).toContainText('Rindió normal');
    const foto = async (n) => {
      if (!process.env.WYBIX_CAPTURAS) return;
      fs.mkdirSync(process.env.WYBIX_CAPTURAS, { recursive: true });
      await v.screenshot({ path: require('node:path').join(process.env.WYBIX_CAPTURAS, `${n}.png`) });
    };
    await foto('carne-cierre');
    await v.locator('[data-guide="carne-cierre-seguir"]').click();

    const resultado = v.locator('[data-guide="carne-resultado"]');
    await expect(resultado).toContainText('Se fueron 10 tacos de pastor sin cobrar');
    await expect(resultado).toContainText('Bistec');
    await foto('carne-resultado');
    await v.locator('[data-guide="carne-resultado-seguir"]').click();

    /* Y el efectivo, como siempre. */
    await expect(v.locator('#corte-contado')).toBeVisible({ timeout: 15000 });
    const turno = sql(`SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC;`)[0].id;
    await v.locator('#corte-contado').fill('500');
    await v.getByRole('button', { name: 'Confirmar cierre' }).click();
    await expect.poll(() => sql(`SELECT closed_at FROM dbo.cash_closures WHERE id = ${turno}`)[0].closed_at != null, { timeout: 30000 }).toBe(true);

    const conteos = sql(`SELECT carne_id, quedo, usado, vendidos, closure_id FROM dbo.rendimiento_conteos ORDER BY carne_id`);
    expect(conteos.length, 'dos carnes contadas').toBe(2);
    expect(conteos.every((c) => Number(c.closure_id) === Number(turno)), 'colgadas de su corte').toBeTruthy();
    expect(Number(sql(`SELECT stock FROM dbo.products WHERE id = ${pastor.id}`)[0].stock), 'quedan 3 kg de pastor').toBe(3000);

    const hoy = new Date();
    const iso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    const er = await api('estadoResultados', { desde: iso, hasta: iso });
    expect(Math.abs(Number(er.data.actual.costo_ventas) - (13 * 170 + 6 * 218)), 'la carne usada es el costo de los tacos').toBeLessThan(0.05);

    // -------------------------------------------------------------- el mes
    await irPorDock(v, 'Inventario', 'Carne por rendimiento');
    const mes = v.locator('[data-guide="carne-mes"]');
    /* El mes suma todo lo que faltó: los 10 de pastor y los 2 de bistec que el
       cierre llamó «normal» (dentro del margen de una noche, pero se fueron). */
    await expect(mes).toContainText('se fueron 12 tacos sin cobrar');
    await expect(mes.locator('.cr-kpi.mal')).toContainText('12 tacos');
    await expect(mes.locator('.cr-tabla')).toContainText('Pastor');
    if (process.env.WYBIX_CAPTURAS) {
      fs.mkdirSync(process.env.WYBIX_CAPTURAS, { recursive: true });
      await v.screenshot({ path: require('node:path').join(process.env.WYBIX_CAPTURAS, 'carne-mes.png') });
    }
  } finally {
    await app.close().catch(() => {});
    try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* noop */ }
    if (!process.env.CARNE_CONSERVAR) { try { temporal.eliminar(DB); } catch { /* noop */ } }
  }
});
