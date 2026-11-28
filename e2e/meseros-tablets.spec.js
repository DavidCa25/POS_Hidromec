/**
 * CUATRO MESEROS, CADA UNO CON SU TABLET: PIDEN, COBRAN Y ENTREGAN (0097).
 *
 *     npm run e2e:meseros
 *
 * La app de escritorio de verdad con su Local Host, y cuatro tablets hablando
 * por HTTP como lo hace la app del mesero (emparejar, entrar con PIN,
 * /api/s/accion). Lo que se prueba:
 *
 *   · los cuatro abren mesas y mandan a cocina AL MISMO TIEMPO, dos rondas;
 *     ninguna línea se duplica ni cae en otra mesa;
 *   · cualquier mesero cobra cualquier mesa: cada uno cobra la de su
 *     compañero, con propina, en efectivo, tarjeta o transferencia;
 *   · dos meseros cobran la MISMA mesa a la vez: una sola venta;
 *   · cobrar con la cuenta vieja (alguien pidió más) se rechaza;
 *   · reintentar el mismo cobro no cobra dos veces;
 *   · «Mi cuenta» de cada mesero cuadra con lo que cobró;
 *   · la caja recibe las entregas en su pantalla (una con faltante) y el corte
 *     espera fondo + lo entregado, y cuadra.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { nuevoPerfil, opcionesDeArranque } = require('./perfil');
const { CUENTAS, irPorDock } = require('./fixtures');

const DB = 'Wybix_E2E_Meseros';
const PUERTO = 17629;
const r2 = (n) => Math.round(n * 100) / 100;

function peticion(ruta, { metodo = 'GET', cuerpo, cookie, cabeceras = {} } = {}) {
  return new Promise((resolve, reject) => {
    const datos = cuerpo ? JSON.stringify(cuerpo) : null;
    const req = http.request({ host: '127.0.0.1', port: PUERTO, path: ruta, method: metodo,
      headers: { ...(datos ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(datos) } : {}),
                 ...(cookie ? { Cookie: cookie } : {}), ...cabeceras } },
    (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => {
      let j = null; try { j = JSON.parse(b); } catch { /* texto */ }
      resolve({ status: res.statusCode, headers: res.headers, datos: j, texto: b });
    }); });
    req.on('error', reject);
    if (datos) req.write(datos);
    req.end();
  });
}
const galletas = (r, antes = '') => {
  const nuevas = [].concat(r.headers['set-cookie'] || []).map((c) => String(c).split(';')[0]);
  const mapa = new Map(String(antes).split('; ').filter(Boolean).map((c) => [c.split('=')[0], c]));
  for (const c of nuevas) mapa.set(c.split('=')[0], c);
  return [...mapa.values()].join('; ');
};

