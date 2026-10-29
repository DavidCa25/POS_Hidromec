/**
 * Liquidaciones de plataforma (0069), en la app de verdad.
 *
 *   1. Liga el canal «Uber Eats» con su plataforma desde la pantalla.
 *   2. Sube el reporte de pedidos de ejemplo de Uber Eats
 *      (e2e/fixtures-archivos/uber-pedidos-ejemplo.csv), captura el desglose y
 *      concilia contra las ventas de la caja: por número de pedido, por
 *      importe, a un día de distancia, faltante, cancelado, importe distinto
 *      y sobrante.
 *   3. Empareja a mano el faltante con el sobrante y confirma.
 *   4. El estado de resultados baja la venta y resta la comisión, y la tabla
 *      por canal enseña la utilidad real de Uber Eats.
 *
 * Corre sobre su PROPIA base (Wybix_E2E_Liquidaciones), para no pisar a otras
 * pruebas que usen Wybix_E2E_Core en el mismo servidor:
 *
 *     npm run e2e:liquidaciones
 *
 * Las capturas quedan en tmp/e2e-liquidaciones/.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-liquidaciones');
const ARCHIVO = path.join(__dirname, 'fixtures-archivos', 'uber-pedidos-ejemplo.csv');

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

async function elegir(p, selectorHost, opcion) {
  await p.locator(selectorHost).getByRole('combobox').click();
  await p.getByRole('option', typeof opcion === 'string' ? { name: opcion, exact: true } : { name: opcion }).last().click();
}

test('Liquidación de Uber Eats: archivo, conciliación y utilidad real', async ({ app }) => {
  test.setTimeout(240000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1440, height: 900 });
  await login(app, CUENTAS.admin);
  const u = (await app.invocar('sesion')).data.userId;

  /* Un canal «Uber Eats» y la semana de ventas de la caja que corresponde al
     archivo de ejemplo (19 al 25 de octubre de 2026). */
  await sql(app.base, `
    DECLARE @p NVARCHAR(MAX) = (SELECT payload FROM dbo.commercial_policy WHERE id = 1);
    IF NOT EXISTS (SELECT 1 FROM OPENJSON(@p, '$.channels') WITH (id NVARCHAR(64)) WHERE id = N'UBER')
      UPDATE dbo.commercial_policy
         SET payload = JSON_MODIFY(payload, 'append $.channels', JSON_QUERY(N'{"id":"UBER","name":"Uber Eats","active":true,"inheritBase":true}')),
             version = version + 1
       WHERE id = 1;
    DELETE FROM dbo.platform_channels;
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'E2E-LQ-DONA')
      INSERT INTO dbo.products (part_number, nombre, price, stock, cost, objeto_impuesto, tasa_iva, active, registrated_date)
      VALUES (N'E2E-LQ-DONA', N'Dona glaseada', 116, 500, 40, '02', 0.16, 1, GETDATE());`);
  const venta = async (fecha, piezas, { canal = 'UBER', ref = null, total = null } = {}) => {
    const t = total ?? 116 * piezas;
    const snap = canal ? `N'{"channel":"${canal}","channelName":"Uber Eats","discount":"0.00"}'` : 'NULL';
    await sql(app.base, `
      DECLARE @a INT = (SELECT id FROM dbo.products WHERE part_number = N'E2E-LQ-DONA');
      INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance, commercial_snapshot)
      VALUES ('${fecha}', ${u}, ${t}, 'PLATAFORMA', ${t}, 0, ${snap});
      DECLARE @s INT = SCOPE_IDENTITY();
      INSERT INTO dbo.sale_payments (sale_id, payment_method, amount, reference) VALUES (@s, 'PLATAFORMA', ${t}, ${ref ? `N'${ref}'` : 'NULL'});
      INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, tax_object, tax_rate)
      VALUES (@s, @a, ${piezas}, ${t / piezas}, 40, '02', 0.16);`);
  };
  await venta('2026-10-19T13:00:00', 2, { ref: '9A3F1' });            // por número de pedido
  await venta('2026-10-20T14:05:00', 1);                              // por importe
  await venta('2026-10-22T00:05:00', 3, { canal: null });             // sin canal, al día siguiente
  await venta('2026-10-24T12:25:00', 1, { ref: 'F7A2B', total: 120 }); // importe distinto
  await venta('2026-10-25T13:00:00', 1);                              // sobrante

  /* 1. Ligar el canal ----------------------------------------------------- */
  await irPorDock(p, 'Inicio', 'Liquidaciones de plataforma');
  const lq = p.locator('app-liquidaciones');
  await expect(lq).toBeVisible();
  await expect(lq.locator('[data-guide="lq-canales"]')).toBeVisible();   // sin canales ligados se abre solo
  await elegir(p, '[data-guide="lq-ligar-UBER"]', 'Uber Eats');
  await expect(lq.locator('.lq-cifra[data-guide-clave="UBER_EATS"]')).toContainText('sin liquidar');
  await p.screenshot({ path: path.join(SHOTS, '1-canales-y-por-cobrar.png'), fullPage: true });

  /* 2. Archivo y desglose ------------------------------------------------- */
  await lq.locator('[data-guide="lq-nueva"]').click();
  await lq.locator('[data-guide="lq-archivo"] input[type="file"]').setInputFiles(ARCHIVO);
  await expect(lq.locator('[data-guide="lq-leido"]')).toContainText('6 pedidos');
  // Lo que enseña la pantalla de ganancias de Uber, con IVA.
  const capturar = async (guia, v) => { const i = lq.locator(`[data-guide="${guia}"]`); await i.fill(String(v)); };
  await capturar('lq-ventas', 986);
  await capturar('lq-marketing', 116);
  await capturar('lq-comision', 232);
  await capturar('lq-reembolsos', 58);
  await capturar('lq-isr', 10);
  await capturar('lq-iva', 5);
  await expect(lq.locator('[data-guide="lq-esperado"]')).toContainText('$565.00');
  await lq.locator('[data-guide="lq-guardar"]').click();
  await expect(lq.locator('[data-guide="lq-conciliacion"]')).toBeVisible();

  const fila = (id) => lq.locator(`[data-guide="lq-conciliacion"] tr[data-guide-clave^="${id}"]`);
  await expect(fila('9a3f1c2e')).toHaveAttribute('data-guide-estado', 'OK');
  await expect(fila('9a3f1c2e')).toContainText('por número de pedido');
  await expect(fila('b7e2d4a1')).toHaveAttribute('data-guide-estado', 'OK');
  await expect(fila('c1d4e5f6')).toHaveAttribute('data-guide-estado', 'OK');
  await expect(fila('d5e6f7a8')).toHaveAttribute('data-guide-estado', 'FALTA_EN_CAJA');
  await expect(fila('e6f7a8b9')).toHaveAttribute('data-guide-estado', 'CANCELADO');
  await expect(fila('f7a2b3c4')).toHaveAttribute('data-guide-estado', 'DIFERENCIA');
  await expect(lq.locator('[data-guide="lq-sobrantes"] li')).toHaveCount(1);
  await p.screenshot({ path: path.join(SHOTS, '2-conciliacion.png'), fullPage: true });

  /* 3. Emparejar a mano y confirmar --------------------------------------- */
  const sobrante = Number((await sql(app.base, `SELECT id FROM dbo.sales WHERE datee = '2026-10-25T13:00:00'`))[0].id);
  // La opción lleva la venta y, en segunda línea, su fecha y canal.
  await elegir(p, '[data-guide="lq-elegir-4"]', new RegExp(`^Folio ${sobrante} · `));
  await fila('d5e6f7a8').getByRole('button', { name: 'Emparejar' }).click();
  await expect(fila('d5e6f7a8')).toHaveAttribute('data-guide-estado', 'DIFERENCIA');
  await expect(fila('d5e6f7a8')).toContainText('a mano');
  await expect(lq.locator('[data-guide="lq-sobrantes"]')).toHaveCount(0);
  await lq.locator('[data-guide="lq-confirmar"]').click();
  await lq.locator('[data-guide="lq-confirmar-si"]').click();
  await expect(lq.locator('[data-guide="lq-estado"]')).toHaveAttribute('data-estado', 'CONFIRMADA');
  await p.screenshot({ path: path.join(SHOTS, '3-confirmada.png'), fullPage: true });

  const eg = await sql(app.base, `SELECT e.amount, c.kind FROM dbo.expenses e JOIN dbo.expense_categories c ON c.id = e.category_id
                                   WHERE e.platform_settlement_id IS NOT NULL AND e.voided_at IS NULL`);
  expect(eg.length).toBe(1);
  expect(Number(eg[0].amount)).toBe(200);           // 232 / 1.16: la comisión SIN IVA
  expect(eg[0].kind).toBe('PLATAFORMA');

  /* 4. Estado de resultados del periodo liquidado -------------------------- */
  await lq.locator('[data-guide="lq-ver-resultados"]').click();
  const er = p.locator('app-estado-resultados');
  await expect(er).toBeVisible();
  // Ventas de la semana: 2 + 1 + 3 + 1 (a 120) + 1 donas = 8 donas; 7 x 100 + 120/1.16 sin IVA.
  const r = await app.invocar('estadoResultados', { desde: '2026-10-19', hasta: '2026-10-25' });
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  expect(Number(r.data.actual.descuentos_plataforma)).toBeCloseTo(150, 1);   // (116 + 58) / 1.16
  expect(Number(r.data.actual.comisiones_plataforma)).toBeCloseTo(200, 1);
  expect(Number(r.data.actual.retenciones_plataforma)).toBeCloseTo(15, 1);
  const uber = r.data.canales.find((c) => c.canal === 'UBER');
  expect(uber.plataforma).toBe('UBER_EATS');
  expect(uber.sin_liquidar).toBe(false);
  await expect(er.locator('[data-guide="er-por-canal"]')).toBeVisible();
  await expect(er.locator('[data-guide="er-por-canal"] tr[data-guide-clave="UBER"]')).toContainText('Uber Eats');
  await expect(er).toContainText('Comisiones de plataformas');
  await expect(er.locator('[data-guide="er-retenciones"]')).toContainText('contador');
  await p.screenshot({ path: path.join(SHOTS, '4-estado-resultados.png'), fullPage: true });
});
