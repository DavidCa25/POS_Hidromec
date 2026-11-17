/**
 * Wybix, asistente operativo, en la app de verdad.
 *
 *     npm run e2e:asistente
 *
 *   1. Wybix revisa el negocio: un producto vendido con pérdida aparece como
 *      hallazgo, el dock muestra el número y Inicio lo dice.
 *   2. En el chat: «se cayeron 6 donas zafiro» → tarjeta con antes/después →
 *      Confirmar → la merma queda en la base, el plan en la bitácora y la
 *      frase como ejemplo para el intérprete.
 *   3. Desde el hallazgo: «Cambiar el precio» → pregunta a cuánto → precio
 *      nuevo en la base.
 *   4. Lo que no entiende no lo inventa.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-asistente');

async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

test('Wybix: hallazgos, chat, merma confirmada y precio desde un hallazgo', async ({ app }) => {
  test.setTimeout(300000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1440, height: 900 });

  const [ids] = await sql(app.base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'E2E Marca') INSERT INTO dbo.CAT_brands (namee) VALUES (N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'E2E Wybix') INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E Wybix');
    DELETE FROM dbo.asistente_hallazgos; DELETE FROM dbo.asistente_mensajes;
    DECLARE @c INT = (SELECT id FROM dbo.CAT_categories WHERE namee = N'E2E Wybix'), @b INT = (SELECT id FROM dbo.CAT_brands WHERE namee = N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'WYB-DONA')
      INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date)
      VALUES (N'WYB-DONA', N'Dona zafiro', 18, 42, 1, 1, 'DIRECT', @c, @b, 6.3, '02', 0.16, GETDATE());
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'WYB-PERDIDA')
      INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date)
      VALUES (N'WYB-PERDIDA', N'Galleta cobalto', 10, 30, 1, 1, 'DIRECT', @c, @b, 12, '02', 0.16, GETDATE());
    UPDATE dbo.products SET stock = 42, price = 18, bar_code = N'7500000000101' WHERE part_number = N'WYB-DONA';
    UPDATE dbo.products SET price = 10, bar_code = N'7500000000102' WHERE part_number = N'WYB-PERDIDA';
    SELECT (SELECT id FROM dbo.products WHERE part_number = N'WYB-DONA') AS dona,
           (SELECT id FROM dbo.products WHERE part_number = N'WYB-PERDIDA') AS galleta;`);

  await p.fill('#username', CUENTAS.admin.usuario);
  await p.fill('#password', CUENTAS.admin.password);
  await p.click('#btnLogin');
  await expect.poll(async () => { try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; } }, { timeout: 60000 })
    .toBe(CUENTAS.admin.usuario);

  // ------------------------------------------------ 1. Wybix revisa el negocio
  const ev = await app.invocar('asistenteEvaluar');
  expect(ev?.success, JSON.stringify(ev)).toBeTruthy();
  const hs = (await app.invocar('asistenteHallazgos')).data;
  const perdida = hs.find((h) => h.regla === 'core.costos.precio_bajo_costo' && h.entidad?.nombre === 'Galleta cobalto');
  expect(perdida, JSON.stringify(hs.map((h) => h.titulo))).toBeTruthy();
  await expect(p.locator('[data-guide=wybix-pendientes]')).toBeVisible({ timeout: 20000 });
  await p.screenshot({ path: path.join(SHOTS, '1-dock-e-inicio.png') });

  // ------------------------------------------------------------ 2. el chat
  await p.click('[data-guide=wybix-guide]');
  await expect(p.locator('[data-guide=wybix-chat]')).toBeVisible();
  await expect(p.locator('[data-guide=wybix-mensaje]').first()).toBeVisible({ timeout: 20000 });

  const campo = p.locator('[data-guide=wybix-campo]');
  await campo.fill('se cayeron 6 donas zafiro');
  await expect(p.locator('[data-guide=wybix-entiende]')).toContainText('Registrar merma');
  await p.screenshot({ path: path.join(SHOTS, '2-entiende.png') });
  await campo.press('Enter');
  const plan = p.locator('[data-guide=wybix-plan]').last();
  await expect(plan).toContainText('Dona zafiro');
  await expect(plan).toContainText('42 → 36');
  await p.screenshot({ path: path.join(SHOTS, '3-plan-merma.png') });
  await plan.locator('[data-guide=wybix-confirmar]').click();
  await expect(plan).toHaveAttribute('data-guide-estado', 'hecho', { timeout: 20000 });
  await expect(p.locator('[data-guide=wybix-mensaje]').last()).toContainText(/Listo|Hecho|Ya quedó/);

  const [m] = await sql(app.base, `
    SELECT (SELECT stock FROM dbo.products WHERE id = ${ids.dona}) AS stock,
           (SELECT TOP 1 qty FROM dbo.production_waste WHERE product_id = ${ids.dona} ORDER BY id DESC) AS merma,
           (SELECT TOP 1 estado FROM dbo.asistente_planes WHERE intent = 'merma.registrar' ORDER BY creado_en DESC) AS estado_plan,
           (SELECT COUNT(*) FROM dbo.asistente_frases WHERE texto = N'se cayeron 6 donas zafiro' AND intent = 'merma.registrar') AS frase,
           (SELECT COUNT(*) FROM dbo.asistente_bitacora WHERE evento = 'PLAN_EJECUTADO') AS bitacora;`);
  expect(Number(m.stock)).toBe(36);
  expect(Number(m.merma)).toBe(6);
  expect(m.estado_plan).toBe('ejecutado');
  expect(Number(m.frase), 'la frase confirmada enseña al intérprete').toBe(1);
  expect(Number(m.bitacora)).toBeGreaterThan(0);

  // ------------------------------------------ 3. desde el hallazgo, el precio
  await campo.fill('que pendientes tengo');
  await campo.press('Enter');
  await p.locator('[data-guide=wybix-opcion]', { hasText: 'Galleta cobalto' }).first().click();
  await expect(p.locator('[data-guide=wybix-mensaje]').last()).toContainText('pérdida');
  await p.locator('[data-guide=wybix-opcion]', { hasText: 'Cambiar el precio' }).click();
  await expect(p.locator('[data-guide=wybix-mensaje]').last()).toContainText('¿A qué precio?');
  await campo.fill('$20');
  await campo.press('Enter');
  const plan2 = p.locator('[data-guide=wybix-plan]').last();
  await expect(plan2).toContainText('$10.00 → $20.00');
  await p.screenshot({ path: path.join(SHOTS, '4-plan-precio.png') });
  await plan2.locator('[data-guide=wybix-confirmar]').click();
  await expect(plan2).toHaveAttribute('data-guide-estado', 'hecho', { timeout: 20000 });
  expect(Number((await sql(app.base, `SELECT price FROM dbo.products WHERE id = ${ids.galleta};`))[0].price)).toBe(20);

  // ---------------------------------------------- 4. lo que no entiende
  await campo.fill('el perro de mi vecino');
  await campo.press('Enter');
  await expect(p.locator('[data-guide=wybix-mensaje]').last()).toContainText(/entend/i);
  await p.screenshot({ path: path.join(SHOTS, '5-no-entiende.png') });
});

/**
 * Las demás áreas del negocio, en la app de verdad: gasto, alta de proveedor
 * y ajuste de inventario confirmados contra la base; consultas de caja, de
 * fiado y la pregunta corta que hereda el contexto («¿y ayer?»).
 */