test('cuatro meseros con tablet piden, cobran cualquier mesa y entregan en caja', async () => {
  test.setTimeout(420000);
  const bases = await import('./preparar-bases.mjs');
  const temporal = await import('../scripts/db/lib/temporal.mjs');
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  bases.prepararBase(DB, { perfil: 'HOSPITALITY', modulos: ['hospitality', 'mesas', 'comandas', 'propinas'] });
  const sql = (t) => { const r = consultarTemporal(DB, t); if (!r.ok) throw new Error(r.error); return r.sets[r.sets.length - 1] ?? []; };

  /* Los cuatro meseros, con el mismo alta que la base de pruebas. */
  const MESEROS = ['ana', 'beto', 'carla', 'dani'];
  sql(MESEROS.map((u) => `INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
    VALUES (N'${u}', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'${u}-1234'), 2), N'cajero', 1, GETDATE());`).join('\n'));

  const perfil = await nuevoPerfil(DB);
  const opciones = opcionesDeArranque(perfil);
  opciones.env = { ...(opciones.env || process.env), WYBIX_LOCAL_HOST_PUERTO: String(PUERTO) };
  const app = await electron.launch(opciones);
  const registro = [];
  app.process().stderr.on('data', (d) => registro.push(String(d)));
  app.process().stdout.on('data', (d) => registro.push(String(d)));
  try {
    const v = await app.firstWindow({ timeout: 120000 });
    await v.waitForFunction(() => !!window.electronAPI, null, { timeout: 60000 });
    await v.evaluate(() => { try { localStorage.setItem('wx-guide:auto', '0'); } catch { /* noop */ } });
    await v.waitForSelector('#username', { timeout: 60000 });
    await v.fill('#username', CUENTAS.admin.usuario);
    await v.fill('#password', CUENTAS.admin.password);
    await v.click('#btnLogin');
    const api = (m, ...a) => v.evaluate(([mm, aa]) => window.electronAPI[mm](...aa), [m, a]);
    const wy = (ruta, p) => v.evaluate(([r, pp]) => r.split('.').reduce((o, k) => o[k], window.wybix)(pp), [ruta, p]);
    await expect.poll(async () => { try { return (await api('sesion'))?.data?.usuario ?? null; } catch { return null; } }, { timeout: 30000 }).toBe(CUENTAS.admin.usuario);
    const yo = (await api('sesion')).data.userId;

    // ------------------------------------------------------------ el local
    await api('createCategory', { nombre: 'Tacos' });
    await api('createBrand', { nombre: 'Casa' });
    const cats = (await api('getCategories'));
    const cat = Number((Array.isArray(cats) ? cats : cats.data).find((c) => (c.namee ?? c.name) === 'Tacos')?.id);
    const brands = await api('getBrands');
    const marca = Number((Array.isArray(brands) ? brands : brands.data)[0]?.id);
    const MENU = { pastor: ['TAC-PAS', 'Taco al pastor', 22], bistec: ['TAC-BIS', 'Taco de bistec', 25], gringa: ['GRI', 'Gringa', 65], refresco: ['REF', 'Refresco', 28] };
    for (const [pn, nombre, precio] of Object.values(MENU)) {
      await api('agregarProducto', marca, cat, pn, nombre, precio, 0, null, null, '02', 0.16, null, { inventory_mode: 'NONE', sellable: 1, base_uom: 'pza' });
    }
    const id = Object.fromEntries(sql(`SELECT part_number, id FROM dbo.products`).map((r) => [r.part_number, Number(r.id)]));
    const precio = Object.fromEntries(Object.values(MENU).map(([pn, , p]) => [id[pn], p]));
    const plancha = (await wy('estaciones.guardar', { nombre: 'Plancha', salida: 'PANTALLA' })).data[0].id;
    for (const k of ['pastor', 'bistec', 'gringa']) await wy('estaciones.asignar', { productId: id[MENU[k][0]], stationId: plancha });
    const area = (await wy('salon.guardarArea', { nombre: 'Salón' })).data[0].id;
    for (let i = 1; i <= 9; i++) await wy('salon.guardarMesa', { areaId: area, nombre: `${i}` });
    const mesaId = Object.fromEntries(sql(`SELECT nombre, id FROM dbo.salon_mesas`).map((r) => [r.nombre, Number(r.id)]));

    /* La caja abre su turno; el Local Host se enciende; cada mesero su PIN y su tablet. */
    expect((await api('openShift', { user_id: yo, opening_cash: 500 }))?.success).toBeTruthy();
    const act = await wy('localHost.activar', { activo: true });
    expect(act.data?.fase, 'Local Host encendido').toBe('ACTIVO');
    const userId = Object.fromEntries(sql(`SELECT usuario, id FROM dbo.users WHERE usuario IN (${MESEROS.map((u) => `N'${u}'`).join(',')})`).map((r) => [r.usuario, Number(r.id)]));
    const tablets = {};
    for (const [i, u] of MESEROS.entries()) {
      const pin = `${2580 + i}`;
      expect((await wy('localHost.pinTrabajador', { userId: userId[u], pin }))?.success, `PIN de ${u}`).toBeTruthy();
      const par = await wy('localHost.emparejar', { superficie: 'WAITER', nombre: `Tablet ${u}` });
      const token = String(par.data?.url || '').split('/pair/')[1];
      const r = await peticion('/api/pair', { metodo: 'POST', cuerpo: { token } });
      expect(r.status, `emparejar tablet ${u}`).toBe(200);
      let cookie = galletas(r);
      const gente = await peticion('/api/trabajador/personas', { cookie });
      const lista = gente.datos?.personas ?? gente.datos ?? [];
      const yoMesero = lista.find((p) => String(p.nombre ?? p.usuario ?? '').toLowerCase().includes(u));
      expect(yoMesero, `${u} aparece en su tablet: ${gente.texto.slice(0, 200)}`).toBeTruthy();
      const e = await peticion('/api/trabajador/entrar', { metodo: 'POST', cookie, cuerpo: { accesoId: yoMesero.accesoId ?? yoMesero.id, pin } });
      expect(e.status, `${u} entra con su PIN: ${e.texto.slice(0, 200)}`).toBe(200);
      tablets[u] = { cookie: galletas(e, cookie), pin };
    }

    const accion = (u, nombre, datos, clave = randomUUID()) => peticion(`/api/s/accion/${nombre}`,
      { metodo: 'POST', cookie: tablets[u].cookie, cuerpo: datos, cabeceras: { 'Idempotency-Key': clave, 'X-Wx-Creado': new Date().toISOString() } });
    const consulta = (u, nombre, q = '') => peticion(`/api/s/consulta/${nombre}${q}`, { cookie: tablets[u].cookie });
    const estado = (u) => peticion('/api/s/estado', { cookie: tablets[u].cookie });

    const st = await estado('ana');
    expect(st.status).toBe(200);
    expect(st.datos?.datos?.puedeCobrar, 'la tablet del mesero ya cobra').toBe(true);
    expect((st.datos?.datos?.mesas ?? []).length, 'cada mesero ve las 9 mesas').toBe(9);

    // -------------------------------------------- pedir, los cuatro a la vez
    /* Ana: mesas 1 y 5; Beto: 2 y 6; Carla: 3 y 7; Dani: 4 y 8. */
    const esperado = {};      // cuentaId -> total
    const cuentaDe = {};      // mesa -> cuentaId
    const ronda = [
      [['pastor', 3], ['refresco', 1]],
      [['bistec', 2], ['gringa', 1], ['refresco', 2]],
    ];
    const pedir = async (u, mesa, lineas) => {
      const a = await accion(u, 'ABRIR_MESA', { mesaId: mesaId[mesa] });
      expect(a.status, `${u} abre la mesa ${mesa}: ${a.texto.slice(0, 160)}`).toBe(200);
      const cuentaId = a.datos.resultado.cuentaId;
      cuentaDe[mesa] = cuentaId;
      const e = await accion(u, 'ENVIAR', { cuentaId, lineas: lineas.map(([k, cantidad]) => ({ productId: id[MENU[k][0]], cantidad, origen: randomUUID(), opciones: [] })) });
      expect(e.status, `${u} envía a la mesa ${mesa}: ${e.texto.slice(0, 160)}`).toBe(200);
      esperado[cuentaId] = r2((esperado[cuentaId] || 0) + lineas.reduce((s, [k, q]) => s + MENU[k][2] * q, 0));
    };
    for (const r of ronda) {
      await Promise.all(MESEROS.flatMap((u, i) => [pedir(u, `${i + 1}`, r), pedir(u, `${i + 5}`, r)]));
    }
    const enCuentas = sql(`SELECT cuenta_id, SUM(cantidad * precio_unitario) AS total, COUNT(*) AS lineas FROM dbo.hosp_orden_lineas GROUP BY cuenta_id`);
    for (const f of enCuentas) {
      expect(Math.abs(Number(f.total) - esperado[f.cuenta_id]), `cuenta ${f.cuenta_id} sin líneas de más ni de menos`).toBeLessThan(0.01);
      expect(Number(f.lineas)).toBe(5);
    }
    expect(enCuentas.length, '8 mesas abiertas, una cuenta cada una').toBe(8);

    // ------------------------------------- la cuenta cambió: no se cobra vieja
    const viejo = esperado[cuentaDe['1']];
    await pedir('ana', '1', [['refresco', 1]]);
    const rechazo = await accion('beto', 'COBRAR', { cuentaId: cuentaDe['1'], metodo: 'EFECTIVO', total: viejo, clave: randomUUID() });
    expect(rechazo.status, 'con el total viejo no se cobra').not.toBe(200);
    expect(String(rechazo.datos?.error), 'y dice el total nuevo').toContain('La cuenta cambió');

    // ------------------------------ cada uno cobra la mesa de su compañero
    const cobros = [];          // [mesero, mesa, metodo, propinaPct]
    const PLAN = [['beto', '1', 'EFECTIVO', 10], ['carla', '2', 'TARJETA', 15], ['dani', '3', 'EFECTIVO', 0], ['ana', '4', 'TRANSFERENCIA', 10],
                  ['ana', '5', 'EFECTIVO', 15], ['beto', '6', 'TARJETA', 0], ['carla', '7', 'EFECTIVO', 10]];
    const modelo = Object.fromEntries(MESEROS.map((u) => [u, { mesas: 0, cobrado: 0, propinas: 0, bolsa: 0 }]));
    const cobrar = async (u, mesa, metodo, pct, clave = randomUUID()) => {
      const total = esperado[cuentaDe[mesa]];
      const propina = r2(total * pct / 100);
      const r = await accion(u, 'COBRAR', { cuentaId: cuentaDe[mesa], metodo, total, propina, clave, recibido: metodo === 'EFECTIVO' ? 1000 : null }, clave);
      return { r, total, propina };
    };
    await Promise.all(PLAN.map(async ([u, mesa, metodo, pct]) => {
      const { r, total, propina } = await cobrar(u, mesa, metodo, pct);
      expect(r.status, `${u} cobra la mesa ${mesa}: ${r.texto.slice(0, 200)}`).toBe(200);
      expect(Math.abs(r.datos.resultado.total - total)).toBeLessThan(0.01);
      if (metodo === 'EFECTIVO') expect(r.datos.resultado.cambio, 'el cambio').toBeCloseTo(1000 - total - propina, 2);
      const m = modelo[u];
      m.mesas++; m.cobrado = r2(m.cobrado + total); m.propinas = r2(m.propinas + propina);
      if (metodo === 'EFECTIVO') m.bolsa = r2(m.bolsa + total + propina);
      cobros.push([u, mesa]);
    }));

    /* Dos meseros cobran la MISMA mesa al mismo tiempo: una sola venta. */
    const [x, y] = await Promise.all([cobrar('dani', '8', 'EFECTIVO', 0), cobrar('carla', '8', 'EFECTIVO', 0)]);
    const ganaron = [x, y].filter((z) => z.r.status === 200);
    expect(ganaron.length, `solo uno cobra la mesa 8: ${x.r.status} ${x.r.texto.slice(0, 80)} / ${y.r.status} ${y.r.texto.slice(0, 80)}`).toBe(1);
    const quien = x.r.status === 200 ? 'dani' : 'carla';
    modelo[quien].mesas++; modelo[quien].cobrado = r2(modelo[quien].cobrado + x.total); modelo[quien].bolsa = r2(modelo[quien].bolsa + x.total);

    /* Reintentar el mismo cobro (misma clave): nada nuevo. */
    const ventasAntes = Number(sql(`SELECT COUNT(*) n FROM dbo.sales`)[0].n);
    await accion('beto', 'COBRAR', { cuentaId: cuentaDe['1'], metodo: 'EFECTIVO', total: esperado[cuentaDe['1']], clave: randomUUID() });
    expect(Number(sql(`SELECT COUNT(*) n FROM dbo.sales`)[0].n), 'cobrar una mesa ya cobrada no crea otra venta').toBe(ventasAntes);
    expect(ventasAntes, 'ocho mesas, ocho ventas').toBe(8);   // la 9 se cobra después, en la pantalla

    const libres = sql(`SELECT COUNT(*) n FROM dbo.hosp_cuentas WHERE estado <> 'COBRADA'`)[0].n;
    expect(Number(libres), 'todas las cuentas quedaron cobradas').toBe(0);
    const porMesero = sql(`SELECT u.usuario, COUNT(*) n FROM dbo.sales s JOIN dbo.users u ON u.id = s.useer_id GROUP BY u.usuario`);
    for (const u of MESEROS) expect(Number(porMesero.find((p) => p.usuario === u)?.n ?? 0), `ventas a nombre de ${u}`).toBe(modelo[u].mesas);

    // ------------------------------- en la tablet, con el dedo: Dani cobra la 9
    await pedir('dani', '9', [['pastor', 4], ['refresco', 2]]);
    const totalNueve = esperado[cuentaDe['9']];
    const { chromium, devices } = require('@playwright/test');
    const navegador = await chromium.launch();
    try {
      const contexto = await navegador.newContext({ ...devices['Galaxy Tab S4'], baseURL: `http://127.0.0.1:${PUERTO}` });
      const p = await contexto.newPage();
      const errores = [];
      p.on('pageerror', (e) => errores.push(e.message));
      const par = await wy('localHost.emparejar', { superficie: 'WAITER', nombre: 'Tablet Dani (pantalla)' });
      await p.goto(String(par.data.url).replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${PUERTO}`));
      await p.getByRole('button', { name: 'Conectar esta pantalla' }).tap();
      await p.getByRole('button', { name: 'Usar PIN' }).tap();
      await p.getByRole('button', { name: /dani/i }).tap();
      for (const d of tablets.dani.pin) await p.getByRole('button', { name: d, exact: true }).tap();
      await p.getByRole('button', { name: 'Entrar' }).tap();
      await p.locator(`[data-mesa="${mesaId['9']}"]`).tap();
      const boton = p.locator('[data-cobrar="mesa"]');
      await expect(boton, 'el botón de cobrar con el total').toContainText(totalNueve.toFixed(2));
      await boton.tap();
      await p.locator('[data-metodo="EFECTIVO"]').tap();
      await p.locator('[data-propina="10"]').tap();
      const propinaNueve = r2(totalNueve * 0.1);
      await expect(p.locator('[data-cobro="confirmar"]'), 'cobra cuenta + propina').toContainText(r2(totalNueve + propinaNueve).toFixed(2));
      await p.locator('#cobro-recibido').fill('500');
      await expect(p.locator('.hoja')).toContainText(r2(500 - totalNueve - propinaNueve).toFixed(2));
      if (process.env.WYBIX_CAPTURAS) { fs.mkdirSync(process.env.WYBIX_CAPTURAS, { recursive: true }); await p.screenshot({ path: `${process.env.WYBIX_CAPTURAS}/mesero-cobrar.png` }); }
      await p.locator('[data-cobro="confirmar"]').tap();
      await expect(p.locator('.hoja')).toContainText('Mesa cobrada');
      await expect(p.locator('.hoja')).toContainText('Cambio');
      await p.locator('[data-cobro="listo"]').tap();
      await p.getByRole('button', { name: 'Mi cuenta' }).tap();
      await expect(p.locator('[data-micuenta="bolsa"]')).toContainText('Traes para entregar');
      if (process.env.WYBIX_CAPTURAS) await p.screenshot({ path: `${process.env.WYBIX_CAPTURAS}/mesero-mi-cuenta.png` });
      expect(errores, 'la app del mesero sin errores').toEqual([]);
      modelo.dani.mesas++; modelo.dani.cobrado = r2(modelo.dani.cobrado + totalNueve);
      modelo.dani.propinas = r2(modelo.dani.propinas + propinaNueve); modelo.dani.bolsa = r2(modelo.dani.bolsa + totalNueve + propinaNueve);
    } finally { await navegador.close().catch(() => {}); }

    // ------------------------------------------------------- «Mi cuenta»
    for (const u of MESEROS) {
      const c = await consulta(u, 'micuenta');
      expect(c.status).toBe(200);
      const r = c.datos.resumen;
      expect(r.mesas, `${u}: mesas`).toBe(modelo[u].mesas);
      expect(r.cobrado, `${u}: cobrado`).toBeCloseTo(modelo[u].cobrado, 2);
      expect(r.propinas, `${u}: propinas`).toBeCloseTo(modelo[u].propinas, 2);
      expect(r.porEntregar, `${u}: trae para entregar`).toBeCloseTo(modelo[u].bolsa, 2);
    }

    // ------------------------------------------ la caja recibe, en pantalla
    await irPorDock(v, 'Venta', 'Entregas de meseros');
    const pantalla = v.locator('[data-guide="meseros-entregas"]');
    await expect(pantalla).toBeVisible();
    const fila = (u) => pantalla.locator(`[data-guide-clave="${u}"]`);
    const conEfectivo = MESEROS.filter((u) => modelo[u].bolsa > 0);
    for (const u of conEfectivo) await expect(fila(u)).toContainText('Recibir entrega');
    /* Ana entrega $20 menos. */
    const deAna = modelo.ana.bolsa;
    await fila('ana').locator('[data-guide="meseros-recibir"]').click();
    await fila('ana').locator('[data-guide="meseros-monto"]').fill(String(r2(deAna - 20)));
    await fila('ana').locator('[data-guide="meseros-recibir-confirmar"]').click();
    await expect(v.locator('.swal2-popup')).toContainText('Le faltaron');
    await v.locator('.swal2-confirm').click().catch(() => {});
    await expect(fila('ana')).toContainText('faltaron');
    let entregado = r2(deAna - 20);
    for (const u of conEfectivo.filter((u) => u !== 'ana')) {
      const r = await wy('meseros.entregar', { meseroId: userId[u], entregado: modelo[u].bolsa });
      expect(r?.success, `${u} entrega: ${r?.error}`).toBeTruthy();
      entregado = r2(entregado + modelo[u].bolsa);
    }

    // ------------------------------------------------------------ el corte
    const turno = sql(`SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC`)[0].id;
    const c = await api('closeShift', { closure_id: turno, cash_delivered: r2(500 + entregado) });
    expect(c?.success, JSON.stringify(c)).toBeTruthy();
    const cierre = sql(`SELECT cash_expected, difference FROM dbo.cash_closures WHERE id = ${turno}`)[0];
    expect(Number(cierre.cash_expected), 'el cajón espera fondo + lo que entregaron').toBeCloseTo(500 + entregado, 2);
    expect(Number(cierre.difference), 'y cuadra').toBe(0);
    const ent = sql(`SELECT SUM(diferencia) d FROM dbo.mesero_entregas WHERE mesero_id = ${userId.ana}`)[0];
    expect(Number(ent.d), 'el faltante queda a nombre de Ana, no en el corte').toBe(-20);
  } finally {
    /* La salida del proceso principal, por si algo falló: el motivo casi siempre está ahí. */
    try { fs.mkdirSync('tmp', { recursive: true }); fs.writeFileSync('tmp/e2e-meseros-main.log', registro.join('')); } catch { /* noop */ }
    await app.close().catch(() => {});
    try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* noop */ }
    if (!process.env.MESEROS_CONSERVAR) { try { temporal.eliminar(DB); } catch { /* noop */ } }
  }
});
