/**
 * Estado de resultados (0062) y Correos de cortes (0061), en la app de verdad.
 *
 *   1. Con ventas de hoy sembradas (costo congelado distinto del costo actual
 *      del producto), la pantalla muestra la utilidad con el costo CONGELADO.
 *   2. Al cerrar un turno sin nube vinculada, el corte queda SIN_ENVIAR y la
 *      ventana "Correos de cortes" lo dice; nada se manda.
 *
 * Las capturas quedan en tmp/e2e-estado-resultados/ para revisarlas a ojo.
 * Las cifras suponen una base recien preparada (npm run e2e:preparar).
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-estado-resultados');

async function login(app, c) {
  const p = app.ventana;
  await p.fill('#username', c.usuario);
  await p.fill('#password', c.password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }).toBe(c.usuario);
}

/* Escribe en la base desechable de las pruebas (las guardas de temporal.mjs
   impiden tocar una base real). */
async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

test('Estado de resultados y correos de cortes', async ({ app }) => {
  test.setTimeout(180000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1440, height: 900 });
  await login(app, CUENTAS.admin);
  const userId = (await app.invocar('sesion')).data.userId;
  /* Codigos propios de esta corrida: la base se reutiliza entre corridas. */
  const corrida = Date.now().toString(36).toUpperCase();
  /* La pantalla abre en el MES en curso: lo que otras pruebas vendieron,
     devolvieron, gastaron o mermaron este mes en esta misma base se manda
     dos meses atras (fuera del mes y del periodo anterior). Sin esto la
     prueba dependia del orden: en la corrida completa siempre fallaba. */
  await sql(app.base, `
    DECLARE @ini DATE = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1);
    DECLARE @atras DATE = DATEADD(MONTH, -2, @ini);
    UPDATE dbo.sales SET datee = DATEADD(MONTH, -2, datee) WHERE datee >= @atras;
    UPDATE dbo.sale_refunds SET datee = DATEADD(MONTH, -2, datee) WHERE datee >= @atras;
    UPDATE dbo.expenses SET expense_date = DATEADD(MONTH, -2, expense_date) WHERE expense_date >= @atras;
    UPDATE dbo.inventory_movements SET datee = DATEADD(MONTH, -2, datee) WHERE datee >= @atras;
    IF OBJECT_ID(N'dbo.production_waste', 'U') IS NOT NULL
      UPDATE dbo.production_waste SET waste_date = DATEADD(MONTH, -2, waste_date) WHERE waste_date >= @atras;
    IF OBJECT_ID(N'dbo.platform_settlement_allocations', 'U') IS NOT NULL
      UPDATE dbo.platform_settlement_allocations SET alloc_date = DATEADD(MONTH, -2, alloc_date) WHERE alloc_date >= @atras;`);

  const turno = await app.invocar('openShift', { user_id: userId, opening_cash: 500 });
  expect(turno?.success || /ya existe un turno/i.test(String(turno?.error ?? '')), JSON.stringify(turno)).toBeTruthy();
  const closureId = Number((await sql(app.base, 'SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC'))[0].id);

  /* Dos productos: uno que se vendió a costo 40 y HOY cuesta 50; otro bajo costo. */
  await sql(app.base, `
    INSERT INTO dbo.products (part_number, nombre, price, stock, cost, objeto_impuesto, tasa_iva, active, registrated_date)
    VALUES (N'E2E-ER-A-${corrida}', N'Aceite 20W-50 1L', 116, 50, 50, '02', 0.16, 1, GETDATE()),
           (N'E2E-ER-C-${corrida}', N'Filtro en oferta', 11.6, 50, 15, '02', 0.16, 1, GETDATE());
    DECLARE @a INT = (SELECT id FROM dbo.products WHERE part_number = N'E2E-ER-A-${corrida}');
    DECLARE @c INT = (SELECT id FROM dbo.products WHERE part_number = N'E2E-ER-C-${corrida}');
    INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance, register_id, closure_id)
    VALUES (GETDATE(), ${userId}, 591.6, 'EFECTIVO', 591.6, 0, 1, ${closureId});
    DECLARE @s INT = SCOPE_IDENTITY();
    INSERT INTO dbo.sale_payments (sale_id, payment_method, amount) VALUES (@s, 'EFECTIVO', 591.6);
    INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, tax_object, tax_rate)
    VALUES (@s, @a, 5, 116, 40, '02', 0.16), (@s, @c, 1, 11.6, 15, '02', 0.16);`);

  /* 1. Estado de resultados ------------------------------------------- */
  await irPorDock(p, 'Inicio', 'Estado de resultados');
  const er = p.locator('app-estado-resultados');
  await expect(er).toBeVisible();
  await expect(er.locator('.er-cifra').first()).toContainText('$510.00');   // 500 + 10 sin IVA
  // costo congelado: 5×40 + 15 = 215 → utilidad bruta 295 (con el costo de hoy serían 245)
  await expect(er.locator('.er-cifra').nth(1)).toContainText('$295.00');
  await expect(er).toContainText('Filtro en oferta');
  await p.screenshot({ path: path.join(SHOTS, '1-estado-resultados.png'), fullPage: true });

  /* 2. Cerrar el turno y ver su correo -------------------------------- */
  const cierre = await app.invocar('closeShift', { closure_id: closureId, cash_delivered: 1091.6 });
  expect(cierre?.success, JSON.stringify(cierre)).toBeTruthy();
  const envio = await app.invocar('corteCorreoEnviar', { closureId });
  expect(envio?.success).toBe(false);
  expect(envio?.data?.estado).toBe('SIN_NUBE');

  await irPorDock(p, 'Venta', 'Corte del día');
  const boton = p.locator('[data-guide="corte-correos"]');
  await expect(boton).toBeVisible();
  await boton.click();
  const dlg = p.locator('app-corte-correos dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText(`#${closureId}`);
  await expect(dlg).toContainText('Sin enviar');
  await expect(dlg).toContainText('no está vinculada');
  await p.waitForTimeout(800);   // la apertura del diálogo anima su opacidad
  await p.screenshot({ path: path.join(SHOTS, '2-correos-de-cortes.png') });
});
