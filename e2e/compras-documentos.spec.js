/**
 * Documentos de compra (0077): subir el ticket o la factura del proveedor,
 * revisarlo y pasarlo a la compra, en la app de verdad.
 *
 *   1. Foto de un ticket de mayorista (OCR local): detecta el proveedor por
 *      RFC, sugiere los productos, crea la presentación «Caja ×12» que el
 *      producto no tenía, pasa los renglones con su costo por caja y, al
 *      registrar, liga el documento a la compra y recuerda los renglones.
 *      Subir el mismo ticket otra vez ya los reconoce «de memoria».
 *   2. XML de una factura (CFDI): proveedor no dado de alta → «Agregar» llega
 *      con nombre y RFC; el producto se encuentra por código de barras; el
 *      costo descuenta el descuento del concepto y suma su IEPS. Subir la
 *      misma factura ya registrada se rechaza por UUID.
 *
 *     npm run build && node e2e/preparar-bases.mjs core && npx playwright test e2e/compras-documentos.spec.js
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock } = require('./fixtures');
const { leerCfdi } = require('../electron/ocr/cfdi.cjs');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-compras-documentos');
const DOCS = path.join(__dirname, '..', 'scripts', 'pruebas', 'compras-documentos');
const TICKET = path.join(DOCS, 'tickets', 'mayorista.png');
const XML = path.join(DOCS, 'xml', 'factura-distribuidor.xml');

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

async function subir(p, archivo) {
  await p.locator('[data-guide="compra-subir-documento"]').click();
  await expect(p.locator('[data-guide="compra-documento-zona"]')).toBeVisible();
  await p.locator('[data-guide="compra-documento-archivo"]').setInputFiles(archivo);
  await expect(p.locator('[data-guide="compra-documento-pasar"]')).toBeVisible({ timeout: 60000 });
}

const renglon = (p, i) => p.locator(`[data-guide="compra-documento-renglon"][data-guide-clave="${i}"]`);

async function registrar(p) {
  await p.locator('.btn-registrar').click();
  await expect(p.locator('.swal2-popup')).toContainText('Compra registrada', { timeout: 30000 });
  await p.locator('.swal2-confirm').click();
  await p.locator('.swal2-container').waitFor({ state: 'detached' }).catch(() => {});
}

test('Ticket por foto y factura XML pasan a la compra y se recuerdan', async ({ app }) => {
  test.setTimeout(300000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  const n = Date.now().toString().slice(-6);
  const cfdi = leerCfdi(fs.readFileSync(XML, 'utf8'));

  /* Catálogo limpio para estos nombres: lo de corridas anteriores, inactivo. */
  const ids = await sql(app.base, `
    UPDATE dbo.products SET active = 0, bar_code = NULL
     WHERE nombre IN (N'Aceite vegetal 1L', N'Arroz super extra 1kg', N'Refresco cola 600ml')
        OR bar_code = '${cfdi.lineas[0].codigo}';
    UPDATE dbo.CAT_suppliers SET activo = 0, rfc = NULL WHERE rfc = '${cfdi.rfc}';
    UPDATE dbo.purchase_documents SET cfdi_uuid = NULL WHERE cfdi_uuid = '${cfdi.uuid}';
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_suppliers WHERE rfc = 'MBA0512153K9' AND ISNULL(activo,1) = 1)
      INSERT INTO dbo.CAT_suppliers (nombre, rfc, activo) VALUES (N'Mayorista del Bajío', 'MBA0512153K9', 1);
    DELETE a FROM dbo.supplier_item_aliases a JOIN dbo.CAT_suppliers s ON s.id = a.supplier_id WHERE s.rfc = 'MBA0512153K9';
    DECLARE @b INT = (SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id);
    DECLARE @c INT = (SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id);
    IF @b IS NULL BEGIN INSERT INTO dbo.CAT_brands (namee) VALUES (N'E2E'); SET @b = SCOPE_IDENTITY(); END
    IF @c IS NULL BEGIN INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E'); SET @c = SCOPE_IDENTITY(); END
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, category_id, brand_id, cost, bar_code, tasa_iva)
    VALUES (N'ACE-${n}', N'Aceite vegetal 1L', 45, 0, 1, @c, @b, 30, NULL, 0),
           (N'ARR-${n}', N'Arroz super extra 1kg', 38, 0, 1, @c, @b, 25, NULL, 0),
           (N'COL-${n}', N'Refresco cola 600ml', 18, 0, 1, @c, @b, 11, '${cfdi.lineas[0].codigo}', 0.16);
    SELECT id, part_number FROM dbo.products WHERE part_number IN (N'ACE-${n}', N'ARR-${n}', N'COL-${n}');`);
  const id = Object.fromEntries(ids.map(r => [r.part_number.slice(0, 3), r.id]));

  await login(app, CUENTAS.admin);
  await irPorDock(p, 'Compras', 'Registrar compra');
  await p.waitForSelector('[data-guide="compra-subir-documento"]', { timeout: 30000 });

  // ------------------------------------------------ 1. ticket por foto
  await subir(p, TICKET);
  await p.screenshot({ path: path.join(SHOTS, '1-ticket-revision.png') });
  const dlg = p.locator('[data-guide="compra-documento"]');
  await expect(dlg).toContainText('Detectado por RFC');
  await expect(p.locator('[data-guide="compra-documento-renglon"]')).toHaveCount(6);
  await expect(renglon(p, 0)).toContainText('ACEITE VEGETAL 1L CJ12');
  await expect(renglon(p, 0).locator('wx-select').first()).toContainText('Aceite vegetal 1L');
  await expect(renglon(p, 0), 'la caja de 12 no existía: se ofrece crearla').toContainText('Se creará al pasar');
  await expect(renglon(p, 1).locator('wx-select').first()).toContainText('Arroz super extra 1kg');
  for (const i of [2, 3, 4, 5]) await renglon(p, i).locator('input[type="checkbox"]').uncheck();
  await expect(p.locator('[data-guide="compra-documento-pasar"]')).toContainText('Pasar 2 renglones');
  await p.locator('[data-guide="compra-documento-pasar"]').click();
  await expect(dlg).toHaveCount(0);

  const filas = p.locator('.venta-table tbody tr');
  await expect(filas).toHaveCount(2);
  await expect(filas.nth(0)).toContainText('Aceite vegetal 1L');
  await expect(filas.nth(0).locator('input[type=\"number\"]').nth(0)).toHaveValue('2');
  await expect(filas.nth(0).locator('input[type=\"number\"]').nth(1)).toHaveValue('412.8');
  await expect(filas.nth(0), 'convierte a piezas').toContainText('Entran 24 pza');
  await expect(filas.nth(1).locator('input[type=\"number\"]').nth(0)).toHaveValue('10');
  await expect(filas.nth(1).locator('input[type=\"number\"]').nth(1)).toHaveValue('28.5');
  await p.screenshot({ path: path.join(SHOTS, '2-ticket-en-compra.png') });
  await registrar(p);

  const despues = await sql(app.base, `
    SELECT p.part_number, CAST(p.stock AS FLOAT) AS stock, CAST(p.cost AS FLOAT) AS cost, CAST(p.price AS FLOAT) AS price
      FROM dbo.products p WHERE p.id IN (${id.ACE}, ${id.ARR}) ORDER BY p.part_number;`);
  expect(despues[0]).toMatchObject({ part_number: `ACE-${n}`, stock: 24, cost: 34.4 });
  expect(despues[0].price, 'conserva el margen (45/30): no queda a precio de costo').toBeCloseTo(51.6, 1);
  expect(despues[1]).toMatchObject({ part_number: `ARR-${n}`, stock: 10, cost: 28.5 });

  const pres = await sql(app.base, `SELECT name, CAST(factor_to_base AS FLOAT) AS f FROM dbo.product_presentations WHERE product_id = ${id.ACE} AND active = 1;`);
  expect(pres).toEqual([{ name: 'Caja ×12', f: 12 }]);
  const docs = await sql(app.base, `
    SELECT TOP 1 d.tipo, d.purchase_id, s.rfc FROM dbo.purchase_documents d JOIN dbo.CAT_suppliers s ON s.id = d.supplier_id
     ORDER BY d.id DESC;`);
  expect(docs[0].tipo).toBe('TICKET');
  expect(docs[0].purchase_id, 'el documento queda ligado a la compra').toBeGreaterThan(0);
  expect(docs[0].rfc).toBe('MBA0512153K9');
  const alias = await sql(app.base, `
    SELECT a.texto, a.product_id, CAST(a.factor AS FLOAT) AS factor FROM dbo.supplier_item_aliases a
      JOIN dbo.CAT_suppliers s ON s.id = a.supplier_id WHERE s.rfc = 'MBA0512153K9' ORDER BY a.product_id;`);
  expect(alias.map(a => a.product_id)).toEqual([id.ACE, id.ARR]);
  expect(alias[0].factor).toBe(12);

  /* El mismo ticket otra vez: ya los conoce. */
  await subir(p, TICKET);
  await expect(renglon(p, 0)).toContainText('Ya lo conocía');
  await expect(renglon(p, 1)).toContainText('Ya lo conocía');
  await expect(renglon(p, 0).locator('wx-select').nth(1)).toContainText('Caja ×12');
  await p.screenshot({ path: path.join(SHOTS, '3-ticket-memoria.png') });
  await p.locator('[data-guide="compra-documento"] .cd-x').click();

  // ------------------------------------------------ 2. factura XML
  await subir(p, XML);
  await expect(dlg).toContainText('no está dado de alta');
  await expect(dlg).toContainText(cfdi.uuid);
  await dlg.locator('.cd-proveedor button:has-text("Agregar")').click();
  await expect(p.locator('#prov-nombre')).toHaveValue(cfdi.proveedor);
  await expect(p.locator('#prov-rfc')).toHaveValue(cfdi.rfc);
  await p.locator('app-proveedor-form button[type="submit"]').click();
  await p.locator('.swal2-container').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await expect(dlg.locator('[data-guide="compra-documento-proveedor"]')).toContainText(cfdi.proveedor);
  await expect(renglon(p, 0)).toContainText('Por código');
  for (let i = 1; i < cfdi.lineas.length; i++) await renglon(p, i).locator('input[type="checkbox"]').uncheck();
  await p.screenshot({ path: path.join(SHOTS, '4-xml-revision.png') });
  await p.locator('[data-guide="compra-documento-pasar"]').click();
  await expect(dlg).toHaveCount(0);

  const l = cfdi.lineas[0];
  const costoCaja = (l.importe - l.descuento + l.ieps) / l.cantidad;
  const precio = Number(await filas.nth(0).locator('input[type="number"]').nth(1).inputValue());
  expect(precio, 'costo por caja: importe − descuento + IEPS').toBeCloseTo(costoCaja, 3);
  await expect(filas.nth(0).locator('input[type="number"]').nth(0)).toHaveValue(String(l.cantidad));
  await registrar(p);

  const col = await sql(app.base, `SELECT CAST(stock AS FLOAT) AS stock FROM dbo.products WHERE id = ${id.COL};`);
  expect(col[0].stock, `${l.cantidad} cajas de ${l.factor}`).toBe(l.cantidad * l.factor);
  const xmlDoc = await sql(app.base, `SELECT TOP 1 tipo, purchase_id, cfdi_uuid FROM dbo.purchase_documents ORDER BY id DESC;`);
  expect(xmlDoc[0]).toMatchObject({ tipo: 'CFDI', cfdi_uuid: cfdi.uuid });
  expect(xmlDoc[0].purchase_id).toBeGreaterThan(0);

  /* La misma factura no entra dos veces. */
  await p.locator('[data-guide="compra-subir-documento"]').click();
  await p.locator('[data-guide="compra-documento-archivo"]').setInputFiles(XML);
  await expect(p.locator('[data-guide="compra-documento"] .cd-error')).toContainText('ya se registró', { timeout: 30000 });
  await p.screenshot({ path: path.join(SHOTS, '5-xml-duplicada.png') });
});

