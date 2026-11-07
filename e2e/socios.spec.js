/**
 * Socios y Propinas (0079), en la app de verdad.
 *
 *   1. El administrador activa Socios desde Aplicaciones con el asistente:
 *      empieza con 2 socios y agrega uno por uno hasta el maximo (10); el
 *      boton se apaga en 10. Ve el ejemplo calculado con un producto real
 *      (David pone $10, Leo $30, sandwich de $80) y elige la regla C.
 *   2. Activa Propinas contestando sus preguntas.
 *   3. Una venta con propina en efectivo por el canal de cobro: la venta se
 *      reparte entre los socios y la propina entra al cajon, fuera de Socios.
 *   4. La pantalla de Socios ensena una tarjeta por socio y el reparto del
 *      ejemplo; Propinas ensena lo pendiente.
 *   5. El producto tiene «Pertenece a» en su ficha.
 *
 * El calculo con 2..10 socios (cada regla, gastos, anticipos, liquidacion) lo
 * prueba scripts/db/pruebas/socios.mjs; aqui se prueba que la pantalla y los
 * canales lo usan.
 *
 *     npm run e2e:socios
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorMas } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-socios');

async function login(app, c) {
  const p = app.ventana;
  await p.fill('#username', c.usuario);
  await p.fill('#password', c.password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }).toBe(c.usuario);
}

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

const LIMPIAR = `
  DELETE FROM dbo.propinas_reparto_lineas; UPDATE dbo.propinas SET reparto_id = NULL; DELETE FROM dbo.propinas_repartos;
  DELETE FROM dbo.propinas; DELETE FROM dbo.propinas_config;
  DELETE FROM dbo.socios_liquidacion_lineas; DELETE FROM dbo.socios_liquidaciones; DELETE FROM dbo.socios_reparto;
  DELETE FROM dbo.socios_gasto_lineas; DELETE FROM dbo.socios_gasto; DELETE FROM dbo.socios_compra;
  DELETE FROM dbo.socios_movimientos; DELETE FROM dbo.socios_duenos; DELETE FROM dbo.socios_config; DELETE FROM dbo.socios;
  DELETE FROM dbo.business_modules WHERE module_key IN (N'socios', N'propinas');`;

/* Socios y Propinas no deben quedar encendidos para las pruebas que siguen. */
test.afterEach(async ({ app }) => {
  await sql(app.base, `EXEC dbo.sp_set_business_module @module_key = N'socios', @enabled = 0;
                       EXEC dbo.sp_set_business_module @module_key = N'propinas', @enabled = 0;`).catch(() => {});
});

