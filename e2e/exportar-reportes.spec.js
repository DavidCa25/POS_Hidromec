/**
 * Exportar reportes a PDF y Excel, en la app de verdad.
 *
 * Cada pantalla contable tiene su menú "Exportar" (data-guide="exportar-reporte").
 * Aquí se pulsa en cada una, PDF y Excel, y se comprueba el ARCHIVO: que
 * exista, que empiece como un PDF (%PDF) o un xlsx (PK), y que el Excel de
 * los reportes de varias partes traiga una hoja por sección.
 *
 * El diálogo "Guardar como" del sistema se sustituye en el proceso principal
 * por una ruta dentro de tmp/e2e-exportes: lo demás —el canal
 * files:save-bytes, la escritura— es el de producción.
 *
 * Supone una base recién preparada (npm run e2e:preparar).
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock, irPorMas } = require('./fixtures');

const SALIDA = path.join(__dirname, '..', 'tmp', 'e2e-exportes');

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

/** El siguiente "Guardar como" responde con esta ruta. */
async function guardarComo(app, archivo) {
  await app.app.evaluate(({ dialog }, ruta) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: ruta });
  }, archivo);
}

/** Pulsa Exportar > PDF|Excel en la pantalla visible y devuelve el archivo escrito. */
async function exportar(app, nombre, tipo) {
  const p = app.ventana;
  const ext = tipo === 'PDF' ? 'pdf' : 'xlsx';
  const archivo = path.join(SALIDA, `${nombre}.${ext}`);
  fs.rmSync(archivo, { force: true });
  await guardarComo(app, archivo);
  const menu = p.locator('[data-guide="exportar-reporte"]:visible, app-corte-correos wx-menu').first();
  const boton = menu.locator('.wx-menu__btn');
  await expect(boton).toBeEnabled();
  await boton.click();
  await menu.locator('.wx-opt', { hasText: tipo }).click();
  await expect.poll(() => fs.existsSync(archivo) && fs.statSync(archivo).size, { timeout: 20000 }).toBeGreaterThan(500);
  const cabeza = fs.readFileSync(archivo).subarray(0, 4).toString('latin1');
  expect(cabeza.startsWith(tipo === 'PDF' ? '%PDF' : 'PK'), `${archivo} no parece ${ext}`).toBe(true);
  return archivo;
}

async function hojas(archivo) {
  const XLSX = require('xlsx-js-style');
  return XLSX.readFile(archivo).SheetNames;
}

async function ambos(app, nombre) {
  await exportar(app, nombre, 'PDF');
  return exportar(app, nombre, 'Excel');
}

