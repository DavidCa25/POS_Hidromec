/**
 * TODOS LOS PERMISOS CON LOS TRES USUARIOS, EN LA APP DE VERDAD.
 *
 *   npm run build && node e2e/preparar-bases.mjs core && npx playwright test e2e/permisos-tres-usuarios.spec.js
 *
 * Entra como Administrador, Encargado y Operador (cada uno con su puesto tal
 * cual) y, por CADA permiso del catálogo, hace una operación representativa
 * por el mismo puente que usa la interfaz. Cada operación está elegida para
 * no dejar daño (montos en cero, ids que no existen, lecturas): lo que se mide
 * es la puerta, no el resultado.
 *
 *   si        pasó la puerta (aunque después la operación diga «monto inválido»)
 *   autoriza  pide el PIN de un encargado o la aprobación del dueño
 *   no        acceso denegado
 *
 * Después revisa lo que cada uno VE: totales, costos, ventas de otros, el menú,
 * el precio en la venta y el crédito de un cliente.
 *
 * La matriz completa (los 307 canales, sin ejecutar nada) está en
 * scripts/pruebas/matriz-permisos.mjs.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS, irPorDock, irPorMas } = require('./fixtures');

const SHOTS = path.join(__dirname, '..', 'tmp', 'e2e-permisos-tres');

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
  await p.locator('.swal2-container').waitFor({ state: 'detached' }).catch(() => {});
  await p.keyboard.press('Escape').catch(() => {});
  await p.click('.wx-yo__btn');
  await p.click('.wx-yo__fila:has-text("Cerrar sesión")');
  await p.waitForSelector('#username', { timeout: 30000 });
}
/** Inicio: con una sola pantalla el dock lo muestra como enlace; con varias, como panel. */
async function irInicio(p) {
  const enlace = p.locator('.wxdock a', { hasText: 'Inicio' });
  if (await enlace.count()) { await enlace.click(); return ''; }
  await p.evaluate(() => [...document.querySelectorAll('.wxdock__btn')].find((x) => x.textContent.includes('Inicio'))?.click());
  await p.waitForSelector('.wxdock__panel', { timeout: 10000 });
  const texto = await p.locator('.wxdock__panel').innerText();
  await p.evaluate(() => (document.querySelector('.wxdock__panel .wxdock__pira.es-principal') || document.querySelector('.wxdock__panel .wxdock__pira'))?.click());
  return texto;
}
/** Las aprobaciones encendidas, como vienen de fábrica: así se acordó lo que pide autorización. */
async function aprobacionesEncendidas(base) {
  await sql(base, "UPDATE dbo.business_modules SET enabled = 1 WHERE module_key = N'APROBACIONES'; EXEC dbo.sp_bump_security_revision;");
}
async function sql(base, texto) {
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  const r = consultarTemporal(base, texto);
  if (!r.ok) throw new Error(r.error);
  return r.sets.length ? r.sets[r.sets.length - 1] : [];
}
/**
 * Llama un método del puente (admite «wybix.coupons.issue») y clasifica la respuesta.
 *
 * Cuando hace falta autorización, el puente NO contesta: abre la ventana
 * «Necesita autorización» (PIN del encargado o la app del dueño) y espera.
 * Eso es «autoriza»: se cancela la ventana y se comprueba que la operación
 * no se hizo.
 */
