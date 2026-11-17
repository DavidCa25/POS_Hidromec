/**
 * Un precio nuevo llega a la Venta y nunca se cobra el viejo. En la app de
 * verdad, con el procesador frenado como en una caja de gama baja.
 *
 *     npm run e2e:precio
 *
 * Nace de un reporte: «cambié la papaya a 38, la vendí enseguida y salió a
 * 40». La Venta cobraba desde su copia del catálogo en memoria y nadie le
 * avisaba del cambio. Ahora:
 *
 *   1. Cambio en ESTA computadora (Inventario, canal sp-update-product): el
 *      canal avisa (`catalogo:cambio`), la Venta relee en segundo plano y el
 *      siguiente escaneo ya entra a 38. Se mide cuánto tarda.
 *   2. Cambio en OTRA caja (directo en la base, sin aviso): el escaneo entra
 *      a 40 con la copia vieja, pero el cobro compara contra la base, se
 *      detiene, la cuenta toma 38 y la venta queda a 38. Nunca a 40.
 *
 * CPU: `Emulation.setCPUThrottlingRate` (WYBIX_CPU, 6 por omisión ≈
 * Celeron/Atom). La RAM no se puede limitar desde aquí.
 * Catálogo: WYBIX_PRODUCTOS (6,000 por omisión) + la papaya.
 * Tiempos en tmp/e2e-precio/.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

const SALIDA = path.join(__dirname, '..', 'tmp', 'e2e-precio');
const PRODUCTOS = Number(process.env.WYBIX_PRODUCTOS ?? 6000);
const CPU = Number(process.env.WYBIX_CPU ?? 6);
const CODIGO = '7500000099901';

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

async function sembrar(base) {
  const [fila] = await sql(base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'Perf Marca') INSERT INTO dbo.CAT_brands (namee) VALUES (N'Perf Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'Perf Cat 1')
      INSERT INTO dbo.CAT_categories (namee) SELECT N'Perf Cat ' + CAST(v.n AS nvarchar) FROM (VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10)) v(n);
    DECLARE @faltan int = ${PRODUCTOS} - (SELECT COUNT(*) FROM dbo.products WHERE part_number LIKE N'PERF-%');
    IF @faltan > 0
      INSERT INTO dbo.products (part_number, bar_code, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date)
      SELECT TOP (@faltan) N'PERF-' + CAST(x.n AS nvarchar), N'75000' + RIGHT('0000000' + CAST(x.n AS nvarchar), 7),
             N'Producto rendimiento ' + CAST(x.n AS nvarchar), 10 + (x.n % 300), 100, 1, 1, 'DIRECT',
             (SELECT id FROM dbo.CAT_categories WHERE namee = N'Perf Cat ' + CAST(1 + x.n % 10 AS nvarchar)),
             (SELECT id FROM dbo.CAT_brands WHERE namee = N'Perf Marca'), 5, '02', 0.16, GETDATE()
        FROM (SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b) x;
    DECLARE @c int = (SELECT id FROM dbo.CAT_categories WHERE namee = N'Perf Cat 1'), @b int = (SELECT id FROM dbo.CAT_brands WHERE namee = N'Perf Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'E2E-PAPAYA')
      INSERT INTO dbo.products (part_number, bar_code, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date)
      VALUES (N'E2E-PAPAYA', N'${CODIGO}', N'Papaya maradol', 40, 100, 1, 1, 'DIRECT', @c, @b, 25, '02', 0.16, GETDATE());
    UPDATE dbo.products SET price = 40, stock = 100, bar_code = N'${CODIGO}' WHERE part_number = N'E2E-PAPAYA';
    SELECT id FROM dbo.products WHERE part_number = N'E2E-PAPAYA';`);
  return Number(fila.id);
}

test.afterEach(async ({ app }) => {
  await sql(app.base, `DELETE FROM dbo.products WHERE part_number LIKE N'PERF-%'
                         AND NOT EXISTS (SELECT 1 FROM dbo.sale_detail d WHERE d.product_id = dbo.products.id);`).catch(() => {});
});

async function cerrarAvisoDeVenta(p) {
  for (let i = 0; i < 2; i++) {
    for (const b of [p.getByRole('button', { name: 'Nada más, cerrar' }), p.locator('app-premios-venta').getByRole('button', { name: 'Continuar' }).first()]) {
      try { await b.click({ timeout: 2500 }); } catch { /* no está */ }
    }
  }
}

