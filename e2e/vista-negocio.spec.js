/**
 * La vista del negocio, de punta a punta en la app de verdad (0090).
 *
 *     npm run e2e:vista-negocio
 *
 * Siembra en la base de prueba una cafetería (un frappé con receta por tamaño
 * y sus modificadores), una panadería (la dona con fórmula y ventas de las
 * últimas semanas) y un abarrote (refresco y agua que se acaban, con su
 * proveedor y su caja). Recorre, con capturas en tmp/e2e-vista-negocio/:
 *
 *   1. Recetas: el vaso del tamaño elegido; cambiar de tamaño lo cambia; pasar
 *      de lo que cabe avisa «Se desborda»; la tira compara los tres tamaños.
 *   2. Modificadores: cada opción con su mini vaso y la frase de lo que hace.
 *   3. Fórmulas: el tazón, la charola y los frascos del simulador.
 *   4. Producción: «Hoy conviene hacer» con la dona, y la tanda en el horno.
 *   5. Alertas: «Generar pedido» arma el del proveedor; «Registrar como
 *      compra» abre Compras ya llena, con cada renglón marcado como pedido.
 *
 * Nada de esto cambia cómo se guarda: lo que se comprueba es que el dibujo y
 * el pedido salen de los mismos datos.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-vista-negocio');

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

async function login(app, c) {
  const p = app.ventana;
  await p.fill('#username', c.usuario);
  await p.fill('#password', c.password);
  await p.click('#btnLogin');
  await expect.poll(async () => { try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; } }, { timeout: 60000 })
    .toBe(c.usuario);
}

/* Rutas de verdad (sin #): se cambia la URL y se avisa al router como lo
   haría el botón de atrás. La base es la carpeta de la app (base-href ./). */
const ir = (p, ruta) => p.evaluate((r) => {
  const destino = location.href.replace(/\/dashboard(\/.*)?$/, '') + r;
  history.pushState({}, '', destino);
  dispatchEvent(new PopStateEvent('popstate', { state: {} }));
}, ruta);
const wy = (p, fn, arg) => p.evaluate(fn, arg);
const ok = (r, que) => expect(r?.success, `${que}: ${JSON.stringify(r)}`).toBeTruthy();

/* [part_number, nombre, categoria, uom, precio, stock, costo, modo] */
const PRODUCTOS = [
  ['VN-LECHE', 'Leche entera', 'Insumos', 'ml', 0, 20000, 0.024, 'DIRECT'],
  ['VN-CAFE', 'Café espresso', 'Insumos', 'ml', 0, 5000, 0.17, 'DIRECT'],
  ['VN-MOKA', 'Jarabe de moka', 'Insumos', 'ml', 0, 3000, 0.12, 'DIRECT'],
  ['VN-HIELO', 'Hielo', 'Insumos', 'g', 0, 50000, 0.004, 'DIRECT'],
  ['VN-CREMA', 'Crema batida', 'Insumos', 'g', 0, 4000, 0.09, 'DIRECT'],
  ['VN-CHISPAS', 'Chispas de chocolate', 'Insumos', 'g', 0, 2000, 0.15, 'DIRECT'],
  ['VN-ALMENDRA', 'Leche de almendra', 'Insumos', 'ml', 0, 6000, 0.05, 'DIRECT'],
  ['VN-FRAPPE', 'Frappé de moka', 'Bebidas', 'pza', 75, 0, 0, 'RECIPE'],
  ['VN-HARINA', 'Harina de trigo', 'Insumos', 'g', 0, 20000, 0.022, 'DIRECT'],
  ['VN-AZUCAR', 'Azúcar', 'Insumos', 'g', 0, 10000, 0.026, 'DIRECT'],
  ['VN-HUEVO', 'Huevo', 'Insumos', 'pza', 0, 120, 3.2, 'DIRECT'],
  ['VN-ACEITE', 'Aceite para freír', 'Insumos', 'ml', 0, 8000, 0.04, 'DIRECT'],
  ['VN-DONA', 'Dona glaseada', 'Panadería', 'pza', 18, 0, 5.4, 'DIRECT'],
  ['VN-REFRESCO', 'Refresco de cola 600 ml', 'Bebidas', 'pza', 20, 9, 13.2, 'DIRECT'],
  ['VN-AGUA', 'Agua natural 1 L', 'Bebidas', 'pza', 14, 14, 8.4, 'DIRECT'],
];