async function puerta(ventana, metodo, ...args) {
  await ventana.evaluate(([m, a]) => {
    window.__res = undefined;
    const raiz = m.startsWith('wybix.') ? window : window.electronAPI;
    const f = m.split('.').reduce((o, k) => o?.[k], raiz);
    if (typeof f !== 'function') { window.__res = { __falta: true }; return; }
    Promise.resolve().then(() => f(...a)).then((r) => { window.__res = r ?? {}; }, (e) => { window.__res = { __lanzo: String(e?.message || e) }; });
  }, [metodo, args]);
  const limite = Date.now() + 10000;
  while (Date.now() < limite) {
    const r = await ventana.evaluate(() => window.__res);
    if (r !== undefined) {
      if (r?.__falta) return 'falta-metodo';
      const txt = JSON.stringify(r ?? {});
      if (r?.motivo === 'REQUIERE_AUTORIZACION' || r?.requiereAutorizacion) return 'autoriza';
      if (r?.motivo === 'SIN_PERMISO' || /no tiene acceso a esta operación/.test(txt)) return 'no';
      return 'si';
    }
    const titulo = await ventana.locator('.swal2-title').innerText({ timeout: 200 }).catch(() => '');
    if (/Necesita autorización/.test(titulo)) {
      await ventana.locator('.swal2-cancel').click();
      await expect.poll(() => ventana.evaluate(() => window.__res), { timeout: 10000 }).toBeTruthy();
      const r = await ventana.evaluate(() => window.__res);
      if (!r?.cancelado) return 'autoriza-pero-se-hizo';
      await ventana.locator('.swal2-container').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      return 'autoriza';
    }
    await ventana.waitForTimeout(150);
  }
  return 'colgado';
}

/* Al terminar: cierra los turnos que se abrieron aquí (cada puesto abre el suyo) y quita los ajustes,
   para que las pruebas que siguen encuentren la caja como la dejaron. */
test.afterEach(async ({ app }) => {
  await sql(app.base, `UPDATE dbo.cash_closures SET closed_at = GETDATE() WHERE closed_at IS NULL
      AND opening_user_id IN (SELECT id FROM dbo.users WHERE usuario IN (N'e2e_encargado', N'e2e_operador'));
    DELETE FROM dbo.user_permissions WHERE user_id IN (SELECT id FROM dbo.users WHERE usuario IN (N'e2e_encargado', N'e2e_operador'));
    EXEC dbo.sp_bump_security_revision;`).catch((e) => console.log('limpieza:', e.message));
});

/*
 * [permiso, método, argumentos, Administrador, Encargado, Operador]
 * Lo esperado es lo acordado para cada puesto TAL COMO VIENE.
 */
const CASOS = (n, prod, col = 0) => [
  ['VENTAS_OPERAR', 'registerCashIn', [{ amount: 0, concept: 'E2E', note: '' }], 'si', 'si', 'si'],
  ['VENTAS_SUPERVISAR', 'aprobacionesPolitica', [], 'si', 'si', 'no'],
  ['INVENTARIO_OPERAR', 'transferenciasListar', [{}], 'si', 'si', 'no'],
  ['INVENTARIO_OPERAR · compras', 'registerPurchase', [{ supplier_id: -1, items: [] }], 'si', 'si', 'autoriza'],
  ['INVENTARIO_OPERAR · baja', 'darDeBajaProducto', [-1], 'si', 'si', 'no'],
  ['CATALOGO_EDITAR', 'createBrand', [{ nombre: `Marca permisos ${n}` }], 'si', 'si', 'si'],
  ['REPORTES_VER', 'estadoResultados', [{}], 'si', 'si', 'no'],
  ['REPORTES_VER · utilidad', 'getProfitOverview', [{}], 'si', 'si', 'no'],
  ['CONFIGURACION_ADMINISTRAR', 'usersPermissions', [], 'si', 'no', 'no'],
  ['SERVICIOS_OPERAR', 'serviciosOrdenEstado', [{ id: -1 }], 'si', 'si', 'si'],
  ['SERVICIOS_ADMINISTRAR', 'serviciosActivarServicio', [{ id: -1 }], 'si', 'si', 'no'],
  ['CAJA_CORTES', 'corteCorreoLista', [{}], 'si', 'si', 'si'],
  ['COMERCIAL_ADMINISTRAR', 'commercialSave', [{}], 'si', 'si', 'si'],
  ['PRODUCCION_OPERAR', 'wybix.produccion.tablero', [{}], 'si', 'si', 'si'],
  ['ASISTENCIA_GESTIONAR', 'asistenciaResumen', [{}], 'si', 'si', 'no'],
  ['DEVOLUCIONES', 'refundSale', [{ sale_id: -1, lines: [], reason: 'E2E' }], 'si', 'si', 'autoriza'],
  ['DEVOLUCIONES · cambio', 'refundExchange', [{ sale_id: -1 }], 'si', 'si', 'autoriza'],
  ['RETIROS_EGRESOS · retiro', 'registerCashMovement', [{ amount: 0, note: '' }], 'si', 'si', 'autoriza'],
  ['RETIROS_EGRESOS · egreso', 'egresosRegistrar', [{ amount: 0 }], 'si', 'si', 'autoriza'],
  ['RETIROS_EGRESOS · cancelar egreso', 'egresosCancelar', [{ id: -1 }], 'si', 'si', 'no'],
  ['CAJON_SIN_VENTA', 'openCashDrawer', [{ reason: 'manual' }], 'si', 'si', 'autoriza'],
  ['MODIFICAR_VENTA', 'updateSale', [{ sale_id: -1 }], 'si', 'si', 'autoriza'],
  ['MODIFICAR_VENTA · factura', 'fiscalCancelar', [{ id: -1 }], 'si', 'si', 'no'],
  ['PRECIOS · ficha', 'actualizarProducto', [{ product_id: prod.id, nombre: prod.nombre, precio: 90 + col, stock: prod.stock, numero_parte: prod.part }], 'si', 'si', 'autoriza'],
  ['CREDITO_CUPONES', 'wybix.coupons.issue', [{}], 'si', 'si', 'no'],
  ['VER_NUMEROS_DIA', 'getSalesDayly', [], 'si', 'si', 'no'],
  ['VER_NUMEROS_DIA · cierre', 'reporteCierreDia', [{}], 'si', 'si', 'no'],
  ['VER_COSTOS', 'getSuppliersAccount', [], 'si', 'si', 'no'],
];

