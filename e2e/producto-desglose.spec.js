/**
 * Editar un producto enseña lo que hay detrás del precio (1.5.8).
 *
 *     npx playwright test e2e/producto-desglose.spec.js
 *
 * Precio $116 con IVA 16% y costo $60: antes de IVA $100, IVA $16, ganancia
 * $40, 66.7% SOBRE EL COSTO (como el «% Ganancia» de Compras), y la línea con
 * el % que se puso en la última compra. Bajar el precio a $58 avisa la pérdida.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-producto-desglose');

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

test('editar producto: precio final, antes de IVA, IVA, costo y ganancia', async ({ app }) => {
  test.setTimeout(180000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1366, height: 820 });
  const n = Date.now().toString().slice(-6);
  const nombre = `Desglose ${n}`;
  await sql(app.base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'E2E Marca') INSERT INTO dbo.CAT_brands (namee) VALUES (N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'E2E Desglose') INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E Desglose');
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date)
    VALUES (N'DSG-${n}', N'${nombre}', 116, 5, 1, 1, 'DIRECT', (SELECT id FROM dbo.CAT_categories WHERE namee = N'E2E Desglose'),
            (SELECT id FROM dbo.CAT_brands WHERE namee = N'E2E Marca'), 60, '02', 0.16, GETDATE());
    DECLARE @prod int = (SELECT id FROM dbo.products WHERE part_number = N'DSG-${n}');
    INSERT INTO dbo.purchase (datee, useer_id, total) VALUES (GETDATE(), (SELECT TOP 1 id FROM dbo.users ORDER BY id), 600);
    INSERT INTO dbo.purchase_detail (puchase_id, product_id, quantity, unitary_price, profit_percent, factor_to_base)
    VALUES (SCOPE_IDENTITY(), @prod, 10, 60, 66.67, 1);`);

  await p.fill('#username', CUENTAS.admin.usuario);
  await p.fill('#password', CUENTAS.admin.password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }, { timeout: 60000 }).toBe(CUENTAS.admin.usuario);

  await irPorDock(p, 'Inventario');
  await p.locator('.ventas-search input[type=search]').fill(nombre);
  await p.locator('tbody tr', { hasText: nombre }).locator('[aria-label="Editar"]').click();

  const d = p.locator('[data-guide=producto-desglose]');
  await expect(d).toBeVisible();
  await expect(d).toContainText('Precio final');
  await expect(d).toContainText('$116.00');
  await expect(d).toContainText('$100.00');
  await expect(d).toContainText('IVA 16%');
  await expect(d).toContainText('$16.00');
  await expect(d).toContainText('$60.00');
  await expect(d).toContainText('$40.00');
  await expect(d).toContainText('66.7%');
  await expect(p.locator('[data-guide=producto-ultima-compra]')).toContainText('66.67% de ganancia');
  await p.screenshot({ path: path.join(SHOTS, 'desglose.png') });

  /* Bajar el precio: se recalcula al escribir y avisa la pérdida. */
  await p.locator('[data-guide=producto-precio]').fill('58');
  await expect(d).toContainText('$50.00');
  await expect(d).toContainText('vendes con pérdida');
  await p.screenshot({ path: path.join(SHOTS, 'perdida.png') });
});
