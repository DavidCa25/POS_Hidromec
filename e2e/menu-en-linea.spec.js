/**
 * MENÚ EN LÍNEA (0067), DE PUNTA A PUNTA.
 *
 *     WYBIX_OWNER_DIR=<checkout de wybix-owner> WYBIX_LANDING_DIR=<checkout de wybix-landing con dist>
 *       npx playwright test e2e/menu-en-linea.spec.js
 *
 * Tres piezas de verdad, ninguna simulada en el camino del pedido:
 *
 *   NUBE     las Edge Functions reales (pos-sync, menu-publico) sobre un
 *            Postgres desechable con TODA la cadena de migraciones
 *            (wybix-owner/scripts/servidor-menu-local.mjs).
 *   CAJA     Electron con su IPC y SQL Server (Wybix_E2E_Core), apuntando a
 *            esa nube con WYBIX_FUNCIONES_URL (solo sin empaquetar).
 *   CELULAR  la página de wybix-landing (vite preview del build) en un
 *            Chromium con tamaño de teléfono, con /backend hacia esa nube.
 *
 *   caja publica el menú -> el celular lo ve, arma un latte grande + donas y
 *   pide -> la caja lo baja y lo acepta en Pedidos en línea -> cuenta con
 *   número del día y comanda en el KDS (sin descontar inventario) -> cocina
 *   lo marca listo -> el celular ve LISTO con su número -> entregado.
 *
 * Sin WYBIX_OWNER_DIR / WYBIX_LANDING_DIR la prueba se salta: depende de
 * otros dos repositorios y de Docker.
 */
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium, devices } = require('@playwright/test');
const { test, expect, CUENTAS, irPorDock, irPorMas } = require('./fixtures');

const OWNER = process.env.WYBIX_OWNER_DIR;
const LANDING = process.env.WYBIX_LANDING_DIR;
const P_NUBE = 54399, P_WEB = 4318;
const CAPTURAS = path.join(__dirname, '..', 'test-results', 'menu-en-linea');

const w = (ventana, fn, arg) => ventana.evaluate(fn, arg);
const filasDe = (r) => Array.isArray(r) ? r : (Array.isArray(r?.recordset) ? r.recordset : (r?.data ?? []));

