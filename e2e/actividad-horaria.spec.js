/**
 * ESTADISTICAS · HORARIOS, EN PANTALLA.
 *
 *     npx playwright test e2e/actividad-horaria.spec.js
 *
 * Las cuentas por hora y por dia con ventas a horas conocidas las prueba
 * `scripts/db/pruebas/mesas-comandas.mjs` contra una base temporal. Aqui se
 * comprueba que la pantalla ensena lo que dice el procedimiento: se cobran
 * dos ventas ahora y tienen que aparecer en la celda de hoy a esta hora.
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

const filasDe = (r) => Array.isArray(r) ? r : (Array.isArray(r?.recordset) ? r.recordset : (r?.data ?? []));
const hoyIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('Horarios: las ventas de ahora caen en la celda de hoy a esta hora', async ({ app }) => {
  test.setTimeout(120000);
  const { ventana } = app;
  await entrar(app, CUENTAS.admin);

  const userId = (await app.invocar('sesion')).data.userId;
  const abierto = await app.invocar('openShift', { user_id: userId, opening_cash: 1000 });
  expect(abierto?.success || /ya existe un turno/i.test(String(abierto?.error ?? ''))).toBeTruthy();

  /* Un producto propio, sin inventario: la prueba no depende de lo que hayan
     dejado otras ni de que haya existencias. */
  const s = Date.now().toString(36);
  const idDe = (x) => Number(x?.id ?? x?.category_id ?? x?.brand_id);
  /* En una base recien preparada no hay catalogo: se crea lo minimo. */
  let cats = filasDe(await app.invocar('getCategories'));
  if (!cats.length) { await app.invocar('createCategory', { nombre: `Bebidas ${s}` }); cats = filasDe(await app.invocar('getCategories')); }
  let marcas = filasDe(await app.invocar('getBrands'));
  if (!marcas.length) { await app.invocar('createBrand', { nombre: `Casa ${s}` }); marcas = filasDe(await app.invocar('getBrands')); }
  await app.invocar('agregarProducto', idDe(marcas[0]), idDe(cats[0]), `AH-${s}`, `Café hora ${s}`, 30, 0,
    null, null, '02', 0.16, null, { inventory_mode: 'NONE', sellable: 1, base_uom: 'pza' });
  const prod = filasDe(await app.invocar('getActiveProducts')).find(p => p.part_number === `AH-${s}`);
  expect(prod, 'el producto de la prueba existe').toBeTruthy();

  const hoy = hoyIso();
  const antes = await ventana.evaluate((d) => window.wybix.reportes.actividadHoraria({ desde: d, hasta: d }), hoy);
  const ticketsAntes = Number(antes.sets[0][0].tickets);

  for (let i = 0; i < 2; i++) {
    const r = await app.invocar('registerSaleV2', {
      userId, paymentMethod: 'EFECTIVO', customerId: null, dueDate: null, registerId: null,
      lines: [{ productId: Number(prod.id ?? prod.product_id), qty: 1, unitPrice: Number(prod.price), options: [] }],
    });
    expect(r?.success, JSON.stringify(r)).toBeTruthy();
  }
  const despues = await ventana.evaluate((d) => window.wybix.reportes.actividadHoraria({ desde: d, hasta: d }), hoy);
  expect(Number(despues.sets[0][0].tickets), 'el procedimiento cuenta las dos').toBe(ticketsAntes + 2);

  // -------------------------------------------------------- la pantalla
  await irPorMas(ventana, 'Estadisticas');
  await ventana.waitForSelector('app-estadisticas', { timeout: 30000 });
  await ventana.click('.est-seg button:has-text("Horarios")');
  await ventana.waitForSelector('app-actividad-horaria', { timeout: 15000 });
  await ventana.click('.ah-seg button:has-text("Hoy")');

  const kpiTickets = ventana.locator('.ah-kpi').filter({ hasText: 'Tickets' }).locator('.ah-kpi__v');
  await expect(kpiTickets, 'el KPI dice lo mismo que el procedimiento').toHaveText(String(ticketsAntes + 2));

  const ahora = new Date();
  const dia = (ahora.getDay() + 6) % 7; // lunes = 0
  const nombres = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const celda = ventana.locator(`.ah-celda[title^="${nombres[dia]} de ${ahora.getHours()}:00"]`);
  await expect(celda, 'la celda de hoy a esta hora existe').toHaveCount(1);
  await expect(celda, 'y tiene actividad').not.toHaveClass(/\bn0\b/);

  await expect(ventana.locator('.ah-kpi').filter({ hasText: 'Hora pico' }).locator('.ah-kpi__v'),
    'hay hora pico').not.toHaveText('—');

  /* «¿Que <dia> fueron mas fuertes?»: con el dia de hoy elegido sale hoy. */
  await ventana.locator('.ah-seg--dias button').nth(dia).click();
  await expect(ventana.locator('.ah-ranking li'), 'hoy aparece en el ranking de su dia').toHaveCount(1);

  /* Rango personalizado: al reves, el procedimiento lo rechaza y se dice. */
  const alReves = await ventana.evaluate(() => window.wybix.reportes.actividadHoraria({ desde: '2026-09-10', hasta: '2026-09-01' }));
  expect(alReves.success).toBe(false);
  expect(String(alReves.error)).toMatch(/anterior/);
});