test('Exportar reportes contables a PDF y Excel', async ({ app }) => {
  test.setTimeout(300000);
  fs.mkdirSync(SALIDA, { recursive: true });
  const p = app.ventana;
  await login(app, CUENTAS.admin);
  const userId = (await app.invocar('sesion')).data.userId;

  /* Un turno con una venta, un egreso y un corte ya cerrado. */
  await app.invocar('openShift', { user_id: userId, opening_cash: 500 });
  const closureId = Number((await sql(app.base, 'SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC'))[0].id);
  await sql(app.base, `
    INSERT INTO dbo.products (part_number, nombre, price, stock, cost, objeto_impuesto, tasa_iva, active, registrated_date)
    VALUES (N'E2E-EX-A', N'Aceite 20W-50 1L', 116, 50, 50, '02', 0.16, 1, GETDATE());
    DECLARE @a INT = (SELECT id FROM dbo.products WHERE part_number = N'E2E-EX-A');
    INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance, register_id, closure_id)
    VALUES (GETDATE(), ${userId}, 232, 'EFECTIVO', 232, 0, 1, ${closureId});
    DECLARE @s INT = SCOPE_IDENTITY();
    INSERT INTO dbo.sale_payments (sale_id, payment_method, amount) VALUES (@s, 'EFECTIVO', 232);
    INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, tax_object, tax_rate)
    VALUES (@s, @a, 2, 116, 40, '02', 0.16);
    INSERT INTO dbo.expense_categories (name, kind) VALUES (N'E2E Renta', 'GENERAL');
    INSERT INTO dbo.expenses (expense_date, category_id, amount, payment_method, user_id)
    VALUES (CAST(GETDATE() AS DATE), (SELECT id FROM dbo.expense_categories WHERE name = N'E2E Renta'), 300, 'TRANSFERENCIA', ${userId});
    /* Un cliente con una venta a credito vencida y una compra a proveedor. */
    INSERT INTO dbo.customers (customerName, credit_limit, terms_days, active) VALUES (N'Taller E2E', 5000, 15, 1);
    INSERT INTO dbo.sales (datee, useer_id, total, payment_method, customer_id, paid_amount, balance, due_date, register_id)
    VALUES (DATEADD(DAY, -40, GETDATE()), ${userId}, 1160, 'CREDITO', SCOPE_IDENTITY(), 0, 1160, DATEADD(DAY, -25, GETDATE()), 1);
    INSERT INTO dbo.CAT_suppliers (nombre) VALUES (N'Lubricantes E2E');
    INSERT INTO dbo.purchase (datee, useer_id, total, tax_rate, tax_amount, supplier_id, balance, payment_status)
    VALUES (GETDATE(), ${userId}, 2320, 0.16, 320, SCOPE_IDENTITY(), 2320, 'PENDIENTE');
    INSERT INTO dbo.purchase_detail (puchase_id, product_id, quantity, unitary_price)
    VALUES (SCOPE_IDENTITY(), @a, 50, 40);`);

  /* Corte de caja (abierto todavía, modo Día: lo ve un administrador). */
  await irPorDock(p, 'Venta', 'Corte del día');
  await p.locator('.user-card').first().click();
  await p.locator('button', { hasText: 'Continuar' }).first().click();
  await p.locator('.mode-card').nth(1).click();
  const seguir = p.locator('button', { hasText: 'Continuar' });
  if (await seguir.isVisible().catch(() => false)) await seguir.click();
  await p.locator('button', { hasText: 'Consultar movimientos' }).click();
  await expect(p.locator('.results-view')).toBeVisible();
  const corte = await ambos(app, 'corte-de-caja');
  expect(await hojas(corte)).toEqual(expect.arrayContaining(['Ventas por forma de pago', 'Dinero en caja', 'Movimientos de efectivo']));

  /* Cerrar el turno y exportar el historial de cortes. */
  expect((await app.invocar('closeShift', { closure_id: closureId, cash_delivered: 732 }))?.success).toBeTruthy();
  await irPorDock(p, 'Venta', 'Corte del día');
  await p.locator('[data-guide="corte-correos"]').click();
  await expect(p.locator('app-corte-correos dialog')).toContainText(`#${closureId}`);
  await ambos(app, 'historial-cortes');
  await p.locator('app-corte-correos dialog .cc-cab button').click();

  /* Estado de resultados: una hoja por sección. */
  await irPorDock(p, 'Inicio', 'Estado de resultados');
  await expect(p.locator('app-estado-resultados .er-cifra').first()).toContainText('Ventas netas');
  const er = await ambos(app, 'estado-resultados');
  expect(await hojas(er)).toEqual(expect.arrayContaining(['Estado de resultados', 'Utilidad por día', 'Egresos por concepto']));

  /* Cierre del día. */
  await irPorDock(p, 'Inicio', 'Cierre del día');
  await expect(p.locator('app-cierre-dia .cd-cifra').first()).toBeVisible();
  await p.screenshot({ path: path.join(SALIDA, 'cierre-del-dia.png') });
  const cd = await ambos(app, 'cierre-del-dia');
  expect(await hojas(cd)).toEqual(expect.arrayContaining(['Cortes de caja', 'Ventas del día']));

  /* Egresos. */
  await irPorDock(p, 'Venta', 'Egresos');
  await expect(p.locator('app-egresos')).toContainText('E2E Renta');
  await ambos(app, 'egresos');

  /* Compras, Clientes (cuentas por cobrar), Estadísticas, Facturación. */
  await irPorDock(p, 'Compras', 'Compras registradas');
  await expect(p.locator('app-tabla-compra')).toBeVisible();
  await expect(p.locator('app-tabla-compra')).toContainText('Lubricantes E2E');
  const compras = await ambos(app, 'compras');
  expect(await hojas(compras)).toEqual(['Compras', 'Detalle por producto']);

  await p.locator('.wxdock a', { hasText: 'Clientes' }).click();
  await expect(p.locator('app-clientes')).toBeVisible();
  await expect(p.locator('app-clientes')).toContainText('Taller E2E');
  await ambos(app, 'cuentas-por-cobrar');

  await irPorMas(p, 'Estadísticas');
  await expect(p.locator('app-estadisticas')).toBeVisible();
  await p.waitForTimeout(1500);   // los indicadores cargan en paralelo
  const est = await ambos(app, 'estadisticas');
  expect(await hojas(est)).toEqual(expect.arrayContaining(['Indicadores']));

  await irPorMas(p, 'Facturación');
  await expect(p.locator('app-facturacion')).toBeVisible();
  const fac = p.locator('app-facturacion [data-guide="exportar-reporte"] .wx-menu__btn');
  await expect(fac).toBeVisible();   // sin facturas en la base nueva: el botón existe y espera datos

  await p.screenshot({ path: path.join(SALIDA, 'ultima-pantalla.png') });
});