test('precio nuevo en la Venta: llega solo, y el cobro nunca usa el viejo (CPU de gama baja)', async ({ app }) => {
  test.setTimeout(600000);
  fs.mkdirSync(SALIDA, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1366, height: 820 });
  const papaya = await sembrar(app.base);

  await p.fill('#username', CUENTAS.admin.usuario);
  await p.fill('#password', CUENTAS.admin.password);
  await p.click('#btnLogin');
  await expect.poll(async () => { try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; } }, { timeout: 60000 })
    .toBe(CUENTAS.admin.usuario);
  const yo = (await app.invocar('sesion')).data.userId;
  await app.invocar('openShift', { user_id: yo, opening_cash: 500, register_id: 1 });

  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

  const t = { cpu: `${CPU}x más lento`, productos: PRODUCTOS + 1 };
  const total = async () => Number(((await p.locator('#total-venta').innerText()).match(/[\d,.]+/) || ['0'])[0].replace(/,/g, ''));
  const quitarLineas = async () => {
    while (await p.locator('[data-guide=venta-linea] button.btn-danger').count()) {
      await p.locator('[data-guide=venta-linea] button.btn-danger').first().click();
      await p.locator('.swal2-confirm').click({ timeout: 1500 }).catch(() => {});
    }
    await expect(p.locator('[data-guide=venta-linea]')).toHaveCount(0, { timeout: 30000 });
  };
  /** Escanear como la pistola (teclado rápido + Enter); devuelve a cuánto entró. */
  const escanear = async ({ dejar = false } = {}) => {
    await p.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await p.keyboard.type(CODIGO, { delay: 4 });
    await p.keyboard.press('Enter');
    await expect(p.locator('[data-guide=venta-linea]')).toHaveCount(1, { timeout: 60000 });
    const precio = await total();
    if (!dejar) await quitarLineas();
    return precio;
  };
  const tarjeta = p.locator('.modal-productos [data-guide=venta-producto][data-guide-clave="E2E-PAPAYA"] .pi-price');
  const precioTarjeta = async () => Number(((await tarjeta.innerText()).match(/[\d,.]+/) || ['0'])[0].replace(/,/g, ''));
  /** Abre el buscador con la papaya a la vista; devuelve cuánto tardó en verse. */
  const abrirBuscador = async () => {
    const t0 = Date.now();
    await p.getByRole('button', { name: /Agregar producto/ }).click();
    await p.locator('.modal-productos [data-guide=venta-producto]').first().waitFor({ timeout: 120000 });
    const ms = Date.now() - t0;
    await p.locator('[data-guide=venta-buscar]').fill('papaya');
    await tarjeta.waitFor({ timeout: 60000 });
    return ms;
  };
  const cerrarBuscador = async () => {
    await p.keyboard.press('Escape');
    if (await p.locator('.modal-productos').count()) await p.locator('.modal-productos button.btn-close').click({ timeout: 2000 }).catch(() => {});
    await expect(p.locator('.modal-productos')).toHaveCount(0);
  };
  const cobrarEfectivo = async () => {
    await p.locator('[data-guide=venta-cobrar]').click();
    await p.locator('[data-guide=venta-recibido]').fill('100');
    await p.locator('[data-guide=venta-confirmar-cobro]').click();
  };
  const ultimaVentaPapaya = async () => (await sql(app.base,
    `SELECT TOP 1 CAST(d.unitary_price AS float) AS unit_price FROM dbo.sale_detail d WHERE d.product_id = ${papaya} ORDER BY d.sale_id DESC;`))[0]?.unit_price;

  // ------------------------------------------- la caja ya tiene el catálogo
  await irPorDock(p, 'Venta');
  await p.waitForSelector('.pos-wrap');
  t.cargaCatalogo = await abrirBuscador();
  expect(await precioTarjeta()).toBe(40);

  // ----------------------- 1. cambio en ESTA computadora (como Inventario)
  /* El buscador queda abierto: la tarjeta cambia sola cuando la Venta relee. */
  let t0 = Date.now();
  const r = await app.invocar('actualizarProducto', { product_id: papaya, nombre: 'Papaya maradol', precio: 38, numero_parte: 'E2E-PAPAYA', bar_code: CODIGO });
  expect(r?.success, JSON.stringify(r)).toBeTruthy();
  t.mismaComputadora_msGuardar = Date.now() - t0;
  await expect.poll(precioTarjeta, { timeout: 60000, intervals: [50] }).toBe(38);
  t.mismaComputadora_msHastaVerPrecioNuevo = Date.now() - t0;
  await cerrarBuscador();
  t.mismaComputadora_escaneo = await escanear({ dejar: true });
  expect(t.mismaComputadora_escaneo).toBe(38);
  await cobrarEfectivo();
  await expect.poll(ultimaVentaPapaya, { timeout: 30000 }).toBe(38);
  await cerrarAvisoDeVenta(p);

  // ------------------- 2. cambio en OTRA caja (directo en la base, sin aviso)
  await sql(app.base, `UPDATE dbo.products SET price = 35 WHERE id = ${papaya};`);
  t.otraCaja_escaneoInmediato = await escanear({ dejar: true });       // copia vieja: 38
  t0 = Date.now();
  const ventaAntes = await ultimaVentaPapaya();
  await cobrarEfectivo();
  /* Dos caminos válidos, y en los dos se cobra 35:
     - sin promociones ni precios por canal: el cobro compara contra la base,
       se detiene con «Cambió el precio» y la cuenta toma 35;
     - con motor comercial (otra prueba dejó promociones en la base): la
       cotización ya lee los precios de la base y cobra 35 directo. */
  const aviso = p.locator('.swal2-popup', { hasText: 'Cambió el precio' });
  await expect.poll(async () => (await aviso.count()) > 0 || (await ultimaVentaPapaya()) !== ventaAntes,
    { timeout: 60000, intervals: [200] }).toBe(true);
  t.otraCaja_msHastaAviso = Date.now() - t0;
  if (await aviso.count()) {
    t.otraCaja_camino = 'aviso';
    await expect(aviso).toContainText('$38.00 → $35.00');
    await p.locator('.swal2-confirm').click();
    await expect.poll(total, { timeout: 10000 }).toBe(35);
    t.otraCaja_totalTrasAviso = await total();
    await cobrarEfectivo();
  } else t.otraCaja_camino = 'motor comercial';
  await expect.poll(ultimaVentaPapaya, { timeout: 30000 }).toBe(35);
  t.otraCaja_vendidaA = await ultimaVentaPapaya();
  await cerrarAvisoDeVenta(p);

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  fs.writeFileSync(path.join(SALIDA, `tiempos-cpu${CPU}-${PRODUCTOS}.json`), JSON.stringify(t, null, 2));
  console.log('\nPRECIO NUEVO EN LA VENTA\n' + JSON.stringify(t, null, 2));

  if (t.otraCaja_camino === 'aviso') expect(t.otraCaja_escaneoInmediato, 'sin aviso, el escaneo usa la copia vieja').toBe(38);
  expect(t.otraCaja_vendidaA, 'el cobro nunca usa el precio viejo').toBe(35);
});