function sqlSembrar() {
  const q = (s) => String(s).replace(/'/g, "''");
  const cats = [...new Set(PRODUCTOS.map((p) => p[2]))];
  const filas = PRODUCTOS.map(([pn, n, c, u, precio, stock, costo, modo]) =>
    `(N'${pn}', N'${q(n)}', ${precio}, ${stock}, N'${q(c)}', N'${u}', ${costo}, N'${modo}', ${precio > 0 ? 1 : 0})`);
  return `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'Vista') INSERT INTO dbo.CAT_brands (namee) VALUES (N'Vista');
    ${cats.map((c) => `IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'${q(c)}') INSERT INTO dbo.CAT_categories (namee) VALUES (N'${q(c)}');`).join('\n')}
    DECLARE @b INT = (SELECT id FROM dbo.CAT_brands WHERE namee = N'Vista');
    DECLARE @f TABLE (pn NVARCHAR(40), nombre NVARCHAR(100), price DECIMAL(10,2), stock DECIMAL(12,2), cat NVARCHAR(100), uom NVARCHAR(10), cost DECIMAL(12,4), modo NVARCHAR(20), vende BIT);
    INSERT INTO @f VALUES ${filas.join(',\n')};
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date, bar_code, base_uom)
      SELECT f.pn, f.nombre, f.price, f.stock, 1, f.vende, f.modo, c.id, @b, f.cost, '02', 0.16, GETDATE(), NULL, f.uom
        FROM @f f JOIN dbo.CAT_categories c ON c.namee = f.cat
       WHERE NOT EXISTS (SELECT 1 FROM dbo.products p WHERE p.part_number = f.pn);
    UPDATE p SET p.stock = f.stock, p.cost = f.cost, p.price = f.price, p.base_uom = f.uom, p.inventory_mode = f.modo, p.active = 1
      FROM dbo.products p JOIN @f f ON f.pn = p.part_number;

    /* El proveedor del abarrote, con su caja y su paquete. */
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_suppliers WHERE nombre = N'Distribuidora del Valle')
      INSERT INTO dbo.CAT_suppliers (nombre, telefono, activo) VALUES (N'Distribuidora del Valle', N'3331234567', 1);
    DECLARE @s INT = (SELECT id FROM dbo.CAT_suppliers WHERE nombre = N'Distribuidora del Valle');
    INSERT INTO dbo.product_suppliers (product_id, supplier_id, is_default, active)
      SELECT p.id, @s, 1, 1 FROM dbo.products p
       WHERE p.part_number IN (N'VN-REFRESCO', N'VN-AGUA')
         AND NOT EXISTS (SELECT 1 FROM dbo.product_suppliers x WHERE x.product_id = p.id AND x.supplier_id = @s);
    INSERT INTO dbo.product_presentations (product_id, name, factor_to_base, is_default, active)
      SELECT p.id, v.nombre, v.factor, 1, 1 FROM dbo.products p
      JOIN (VALUES (N'VN-REFRESCO', N'Caja 24', 24), (N'VN-AGUA', N'Paquete 12', 12)) v(pn, nombre, factor) ON v.pn = p.part_number
       WHERE NOT EXISTS (SELECT 1 FROM dbo.product_presentations x WHERE x.product_id = p.id AND x.name = v.nombre);

    /* Su ritmo: salidas por venta de los últimos 30 días (11.5 y 6.2 al día). */
    DELETE m FROM dbo.inventory_movements m JOIN dbo.products p ON p.id = m.product_id
     WHERE p.part_number IN (N'VN-REFRESCO', N'VN-AGUA') AND m.reference = N'E2E-VISTA';
    INSERT INTO dbo.inventory_movements (product_id, typee, reference, quantity, datee, descriptionn, source)
      SELECT p.id, N'salida', N'E2E-VISTA', v.q, DATEADD(DAY, -d.n, GETDATE()), N'venta sembrada', N'SALE'
        FROM dbo.products p
        JOIN (VALUES (N'VN-REFRESCO', 11.5), (N'VN-AGUA', 6.2)) v(pn, q) ON v.pn = p.part_number
       CROSS JOIN (SELECT TOP 30 ROW_NUMBER() OVER (ORDER BY (SELECT 1)) AS n FROM sys.objects) d;

    /* La dona: lo vendido los últimos 4 días como hoy (40, 46, 44, 50 = 45). */
    DECLARE @u INT = (SELECT TOP 1 id FROM dbo.users ORDER BY id);
    DECLARE @dona INT = (SELECT id FROM dbo.products WHERE part_number = N'VN-DONA');
    DELETE d FROM dbo.sale_detail d JOIN dbo.sales s ON s.id = d.sale_id WHERE s.ext_folio LIKE N'E2E-VISTA-%';
    DELETE FROM dbo.sales WHERE ext_folio LIKE N'E2E-VISTA-%';
    DECLARE @k INT = 1;
    WHILE @k <= 4
    BEGIN
      DECLARE @q INT = CHOOSE(@k, 40, 46, 44, 50);
      INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, ext_folio)
        VALUES (DATEADD(DAY, -7 * @k, DATEADD(HOUR, 10, CAST(CAST(GETDATE() AS DATE) AS DATETIME))), @u, @q * 18, N'EFECTIVO', @q * 18, CONCAT(N'E2E-VISTA-', @k));
      INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price) VALUES (SCOPE_IDENTITY(), @dona, @q, 18);
      SET @k += 1;
    END;
    SELECT id, part_number FROM dbo.products WHERE part_number LIKE N'VN-%';`;
}

