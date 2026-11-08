/**
 * Permisos por persona (0077): «Qué puede ver» (una opción por fila) y «Qué
 * puede hacer» (casillas) en Usuarios y permisos, y que la caja los respete.
 *
 *   npm run build && node e2e/preparar-bases.mjs core && npx playwright test e2e/permisos-persona.spec.js
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorMas } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-permisos-persona');

async function entrar(app, c) {
  const p = app.ventana;
  await p.waitForSelector('#username', { timeout: 60000 });
  await p.fill('#username', c.usuario);
  await p.fill('#password', c.password);
  await p.click('#btnLogin');
  await expect.poll(async () => {
    try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; }
  }).toBe(c.usuario);
}
async function salir(app) {
  const p = app.ventana;
  await p.click('.wx-yo__btn');
  await p.click('.wx-yo__fila:has-text("Cerrar sesión")');
  await p.waitForSelector('#username', { timeout: 30000 });
}
async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}

test('Usuarios y permisos: ajustar a una persona y que la caja lo respete', async ({ app }) => {
  test.setTimeout(300000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  const ids = await sql(app.base, `SELECT id, usuario FROM dbo.users WHERE usuario IN (N'e2e_operador', N'e2e_encargado');`);
  const id = (u) => ids.find((x) => x.usuario === u).id;
  await sql(app.base, `DELETE FROM dbo.user_permissions WHERE user_id IN (${id('e2e_operador')}, ${id('e2e_encargado')});`);
  /* Un producto vendible propio, con costo, para ver quién recibe el costo.
     Antes se daba por hecho que la base ya traía uno; una base recién
     preparada no trae marcas ni productos y el catálogo llegaba vacío. */
  await sql(app.base, `
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_brands WHERE namee = N'E2E Marca') INSERT INTO dbo.CAT_brands (namee) VALUES (N'E2E Marca');
    IF NOT EXISTS (SELECT 1 FROM dbo.CAT_categories WHERE namee = N'E2E Categoría') INSERT INTO dbo.CAT_categories (namee) VALUES (N'E2E Categoría');
    IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE part_number = N'E2E-PERSONA')
      INSERT INTO dbo.products (part_number, nombre, price, stock, active, sellable, category_id, brand_id, cost)
      VALUES (N'E2E-PERSONA', N'Producto permisos por persona', 50, 10, 1, 1,
              (SELECT id FROM dbo.CAT_categories WHERE namee = N'E2E Categoría'),
              (SELECT id FROM dbo.CAT_brands WHERE namee = N'E2E Marca'), 20);`);

  // ------------------------------------------------------ 1. el Operador
  await entrar(app, CUENTAS.admin);
  /* El Operador entra directo a Venta: sin turno abierto, el modal «Abrir
     turno» taparía la pantalla. La prueba no depende de que otra lo haya
     dejado abierto. */
  const yo = (await app.invocar('sesion')).data.userId;
  const turno = await app.invocar('openShift', { user_id: yo, opening_cash: 500, register_id: 1 });
  expect(turno?.success || /ya existe un turno|ya hay un turno/i.test(String(turno?.error ?? '')), JSON.stringify(turno)).toBeTruthy();
  await irPorMas(p, 'Usuarios y permisos');
  await p.locator('[data-guide="usuarios-persona"]').filter({ hasText: 'e2e_operador' }).click();
  const ver = p.locator('[data-guide="usuarios-ver"]');
  const hacer = p.locator('[data-guide="usuarios-hacer"]');
  await expect(ver).toBeVisible();
  /* Lo que trae el puesto. */
  await expect(p.locator('[data-guide="usuarios-ver-ventas-propias"]')).toBeChecked();
  await expect(p.locator('[data-guide="usuarios-ver-numeros-nada"]')).toBeChecked();
  await expect(p.locator('[data-guide="usuarios-ver-costos-ocultos"]')).toBeChecked();
  const casilla = (clave) => hacer.locator(`[data-guide="usuarios-hacer-permiso"][data-guide-clave="${clave}"]`);
  await expect(casilla('DEVOLUCIONES').locator('input')).not.toBeChecked();
  await expect(casilla('DEVOLUCIONES')).toContainText('Pide autorización');
  await expect(casilla('CAJA_CORTES').locator('input')).toBeChecked();
  await expect(p.locator('[data-guide="usuarios-guardar-permisos"]')).toBeDisabled();

  /* Ajustes: números del día y devoluciones sin pedir permiso. */
  await p.locator('[data-guide="usuarios-ver-numeros-dia"]').locator('xpath=..').click();
  await casilla('DEVOLUCIONES').locator('input').check();
  await expect(casilla('DEVOLUCIONES')).toContainText('Distinto al puesto');
  await expect(p.locator('.aj-pie')).toContainText('2 ajustes sobre Operador');
  await p.screenshot({ path: path.join(SHOTS, '1-operador.png'), fullPage: true });
  await p.locator('[data-guide="usuarios-guardar-permisos"]').click();
  await expect.poll(async () => (await sql(app.base, `SELECT permiso FROM dbo.user_permissions WHERE user_id = ${id('e2e_operador')} ORDER BY permiso;`)).map((r) => r.permiso))
    .toEqual(['DEVOLUCIONES', 'VER_NUMEROS_DIA']);
  await expect(p.locator('[data-guide="usuarios-guardar-permisos"]')).toBeDisabled();

  // ------------------------------------------------------ 2. el Encargado
  await p.locator('[data-guide="usuarios-persona"]').filter({ hasText: 'e2e_encargado' }).click();
  await expect(p.locator('[data-guide="usuarios-ver-numeros-todo"]')).toBeChecked();
  await p.locator('[data-guide="usuarios-ver-costos-ocultos"]').locator('xpath=..').click();
  await casilla('DEVOLUCIONES').locator('input').uncheck();
  await expect(casilla('DEVOLUCIONES')).toContainText('Distinto al puesto');
  await p.screenshot({ path: path.join(SHOTS, '2-encargado.png'), fullPage: true });
  await p.locator('[data-guide="usuarios-guardar-permisos"]').click();
  await expect.poll(async () => (await sql(app.base, `SELECT permiso FROM dbo.user_permissions WHERE user_id = ${id('e2e_encargado')} ORDER BY permiso;`)).map((r) => r.permiso))
    .toEqual(['-DEVOLUCIONES', '-VER_COSTOS']);

  /* «Volver a lo del puesto» deja todo como el puesto (sin guardar todavía). */
  await p.locator('.aj-link').click();
  await expect(casilla('DEVOLUCIONES').locator('input')).toBeChecked();
  await p.locator('.aj-pie .btn-outline').click();
  await expect(casilla('DEVOLUCIONES').locator('input')).not.toBeChecked();
  await salir(app);

  // ------------------------------------------------------ 3. la caja lo respeta
  await entrar(app, CUENTAS.operador);
  let permisos = (await app.invocar('sesion')).data.permisos;
  expect(permisos).toEqual(expect.arrayContaining(['DEVOLUCIONES', 'VER_NUMEROS_DIA']));
  expect(permisos).not.toContain('VER_VENTAS_TODOS');
  expect(permisos).not.toContain('VER_COSTOS');
  const dia = await app.invocar('getSalesDayly');
  expect(dia?.success, 'con «Números: del día» ve el total de hoy').toBeTruthy();
  const proveedores = await app.invocar('getSuppliersAccount');
  expect(proveedores?.success, 'con «Costos: ocultos» no ve lo que se debe a proveedores').toBeFalsy();
  const productos = await app.invocar('getActiveProducts');
  const lista = Array.isArray(productos) ? productos : (productos?.data ?? []);
  expect(lista.length).toBeGreaterThan(0);
  expect(lista.some((x) => 'cost' in x), 'el costo no llega a quien no puede verlo').toBeFalsy();
  const ventas = await app.invocar('getSales', {});
  const operadorId = id('e2e_operador');
  expect((ventas?.data ?? []).every((v) => Number(v.useer_id) === operadorId), 'solo ve sus ventas').toBeTruthy();
  await salir(app);

  await entrar(app, CUENTAS.encargado);
  permisos = (await app.invocar('sesion')).data.permisos;
  expect(permisos).not.toContain('DEVOLUCIONES');
  expect(permisos).not.toContain('VER_COSTOS');
  expect(permisos).toEqual(expect.arrayContaining(['REPORTES_VER', 'RETIROS_EGRESOS']));
  await salir(app);

  await sql(app.base, `DELETE FROM dbo.user_permissions WHERE user_id IN (${id('e2e_operador')}, ${id('e2e_encargado')});`);
});