test('Wybix: gasto, proveedor y ajuste confirmados; caja, fiado y contexto', async ({ app }) => {
  test.setTimeout(300000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1440, height: 900 });

  const [ids] = await sql(app.base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'E2E Marca') INSERT INTO dbo.CAT_brands (namee) VALUES (N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'E2E Wybix') INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E Wybix');
    DELETE FROM dbo.asistente_mensajes;
    DELETE FROM dbo.CAT_suppliers WHERE nombre = N'Cremeria Los Altos';
    DECLARE @c INT = (SELECT id FROM dbo.CAT_categories WHERE namee = N'E2E Wybix'), @b INT = (SELECT id FROM dbo.CAT_brands WHERE namee = N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'WYB-ATUN')
      INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date, bar_code)
      VALUES (N'WYB-ATUN', N'Atun ambar', 24, 30, 1, 1, 'DIRECT', @c, @b, 15, '02', 0.16, GETDATE(), N'7500000000201');
    UPDATE dbo.products SET stock = 30 WHERE part_number = N'WYB-ATUN';
    SELECT (SELECT id FROM dbo.products WHERE part_number = N'WYB-ATUN') AS atun,
           (SELECT ISNULL(SUM(amount), 0) FROM dbo.expenses WHERE voided_at IS NULL) AS gastos_antes;`);

  await p.fill('#username', CUENTAS.admin.usuario);
  await p.fill('#password', CUENTAS.admin.password);
  await p.click('#btnLogin');
  await expect.poll(async () => { try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; } }, { timeout: 60000 })
    .toBe(CUENTAS.admin.usuario);

  await p.click('[data-guide=wybix-guide]');
  await expect(p.locator('[data-guide=wybix-chat]')).toBeVisible();
  const campo = p.locator('[data-guide=wybix-campo]');
  const ultimo = () => p.locator('[data-guide=wybix-mensaje]').last();
  const decir = async (t) => { await campo.fill(t); await campo.press('Enter'); };

  // -------------------------------------------- gasto con forma de pago
  await decir('pague 350 de luz');
  await expect(ultimo()).toContainText('¿Cómo se pagó?');
  await p.locator('[data-guide=wybix-opcion]', { hasText: 'Transferencia' }).last().click();
  const gasto = p.locator('[data-guide=wybix-plan]').last();
  await expect(gasto).toContainText('Luz');
  await expect(gasto).toContainText('$350.00');
  await p.screenshot({ path: path.join(SHOTS, '6-plan-gasto.png') });
  await gasto.locator('[data-guide=wybix-confirmar]').click();
  await expect(gasto).toHaveAttribute('data-guide-estado', 'hecho', { timeout: 20000 });

  // -------------------------------------------------- alta de proveedor
  await decir('da de alta al proveedor cremeria los altos telefono 4771234567');
  const prov = p.locator('[data-guide=wybix-plan]').last();
  await expect(prov).toContainText('Cremeria Los Altos');
  await prov.locator('[data-guide=wybix-confirmar]').click();
  await expect(prov).toHaveAttribute('data-guide-estado', 'hecho', { timeout: 20000 });

  // ------------------------------------------------- ajuste de inventario
  await decir('conte 26 atun ambar');
  const aj = p.locator('[data-guide=wybix-plan]').last();
  await expect(aj).toContainText('30 → 26');
  await aj.locator('[data-guide=wybix-confirmar]').click();
  await expect(aj).toHaveAttribute('data-guide-estado', 'hecho', { timeout: 20000 });

  const [b] = await sql(app.base, `
    SELECT (SELECT ISNULL(SUM(amount), 0) FROM dbo.expenses WHERE voided_at IS NULL) AS gastos,
           (SELECT TOP 1 payment_method FROM dbo.expenses ORDER BY id DESC) AS metodo,
           (SELECT COUNT(*) FROM dbo.CAT_suppliers WHERE nombre = N'Cremeria Los Altos' AND telefono = N'4771234567') AS proveedor,
           (SELECT stock FROM dbo.products WHERE id = ${ids.atun}) AS stock;`);
  expect(Number(b.gastos) - Number(ids.gastos_antes)).toBe(350);
  expect(b.metodo).toBe('TRANSFERENCIA');
  expect(Number(b.proveedor)).toBe(1);
  expect(Number(b.stock)).toBe(26);

  // ------------------------------------------ consultas y contexto corto
  await decir('cuanto hay en caja');
  await expect(ultimo()).toContainText(/caja|efectivo/i);
  await decir('quien me debe');
  await expect(ultimo()).toContainText(/debe|Nadie/);
  await decir('cuanto vendi hoy');
  await expect(ultimo()).toContainText(/Hoy/);
  await decir('y ayer?');
  await expect(ultimo()).toContainText(/Ayer/);
  await p.screenshot({ path: path.join(SHOTS, '7-contexto.png') });
});

/**
 * Lo que hace que Wybix se parezca a un LLM, en la app de verdad: un apodo
 * enseñado y usado, una pregunta con filtros, «¿y si subo el precio?», el
 * pronóstico, cuándo se acaba algo, una frase con dos órdenes y «cóbrale»
 * con la cuenta ya cargada en Venta.
 */
test('Wybix: apodos, filtros, simulación, pronóstico, frase compuesta y carrito', async ({ app }) => {
  test.setTimeout(300000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1440, height: 900 });

  const [ids] = await sql(app.base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'E2E Marca') INSERT INTO dbo.CAT_brands (namee) VALUES (N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'E2E Wybix') INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E Wybix');
    DELETE FROM dbo.asistente_mensajes;
    DELETE FROM dbo.asistente_alias;
    DECLARE @c INT = (SELECT id FROM dbo.CAT_categories WHERE namee = N'E2E Wybix'), @b INT = (SELECT id FROM dbo.CAT_brands WHERE namee = N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'WYB-PAN')
      INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date, bar_code)
      VALUES (N'WYB-PAN', N'Pan topacio', 12, 50, 1, 1, 'DIRECT', @c, @b, 5, '02', 0.16, GETDATE(), N'7500000000301');
    UPDATE dbo.products SET stock = 50, price = 12 WHERE part_number = N'WYB-PAN';
    SELECT (SELECT id FROM dbo.products WHERE part_number = N'WYB-PAN') AS pan;`);

  await p.fill('#username', CUENTAS.admin.usuario);
  await p.fill('#password', CUENTAS.admin.password);
  await p.click('#btnLogin');
  await expect.poll(async () => { try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; } }, { timeout: 60000 })
    .toBe(CUENTAS.admin.usuario);

  await p.click('[data-guide=wybix-guide]');
  await expect(p.locator('[data-guide=wybix-chat]')).toBeVisible();
  const campo = p.locator('[data-guide=wybix-campo]');
  const ultimo = () => p.locator('[data-guide=wybix-mensaje]').last();
  const decir = async (t) => { await campo.fill(t); await campo.press('Enter'); };

  // ---------------------------------------------- apodo enseñado y usado
  await decir('al pan topacio dile el azulito');
  const apodo = p.locator('[data-guide=wybix-plan]').last();
  await expect(apodo).toContainText('«azulito» = Pan topacio');
  await apodo.locator('[data-guide=wybix-confirmar]').click();
  await expect(apodo).toHaveAttribute('data-guide-estado', 'hecho', { timeout: 20000 });
  const [a] = await sql(app.base, `SELECT COUNT(*) AS n FROM dbo.asistente_alias WHERE alias = N'azulito' AND tipo = 'producto' AND ref_id = ${ids.pan};`);
  expect(Number(a.n)).toBe(1);
  await decir('cuantos azulitos quedan');
  await expect(ultimo()).toContainText('Pan topacio');
  await p.screenshot({ path: path.join(SHOTS, '8-apodo.png') });

  // ------------------------------------------ filtros, simulación y pronóstico
  await decir('cuanto vendi los sabados despues de las 6');
  await expect(ultimo()).toContainText('los sábados');
  await decir('si subo el pan topacio a 15 cuanto gano');
  await expect(ultimo()).toContainText('Pan topacio');
  await expect(p.locator('[data-guide=wybix-opcion]', { hasText: 'Cambiar el precio' })).toBeVisible();
  await decir('cuanto voy a vender manana');
  await expect(ultimo()).toContainText(/Mañana|Todavía/);
  await decir('cuando se me acaba el pan topacio');
  await expect(ultimo()).toContainText('Pan topacio');

  // ---------------------------------------------- dos órdenes en una frase
  const antes = await p.locator('[data-guide=wybix-mensaje]').count();
  await decir('pague 120 de luz en efectivo y dime cuanto hay en caja');
  /* Dos respuestas, una por orden (puede venir una observación más, «un día raro»). */
  await expect.poll(() => p.locator('[data-guide=wybix-mensaje]').count()).toBeGreaterThanOrEqual(antes + 2);
  const gasto = p.locator('[data-guide=wybix-plan]').last();
  await expect(gasto).toContainText('Luz');
  await expect(gasto).toContainText('$120.00');
  await expect(ultimo()).toContainText(/caja|efectivo/i);
  await gasto.locator('[data-guide=wybix-cancelar]').click();
  await p.screenshot({ path: path.join(SHOTS, '9-compuesta.png') });

  // ------------------------------------------ «cóbrale»: la cuenta ya cargada
  await decir('cobrale 2 pan topacio');
  await expect.poll(() => p.url(), { timeout: 20000 }).toContain('/dashboard/venta');
  await expect(p.locator(`[data-guide=venta-linea][data-guide-clave="${ids.pan}"]`)).toBeVisible({ timeout: 20000 });
  await p.screenshot({ path: path.join(SHOTS, '10-carrito.png') });
});