test('vista del negocio: vaso, modificadores, fórmula, producción y pedido sugerido', async ({ app }) => {
  test.setTimeout(420000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1440, height: 900 });
  const ids = Object.fromEntries((await sql(app.base, sqlSembrar())).map((r) => [r.part_number, r.id]));
  const foto = (n) => p.screenshot({ path: path.join(SHOTS, `${n}.png`) });

  await login(app, CUENTAS.admin);
  /* El perfil del negocio se leyó al arrancar, antes de sembrar. Aplicaciones
     vuelve a leer las capacidades (caps.load(true)) y toma HOSPITALITY. */
  const cfg = await app.invocar('getConfig');
  const perfil = (bp) => app.invocar('updateBusinessConfig', { ...(cfg?.data ?? cfg), business_profile: bp });
  ok(await perfil('HOSPITALITY'), 'perfil cafetería');
  await ir(p, '/dashboard/aplicaciones');
  await expect.poll(() => p.evaluate(() => location.pathname.endsWith('/dashboard/aplicaciones')), { timeout: 15000 }).toBe(true);
  await p.waitForTimeout(1500);

  /* ------------------------------------------- modificadores y recetas */
  const grupo = await wy(p, (x) => window.wybix.modifiers.save({
    name: 'Tamaño', role: 'SIZE', minSelect: 1, maxSelect: 1, required: true, active: true,
    options: [
      { name: 'Chico 12 oz', priceDelta: 0, effect: 'NONE', sortOrder: 1 },
      { name: 'Mediano 16 oz', priceDelta: 10, effect: 'NONE', sortOrder: 2 },
      { name: 'Grande 20 oz', priceDelta: 20, effect: 'NONE', sortOrder: 3 },
    ],
  }), null);
  ok(grupo, 'grupo Tamaño');
  const extras = await wy(p, (x) => window.wybix.modifiers.save({
    name: 'Extras', role: 'ADDON', minSelect: 0, maxSelect: 4, required: false, active: true,
    options: [
      { name: 'Shot extra', priceDelta: 12, effect: 'ADD', ingredientProductId: x.cafe, qtyBase: 30, sortOrder: 1 },
      { name: 'Leche de almendra', priceDelta: 10, effect: 'SUBSTITUTE', ingredientProductId: x.almendra, replacesProductId: x.leche, sortOrder: 2 },
      { name: 'Sin crema', priceDelta: 0, effect: 'REMOVE', replacesProductId: x.crema, sortOrder: 3 },
      { name: 'Versión doble', priceDelta: 25, effect: 'SCALE', qtyFactor: 1.5, sortOrder: 4 },
    ],
  }), { cafe: ids['VN-CAFE'], almendra: ids['VN-ALMENDRA'], leche: ids['VN-LECHE'], crema: ids['VN-CREMA'] });
  ok(extras, 'grupo Extras');
  ok(await wy(p, (x) => window.wybix.modifiers.setProductGroups({ productId: x.f, groupIds: [x.g, x.e] }),
    { f: ids['VN-FRAPPE'], g: grupo.groupId, e: extras.groupId }), 'asignar grupos');
  const opciones = (await wy(p, (x) => window.wybix.modifiers.list({ productId: x, onlyActive: true }), ids['VN-FRAPPE'])).data.opciones;
  const op = (n) => opciones.find((o) => o.name === n).id;
  const receta = (variante, q) => wy(p, (x) => window.wybix.recipes.save({
    productId: x.f, variantOptionId: x.v,
    lines: [
      { ingredientProductId: x.i.hielo, inputQty: x.q[0], inputUom: 'g', sortOrder: 1 },
      { ingredientProductId: x.i.leche, inputQty: x.q[1], inputUom: 'ml', wastePct: 2, sortOrder: 2 },
      { ingredientProductId: x.i.cafe, inputQty: x.q[2], inputUom: 'ml', sortOrder: 3 },
      { ingredientProductId: x.i.moka, inputQty: x.q[3], inputUom: 'ml', sortOrder: 4 },
      { ingredientProductId: x.i.crema, inputQty: x.q[4], inputUom: 'g', wastePct: 5, sortOrder: 5 },
      { ingredientProductId: x.i.chispas, inputQty: x.q[5], inputUom: 'g', sortOrder: 6 },
    ],
  }), { f: ids['VN-FRAPPE'], v: variante, q,
    i: { hielo: ids['VN-HIELO'], leche: ids['VN-LECHE'], cafe: ids['VN-CAFE'], moka: ids['VN-MOKA'], crema: ids['VN-CREMA'], chispas: ids['VN-CHISPAS'] } });
  ok(await receta(null, [160, 220, 60, 40, 30, 6]), 'receta base');
  ok(await receta(op('Chico 12 oz'), [120, 160, 60, 30, 25, 5]), 'receta chico');
  ok(await receta(op('Grande 20 oz'), [180, 280, 90, 50, 35, 8]), 'receta grande');

  /* --------------------------------------------- fórmula y una tanda */
  ok(await wy(p, (x) => window.wybix.produccion.guardarFormula({ productId: x.dona, rinde: 24, notas: 'Freír 2 minutos por lado', lineas: [
    { ingredientProductId: x.harina, inputQty: 1000, inputUom: 'g', wastePct: 2 },
    { ingredientProductId: x.leche, inputQty: 400, inputUom: 'ml' },
    { ingredientProductId: x.aceite, inputQty: 300, inputUom: 'ml', wastePct: 10 },
    { ingredientProductId: x.azucar, inputQty: 120, inputUom: 'g' },
    { ingredientProductId: x.huevo, inputQty: 3, inputUom: 'pza' },
  ] }), { dona: ids['VN-DONA'], harina: ids['VN-HARINA'], leche: ids['VN-LECHE'], aceite: ids['VN-ACEITE'], azucar: ids['VN-AZUCAR'], huevo: ids['VN-HUEVO'] }), 'fórmula');

  /* ---------------------------------------------------- 1. el vaso */
  await ir(p, '/dashboard/recetas');
  await p.locator('.hosp-item', { hasText: 'Frappé de moka' }).click();
  const vaso = p.locator('[data-guide=receta-vaso]');
  await expect(vaso).toBeVisible({ timeout: 30000 });
  await expect(vaso.locator('.vr__rotulos li')).toHaveCount(6);
  /* El dibujo ocupa su lugar (una clase global de Bootstrap ya lo dejó en 1px). */
  expect((await vaso.locator('svg').first().boundingBox()).width).toBeGreaterThan(150);
  await expect(p.locator('[data-guide=receta-comparar] .hosp-comparar__op')).toHaveCount(3);
  await foto('1-receta-base');
  await p.locator('.hosp-chip', { hasText: 'Grande 20 oz' }).click();
  await expect(vaso.locator('.vr__cap')).toContainText('591 ml');
  await foto('2-receta-grande');
  /* Pasarse: la tabla manda y el vaso lo dice. */
  const leche = p.locator('.hosp-table tbody tr', { hasText: 'Leche entera' }).locator('input[type=number]').first();
  await leche.fill('900');
  await expect(vaso.locator('.vr__cap')).toContainText('Se desborda');
  await foto('3-receta-se-desborda');
  await leche.fill('280');
  await expect(vaso.locator('.vr__cap')).not.toContainText('Se desborda');

  /* ------------------------------------------------ 2. modificadores */
  await p.locator('.hosp-tabs button', { hasText: 'Modificadores' }).click();
  await p.locator('.hosp-item', { hasText: 'Extras' }).click();
  await expect(p.locator('[data-guide=modificador-efecto]')).toHaveCount(4);
  await expect(p.locator('[data-guide=modificador-efecto]').first()).toContainText('Agrega 30 ml de Café espresso');
  await expect(p.locator('[data-guide=modificador-efecto]').nth(1)).toContainText('Cambia Leche entera por Leche de almendra');
  await foto('4-modificadores');

  /* ---------------------------------------------------- 3. fórmula */
  await ir(p, '/dashboard/produccion/formulas');
  await expect(p.locator('[data-guide=produccion-formula-charola]')).toBeVisible({ timeout: 30000 });
  await expect(p.locator('.fo-tazon')).toBeVisible();
  await expect(p.locator('.fo-frasco')).toHaveCount(5);
  await foto('5-formula');

  /* -------------------------------------------------- 4. producción */
  const plan = await wy(p, (x) => window.wybix.produccion.planear({ productId: x, cantidad: 24, uuid: crypto.randomUUID() }), ids['VN-DONA']);
  ok(plan, 'planear');
  const tab = await wy(p, () => window.wybix.produccion.tablero({}));
  const tanda = tab.data.tandas.find((t) => t.product_id === ids['VN-DONA'] && t.status === 'PLANNED');
  ok(await wy(p, (x) => window.wybix.produccion.empezar({ batchId: x }), tanda.id), 'empezar');
  const sug = await wy(p, () => window.wybix.produccion.sugerido({}));
  ok(sug, 'sugerido');
  const dona = sug.data.find((s) => s.product_id === ids['VN-DONA']);
  /* 45 al día, 0 en existencia, 24 en el horno: faltan 21 → una tanda de 24. */
  expect(Number(dona.promedio_dia)).toBe(45);
  expect(Number(dona.sugerido)).toBe(24);
  await ir(p, '/dashboard/produccion');
  await expect(p.locator('[data-guide=produccion-sugerido]')).toContainText('Dona glaseada', { timeout: 30000 });
  await expect(p.locator('.pr-horno')).toHaveCount(1);
  await foto('6-produccion');

  /* ---------------------------------------- 5. pedido → compra llena */
  await ir(p, '/dashboard/alertas');
  await p.locator('[data-guide=alertas-generar-pedido]').click();
  const pedido = p.locator('[data-guide=alertas-pedido]', { hasText: 'Distribuidora del Valle' });
  await expect(pedido).toBeVisible({ timeout: 30000 });
  await expect(pedido.locator('tbody tr')).toHaveCount(2);
  /* Refresco: 11.5 al día por 7 días = 81, hay 9 → 72 = 3 cajas de 24. */
  await expect(pedido.locator('tbody tr', { hasText: 'Refresco' })).toContainText('Caja 24');
  await expect(pedido.locator('tbody tr', { hasText: 'Refresco' }).locator('.al-paso b')).toHaveText('3');
  await pedido.scrollIntoViewIfNeeded();
  await foto('7-alertas-pedido');
  await pedido.locator('[data-guide=alertas-pedido-compra]').click();
  await expect(p.locator('[data-guide=compra-desde-pedido]')).toBeVisible({ timeout: 30000 });
  await expect(p.locator('[data-guide=compra-estado-pedido]')).toHaveCount(2);
  await expect(p.locator('.form-control', { hasText: 'Distribuidora del Valle' })).toBeVisible();
  await foto('8-compra-llena');

  ok(await perfil('RETAIL'), 'perfil de vuelta');
  console.log(`vista del negocio: capturas en ${SHOTS}`);
});