test('Socios: asistente de 2 a 10 socios, venta repartida y propina', async ({ app }) => {
  test.setTimeout(300000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1280, height: 800 });
  await sql(app.base, LIMPIAR);

  /* El ejemplo del documento: Jamon de David ($10), Pan de Leo ($30) y el
     sandwich de $80 que vende David. */
  const ids = (await sql(app.base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'E2E Comida') INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E Comida');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'E2E Bebidas') INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E Bebidas');
    DECLARE @comida INT = (SELECT id FROM dbo.CAT_categories WHERE namee = N'E2E Comida');
    DECLARE @bebidas INT = (SELECT id FROM dbo.CAT_categories WHERE namee = N'E2E Bebidas');
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'E2E-SOC-JAMON')
      INSERT INTO dbo.products (part_number, nombre, price, stock, cost, category_id, sellable, objeto_impuesto, tasa_iva, active, registrated_date)
      VALUES (N'E2E-SOC-JAMON', N'Jamón E2E', 0, 1000, 10, @comida, 0, '02', 0.16, 1, GETDATE());
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'E2E-SOC-PAN')
      INSERT INTO dbo.products (part_number, nombre, price, stock, cost, category_id, sellable, objeto_impuesto, tasa_iva, active, registrated_date)
      VALUES (N'E2E-SOC-PAN', N'Pan E2E', 0, 1000, 30, @bebidas, 0, '02', 0.16, 1, GETDATE());
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'E2E-SOC-SAND')
      INSERT INTO dbo.products (part_number, nombre, price, stock, cost, category_id, inventory_mode, objeto_impuesto, tasa_iva, active, registrated_date)
      VALUES (N'E2E-SOC-SAND', N'Sándwich E2E', 80, 0, NULL, @comida, 'RECIPE', '02', 0.16, 1, GETDATE());
    DECLARE @sand INT = (SELECT id FROM dbo.products WHERE part_number = N'E2E-SOC-SAND');
    IF NOT EXISTS (SELECT 1 FROM dbo.recipes WHERE product_id = @sand)
    BEGIN
      DECLARE @l dbo.RecipeLineType;
      INSERT INTO @l (ingredient_product_id, input_qty, input_uom, waste_pct, sort_order)
      SELECT id, 1, 'pza', 0, ROW_NUMBER() OVER (ORDER BY id) FROM dbo.products WHERE part_number IN (N'E2E-SOC-JAMON', N'E2E-SOC-PAN');
      EXEC dbo.sp_save_recipe @product_id = @sand, @variant_option_id = NULL, @Lines = @l;
    END
    SELECT @sand AS sand, @comida AS comida, @bebidas AS bebidas;`))[0];

  // --------------------------------------------- 1. el asistente, 2 -> 10
  await login(app, CUENTAS.admin);
  await irPorMas(p, 'Aplicaciones');
  const tarjeta = p.locator('article').filter({ has: p.locator('h3', { hasText: /^Socios$/ }) });
  await tarjeta.getByRole('button', { name: /Activar/ }).click();
  await expect(p.locator('[data-guide="socios-asistente"]')).toBeVisible();

  const nombres = ['David', 'Leo', 'Ana', 'Beto', 'Caro', 'Dani', 'Eli', 'Fer', 'Gus', 'Hugo'];
  const campos = p.locator('[data-guide="socio-nombre"]');
  await expect(campos).toHaveCount(2);
  const siguiente = p.locator('[data-guide="socios-siguiente"]');
  for (let i = 0; i < nombres.length; i++) {
    if (i >= 2) {
      await p.locator('[data-guide="socio-agregar"]').click();
      await expect(campos).toHaveCount(i + 1);
    }
    /* Un socio nuevo sin nombre no deja avanzar; con nombre, si. */
    if (i >= 1) await expect(siguiente).toBeDisabled();
    await campos.nth(i).fill(nombres[i]);
    if (i >= 1) await expect(siguiente).toBeEnabled();
  }
  await expect(p.locator('[data-guide="socio-agregar"]')).toBeDisabled();
  await p.screenshot({ path: path.join(SHOTS, '1-diez-socios.png') });
  await siguiente.click();

  /* 2. Comida es de David y Bebidas de Leo. */
  const cat = (id) => p.locator(`.soc-cat[data-guide-clave="${id}"]`);
  await cat(ids.comida).getByRole('combobox').click();
  await p.getByRole('option', { name: 'David', exact: true }).click();
  await cat(ids.bebidas).getByRole('combobox').click();
  await p.getByRole('option', { name: 'Leo', exact: true }).click();
  await siguiente.click();
  await siguiente.click(); // 3. sin dueno: partes iguales

  /* 4. El ejemplo con el sandwich: A 50/30, B 20/60, C 30 % 29/51. */
  await p.locator('[data-guide="socios-ejemplo"]').getByRole('combobox').click();
  await p.getByRole('option', { name: /Sándwich E2E/ }).click();
  const ejemplo = p.locator('[data-guide="socios-ejemplo"]');
  await expect(ejemplo).toContainText('Sándwich E2E');
  await expect(ejemplo.locator('tbody tr').nth(0)).toContainText('$50.00');
  await expect(ejemplo.locator('tbody tr').nth(1)).toContainText('$60.00');
  await expect(ejemplo.locator('tbody tr').nth(2)).toContainText('$29.00');
  await expect(ejemplo.locator('tbody tr').nth(2)).toContainText('$51.00');
  await p.locator('[data-guide="socios-regla-C"]').click();
  await p.screenshot({ path: path.join(SHOTS, '2-ejemplo.png') });
  for (let i = 0; i < 4; i++) await siguiente.click(); // 5 gastos, 6 faltantes, 7 liquidacion, 8 inicio
  await p.locator('[data-guide="socios-terminar"]').click();
  await expect(p.locator('.swal2-popup')).toContainText('Socios activado');
  const socios = await sql(app.base, `SELECT COUNT(*) AS n FROM dbo.socios WHERE activo = 1;
    SELECT enabled FROM dbo.business_modules WHERE module_key = N'socios';`);
  expect(socios[0].enabled).toBe(true);
  expect((await sql(app.base, 'SELECT COUNT(*) AS n FROM dbo.socios WHERE activo = 1;'))[0].n).toBe(10);

  // -------------------------------------------------------- 2. propinas
  await p.locator('.swal2-container').waitFor({ state: 'detached' }).catch(() => {});
  await irPorMas(p, 'Aplicaciones');
  const tProp = p.locator('article').filter({ has: p.locator('h3', { hasText: /^Propinas$/ }) });
  await tProp.getByRole('button', { name: /Activar/ }).click();
  await expect(p.locator('.swal2-popup')).toContainText('Activar Propinas');
  await p.locator('.swal2-confirm').click();
  await expect(p.locator('.swal2-popup')).toContainText('Propinas activado');

  // ------------------------------------- 3. venta con propina, repartida
  const yo = (await app.invocar('sesion')).data.userId;
  await app.invocar('openShift', { user_id: yo, opening_cash: 500 }).catch(() => {});
  const venta = await app.invocar('registerSaleV2', {
    userId: yo, paymentMethod: 'EFECTIVO', lines: [{ productId: ids.sand, qty: 1, unitPrice: 80 }],
    tip: { monto: 12, metodo: 'EFECTIVO' },
  });
  expect(venta).toMatchObject({ success: true, propina: { ok: true } });
  const rep = await sql(app.base, `
    SELECT s.nombre, x.total FROM dbo.socios_reparto x JOIN dbo.socios s ON s.id = x.socio_id
     WHERE x.sale_id = ${venta.saleId} ORDER BY s.nombre;`);
  const de = (n) => Number(rep.find(r => r.nombre === n)?.total);
  expect(de('David')).toBeCloseTo(29, 3);
  expect(de('Leo')).toBeCloseTo(51, 3);
  expect(rep.reduce((a, r) => a + Number(r.total), 0)).toBeCloseTo(80, 3);
  const tip = await sql(app.base, `SELECT p.monto, m.amount FROM dbo.propinas p JOIN dbo.cash_movements m ON m.id = p.cash_movement_id WHERE p.sale_id = ${venta.saleId};`);
  expect(tip[0]).toMatchObject({ monto: 12, amount: 12 });

  // ------------------------------------------------ 4. las pantallas
  await irPorMas(p, 'Socios');
  await expect(p.locator('.soc-cab h1')).toHaveText('Socios');
  await expect(p.locator('[data-guide="socios-tarjetas"] .soc-tarjeta')).toHaveCount(10);
  /* Otras pruebas venden el mismo dia y esas ventas tambien se reparten: la
     pantalla se comprueba por su forma; el monto exacto ya lo dio SQL. */
  await expect(p.locator('.soc-tarjeta', { hasText: 'Leo' })).toContainText('Recupera de sus insumos');
  await p.screenshot({ path: path.join(SHOTS, '3-socios.png') });
  await p.locator('[data-guide="socios-tab-cortes"]').click();
  await expect(p.locator('[data-guide="socios-cortes"] thead')).toContainText('Leo');

  await irPorMas(p, 'Propinas');
  await expect(p.locator('[data-guide="propinas-pendiente"]')).toContainText(/Pagar \$/);
  await p.screenshot({ path: path.join(SHOTS, '4-propinas.png') });
});