test('Todos los permisos con Administrador, Encargado y Operador', async ({ app }) => {
  test.setTimeout(600000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = app.ventana;
  const n = Date.now().toString().slice(-6);
  await aprobacionesEncendidas(app.base);
  /* Nadie trae ajustes: cada quien con su puesto tal cual. */
  const usuarios = await sql(app.base, `SELECT id, usuario FROM dbo.users WHERE usuario IN (N'e2e_admin', N'e2e_encargado', N'e2e_operador');`);
  const idDe = (u) => Number(usuarios.find((x) => x.usuario === u).id);
  await sql(app.base, `DELETE FROM dbo.user_permissions WHERE user_id IN (${usuarios.map((u) => u.id).join(',')});`);
  const [prod] = await sql(app.base, `
    DECLARE @b INT = (SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id);
    DECLARE @c INT = (SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id);
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, category_id, brand_id, cost, bar_code)
    VALUES (N'PRM-${n}', N'Producto permisos ${n}', 80, 10, 1, @c, @b, 40, NULL);
    SELECT id, nombre, CAST(stock AS FLOAT) AS stock, part_number AS part FROM dbo.products WHERE part_number = N'PRM-${n}';`);
  /* Una venta de cada quien, para ver quién ve las de los demás. */
  await sql(app.base, `
    DECLARE @r INT = (SELECT TOP 1 id FROM dbo.registers ORDER BY id);
    INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance, register_id)
    VALUES (GETDATE(), ${idDe('e2e_admin')}, 10, N'EFECTIVO', 10, 0, @r), (GETDATE(), ${idDe('e2e_encargado')}, 11, N'EFECTIVO', 11, 0, @r),
           (GETDATE(), ${idDe('e2e_operador')}, 12, N'EFECTIVO', 12, 0, @r);`);

  const tabla = [];
  const PUESTOS = [['Administrador', CUENTAS.admin, 3], ['Encargado', CUENTAS.encargado, 4], ['Operador', CUENTAS.operador, 5]];
  let politica = null;
  for (const [nombre, cuenta, col] of PUESTOS) {
    await entrar(app, cuenta);
    if (politica === null) {
      const r = await app.invocar('aprobacionesPolitica');
      politica = JSON.stringify(r);
    }
    const yo = (await app.invocar('sesion')).data.userId;
    if (nombre === 'Administrador') {
      /* PIN para autorizar en la caja. */
      for (const u of ['e2e_encargado', 'e2e_operador']) {
        const r = await app.invocar('usersSetPin', { id: idDe(u), pin: '2468' });
        expect(r?.success, `PIN de ${u}: ${JSON.stringify(r)}`).toBeTruthy();
      }
    }
    const userId = yo;
    await app.invocar('openShift', { user_id: userId, opening_cash: 100 }).catch(() => null);

    // ------------------------------------------------ cada permiso por su puerta
    for (const caso of CASOS(n, prod, col)) {
      const [permiso, metodo, args] = caso;
      const debe = caso[col];
      const t0 = Date.now();
      const dio = await puerta(p, metodo, ...args);
      console.log(`${nombre} · ${permiso} → ${dio} (${Date.now() - t0} ms)`);
      tabla.push({ puesto: nombre, permiso, metodo, debe, dio });
      expect.soft(dio, `${nombre} · ${permiso} (${metodo})`).toBe(debe);
      await p.locator('.swal2-container').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    }

    // ------------------------------------------------ autorizar con PIN
    if (nombre === 'Operador') {
      const autorizar = async (usuario) => {
        await p.evaluate(() => {
          window.__res = undefined;
          window.electronAPI.registerCashMovement({ amount: 1, note: 'E2E PIN' }).then((r) => { window.__res = r ?? {}; });
        });
        await expect(p.locator('.swal2-title')).toHaveText('Necesita autorización');
        await p.fill('#aut-user', usuario);
        await p.fill('#aut-pin', '2468');
        await p.locator('.swal2-confirm').click();
      };
      const antes = Number((await sql(app.base, "SELECT COUNT(*) AS n FROM dbo.cash_movements WHERE typee = 'WITHDRAW' AND note = N'E2E PIN';"))[0].n);
      /* Con su propio PIN no: un Operador no autoriza retiros. */
      await autorizar('e2e_operador');
      const rechazo = await p.locator('.swal2-popup').innerText({ timeout: 8000 }).catch(() => '');
      tabla.push({ puesto: nombre, permiso: 'PIN de otro Operador', metodo: '', debe: '', dio: rechazo.slice(0, 80) });
      for (let i = 0; i < 4 && await p.locator('.swal2-popup').isVisible().catch(() => false); i++) {
        await p.locator('.swal2-cancel, .swal2-confirm').first().click().catch(() => {});
        await p.waitForTimeout(300);
      }
      await expect.poll(() => p.evaluate(() => window.__res), { timeout: 10000 }).toBeTruthy();
      expect.soft(Number((await sql(app.base, "SELECT COUNT(*) AS n FROM dbo.cash_movements WHERE typee = 'WITHDRAW' AND note = N'E2E PIN';"))[0].n),
        'con el PIN de otro Operador el retiro NO se hace').toBe(antes);
      /* Con el PIN del Encargado sí. */
      await autorizar('e2e_encargado');
      await expect.poll(() => p.evaluate(() => window.__res), { timeout: 15000 }).toBeTruthy();
      const r = await p.evaluate(() => window.__res);
      expect.soft(r?.success, `con el PIN del Encargado el retiro se hace: ${JSON.stringify(r)}`).toBeTruthy();
      expect.soft(Number((await sql(app.base, "SELECT COUNT(*) AS n FROM dbo.cash_movements WHERE typee = 'WITHDRAW' AND note = N'E2E PIN';"))[0].n),
        'el retiro autorizado quedó en caja').toBe(antes + 1);
      await p.locator('.swal2-container').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    }

    // ------------------------------------------------ lo que VE
    const ventas = (await app.invocar('getSales', {}))?.data ?? [];
    const ajenas = ventas.filter((v) => Number(v.useer_id) !== Number(yo)).length;
    if (nombre === 'Operador') expect.soft(ajenas, 'Operador: solo ve sus ventas').toBe(0);
    else expect.soft(ajenas, `${nombre}: ve las ventas de los demás`).toBeGreaterThan(0);
    expect.soft(ventas.some((v) => Number(v.useer_id) === Number(yo)), `${nombre}: ve las suyas`).toBeTruthy();

    const productos = await app.invocar('getActiveProducts');
    const lista = Array.isArray(productos) ? productos : (productos?.data ?? []);
    const conCosto = lista.some((x) => 'cost' in x);
    expect.soft(conCosto, `${nombre}: ${nombre === 'Operador' ? 'no ve' : 've'} el costo de los productos`).toBe(nombre !== 'Operador');

    const perms = (await app.invocar('sesion')).data.permisos;
    tabla.push({ puesto: nombre, permiso: 'permisos de la sesión', metodo: '', debe: '', dio: String(perms.length) });

    // ------------------------------------------------ la pantalla
    /* Inicio: «Vendido hoy» solo con Números del día. */
    const panel = await irInicio(p);
    await p.waitForTimeout(1200);
    const vendido = await p.locator('text=Vendido hoy').count();
    expect.soft(vendido > 0, `${nombre}: Inicio ${nombre === 'Operador' ? 'no muestra' : 'muestra'} «Vendido hoy»`).toBe(nombre !== 'Operador');
    /* El menú: Cierre del día, Estado de resultados, Usuarios. */
    const menu = await p.evaluate(() => {
      const t = [];
      document.querySelectorAll('.wxdock__btn').forEach((b) => t.push(b.textContent.trim()));
      return t.join('|');
    });
    /* Lo que ofrece Inicio (vacío si solo es «Resumen del día»). */
    expect.soft(/Cierre del día/.test(panel), `${nombre}: Cierre del día en el menú`).toBe(nombre !== 'Operador');
    expect.soft(/Estado de resultados/.test(panel), `${nombre}: Estado de resultados en el menú`).toBe(nombre !== 'Operador');
    await p.screenshot({ path: path.join(SHOTS, `${nombre}-inicio.png`) });
    tabla.push({ puesto: nombre, permiso: 'dock', metodo: '', debe: '', dio: menu });

    /* Venta: el precio del renglón solo lo escribe quien tiene «Cambiar precios». */
    await irPorDock(p, 'Venta');
    await p.waitForSelector('[data-guide="venta-agregar"]', { timeout: 30000 });
    await p.locator('[data-guide="venta-agregar"]').click();
    await p.locator('[data-guide="venta-buscar"]').fill(`Producto permisos ${n}`);
    await p.locator(`[data-guide="venta-producto"][data-guide-clave="PRM-${n}"]`).click();
    if (await p.locator('[data-guide="venta-buscar"]').isVisible().catch(() => false)) await p.keyboard.press('Escape');
    const linea = p.locator(`[data-guide="venta-linea"][data-guide-clave="${prod.id}"]`);
    await expect(linea).toBeVisible();
    const precio = linea.locator('input[type="number"]').nth(1);
    const soloLectura = await precio.evaluate((el) => el.readOnly);
    expect.soft(soloLectura, `${nombre}: el precio en la venta ${nombre === 'Operador' ? 'no se puede' : 'se puede'} cambiar`).toBe(nombre === 'Operador');
    await p.screenshot({ path: path.join(SHOTS, `${nombre}-venta.png`) });
    await linea.locator('button.btn-danger').click();
    await p.locator('.swal2-confirm').click({ timeout: 2000 }).catch(() => {});

    /* Clientes: el límite de crédito solo lo asigna quien tiene «Crédito y cupones». */
    await p.locator('.wxdock a', { hasText: 'Clientes' }).click();
    await p.locator('button', { hasText: '+ Nuevo cliente' }).click();
    const dlg = p.locator('.cli-dlg');
    const cab = dlg.locator('.cli-sec__cab', { hasText: 'Crédito' });
    const limite = dlg.locator('#cli-limite');
    if (!(await limite.isVisible().catch(() => false)) && await cab.count()) await cab.click().catch(() => {});
    await expect(limite).toBeVisible();
    expect.soft(await limite.isDisabled(), `${nombre}: el límite de crédito ${nombre === 'Operador' ? 'no se puede' : 'se puede'} cambiar`).toBe(nombre === 'Operador');
    await p.screenshot({ path: path.join(SHOTS, `${nombre}-cliente.png`) });
    await p.keyboard.press('Escape');
    await p.locator('.cli-dlg').waitFor({ state: 'detached', timeout: 5000 }).catch(async () => {
      await dlg.locator('button', { hasText: /Cancelar|Cerrar/ }).first().click().catch(() => {});
    });

    /* Usuarios y permisos: solo el Administrador. */
    const usuariosVisible = await p.evaluate(() => [...document.querySelectorAll('a,button')].some((x) => /Usuarios y permisos/.test(x.textContent || '')));
    tabla.push({ puesto: nombre, permiso: 'Usuarios y permisos (visible sin abrir Más)', metodo: '', debe: '', dio: String(usuariosVisible) });
    await salir(app);
  }

  /* Reporte legible: qué hizo cada quien con cada permiso. */
  const filas = tabla.filter((t) => t.debe);
  const anchos = Math.max(...filas.map((t) => t.permiso.length));
  const lineas = [];
  for (const caso of CASOS(n, prod)) {
    const de = (pu) => filas.find((t) => t.puesto === pu && t.permiso === caso[0]);
    const celda = (pu) => { const t = de(pu); return t ? (t.dio === t.debe ? t.dio : `${t.dio}≠${t.debe}`) : '-'; };
    lineas.push(`${caso[0].padEnd(anchos)}  ${celda('Administrador').padEnd(10)} ${celda('Encargado').padEnd(10)} ${celda('Operador')}`);
  }
  const reporte = `política de aprobaciones: ${politica}\n\n${'permiso'.padEnd(anchos)}  ${'Admin'.padEnd(10)} ${'Encargado'.padEnd(10)} Operador\n${lineas.join('\n')}\n`;
  fs.writeFileSync(path.join(SHOTS, 'reporte.txt'), reporte);
  console.log(reporte);
});

/*
 * CADA AJUSTE POR PERSONA, EN LA APP: al Operador se le DAN los 15 ajustables
 * y al Encargado se le QUITAN los 15. Cada uno por su puerta.
 */
const AJUSTES = (prod, precio) => [
  // [permiso, método, argumentos, aprobable]
  ['DEVOLUCIONES', 'refundSale', [{ sale_id: -1, lines: [], reason: 'E2E' }], true],
  ['RETIROS_EGRESOS', 'registerCashMovement', [{ amount: 0, note: '' }], true],
  ['CAJON_SIN_VENTA', 'openCashDrawer', [{ reason: 'manual' }], true],
  ['MODIFICAR_VENTA', 'updateSale', [{ sale_id: -1 }], true],
  ['CAJA_CORTES', 'corteCorreoLista', [{}], false],
  ['PRECIOS', 'actualizarProducto', [{ product_id: prod.id, nombre: prod.nombre, precio, stock: prod.stock, numero_parte: prod.part }], true],
  /* Sin la casilla no se puede: la autorización de este canal es solo para promociones de más de 30% o bajo costo. */
  ['COMERCIAL_ADMINISTRAR', 'commercialSave', [{}], false],
  ['CREDITO_CUPONES', 'wybix.coupons.issue', [{}], false],
  ['INVENTARIO_OPERAR', 'transferenciasListar', [{}], false],
  ['CONFIGURACION_EQUIPO', 'setDeviceConfig', ['__MISMA__'], false],
  ['ASISTENCIA_GESTIONAR', 'asistenciaResumen', [{}], false],
  ['VER_VENTAS_TODOS', null, [], false],
  ['VER_NUMEROS_DIA', 'getSalesDayly', [], false],
  ['REPORTES_VER', 'estadoResultados', [{}], false],
  ['VER_COSTOS', 'getSuppliersAccount', [], false],
];

test('Cada ajuste por persona: darlo al Operador y quitarlo al Encargado', async ({ app }) => {
  test.setTimeout(600000);
  const p = app.ventana;
  const n = Date.now().toString().slice(-6);
  const usuarios = await sql(app.base, `SELECT id, usuario FROM dbo.users WHERE usuario IN (N'e2e_admin', N'e2e_encargado', N'e2e_operador');`);
  const idDe = (u) => Number(usuarios.find((x) => x.usuario === u).id);
  const [prod] = await sql(app.base, `
    DECLARE @b INT = (SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id);
    DECLARE @c INT = (SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id);
    INSERT INTO dbo.products (part_number, nombre, price, stock, active, category_id, brand_id, cost, bar_code)
    VALUES (N'AJ-${n}', N'Producto ajustes ${n}', 50, 10, 1, @c, @b, 30, NULL);
    SELECT id, nombre, CAST(stock AS FLOAT) AS stock, part_number AS part FROM dbo.products WHERE part_number = N'AJ-${n}';`);
  const lista = AJUSTES(prod, 0).map((a) => a[0]);
  await aprobacionesEncendidas(app.base);
  await sql(app.base, `
    DELETE FROM dbo.user_permissions WHERE user_id IN (${idDe('e2e_operador')}, ${idDe('e2e_encargado')});
    INSERT INTO dbo.user_permissions (user_id, permiso) VALUES ${lista.map((x) => `(${idDe('e2e_operador')}, '${x}')`).join(',')};
    INSERT INTO dbo.user_permissions (user_id, permiso) VALUES ${lista.map((x) => `(${idDe('e2e_encargado')}, '-${x}')`).join(',')};
    EXEC dbo.sp_bump_security_revision;
    DECLARE @r INT = (SELECT TOP 1 id FROM dbo.registers ORDER BY id);
    INSERT INTO dbo.sales (datee, useer_id, total, payment_method, paid_amount, balance, register_id)
    VALUES (GETDATE(), ${idDe('e2e_admin')}, 13, N'EFECTIVO', 13, 0, @r);`);

  const reporte = [];
  for (const [nombre, cuenta, dar] of [['Operador', CUENTAS.operador, true], ['Encargado', CUENTAS.encargado, false]]) {
    await entrar(app, cuenta);
    const yo = (await app.invocar('sesion')).data.userId;
    const perms = (await app.invocar('sesion')).data.permisos;
    await app.invocar('openShift', { user_id: yo, opening_cash: 100 }).catch(() => null);
    const misma = await app.invocar('getDeviceConfig');
    for (const [permiso, metodo, args0, aprobable] of AJUSTES(prod, dar ? 61 : 62)) {
      const tiene = perms.includes(permiso);
      expect.soft(tiene, `${nombre} ${dar ? '+' : '−'} ${permiso}: en la sesión`).toBe(dar);
      let dio;
      if (permiso === 'VER_VENTAS_TODOS') {
        const ventas = (await app.invocar('getSales', {}))?.data ?? [];
        dio = ventas.some((v) => Number(v.useer_id) !== Number(yo)) ? 'si' : 'no';
      } else {
        const args = args0.map((a) => (a === '__MISMA__' ? (misma?.data ?? misma) : a));
        dio = await puerta(p, metodo, ...args);
      }
      const debe = dar ? 'si' : (aprobable ? 'autoriza' : 'no');
      reporte.push(`${nombre.padEnd(10)} ${dar ? '+' : '−'} ${permiso.padEnd(22)} ${dio === debe ? dio : `${dio}≠${debe}`}`);
      expect.soft(dio, `${nombre} ${dar ? '+' : '−'} ${permiso} (${metodo ?? 'getSales'})`).toBe(debe);
    }
    /* Costos: el catálogo trae el costo solo con «Costos: visibles». */
    const productos = await app.invocar('getActiveProducts');
    const conCosto = (Array.isArray(productos) ? productos : (productos?.data ?? [])).some((x) => 'cost' in x);
    expect.soft(conCosto, `${nombre}: costo en el catálogo`).toBe(dar);
    reporte.push(`${nombre.padEnd(10)} ${dar ? '+' : '−'} ${'costo en el catálogo'.padEnd(22)} ${conCosto === dar ? (conCosto ? 'si' : 'no') : 'MAL'}`);
    await salir(app);
  }
  await sql(app.base, `DELETE FROM dbo.user_permissions WHERE user_id IN (${idDe('e2e_operador')}, ${idDe('e2e_encargado')}); EXEC dbo.sp_bump_security_revision;`);
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, 'reporte-ajustes.txt'), reporte.join('\n') + '\n');
  console.log(reporte.join('\n'));
});
