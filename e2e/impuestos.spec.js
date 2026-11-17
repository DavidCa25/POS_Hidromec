/**
 * Impuestos además del IVA (0083) y el costo editable, en la app de verdad.
 *
 *     npx playwright test e2e/impuestos.spec.js
 *
 *   1. Configuración → Impuestos: el catálogo trae IEPS por tasa encendidos y
 *      las cuotas apagadas; se captura la cuota de bebidas y se enciende.
 *   2. Inventario → editar producto: el costo se escribe en la ficha; marcar
 *      IEPS 8% cambia el desglose (sin impuestos, IEPS, IVA) mientras se
 *      edita; al guardar quedan el costo y el impuesto en la base.
 *   3. Un refresco con IEPS por cuota pide cuántos litros trae una pieza.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock, irPorMas } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-impuestos');

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

test('impuestos: catálogo en Configuración, IEPS y costo en la ficha del producto', async ({ app }) => {
  test.setTimeout(240000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1366, height: 860 });
  const n = Date.now().toString().slice(-6);
  const papas = `Papas IEPS ${n}`, refresco = `Refresco IEPS ${n}`;
  await sql(app.base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'E2E Marca') INSERT INTO dbo.CAT_brands (namee) VALUES (N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'E2E Impuestos') INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E Impuestos');
    DECLARE @c INT = (SELECT id FROM dbo.CAT_categories WHERE namee = N'E2E Impuestos'), @b INT = (SELECT id FROM dbo.CAT_brands WHERE namee = N'E2E Marca');
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date, bar_code)
    VALUES (N'IMP-P-${n}', N'${papas}', 58, 10, 1, 1, 'DIRECT', @c, @b, 30, '02', 0.16, GETDATE(), N'75001${n}');
    /* Con su propio código: el DEFAULT heredado de bar_code es un valor fijo y chocaría. */
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date, bar_code)
    VALUES (N'IMP-R-${n}', N'${refresco}', 20, 10, 1, 1, 'DIRECT', @c, @b, 9, '02', 0.16, GETDATE(), N'75002${n}');`);

  await p.fill('#username', CUENTAS.admin.usuario);
  await p.fill('#password', CUENTAS.admin.password);
  await p.click('#btnLogin');
  await expect.poll(async () => { try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; } }, { timeout: 60000 })
    .toBe(CUENTAS.admin.usuario);

  // ------------------------------------------- 1. Configuración → Impuestos
  await irPorMas(p, 'Configuración');
  await p.locator('[data-guide=config-mosaico][data-guide-clave=impuestos]').click();
  const panel = p.locator('[data-guide=impuestos-panel]');
  await expect(panel).toBeVisible({ timeout: 20000 });
  const alimentos = panel.locator('[data-guide=impuesto][data-guide-clave=IEPS_ALIMENTOS]');
  await expect(alimentos.locator('[data-guide=impuesto-valor]')).toHaveValue('8');
  await expect(alimentos.locator('[data-guide=impuesto-activo]')).toBeChecked();
  const bebidas = panel.locator('[data-guide=impuesto][data-guide-clave=IEPS_BEBIDAS_AZUCAR]');
  await expect(bebidas.locator('[data-guide=impuesto-activo]')).not.toBeChecked();
  /* Cuota de PRUEBA: el negocio captura la vigente. */
  await bebidas.locator('[data-guide=impuesto-valor]').fill('1.5');
  await bebidas.locator('[data-guide=impuesto-valor]').blur();
  /* El interruptor es un checkbox oculto bajo su etiqueta: se toca la etiqueta. */
  await bebidas.locator('label.sw').click();
  await expect.poll(async () => (await sql(app.base, `SELECT activo, cuota FROM dbo.CAT_impuestos WHERE clave = 'IEPS_BEBIDAS_AZUCAR'`))[0])
    .toEqual({ activo: true, cuota: 1.5 });
  await p.screenshot({ path: path.join(SHOTS, '1-catalogo.png') });
  await p.keyboard.press('Escape');

  // ------------------------------------------- 2. La ficha: costo e IEPS
  await irPorDock(p, 'Inventario');
  await p.locator('.ventas-search input[type=search]').fill(papas);
  await p.locator('tbody tr', { hasText: papas }).locator('[aria-label="Editar"]').click();
  const d = p.locator('[data-guide=producto-desglose]');
  await expect(d).toContainText('$50.00');                         // 58 / 1.16
  await expect(p.locator('[data-guide=producto-costo]')).toHaveValue('30');
  await p.locator('[data-guide=producto-costo]').fill('28');
  await expect(d).toContainText('$22.00');                         // 50 − 28
  const fila = p.locator('[data-guide=producto-impuestos] .prod-impuestos__fila', { hasText: 'alimentos no básicos' });
  await fila.locator('[data-guide=producto-impuesto]').click();
  /* 58 / (1.08 × 1.16) = 46.30; IEPS 3.70; IVA 8.00. */
  await expect(d).toContainText('Sin impuestos');
  await expect(d.locator('[data-guide=producto-desglose-impuesto]')).toContainText('$3.70');
  await expect(d).toContainText('$46.30');
  await expect(d).toContainText('$8.00');
  await p.screenshot({ path: path.join(SHOTS, '2-ficha.png') });
  await p.locator('[data-guide=producto-guardar]').click();
  await expect.poll(async () => (await sql(app.base, `
    SELECT p.cost, (SELECT COUNT(*) FROM dbo.product_impuestos x JOIN dbo.CAT_impuestos i ON i.id = x.impuesto_id
                     WHERE x.product_id = p.id AND i.clave = 'IEPS_ALIMENTOS') AS ieps
      FROM dbo.products p WHERE p.part_number = N'IMP-P-${n}'`))[0], { timeout: 20000 }).toEqual({ cost: 28, ieps: 1 });

  // ------------------------------------------- 3. Por cuota: litros por pieza
  await p.locator('.ventas-search input[type=search]').fill(refresco);
  await p.locator('tbody tr', { hasText: refresco }).locator('[aria-label="Editar"]').click();
  const cuota = p.locator('[data-guide=producto-impuestos] .prod-impuestos__fila', { hasText: 'bebidas saborizadas' });
  await cuota.locator('[data-guide=producto-impuesto]').click();
  await cuota.locator('[data-guide=producto-impuesto-cantidad]').fill('0.6');
  /* (20 − 0.9 × 1.16) / 1.16 = 16.34; IEPS 0.90. */
  await expect(d.locator('[data-guide=producto-desglose-impuesto]')).toContainText('$0.90');
  await expect(d).toContainText('$16.34');
  await p.locator('[data-guide=producto-guardar]').click();
  await expect.poll(async () => (await sql(app.base, `
    SELECT x.cantidad FROM dbo.product_impuestos x JOIN dbo.products p ON p.id = x.product_id WHERE p.part_number = N'IMP-R-${n}'`))[0]?.cantidad,
    { timeout: 20000 }).toBe(0.6);
  await p.screenshot({ path: path.join(SHOTS, '3-cuota.png') });

  /* Se deja el catálogo como venía para las demás pruebas. */
  await sql(app.base, `UPDATE dbo.CAT_impuestos SET activo = 0, cuota = NULL WHERE clave = 'IEPS_BEBIDAS_AZUCAR';
                       DELETE x FROM dbo.product_impuestos x JOIN dbo.products p ON p.id = x.product_id WHERE p.part_number IN (N'IMP-P-${n}', N'IMP-R-${n}');`);
});
