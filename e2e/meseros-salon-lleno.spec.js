/**
 * SALÓN LLENO: DIEZ MESEROS, VEINTE MESAS, CADA UNO CON SU TABLET (0097).
 *
 *     npm run e2e:salon-lleno
 *
 * La app de escritorio de verdad con su Local Host y diez tablets por HTTP,
 * cada una desde SU propia IP (127.0.0.11 … 127.0.0.20), como en el Wi-Fi de
 * un local: el límite de peticiones es por IP y así se prueba de verdad.
 * Mientras tanto, cada tablet pregunta el estado del salón cada 4 s, igual que
 * la app del mesero.
 *
 *   · los diez abren sus dos mesas y mandan a cocina AL MISMO TIEMPO, tres
 *     rondas: ninguna línea se duplica, se pierde ni cae en otra mesa;
 *   · las veinte mesas se cobran A LA VEZ y casi siempre por OTRO mesero, con
 *     propina, en efectivo, tarjeta o transferencia;
 *   · tres mesas las cobran dos meseros al mismo tiempo: una sola venta;
 *   · reintentar el mismo cobro (misma clave) no cobra dos veces;
 *   · segunda vuelta: diez mesas se vuelven a ocupar y se cobran;
 *   · «Mi cuenta» de cada mesero cuadra; la caja recibe las diez bolsas y el
 *     corte espera fondo + lo entregado, y cuadra;
 *   · tiempos de respuesta de pedir y cobrar (p50, p95, máximo).
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { nuevoPerfil, opcionesDeArranque } = require('./perfil');
const { CUENTAS } = require('./fixtures');

const DB = 'Wybix_E2E_SalonLleno';
const PUERTO = 17631;
const N_MESEROS = Number(process.env.SALON_MESEROS || 10);
const N_MESAS = N_MESEROS * 2;
const r2 = (n) => Math.round(n * 100) / 100;
const MESEROS = ['ana', 'beto', 'carla', 'dani', 'eli', 'fer', 'gabo', 'hugo', 'ivan', 'juli', 'kari', 'luis'].slice(0, N_MESEROS);

function peticion(ruta, { metodo = 'GET', cuerpo, cookie, cabeceras = {}, ip } = {}) {
  return new Promise((resolve, reject) => {
    const datos = cuerpo ? JSON.stringify(cuerpo) : null;
    const req = http.request({ host: '127.0.0.1', port: PUERTO, path: ruta, method: metodo, localAddress: ip, agent: false,
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
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))] : 0; };

test(`salón lleno: ${N_MESEROS} meseros y ${N_MESAS} mesas piden, cobran y entregan a la vez`, async () => {
  test.setTimeout(900000);
  const bases = await import('./preparar-bases.mjs');
  const temporal = await import('../scripts/db/lib/temporal.mjs');
  const { consultarTemporal } = await import('../scripts/db/lib/temporal-consulta.mjs');
  bases.prepararBase(DB, { perfil: 'HOSPITALITY', modulos: ['hospitality', 'mesas', 'comandas', 'propinas'] });
  const sql = (t) => { const r = consultarTemporal(DB, t); if (!r.ok) throw new Error(r.error); return r.sets[r.sets.length - 1] ?? []; };

  sql(MESEROS.map((u) => `INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
    VALUES (N'${u}', CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', N'${u}-1234'), 2), N'cajero', 1, GETDATE());`).join('\n'));

  const perfil = await nuevoPerfil(DB);
  const opciones = opcionesDeArranque(perfil);
  opciones.env = { ...(opciones.env || process.env), WYBIX_LOCAL_HOST_PUERTO: String(PUERTO) };
  const app = await electron.launch(opciones);
  const registro = [];
  app.process().stderr.on('data', (d) => registro.push(String(d)));
  app.process().stdout.on('data', (d) => registro.push(String(d)));
  const sondeos = [];
  const informe = [];
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
    const MENU = {
      pastor: ['TAC-PAS', 'Taco al pastor', 22], bistec: ['TAC-BIS', 'Taco de bistec', 25], suadero: ['TAC-SUA', 'Taco de suadero', 24],
      gringa: ['GRI', 'Gringa', 65], quesadilla: ['QUE', 'Quesadilla', 45], refresco: ['REF', 'Refresco', 28], agua: ['AGU', 'Agua de horchata', 25],
    };
    for (const [pn, nombre, precio] of Object.values(MENU)) {
      await api('agregarProducto', marca, cat, pn, nombre, precio, 0, null, null, '02', 0.16, null, { inventory_mode: 'NONE', sellable: 1, base_uom: 'pza' });
    }
    const id = Object.fromEntries(sql(`SELECT part_number, id FROM dbo.products`).map((r) => [r.part_number, Number(r.id)]));
    const plancha = (await wy('estaciones.guardar', { nombre: 'Plancha', salida: 'PANTALLA' })).data[0].id;
    for (const k of ['pastor', 'bistec', 'suadero', 'gringa', 'quesadilla']) await wy('estaciones.asignar', { productId: id[MENU[k][0]], stationId: plancha });
    const salon = (await wy('salon.guardarArea', { nombre: 'Salón' })).data[0].id;
    const terraza = (await wy('salon.guardarArea', { nombre: 'Terraza' })).data[0].id;
    for (let i = 1; i <= N_MESAS; i++) await wy('salon.guardarMesa', { areaId: i <= Math.ceil(N_MESAS * 0.6) ? salon : terraza, nombre: `${i}` });
    const mesaId = Object.fromEntries(sql(`SELECT nombre, id FROM dbo.salon_mesas`).map((r) => [r.nombre, Number(r.id)]));

    expect((await api('openShift', { user_id: yo, opening_cash: 1000 }))?.success).toBeTruthy();
    const act = await wy('localHost.activar', { activo: true });
    expect(act.data?.fase, 'Local Host encendido').toBe('ACTIVO');
    const userId = Object.fromEntries(sql(`SELECT usuario, id FROM dbo.users WHERE usuario IN (${MESEROS.map((u) => `N'${u}'`).join(',')})`).map((r) => [r.usuario, Number(r.id)]));

    /* Cada tablet: su IP, su emparejamiento y su mesero con PIN. */
    const tablets = {};
    for (const [i, u] of MESEROS.entries()) {
      const pin = `${2580 + i}`;
      const ip = `127.0.0.${11 + i}`;
      expect((await wy('localHost.pinTrabajador', { userId: userId[u], pin }))?.success, `PIN de ${u}`).toBeTruthy();
      const par = await wy('localHost.emparejar', { superficie: 'WAITER', nombre: `Tablet ${u}` });
      expect(par?.success, `QR para la tablet de ${u}: ${par?.error}`).toBeTruthy();
      const token = String(par.data?.url || '').split('/pair/')[1];
      const r = await peticion('/api/pair', { metodo: 'POST', cuerpo: { token }, ip });
      expect(r.status, `emparejar tablet ${u}: ${r.texto.slice(0, 160)}`).toBe(200);
      const cookie = galletas(r);
      const gente = await peticion('/api/trabajador/personas', { cookie, ip });
      const lista = gente.datos?.personas ?? gente.datos ?? [];
      const yoMesero = lista.find((p) => String(p.nombre ?? p.usuario ?? '').toLowerCase().includes(u));
      expect(yoMesero, `${u} aparece en su tablet`).toBeTruthy();
      const e = await peticion('/api/trabajador/entrar', { metodo: 'POST', cookie, ip, cuerpo: { accesoId: yoMesero.accesoId ?? yoMesero.id, pin } });
      expect(e.status, `${u} entra con su PIN: ${e.texto.slice(0, 200)}`).toBe(200);
      tablets[u] = { cookie: galletas(e, cookie), pin, ip };
    }

    const tiempos = { ABRIR_MESA: [], ENVIAR: [], COBRAR: [], estado: [] };
    const accion = async (u, nombre, datos, clave = randomUUID()) => {
      const t0 = Date.now();
      const r = await peticion(`/api/s/accion/${nombre}`, { metodo: 'POST', cookie: tablets[u].cookie, ip: tablets[u].ip, cuerpo: datos,
        cabeceras: { 'Idempotency-Key': clave, 'X-Wx-Creado': new Date().toISOString() } });
      tiempos[nombre].push(Date.now() - t0);
      return r;
    };
    const consulta = (u, nombre, q = '') => peticion(`/api/s/consulta/${nombre}${q}`, { cookie: tablets[u].cookie, ip: tablets[u].ip });
    const estado = async (u) => {
      const t0 = Date.now();
      const r = await peticion('/api/s/estado', { cookie: tablets[u].cookie, ip: tablets[u].ip });
      tiempos.estado.push(Date.now() - t0);
      return r;
    };

    /* Como la app: cada tablet pregunta el estado cada 4 s mientras trabaja. */
    const fallosSondeo = [];
    for (const [i, u] of MESEROS.entries()) {
      const tick = async () => {
        try { const r = await estado(u); if (r.status !== 200) fallosSondeo.push(`${u}: ${r.status} ${r.texto.slice(0, 80)}`); }
        catch (e) { fallosSondeo.push(`${u}: ${e.message}`); }
      };
      setTimeout(() => sondeos.push(setInterval(tick, 4000)), i * 400);
    }

    const st = await estado('ana');
    expect(st.status).toBe(200);
    expect((st.datos?.datos?.mesas ?? []).length, `cada mesero ve las ${N_MESAS} mesas`).toBe(N_MESAS);

    // ------------------------------------------- pedir, los diez a la vez
    const esperado = {};        // cuentaId -> total
    const lineasDe = {};        // cuentaId -> número de líneas
    const cuentaDe = {};        // mesa -> cuentaId (la vigente)
    const abiertaPor = {};      // mesa -> mesero
    const RONDAS = [
      [['pastor', 4], ['refresco', 2]],
      [['bistec', 3], ['gringa', 1], ['agua', 2]],
      [['suadero', 2], ['quesadilla', 1]],
    ];
    const abrir = async (u, mesa) => {
      const a = await accion(u, 'ABRIR_MESA', { mesaId: mesaId[mesa] });
      expect(a.status, `${u} abre la mesa ${mesa}: ${a.texto.slice(0, 160)}`).toBe(200);
      cuentaDe[mesa] = a.datos.resultado.cuentaId;
      abiertaPor[mesa] = u;
    };
    const enviar = async (u, mesa, lineas) => {
      const cuentaId = cuentaDe[mesa];
      const e = await accion(u, 'ENVIAR', { cuentaId, lineas: lineas.map(([k, cantidad]) => ({ productId: id[MENU[k][0]], cantidad, origen: randomUUID(), opciones: [] })) });
      expect(e.status, `${u} envía a la mesa ${mesa}: ${e.texto.slice(0, 160)}`).toBe(200);
      esperado[cuentaId] = r2((esperado[cuentaId] || 0) + lineas.reduce((s, [k, q]) => s + MENU[k][2] * q, 0));
      lineasDe[cuentaId] = (lineasDe[cuentaId] || 0) + lineas.length;
    };
    /* Mesero i: mesas i+1 y i+1+N. */
    const susMesas = (i) => [`${i + 1}`, `${i + 1 + N_MESEROS}`];
    await Promise.all(MESEROS.flatMap((u, i) => susMesas(i).map((m) => abrir(u, m))));
    expect(new Set(Object.values(cuentaDe)).size, 'una cuenta distinta por mesa').toBe(N_MESAS);
    for (const r of RONDAS) {
      await Promise.all(MESEROS.flatMap((u, i) => susMesas(i).map((m) => enviar(u, m, r))));
    }
    /* Un compañero le agrega algo a la mesa de otro (cualquiera atiende cualquier mesa). */
    await Promise.all(MESEROS.map((u, i) => enviar(u, `${((i + 1) % N_MESEROS) + 1}`, [['refresco', 1]])));

    const verificarCuentas = () => {
      const enCuentas = sql(`SELECT cuenta_id, SUM(cantidad * precio_unitario) AS total, COUNT(*) AS lineas FROM dbo.hosp_orden_lineas GROUP BY cuenta_id`);
      for (const f of enCuentas) {
        expect(Math.abs(Number(f.total) - esperado[f.cuenta_id]), `cuenta ${f.cuenta_id}: total`).toBeLessThan(0.01);
        expect(Number(f.lineas), `cuenta ${f.cuenta_id}: líneas`).toBe(lineasDe[f.cuenta_id]);
      }
      return enCuentas.length;
    };
    expect(verificarCuentas(), `${N_MESAS} mesas con su cuenta`).toBe(N_MESAS);
    const lineasCocina = Number(sql(`SELECT COUNT(*) n FROM dbo.hosp_orden_lineas l JOIN dbo.products p ON p.id = l.product_id WHERE p.part_number NOT IN ('REF','AGU')`)[0].n);
    informe.push(`Pedidos: ${Object.values(lineasDe).reduce((a, b) => a + b, 0)} líneas en ${N_MESAS} mesas; ${lineasCocina} a la plancha`);

    // ----------------------------- las veinte mesas se cobran a la vez
    const METODOS = ['EFECTIVO', 'EFECTIVO', 'TARJETA', 'EFECTIVO', 'TRANSFERENCIA'];
    const PROPINAS = [10, 15, 0, 10, 12];
    const modelo = Object.fromEntries(MESEROS.map((u) => [u, { mesas: 0, cobrado: 0, propinas: 0, bolsa: 0 }]));
    const anotar = (u, metodo, total, propina) => {
      const m = modelo[u];
      m.mesas++; m.cobrado = r2(m.cobrado + total); m.propinas = r2(m.propinas + propina);
      if (metodo === 'EFECTIVO') m.bolsa = r2(m.bolsa + total + propina);
    };
    const cobrar = async (u, mesa, metodo, pctP, clave = randomUUID()) => {
      const total = esperado[cuentaDe[mesa]];
      const propina = r2(total * pctP / 100);
      const r = await accion(u, 'COBRAR', { cuentaId: cuentaDe[mesa], metodo, total, propina, clave, recibido: metodo === 'EFECTIVO' ? 2000 : null }, clave);
      return { r, total, propina, u, metodo };
    };
    const CARRERAS = 3;
    const normales = Array.from({ length: N_MESAS - CARRERAS }, (_, k) => {
      const mesa = `${k + 1}`;
      const dueño = MESEROS.indexOf(abiertaPor[mesa]);
      const u = k % 4 === 3 ? abiertaPor[mesa] : MESEROS[(dueño + 1 + (k % 3)) % N_MESEROS];   // casi siempre otro
      return [u, mesa, METODOS[k % METODOS.length], PROPINAS[k % PROPINAS.length]];
    });
    const carreras = Array.from({ length: CARRERAS }, (_, k) => `${N_MESAS - k}`);
    const claveRepetida = randomUUID();
    const t0 = Date.now();
    const [resNormales, resCarreras] = await Promise.all([
      Promise.all(normales.map(([u, mesa, metodo, p], k) => cobrar(u, mesa, metodo, p, k === 0 ? claveRepetida : undefined))),
      Promise.all(carreras.map((mesa, k) => Promise.all([
        cobrar(MESEROS[k], mesa, 'EFECTIVO', 10), cobrar(MESEROS[(k + 5) % N_MESEROS], mesa, 'EFECTIVO', 10),
      ]))),
    ]);
    informe.push(`Cobrar ${N_MESAS} mesas a la vez: ${Date.now() - t0} ms en total`);
    for (const [k, x] of resNormales.entries()) {
      expect(x.r.status, `${x.u} cobra la mesa ${normales[k][1]}: ${x.r.texto.slice(0, 200)}`).toBe(200);
      expect(Math.abs(x.r.datos.resultado.total - x.total)).toBeLessThan(0.01);
      if (x.metodo === 'EFECTIVO') expect(x.r.datos.resultado.cambio, 'el cambio').toBeCloseTo(2000 - x.total - x.propina, 2);
      anotar(x.u, x.metodo, x.total, x.propina);
    }
    for (const [k, par] of resCarreras.entries()) {
      const ganaron = par.filter((z) => z.r.status === 200);
      expect(ganaron.length, `solo uno cobra la mesa ${carreras[k]}: ${par.map((z) => `${z.u} ${z.r.status} ${z.r.texto.slice(0, 80)}`).join(' / ')}`).toBe(1);
      anotar(ganaron[0].u, 'EFECTIVO', ganaron[0].total, ganaron[0].propina);
    }

    /* Reintento del primer cobro con la MISMA clave: la misma respuesta, ninguna venta nueva. */
    const ventasAntes = Number(sql(`SELECT COUNT(*) n FROM dbo.sales`)[0].n);
    expect(ventasAntes, 'una venta por mesa').toBe(N_MESAS);
    const [u0, m0, met0, p0] = normales[0];
    const re = await cobrar(u0, m0, met0, p0, claveRepetida);
    expect(re.r.status, `reintento: ${re.r.texto.slice(0, 120)}`).toBe(200);
    expect(re.r.datos.resultado.ventaId, 'devuelve la misma venta').toBe(resNormales[0].r.datos.resultado.ventaId);
    expect(Number(sql(`SELECT COUNT(*) n FROM dbo.sales`)[0].n), 'reintentar no crea otra venta').toBe(ventasAntes);
    expect(Number(sql(`SELECT COUNT(*) n FROM dbo.hosp_cuentas WHERE estado <> 'COBRADA'`)[0].n), 'todas cobradas').toBe(0);

    // ------------------------------------------------- segunda vuelta
    const segunda = Array.from({ length: N_MESEROS }, (_, i) => [MESEROS[(i + 3) % N_MESEROS], `${i * 2 + 1}`]);
    await Promise.all(segunda.map(([u, mesa]) => abrir(u, mesa)));
    await Promise.all(segunda.map(([u, mesa]) => enviar(u, mesa, RONDAS[(Number(mesa) % RONDAS.length)])));
    await Promise.all(segunda.map(([u, mesa]) => enviar(u, mesa, [['agua', 1]])));
    const res2 = await Promise.all(segunda.map(([u, mesa], k) => cobrar(MESEROS[(MESEROS.indexOf(u) + 2) % N_MESEROS], mesa, METODOS[(k + 1) % METODOS.length], PROPINAS[k % PROPINAS.length])));
    for (const x of res2) {
      expect(x.r.status, `segunda vuelta, ${x.u} cobra: ${x.r.texto.slice(0, 200)}`).toBe(200);
      anotar(x.u, x.metodo, x.total, x.propina);
    }
    expect(verificarCuentas(), 'cuentas de las dos vueltas').toBe(N_MESAS + N_MESEROS);
    const ventas = sql(`SELECT COUNT(*) n, SUM(total) t FROM dbo.sales`)[0];
    expect(Number(ventas.n), 'ventas de las dos vueltas').toBe(N_MESAS + N_MESEROS);
    const totalModelo = r2(Object.values(modelo).reduce((s, m) => s + m.cobrado, 0));
    expect(Number(ventas.t), 'lo vendido = lo cobrado por los meseros').toBeCloseTo(totalModelo, 2);
    const porMesero = sql(`SELECT u.usuario, COUNT(*) n FROM dbo.sales s JOIN dbo.users u ON u.id = s.useer_id GROUP BY u.usuario`);
    for (const u of MESEROS) expect(Number(porMesero.find((p) => p.usuario === u)?.n ?? 0), `ventas a nombre de ${u}`).toBe(modelo[u].mesas);

    // ------------------------------------------------------ «Mi cuenta»
    for (const u of MESEROS) {
      const c = await consulta(u, 'micuenta');
      expect(c.status).toBe(200);
      const r = c.datos.resumen;
      expect(r.mesas, `${u}: mesas`).toBe(modelo[u].mesas);
      expect(r.cobrado, `${u}: cobrado`).toBeCloseTo(modelo[u].cobrado, 2);
      expect(r.propinas, `${u}: propinas`).toBeCloseTo(modelo[u].propinas, 2);
      expect(r.porEntregar, `${u}: trae para entregar`).toBeCloseTo(modelo[u].bolsa, 2);
    }

    // ---------------------------------------- la caja recibe las bolsas
    for (const t of sondeos) clearInterval(t);
    let entregado = 0;
    for (const u of MESEROS.filter((x) => modelo[x].bolsa > 0)) {
      const r = await wy('meseros.entregar', { meseroId: userId[u], entregado: modelo[u].bolsa });
      expect(r?.success, `${u} entrega: ${r?.error}`).toBeTruthy();
      entregado = r2(entregado + modelo[u].bolsa);
    }
    const resumen = await wy('meseros.resumen', {});
    const pendientes = (resumen?.data ?? []).filter((x) => Math.abs(Number(x.por_entregar ?? x.porEntregar ?? 0)) > 0.001);
    expect(pendientes, 'nadie queda debiendo').toEqual([]);

    const turno = sql(`SELECT TOP 1 id FROM dbo.cash_closures WHERE closed_at IS NULL ORDER BY id DESC`)[0].id;
    const c = await api('closeShift', { closure_id: turno, cash_delivered: r2(1000 + entregado) });
    expect(c?.success, JSON.stringify(c)).toBeTruthy();
    const cierre = sql(`SELECT cash_expected, difference FROM dbo.cash_closures WHERE id = ${turno}`)[0];
    expect(Number(cierre.cash_expected), 'el cajón espera fondo + lo que entregaron').toBeCloseTo(1000 + entregado, 2);
    expect(Number(cierre.difference), 'y cuadra').toBe(0);

    expect(fallosSondeo, 'las tablets nunca perdieron el salón mientras preguntaban').toEqual([]);
    for (const [k, xs] of Object.entries(tiempos)) informe.push(`${k}: ${xs.length} peticiones · p50 ${pct(xs, 50)} ms · p95 ${pct(xs, 95)} ms · máx ${Math.max(0, ...xs)} ms`);
    informe.push(`Vendido: $${Number(ventas.t).toFixed(2)} en ${ventas.n} ventas · propinas $${r2(Object.values(modelo).reduce((s, m) => s + m.propinas, 0)).toFixed(2)} · entregado en caja $${entregado.toFixed(2)}`);
    for (const u of MESEROS) informe.push(`  ${u.padEnd(6)} ${modelo[u].mesas} mesas · cobró $${modelo[u].cobrado.toFixed(2)} · propinas $${modelo[u].propinas.toFixed(2)} · entregó $${modelo[u].bolsa.toFixed(2)}`);
    expect(pct(tiempos.COBRAR, 95), 'cobrar responde en menos de 10 s aun con el salón lleno').toBeLessThan(10000);
  } finally {
    for (const t of sondeos) clearInterval(t);
    try {
      fs.mkdirSync('tmp', { recursive: true });
      fs.writeFileSync('tmp/e2e-salon-lleno-main.log', registro.join(''));
      fs.writeFileSync('tmp/e2e-salon-lleno-informe.txt', informe.join('\n') + '\n');
      console.log(informe.join('\n'));
    } catch { /* noop */ }
    await app.close().catch(() => {});
    try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* noop */ }
    if (!process.env.MESEROS_CONSERVAR) { try { temporal.eliminar(DB); } catch { /* noop */ } }
  }
});