/*
 * ¿YA SE REGISTRÓ? (0078). El repartidor cobró y la caja le pagó con
 * «Salida de efectivo > Pago a proveedor» antes de capturar la compra:
 *   · la revisión encuentra ese pago suelto del mismo proveedor y monto;
 *   · la compra registrada con ese pago aplicado nace PAGADA, el pago queda
 *     ligado a ella y NO sale otro movimiento del cajón;
 *   · después, la revisión encuentra la compra (no el pago, ya aplicado);
 *   · el mismo pago no se puede aplicar a una segunda compra.
 */
test('Compra con pago previo de la caja: se detecta y no sale dos veces', async ({ app }) => {
  test.setTimeout(120000);
  const n = Date.now().toString().slice(-6);
  await login(app, CUENTAS.admin);
  const userId = (await app.invocar('sesion')).data.userId;
  const [fila] = await sql(app.base, `
    INSERT INTO dbo.CAT_suppliers (nombre, activo) VALUES (N'Repartidor duplicados ${n}', 1);
    DECLARE @s INT = SCOPE_IDENTITY();
    DECLARE @b INT = (SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id);
    DECLARE @c INT = (SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id);
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, category_id, brand_id, cost, tasa_iva)
    VALUES (N'DUP-${n}', N'Pan duplicados ${n}', 30, 0, 1, @c, @b, 20, 0);
    DECLARE @p INT = SCOPE_IDENTITY();
    INSERT INTO dbo.supplier_payments (supplier_id, purchase_id, datee, amount, payment_method, user_id, note)
    VALUES (@s, NULL, GETDATE(), 240.00, 'EFECTIVO', ${userId}, N'Pago al repartidor');
    SELECT @s AS s, @p AS p, CAST(SCOPE_IDENTITY() AS INT) AS pago;`);

  const antes = await app.invocar('comprasDocDuplicados', { supplier_id: fila.s, total: 240.4 });
  expect(antes.success).toBe(true);
  expect(antes.data.pagos.map(x => x.id), 'el pago suelto, con 40 centavos de redondeo').toEqual([fila.pago]);
  expect(antes.data.compras).toHaveLength(0);

  const compra = {
    user_id: userId, supplier_id: fila.s, tax_rate: 0, tax_amount: 0, subtotal: 240, total: 240,
    payment_method: 'EFECTIVO', register_id: null, apply_payment_id: fila.pago,
    detalles: [{ product_id: fila.p, quantity: 12, unit_price: 20, profit_percent: 50, presentation_id: null }],
  };
  const movAntes = (await sql(app.base, `SELECT COUNT(*) AS n FROM dbo.cash_movements;`))[0].n;
  const r = await app.invocar('registerPurchase', compra);
  expect(r?.success, r?.error || r?.message).toBe(true);
  const compraId = Number(r.purchase_id);
  const [db] = await sql(app.base, `
    SELECT p.balance, p.payment_status, sp.purchase_id AS pago_de,
           (SELECT COUNT(*) FROM dbo.cash_movements) AS movs
      FROM dbo.purchase p, dbo.supplier_payments sp
     WHERE p.id = ${compraId} AND sp.id = ${fila.pago};`);
  expect(Number(db.balance)).toBe(0);
  expect(db.payment_status).toBe('PAGADO');
  expect(db.pago_de, 'el pago queda ligado a la compra').toBe(compraId);
  expect(db.movs, 'el efectivo no sale otra vez del cajón').toBe(movAntes);

  const despues = await app.invocar('comprasDocDuplicados', { supplier_id: fila.s, total: 240 });
  expect(despues.data.compras.map(x => x.id)).toEqual([compraId]);
  expect(despues.data.pagos).toHaveLength(0);

  const otra = await app.invocar('registerPurchase', compra);
  expect(otra?.success, 'el mismo pago no se aplica a dos compras').toBeFalsy();
});