/**
 * Wybix conversa: una pregunta que ningún intent tiene escrita (con su
 * gráfica), «dime más del segundo», «¿cómo lo calculaste?», «sin gráficas»
 * y un alta de producto hablada que pregunta costo y existencia.
 */
test('Wybix: pregunta libre con gráfica, referencias, explicación, preferencias y alta hablada', async ({ app }) => {
  test.setTimeout(300000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1440, height: 900 });

  /* Ventas de hoy en dos categorías: Bebidas E2E deja más que Pan E2E. */
  const [ids] = await sql(app.base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'E2E Marca') INSERT INTO dbo.CAT_brands (namee) VALUES (N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'Bebidas E2E') INSERT INTO dbo.CAT_categories (namee) VALUES (N'Bebidas E2E');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'Pan E2E') INSERT INTO dbo.CAT_categories (namee) VALUES (N'Pan E2E');
    DELETE FROM dbo.asistente_mensajes; DELETE FROM dbo.asistente_preferencias;
    DECLARE @b INT = (SELECT id FROM dbo.CAT_brands WHERE namee = N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'WYB-CAFE')
      INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date)
      VALUES (N'WYB-CAFE', N'Cafe de olla', 30, 100, 1, 1, 'DIRECT', (SELECT id FROM dbo.CAT_categories WHERE namee = N'Bebidas E2E'), @b, 10, '01', 0, GETDATE());
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'WYB-OREJA')
      INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, brand_id, cost, objeto_impuesto, tasa_iva, registrated_date)
      VALUES (N'WYB-OREJA', N'Oreja de hojaldre', 10, 100, 1, 1, 'DIRECT', (SELECT id FROM dbo.CAT_categories WHERE namee = N'Pan E2E'), @b, 4, '01', 0, GETDATE());
    DECLARE @u INT = (SELECT TOP 1 id FROM dbo.users ORDER BY id);
    DECLARE @cafe INT = (SELECT id FROM dbo.products WHERE part_number = N'WYB-CAFE'), @oreja INT = (SELECT id FROM dbo.products WHERE part_number = N'WYB-OREJA');
    INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance) VALUES (GETDATE(), @u, 300, 'EFECTIVO', 300, 0);
    INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, tax_object, tax_rate) VALUES (SCOPE_IDENTITY(), @cafe, 10, 30, 10, '01', 0);
    INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance) VALUES (GETDATE(), @u, 150, 'TARJETA', 150, 0);
    INSERT INTO dbo.sale_detail (sale_id, product_id, quantity, unitary_price, unit_cost, tax_object, tax_rate) VALUES (SCOPE_IDENTITY(), @oreja, 15, 10, 4, '01', 0);
    SELECT @cafe AS cafe, @oreja AS oreja, (SELECT id FROM dbo.CAT_categories WHERE namee = N'Pan E2E') AS pan;`);

  await p.fill('#username', CUENTAS.admin.usuario);
  await p.fill('#password', CUENTAS.admin.password);
  await p.click('#btnLogin');
  await expect.poll(async () => { try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; } }, { timeout: 60000 })
    .toBe(CUENTAS.admin.usuario);
  await p.click('[data-guide=wybix-guide]');
  await expect(p.locator('[data-guide=wybix-chat]')).toBeVisible();
  const campo = p.locator('[data-guide=wybix-campo]');
  const ultimo = () => p.locator('[data-guide=wybix-mensaje]').last();
  const decir = async (t) => { const antes = await p.locator('[data-guide=wybix-mensaje]').count(); await campo.fill(t); await campo.press('Enter');
                               await expect.poll(() => p.locator('[data-guide=wybix-mensaje]').count(), { timeout: 20000 }).toBeGreaterThan(antes); };

  // ------------------------------------------- pregunta libre con gráfica
  await decir('que categoria deja mas ganancia este mes');
  await expect(ultimo()).toContainText('Bebidas E2E');
  await expect(ultimo().locator('[data-guide=wybix-grafica]')).toBeVisible();
  await p.screenshot({ path: path.join(SHOTS, '11-libre.png') });

  // ------------------------------------------- comparar dos productos
  await decir('cafe de olla contra oreja de hojaldre');
  await expect(ultimo()).toContainText('Cafe de olla');
  await expect(ultimo()).toContainText('Oreja de hojaldre');

  // ------------------------------------------- referencias y explicación
  await decir('que es lo que mas se vende hoy');
  await expect(ultimo()).toContainText('Oreja de hojaldre');
  await decir('dime mas del segundo');
  await expect(ultimo()).toContainText('Cafe de olla');
  await decir('lo menos vendido de hoy');
  await decir('como lo calculaste');
  await expect(ultimo()).toContainText('Lo saqué así');

  // ------------------------------------------- preferencias
  await decir('sin graficas');
  await expect(ultimo()).toContainText('sin gráficas');
  await decir('a que hora vendo mas');
  await expect(ultimo().locator('[data-guide=wybix-grafica]')).toHaveCount(0);
  const [pref] = await sql(app.base, `SELECT datos FROM dbo.asistente_preferencias`);
  expect(JSON.parse(pref.datos)).toMatchObject({ graficas: false });

  // ------------------------------------------- alta hablada
  await decir('da de alta un producto Dona glaseada E2E a 18 en Pan E2E');
  await expect(ultimo()).toContainText('cuesta');
  await decir('7');
  await expect(ultimo()).toContainText('tienes');
  await decir('ninguno');
  const alta = p.locator('[data-guide=wybix-plan]').last();
  await expect(alta).toContainText('Costo sin IVA');
  await expect(alta).toContainText('$7.00');
  await alta.locator('[data-guide=wybix-confirmar]').click();
  await expect(alta).toHaveAttribute('data-guide-estado', 'hecho', { timeout: 20000 });
  const [nuevo] = await sql(app.base, `SELECT cost, stock, category_id FROM dbo.products WHERE nombre = N'Dona glaseada E2E'`);
  expect(Number(nuevo.cost)).toBe(7);
  expect(Number(nuevo.category_id)).toBe(Number(ids.pan));
  await p.screenshot({ path: path.join(SHOTS, '12-alta.png') });
});

test('Wybix: editar la ficha hablando (costo, código de barras, nombre, IEPS) y dar de baja, con tarjeta y en la base', async ({ app }) => {
  test.setTimeout(300000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  await p.setViewportSize?.({ width: 1440, height: 900 });
  const [ids] = await sql(app.base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'E2E Ficha') INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E Ficha');
    DECLARE @c INT = (SELECT id FROM dbo.CAT_categories WHERE namee = N'E2E Ficha');
    DELETE FROM dbo.asistente_mensajes;
    DELETE FROM dbo.product_impuestos WHERE product_id IN (SELECT id FROM dbo.products WHERE part_number IN (N'WYB-PALANQ', N'WYB-BAJA'));
    UPDATE dbo.products SET bar_code = NULL WHERE bar_code IN (N'7500000009911', N'7500000009922');
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'WYB-PALANQ')
      INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, cost, objeto_impuesto, tasa_iva, registrated_date, bar_code)
      VALUES (N'WYB-PALANQ', N'Palanqueta nogal', 20, 10, 1, 1, 'DIRECT', @c, 9, '02', 0.16, GETDATE(), N'7500000009911');
    UPDATE dbo.products SET nombre = N'Palanqueta nogal', cost = 9, bar_code = N'7500000009911', active = 1 WHERE part_number = N'WYB-PALANQ';
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'WYB-BAJA')
      INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, inventory_mode, category_id, cost, objeto_impuesto, tasa_iva, registrated_date)
      VALUES (N'WYB-BAJA', N'Turron cobre', 15, 0, 1, 1, 'DIRECT', @c, 5, '02', 0.16, GETDATE());
    UPDATE dbo.products SET active = 1 WHERE part_number = N'WYB-BAJA';
    SELECT (SELECT id FROM dbo.products WHERE part_number = N'WYB-PALANQ') AS palanqueta,
           (SELECT id FROM dbo.products WHERE part_number = N'WYB-BAJA') AS turron,
           (SELECT id FROM dbo.CAT_impuestos WHERE clave = 'IEPS_ALIMENTOS') AS ieps;`);

  await p.fill('#username', CUENTAS.admin.usuario);
  await p.fill('#password', CUENTAS.admin.password);
  await p.click('#btnLogin');
  await expect.poll(async () => { try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; } }, { timeout: 60000 })
    .toBe(CUENTAS.admin.usuario);
  await p.click('[data-guide=wybix-guide]');
  await expect(p.locator('[data-guide=wybix-chat]')).toBeVisible();
  const campo = p.locator('[data-guide=wybix-campo]');
  const decir = async (t) => { await campo.fill(t); await campo.press('Enter'); };
  const confirmarUltimo = async (texto) => {
    const plan = p.locator('[data-guide=wybix-plan]').last();
    await expect(plan).toContainText(texto, { timeout: 20000 });
    await plan.locator('[data-guide=wybix-confirmar]').click();
    await expect(plan).toHaveAttribute('data-guide-estado', 'hecho', { timeout: 20000 });
    return plan;
  };
  const ficha = async () => (await sql(app.base, `SELECT nombre, cost, bar_code, active FROM dbo.products WHERE id = ${ids.palanqueta}`))[0];

  /* Por el código de barras: el código ES el producto. */
  await decir('cambia el costo del 7500000009911 a 11.50');
  const pc = await confirmarUltimo('$9.00 → $11.50');
  await pc.screenshot({ path: path.join(SHOTS, 'ficha-costo.png') });
  await expect.poll(async () => Number((await ficha()).cost)).toBe(11.5);

  await decir('ponle el código de barras 7500000009922 a la palanqueta nogal');
  await confirmarUltimo('7500000009911 → 7500000009922');
  await expect.poll(async () => (await ficha()).bar_code).toBe('7500000009922');

  await decir('renombra la palanqueta nogal a Palanqueta de nuez');
  await confirmarUltimo('Palanqueta de nuez');
  await expect.poll(async () => (await ficha()).nombre).toBe('Palanqueta de nuez');
  expect(Number((await ficha()).cost), 'renombrar no toca el costo').toBe(11.5);

  await decir('ponle IEPS 8% a la palanqueta de nuez');
  await confirmarUltimo('IEPS');
  await expect.poll(async () => (await sql(app.base, `SELECT COUNT(*) AS n FROM dbo.product_impuestos WHERE product_id = ${ids.palanqueta} AND impuesto_id = ${ids.ieps}`))[0].n).toBe(1);

  await decir('da de baja el turron cobre');
  await confirmarUltimo('Dar de baja Turron cobre');
  await expect.poll(async () => (await sql(app.base, `SELECT active FROM dbo.products WHERE id = ${ids.turron}`))[0].active).toBe(false);
  await p.screenshot({ path: path.join(SHOTS, 'ficha-chat.png') });
});