function levantar(cmd, args, opciones, listo) {
  return new Promise((ok, mal) => {
    const p = spawn(cmd, args, { ...opciones, shell: process.platform === 'win32' });
    let salida = '';
    const t = setTimeout(() => mal(new Error(`${args.join(' ')} no arrancó: ${salida.slice(-400)}`)), 180000);
    const ver = (d) => { salida += String(d).replace(/\[[0-9;]*m/g, ''); if (listo.test(salida)) { clearTimeout(t); ok(p); } };
    p.stdout.on('data', ver); p.stderr.on('data', ver);
    p.on('exit', (c) => { clearTimeout(t); mal(new Error(`salió con ${c}: ${salida.slice(-400)}`)); });
  });
}
function matar(p) {
  if (!p || p.exitCode != null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F']);
  else p.kill();
}

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

test.describe('Menú en línea', () => {
  test.skip(!OWNER || !LANDING, 'Necesita WYBIX_OWNER_DIR y WYBIX_LANDING_DIR (y Docker).');
  let nube = null, web = null;

  test.beforeAll(async () => {
    test.setTimeout(300000);
    fs.mkdirSync(CAPTURAS, { recursive: true });
    nube = await levantar(process.execPath, ['--no-warnings', 'scripts/servidor-menu-local.mjs', '--puerto', String(P_NUBE)], { cwd: OWNER }, /LISTO \d+/);
    web = await levantar('npx', ['vite', 'preview', '--outDir', 'dist', '--port', String(P_WEB), '--strictPort', '--host', '127.0.0.1'],
      { cwd: LANDING, env: { ...process.env, WYBIX_BACKEND_LOCAL: `http://127.0.0.1:${P_NUBE}` } }, /Local:/);
    /* La caja que arranca la fixture lee esto al iniciar. */
    process.env.WYBIX_FUNCIONES_URL = `http://127.0.0.1:${P_NUBE}`;
  });
  test.afterAll(() => { matar(web); matar(nube); delete process.env.WYBIX_FUNCIONES_URL; });

  test.afterEach(async ({ app }) => {
    await app.invocar('menuLineaGuardar', { activo: false }).catch(() => {});
    await app.invocar('cloudSetConfig', { enabled: false }).catch(() => {});
    for (const m of ['comandas', 'hospitality']) await app.invocar('modulosSet', m, false).catch(() => {});
  });

  test('el cliente pide desde su celular, la caja acepta, cocina lo prepara y el cliente lo ve listo', async ({ app }) => {
    test.setTimeout(420000);
    const { ventana } = app;
    const s = Date.now().toString().slice(-6);
    const slug = `cafe-e2e-${s}`;
    await entrar(app, CUENTAS.admin);

    // ------------------------------------------------ el local (por canales)
    for (const m of ['hospitality', 'comandas']) expect((await app.invocar('modulosSet', m, true))?.success).toBeTruthy();
    const est = await w(ventana, (n) => window.wybix.estaciones.guardar({ nombre: n, salida: 'PANTALLA' }), `Barra ${s}`);
    const barra = est.data[0].id;
    await app.invocar('createCategory', { nombre: `Cafés ${s}` });
    const cat = filasDe(await app.invocar('getCategories')).find(c => (c.namee ?? c.nombre ?? c.category_name) === `Cafés ${s}`);
    let marcas = filasDe(await app.invocar('getBrands'));
    if (!marcas.length) { await app.invocar('createBrand', { nombre: `Casa ${s}` }); marcas = filasDe(await app.invocar('getBrands')); }
    const idDe = (x) => Number(x?.id ?? x?.category_id ?? x?.brand_id);
    const producto = async (pn, nombre, precio, modo, stock = 0) => {
      await app.invocar('agregarProducto', idDe(marcas[0]), idDe(cat), pn, nombre, precio, stock,
        null, null, '02', 0.16, null, { inventory_mode: modo, sellable: 1, base_uom: 'pza' });
      return Number(filasDe(await app.invocar('getActiveProducts')).find(x => x.part_number === pn).id);
    };
    const latte = await producto(`ML-LAT-${s}`, `Latte ${s}`, 55, 'NONE');
    const dona = await producto(`ML-DON-${s}`, `Dona ${s}`, 25, 'DIRECT', 30);
    for (const pid of [latte, dona]) await w(ventana, ([p, st]) => window.wybix.estaciones.asignar({ productId: p, stationId: st }), [pid, barra]);
    const g = await w(ventana, (n) => window.wybix.modifiers.save({
      name: n, role: 'SIZE', minSelect: 1, maxSelect: 1, required: true,
      options: [{ name: 'Chico', priceDelta: 0, effect: 'NONE' }, { name: 'Grande', priceDelta: 10, effect: 'NONE' }],
    }), `Tamaño ${s}`);
    expect(g?.success, JSON.stringify(g)).toBeTruthy();
    await w(ventana, ([p, gid]) => window.wybix.modifiers.setProductGroups({ productId: p, groupIds: [gid] }), [latte, g.groupId]);
    const stockDona = async () => Number(filasDe(await app.invocar('getActiveProducts')).find(x => Number(x.id) === dona).stock);

    // ------------------------------------------ la caja se conecta a la nube
    await app.invocar('cloudSetConfig', { enabled: true });
    const alta = await app.invocar('cloudEnsureProvisioned', `Café e2e ${s}`);
    expect(alta?.success, `alta en la nube local: ${JSON.stringify(alta)}`).toBeTruthy();

    // -------------------------------------- publicar el menú desde la pantalla
    /* Aplicaciones relee los módulos: así la navegación ve Hospitality encendido. */
    await irPorMas(ventana, 'Aplicaciones');
    await ventana.waitForSelector('app-aplicaciones', { timeout: 30000 });
    await ventana.waitForTimeout(1500);
    await irPorDock(ventana, 'Venta', 'Pedidos en línea');
    await ventana.waitForSelector('[data-guide="pedidos-en-linea"]');
    await ventana.click('[data-guide="pedidos-en-linea-configurar"]');
    await ventana.check('[data-guide="pedidos-en-linea-activo"]');
    await ventana.fill('[data-guide="pedidos-en-linea-slug"]', slug);
    await ventana.click('[data-guide="pedidos-en-linea-guardar"]');
    await expect(ventana.locator('.pel-qr img'), 'publicado: el QR del menú').toBeVisible({ timeout: 30000 });
    await expect(ventana.locator('.hx-head__txt p')).toContainText(`/m/${slug}`);
    await ventana.screenshot({ path: path.join(CAPTURAS, '1-caja-publicar.png') });

    // ------------------------------------------------------ el celular pide
    const nav = await chromium.launch();
    const tel = await nav.newContext({ ...devices['Pixel 7'] });
    const cel = await tel.newPage();
    await cel.goto(`http://127.0.0.1:${P_WEB}/m/${slug}?origen=mostrador`);
    await expect(cel.locator('.m-cab h1')).toHaveText(`Café e2e ${s}`, { timeout: 30000 });
    await expect(cel.locator('.m-cab p'), 'abierto: la caja late').toContainText('Para recoger');
    await cel.screenshot({ path: path.join(CAPTURAS, '2-celular-menu.png'), fullPage: true });

    await cel.locator('.m-prod', { hasText: `Latte ${s}` }).click();
    await expect(cel.locator('.m-op.on'), 'el tamaño llega con Chico elegido').toHaveText(/Chico/);
    await cel.locator('.m-op', { hasText: 'Grande' }).click();
    await cel.locator('.m-campo input').first().fill('extra caliente');
    await cel.screenshot({ path: path.join(CAPTURAS, '3-celular-producto.png') });
    await cel.click('[data-guide="menu-agregar"]');
    await cel.locator('.m-prod', { hasText: `Dona ${s}` }).click();
    await cel.locator('.m-cantidad button[aria-label="Uno más"]').click();
    await cel.click('[data-guide="menu-agregar"]');
    await expect(cel.locator('.m-barra'), '1 latte grande + 2 donas = $115').toContainText('115');
    await cel.click('[data-guide="menu-ver-pedido"]');
    await cel.fill('[data-guide="menu-nombre"]', 'Ana Ruiz');
    await cel.fill('[data-guide="menu-telefono"]', `477 1${s.slice(0, 2)} ${s.slice(2)}`);
    await cel.screenshot({ path: path.join(CAPTURAS, '4-celular-pedido.png') });
    await cel.click('[data-guide="menu-enviar"]');
    await expect(cel.locator('[data-guide="menu-seguimiento"]')).toHaveAttribute('data-guide-estado', 'RECIBIDO', { timeout: 30000 });
    await cel.screenshot({ path: path.join(CAPTURAS, '5-celular-recibido.png') });

    // ----------------------------------------------------- la caja lo acepta
    await expect.poll(async () => {
      await app.invocar('menuLineaSincronizar');
      return ((await app.invocar('menuLineaPedidos'))?.data ?? []).filter(p => p.estado === 'PENDIENTE').length;
    }, { timeout: 60000, intervals: [1000, 2000, 3000] }).toBe(1);
    const tarjeta = ventana.locator('[data-guide="pedidos-en-linea-pendiente"]');
    await expect(tarjeta).toContainText('Ana Ruiz', { timeout: 20000 });
    await expect(tarjeta).toContainText('Grande');
    await expect(tarjeta).toContainText('extra caliente');
    await expect(tarjeta.locator('.pel-total')).toContainText('115');
    expect(await stockDona(), 'recibir no descuenta').toBe(30);
    await ventana.screenshot({ path: path.join(CAPTURAS, '6-caja-por-aceptar.png') });
    await tarjeta.locator('[data-guide="pedidos-en-linea-aceptar"]').click();
    const hoy = ventana.locator('[data-guide="pedidos-en-linea-hoy"]').first();
    await expect(hoy).toHaveAttribute('data-guide-estado', 'PREPARANDO', { timeout: 20000 });
    const numero = (await hoy.locator('.pel-num').innerText()).replace('#', '').trim();
    expect(Number(numero), 'tiene número del día').toBeGreaterThan(0);
    expect(await stockDona(), 'aceptar tampoco descuenta: se cobra al recoger').toBe(30);

    // ----------------------------------------------------- cocina (KDS)
    const kds = await w(ventana, (st) => window.wybix.kds.listar({ stationId: st }), barra);
    const comanda = (kds.sets[0] || []).find(c => Number(c.numero_dia) === Number(numero));
    expect(comanda, 'la comanda llegó al KDS de Barra con su número').toBeTruthy();
    expect(String(comanda.destino)).toContain('En línea');
    const lineasKds = (kds.sets[1] || []).filter(l => l.comanda_id === comanda.id);
    expect(lineasKds.length, 'latte y donas en la comanda').toBe(2);

    await expect.poll(async () => { await app.invocar('menuLineaSincronizar'); return (await cel.locator('[data-guide="menu-seguimiento"]').getAttribute('data-guide-estado')); },
      { timeout: 60000, intervals: [2000, 3000] }).toBe('PREPARANDO');
    await expect(cel.locator('[data-guide="menu-numero"]'), 'el celular ya sabe su número').toHaveText(numero);
    await cel.screenshot({ path: path.join(CAPTURAS, '7-celular-preparando.png') });

    const r = await w(ventana, (id) => window.wybix.kds.estado({ comandaId: id, estado: 'LISTA' }), comanda.id);
    expect(r?.success, JSON.stringify(r)).toBeTruthy();
    await expect.poll(async () => { await app.invocar('menuLineaSincronizar'); return (await cel.locator('[data-guide="menu-seguimiento"]').getAttribute('data-guide-estado')); },
      { timeout: 60000, intervals: [2000, 3000] }).toBe('LISTO');
    await expect(cel.locator('.m-seg__titulo')).toHaveText('¡Tu pedido está listo!');
    await cel.screenshot({ path: path.join(CAPTURAS, '8-celular-listo.png') });
    await expect.poll(async () => ((await app.invocar('menuLineaPedidos'))?.data ?? [])[0]?.estadoCliente, { timeout: 20000 }).toBe('LISTO');
    await expect(ventana.locator('[data-guide="pedidos-en-linea-hoy"]').first()).toHaveAttribute('data-guide-estado', 'LISTO', { timeout: 20000 });
    await ventana.screenshot({ path: path.join(CAPTURAS, '9-caja-listo.png') });

    await w(ventana, (id) => window.wybix.kds.estado({ comandaId: id, estado: 'ENTREGADA' }), comanda.id);
    await expect.poll(async () => { await app.invocar('menuLineaSincronizar'); return (await cel.locator('[data-guide="menu-seguimiento"]').getAttribute('data-guide-estado')); },
      { timeout: 60000, intervals: [2000, 3000] }).toBe('ENTREGADO');

    // ------------------------------------------- rechazo, con motivo visible
    await cel.goto(`http://127.0.0.1:${P_WEB}/m/${slug}`);
    await cel.locator('.m-prod', { hasText: `Dona ${s}` }).click();
    await cel.click('[data-guide="menu-agregar"]');
    await cel.click('[data-guide="menu-ver-pedido"]');
    await cel.click('[data-guide="menu-enviar"]');
    await expect(cel.locator('[data-guide="menu-seguimiento"]')).toHaveAttribute('data-guide-estado', 'RECIBIDO', { timeout: 30000 });
    await expect.poll(async () => {
      await app.invocar('menuLineaSincronizar');
      return ((await app.invocar('menuLineaPedidos'))?.data ?? []).filter(p => p.estado === 'PENDIENTE').length;
    }, { timeout: 60000, intervals: [1000, 2000, 3000] }).toBe(1);
    const pendiente = ((await app.invocar('menuLineaPedidos')).data).find(p => p.estado === 'PENDIENTE');
    expect((await app.invocar('menuLineaRechazar', { id: pendiente.id, motivo: 'Se nos acabaron las donas' }))?.success).toBeTruthy();
    await expect.poll(async () => { await app.invocar('menuLineaSincronizar'); return (await cel.locator('[data-guide="menu-seguimiento"]').getAttribute('data-guide-estado')); },
      { timeout: 60000, intervals: [2000, 3000] }).toBe('RECHAZADO');
    await expect(cel.locator('.m-seg__motivo')).toContainText('Se nos acabaron las donas');
    await cel.screenshot({ path: path.join(CAPTURAS, '10-celular-rechazado.png') });
    await nav.close();
  });
});