/*
 * Fotos REALES de proveedores (scripts/pruebas/compras-documentos/tickets/real-*):
 *   · Pepsi, como WEBP (así llegan por WhatsApp): el proceso principal no
 *     abre WEBP; la pantalla la convierte. Foto chica e inclinada, decimales
 *     sin punto y tres importes mal leídos que se corrigen con el neto a
 *     pagar. Combos sin cargo: quedan sin marcar. Cuadra al centavo.
 *   · Sabritas: «$» leído como 8, un importe mal leído, descuento e IVA de
 *     $0.00 leídos 0.80 y 8.08; IEPS 8 % aparte. Cuadra al centavo.
 */
test('Tickets reales de Pepsi (WEBP) y Sabritas cuadran con su total', async ({ app }) => {
  test.setTimeout(180000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  const webp = path.join(SHOTS, 'real-pepsi.webp');
  fs.copyFileSync(path.join(DOCS, 'webp', 'real-pepsi.webp'), webp);

  await login(app, CUENTAS.admin);
  await irPorDock(p, 'Compras', 'Registrar compra');
  await p.waitForSelector('[data-guide="compra-subir-documento"]', { timeout: 30000 });

  await subir(p, webp);
  const dlg = p.locator('[data-guide="compra-documento"]');
  await expect(p.locator('[data-guide="compra-documento-renglon"]')).toHaveCount(11);
  await expect(renglon(p, 0)).toContainText('Sin cargo (promoción)');
  await expect(renglon(p, 0).locator('input[type="checkbox"]').first()).not.toBeChecked();
  await expect(dlg.getByLabel('Los precios del ticket ya incluyen IVA')).toBeChecked();
  await expect(p.locator('[data-guide="compra-documento-cuadre"]')).toContainText('Cuadra con el documento');
  await expect(p.locator('[data-guide="compra-documento-pasar"]')).toContainText('Pasar 9 renglones');
  await p.screenshot({ path: path.join(SHOTS, '6-real-pepsi.png') });

  await dlg.getByRole('button', { name: 'Subir otro' }).click();
  await p.locator('[data-guide="compra-documento-archivo"]').setInputFiles(path.join(DOCS, 'tickets', 'real-sabritas.png'));
  await expect(p.locator('[data-guide="compra-documento-pasar"]')).toBeVisible({ timeout: 60000 });
  await expect(p.locator('[data-guide="compra-documento-renglon"]')).toHaveCount(10);
  await expect(renglon(p, 5)).toContainText('CHEETOS');
  await expect(p.locator('[data-guide="compra-documento-cuadre"]')).toContainText('Cuadra con el documento');
  await expect(dlg).toContainText('se leyó 187.76');
  await p.screenshot({ path: path.join(SHOTS, '7-real-sabritas.png') });
});
