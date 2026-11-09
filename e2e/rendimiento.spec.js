/**
 * Rendimiento con un catálogo grande (6,000 productos), en la app de verdad.
 *
 *     npm run e2e:rendimiento
 *
 * Mide lo que una caja siente: abrir el buscador de Venta, filtrar, abrir
 * Inventario, buscar ahí y buscar en Touch. Cada medida tiene un tope; si una
 * pantalla vuelve a pintar miles de filas o a releer SQL en cada apertura, el
 * tope se rompe. Los tiempos quedan en tmp/e2e-rendimiento/tiempos.json.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

const SALIDA = path.join(__dirname, '..', 'tmp', 'e2e-rendimiento');
const PRODUCTOS = 6000;

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

/** 6,000 productos vendibles en 10 categorías (idempotente). */
async function sembrar(base) {
  await sql(base, `
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
        FROM (SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b) x;`);
}

/** Cuánto tarda `accion` hasta que `listo` se cumple, en ms. */
async function medir(p, accion, listo) {
  const t0 = Date.now();
  await accion();
  await listo();
  /* Un cuadro más: lo que el usuario ve, no solo lo que el DOM ya tiene. */
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  return Date.now() - t0;
}

/* Los 6,000 productos se quitan al terminar: las demás pruebas de la misma
   corrida usan la misma base y esperan un catálogo chico. */
test.afterEach(async ({ app }) => {
  await sql(app.base, `DELETE FROM dbo.products WHERE part_number LIKE N'PERF-%'
                         AND NOT EXISTS (SELECT 1 FROM dbo.sale_detail d WHERE d.product_id = dbo.products.id);`).catch(() => {});
});

test('catálogo de 6,000 productos: Venta e Inventario responden', async ({ app }) => {
  test.setTimeout(420000);
  fs.mkdirSync(SALIDA, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1366, height: 820 });
  await sembrar(app.base);

  await p.fill('#username', CUENTAS.admin.usuario);
  await p.fill('#password', CUENTAS.admin.password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }, { timeout: 60000 }).toBe(CUENTAS.admin.usuario);
  const yo = (await app.invocar('sesion')).data.userId;
  await app.invocar('openShift', { user_id: yo, opening_cash: 500, register_id: 1 });

  const t = {};

  // ------------------------------------------------------------ Venta
  await irPorDock(p, 'Venta');
  await p.waitForSelector('.pos-wrap');
  const abrir = () => p.getByRole('button', { name: /Agregar producto/ }).click();
  t.ventaBuscadorPrimera = await medir(p, abrir, () => p.locator('.modal-productos [data-guide=venta-producto]').first().waitFor({ timeout: 60000 }));
  t.ventaFilasPintadas = await p.locator('.modal-productos [data-guide=venta-producto]').count();
  const buscador = p.locator('[data-guide=venta-buscar]');
  t.ventaFiltrar = await medir(p, () => buscador.fill('rendimiento 4517'),
    () => expect(p.locator('.modal-productos .prod-item:visible')).toHaveCount(1));
  await p.keyboard.press('Escape');
  await p.locator('.modal-productos button.btn-close').click().catch(() => {});
  await expect(p.locator('.modal-productos')).toHaveCount(0);
  t.ventaBuscadorSegunda = await medir(p, abrir, () => p.locator('.modal-productos [data-guide=venta-producto]').first().waitFor({ timeout: 60000 }));
  await p.locator('.modal-productos button.btn-close').click();

  // ------------------------------------------------------------ Inventario
  t.inventarioAbrir = await medir(p, () => irPorDock(p, 'Inventario'),
    () => p.locator('tbody tr').nth(5).waitFor({ timeout: 60000 }));
  const busInv = p.locator('.ventas-search input[type=search]');
  t.inventarioFiltrar = await medir(p, () => busInv.fill('rendimiento 4517'),
    () => expect(p.locator('tbody tr', { hasText: 'Producto rendimiento 4517' })).toHaveCount(1));
  /* Teclear de verdad: cada tecla dispara la detección de cambios. */
  await busInv.fill('');
  t.inventarioTeclear = await medir(p, () => busInv.pressSequentially('rendimiento 5', { delay: 0 }),
    () => expect(p.locator('tbody tr').first()).toBeVisible());

  fs.writeFileSync(path.join(SALIDA, 'tiempos.json'), JSON.stringify(t, null, 2));
  console.log('\nTIEMPOS (ms)\n' + Object.entries(t).map(([k, v]) => `  ${k.padEnd(24)} ${v}`).join('\n'));

  /* Topes: lo que una caja con 6,000 productos debe aguantar sin sentirse lenta. */
  expect(t.ventaFilasPintadas, 'el buscador no pinta miles de tarjetas').toBeLessThanOrEqual(200);
  expect(t.ventaBuscadorSegunda, 'reabrir el buscador usa lo que ya cargó').toBeLessThan(700);
  expect(t.ventaFiltrar).toBeLessThan(1000);
  expect(t.inventarioFiltrar).toBeLessThan(1500);
});
