/**
 * WYBIX LOCAL HOST Y KDS EN LA RED LOCAL, CONTRA UNA BASE DE VERDAD.
 *
 *     npm run test:local-host
 *
 * (Corre con el Node de Electron -ELECTRON_RUN_AS_NODE=1- porque el driver de
 * SQL Server del proyecto esta compilado para Electron.)
 *
 * Levanta una base temporal como nace una cafeteria -plantilla, migraciones,
 * alta-, con Barra y Cocina, y enciende el Local Host de verdad: servidor
 * HTTP, arriendo en la base, eventos. Las tablets se hacen con peticiones
 * HTTP como las de un navegador (cookie incluida) y, para sonido, tema y
 * tacto, con un Chromium real de Playwright abriendo la pagina del Host.
 *
 * Numeracion = la lista de pruebas pedida (1..30). Nunca toca una base
 * existente: crea la suya y la borra al terminar.
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { ejecutar, ejecutarVarios, restaurar, eliminar, exigirTemporal } from '../db/lib/temporal.mjs';
import { SERVIDOR } from '../db/lib/sql.mjs';

const require = createRequire(import.meta.url);
process.env.WYBIX_LOCAL_HOST_PUERTO = process.env.WYBIX_LOCAL_HOST_PUERTO || '17427';
const PUERTO = Number(process.env.WYBIX_LOCAL_HOST_PUERTO);
const PUERTO_B = PUERTO + 1;

const sql = require('mssql/msnodesqlv8');
const red = require('../../electron/local-host/red.js');
const { crearLocalHost } = require('../../electron/local-host/index.js');

const DB = 'Wybix_TmpLocalHost';
/* Con WYBIX_CAPTURAS=carpeta, guarda fotos de la pantalla de la tablet. */
const CAPTURAS = process.env.WYBIX_CAPTURAS || null;
const foto = async (pagina, nombre) => { if (CAPTURAS) await pagina.screenshot({ path: join(CAPTURAS, `${nombre}.png`) }); };
const resultados = [];
const check = (n, cond, titulo, detalle = '') => {
  resultados.push({ n, ok: !!cond, titulo, detalle });
  console.log(`   ${cond ? 'ok    ' : 'FALLA '} ${String(n).padStart(2)}. ${titulo}${detalle ? '  · ' + detalle : ''}`);
};
const salto = (n, titulo, motivo) => {
  resultados.push({ n, ok: null, titulo, detalle: motivo });
  console.log(`   SALTA  ${String(n).padStart(2)}. ${titulo}  · ${motivo}`);
};
const seccion = (t) => console.log(`\n-- ${t}`);
const dormir = (ms) => new Promise(r => setTimeout(r, ms));

const lotesDe = (ruta) => readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n')
  .split(/\n\s*GO\s*\n/gi).map(x => x.trim()).filter(Boolean);

function nacer() {
  eliminar(DB);
  restaurar(DB, join(process.cwd(), 'installer', 'template.bak'));
  const dir = join(process.cwd(), 'electron', 'migrations');
  const lotes = readdirSync(dir).filter(f => f.endsWith('.sql')).sort().flatMap(f => lotesDe(join(dir, f)));
  const r = ejecutarVarios(DB, lotes);
  const malo = r.findIndex(x => !x.ok);
  if (malo >= 0) throw new Error(`migraciones, lote ${malo + 1}: ${r[malo].error}\n${lotes[malo].slice(0, 300)}`);
  ejecutar(DB, `EXEC dbo.sp_setup_inicial @usuario = N'cafelan', @password = N'cafelan1234',
      @business_name = N'Cafe LAN', @business_profile = N'HOSPITALITY'`);
  /* Los modulos, por la misma puerta que Aplicaciones: sin Comandas no hay KDS. */
  for (const m of ['hospitality', 'mesas', 'comandas']) {
    ejecutar(DB, `EXEC dbo.sp_set_business_module @module_key = N'${m}', @enabled = 1`);
  }
}

// ----------------------------------------------------------- SQL directo
async function abrirPool() {
  const p = new sql.ConnectionPool({
    server: SERVIDOR, database: DB, connectionTimeout: 8000, requestTimeout: 30000,
    options: { trustedConnection: true, trustServerCertificate: true, encrypt: false, enableArithAbort: true },
  });
  return p.connect();
}

// --------------------------------------------------------------- HTTP
function pedir(ruta, { metodo = 'GET', cuerpo = null, cookie = null, host = '127.0.0.1', puerto = PUERTO, crudo = null, cabeceras = {} } = {}) {
  return new Promise((resolve, reject) => {
    const datos = crudo ?? (cuerpo ? JSON.stringify(cuerpo) : null);
    const req = http.request({ host, port: puerto, path: ruta, method: metodo, headers: {
      ...(datos ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(datos) } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...cabeceras,
    } }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', c => { b += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch { /* no es json */ }
        resolve({ status: res.statusCode, headers: res.headers, texto: b, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
    if (datos) req.write(datos);
    req.end();
  });
}

/** Una tablet escuchando eventos, como la pagina: cookie y Server-Sent Events. */
function escuchar(cookie, { puerto = PUERTO } = {}) {
  const eventos = [];
  let res = null;
  let cerrado = false;
  const esperando = [];
  const req = http.get({ host: '127.0.0.1', port: puerto, path: '/api/s/eventos', headers: { Cookie: cookie, Accept: 'text/event-stream' } }, (r) => {
    res = r;
    r.setEncoding('utf8');
    let buf = '';
    r.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const bloque = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = { evento: 'message', datos: null, t: Date.now() };
        for (const linea of bloque.split('\n')) {
          if (linea.startsWith('event: ')) ev.evento = linea.slice(7);
          else if (linea.startsWith('data: ')) { try { ev.datos = JSON.parse(linea.slice(6)); } catch { ev.datos = linea.slice(6); } }
        }
        if (bloque.startsWith(':') || bloque.startsWith('retry:')) continue;
        eventos.push(ev);
        for (const w of [...esperando]) if (w.cond(ev)) { esperando.splice(esperando.indexOf(w), 1); w.resolve(ev); }
      }
    });
    r.on('end', () => { cerrado = true; });
    r.on('close', () => { cerrado = true; });
  });
  req.on('error', () => { cerrado = true; });
  return {
    eventos,
    get status() { return res?.statusCode; },
    get cerrado() { return cerrado; },
    esperar(cond, ms = 5000) {
      const ya = eventos.find(cond);
      if (ya) return Promise.resolve(ya);
      return new Promise((resolve) => {
        const w = { cond, resolve };
        esperando.push(w);
        setTimeout(() => { const i = esperando.indexOf(w); if (i >= 0) { esperando.splice(i, 1); resolve(null); } }, ms);
      });
    },
    cerrar() { req.destroy(); cerrado = true; },
  };
}

function puertoAbierto(puerto, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port: puerto, host });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(1500, () => { s.destroy(); resolve(false); });
  });
}

// ================================================================= INICIO
exigirTemporal(DB);
console.log(`\nWYBIX LOCAL HOST · base ${DB} · puerto de prueba ${PUERTO}\n`);

let pool, poolCaja2, hostA, hostB;
let navegador = null;
const configA = { localHost: { activo: true } };
const configB = { localHost: { activo: true } };

try {
  nacer();
  pool = await abrirPool();
  poolCaja2 = await abrirPool();
  const q = async (t) => (await pool.request().query(t)).recordsets;
  const uno = async (t) => (await q(t))[0]?.[0] ?? {};

  // ------------------------------------------------------------ SIEMBRA
  await q(`INSERT INTO dbo.CAT_categories (namee) VALUES (N'Bebidas'); INSERT INTO dbo.CAT_brands (namee) VALUES (N'General');`);
  const cat = (await uno(`SELECT TOP 1 id FROM dbo.CAT_categories ORDER BY id DESC`)).id;
  const marca = (await uno(`SELECT TOP 1 id FROM dbo.CAT_brands ORDER BY id DESC`)).id;
  for (const [pn, n, pr] of [['AME', 'Americano', 38], ['CHI', 'Chilaquiles', 95]]) {
    await q(`EXEC dbo.sp_add_product @brand = ${marca}, @category = ${cat}, @part_number = N'${pn}', @name = N'${n}',
             @price = ${pr}, @stock = 0, @inventory_mode = 'NONE', @sellable = 1`);
  }
  const prod = async (pn) => (await uno(`SELECT id FROM dbo.products WHERE part_number = N'${pn}'`)).id;
  const americano = await prod('AME'), chilaquiles = await prod('CHI');
  const barra = (await uno(`EXEC dbo.sp_prep_station_save @nombre = N'Barra', @salida = 'PANTALLA'`)).id;
  const cocina = (await uno(`EXEC dbo.sp_prep_station_save @nombre = N'Cocina', @salida = 'PANTALLA'`)).id;
  await q(`EXEC dbo.sp_product_prep_set @product_id = ${americano}, @station_id = ${barra}`);
  await q(`EXEC dbo.sp_product_prep_set @product_id = ${chilaquiles}, @station_id = ${cocina}`);
  const salon = (await uno(`EXEC dbo.sp_salon_area_save @nombre = N'Salón', @orden = 1`)).id;
  const mesas = [];
  for (let i = 1; i <= 8; i++) mesas.push((await uno(`EXEC dbo.sp_salon_mesa_save @area_id = ${salon}, @nombre = N'${i}'`)).id);

  /** Una caja envia a preparacion: abrir la mesa + sp_hosp_orden_enviar, como cuentas:enviar. */
  const enviar = async (mesaIdx, lineas, { p = pool } = {}) => {
    const cuenta = (await p.request().query(`EXEC dbo.sp_hosp_cuenta_abrir @mesa_id = ${mesas[mesaIdx]}, @user_id = 1`)).recordset[0].id;
    const r = await p.request().query(`
      DECLARE @l dbo.HospOrdenLineaV2Type;
      INSERT INTO @l (linea, product_id, cantidad, nota, origen) VALUES ${lineas.map((l, i) => `(${i + 1}, ${l[0]}, ${l[1]}, NULL, NEWID())`).join(', ')};
      DECLARE @o dbo.HospOrdenOpcionType;
      EXEC dbo.sp_hosp_orden_enviar @cuenta_id = ${cuenta}, @user_id = 1, @lineas = @l, @opciones = @o;`);
    return (r.recordsets[1] || []).map(c => ({ id: c.id, stationId: c.station_id }));
  };
  const estadoDe = async (id) => (await uno(`SELECT estado FROM dbo.comandas WHERE id = ${id}`)).estado;

  const nuevoHost = (machine, config, puerto) => {
    const antes = process.env.WYBIX_LOCAL_HOST_PUERTO;
    process.env.WYBIX_LOCAL_HOST_PUERTO = String(puerto);
    delete require.cache[require.resolve('../../electron/local-host/index.js')];
    const { crearLocalHost: crear } = require('../../electron/local-host/index.js');
    process.env.WYBIX_LOCAL_HOST_PUERTO = antes;
    return crear({
      sql, poolPromise: Promise.resolve(pool),
      machineId: () => machine, machineName: machine,
      esPrincipal: () => true,
      leerConfig: () => config,
      guardarConfig: (c) => Object.assign(config, c),
      log: () => {},
    });
  };

  /** Emparejar una pantalla: el QR del Host y el canje, como la tablet. */
  const emparejar = async (host, opciones) => {
    const r = await host.emparejar({ ...opciones, userId: 1 });
    if (!r.ok) throw new Error(`emparejar: ${r.error}`);
    const token = r.url.split('/pair/')[1];
    const canje = await pedir('/api/pair', { metodo: 'POST', cuerpo: { token } });
    const cookie = String(canje.headers['set-cookie']?.[0] || '').split(';')[0];
    return { r, token, canje, cookie };
  };

  // =========================================================== EL HOST
  seccion('Host, puerto y direcciones');
  hostA = nuevoHost('PC-PRINCIPAL', configA, PUERTO);
  await hostA.iniciar();
  const inst = hostA.instantanea();
  check(1, inst.fase === 'ACTIVO' && await puertoAbierto(PUERTO), 'el Host inicia y escucha', `fase ${inst.fase}`);
  check(1, /\|\|\s*7427/.test(readFileSync('electron/local-host/index.js', 'utf8')), 'el puerto de fabrica es 7427 (fijo y documentado)');

  const lan = red.interfacesLan();
  if (lan.length) {
    const h = await pedir('/health', { host: lan[0].ip });
    check(2, h.status === 200 && h.json?.servicio === 'wybix-local-host', 'health responde por la interfaz de la red local', lan[0].ip);
  } else salto(2, 'health por la interfaz LAN', 'este equipo no tiene red local privada ahora');
  const h127 = await pedir('/health');
  check(3, h127.status === 200 && h127.json?.ok === true, 'y por localhost dentro de la computadora');
  check(3, !/Server=|password|mssql|Wybix_Tmp/i.test(h127.texto), 'health no dice nada del negocio ni de la base');

  const falsas = {
    'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    'vEthernet (WSL)': [{ address: '172.28.16.1', family: 'IPv4', internal: false }],
    'Tailscale': [{ address: '100.101.2.3', family: 'IPv4', internal: false }],
    'NordLynx VPN': [{ address: '10.5.0.2', family: 'IPv4', internal: false }],
    'Ethernet': [{ address: '192.168.1.20', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
    'Wi-Fi': [{ address: '10.0.0.15', family: 'IPv4', internal: false }],
    'Publica': [{ address: '201.140.3.4', family: 'IPv4', internal: false }],
  };
  const filtradas = red.interfacesLan(falsas).map(i => i.ip);
  check(4, filtradas.join() === '192.168.1.20,10.0.0.15',
    'nunca se anuncia 127.0.0.1, ni adaptadores virtuales/VPN, ni IPs publicas', filtradas.join(', '));
  check(4, !inst.direcciones.some(d => d.ip.startsWith('127.')), 'las direcciones del Host no traen 127.x');

  // ======================================================== EMPAREJAR
  seccion('Emparejar');
  const eBarra = await emparejar(hostA, { stationId: barra, nombre: 'Tablet Barra' });
  const ck = eBarra.canje.headers['set-cookie']?.[0] || '';
  check(5, eBarra.canje.status === 200 && eBarra.canje.json?.dispositivo?.estacion === 'Barra', 'un QR vigente conecta la pantalla a SU estación');
  check(5, /HttpOnly/i.test(ck) && /SameSite=Strict/i.test(ck), 'la credencial queda en una cookie HttpOnly y SameSite=Strict');
  check(5, !eBarra.r.url.includes('127.0.0.1') && /^http:\/\/[\d.]+:\d+\/pair\/[A-Za-z0-9_-]{43}$/.test(eBarra.r.url) || !lan.length,
    'la URL del QR es http://IP_LAN:PUERTO/pair/TOKEN', eBarra.r.url.replace(/\/pair\/.*/, '/pair/…'));
  const guardado = await uno(`SELECT TOP 1 token_hash, station_id, superficie FROM dbo.dispositivos_emparejamientos ORDER BY id DESC`);
  check(5, guardado.token_hash?.length === 64 && guardado.token_hash !== eBarra.token && guardado.superficie === 'PREPARATION' && guardado.station_id === barra,
    'en la base solo queda el hash del token, ligado a la estación y a la función Preparación');
  const credBD = await uno(`SELECT credencial_hash FROM dbo.dispositivos_locales WHERE nombre = N'Tablet Barra'`);
  check(5, credBD.credencial_hash?.length === 64 && !eBarra.cookie.includes(credBD.credencial_hash), 'y de la credencial, solo su hash');

  const caduco = await hostA.emparejar({ stationId: barra, nombre: 'Caduca', userId: 1 });
  const tCaduco = caduco.url.split('/pair/')[1];
  await q(`UPDATE dbo.dispositivos_emparejamientos SET expira_en = DATEADD(MINUTE, -1, SYSUTCDATETIME()) WHERE usado_en IS NULL`);
  const rCaduco = await pedir('/api/pair', { metodo: 'POST', cuerpo: { token: tCaduco } });
  check(6, rCaduco.status === 410 && rCaduco.json?.motivo === 'CADUCO' && /caducó/.test(rCaduco.json?.error),
    'un QR caducado se rechaza con un mensaje claro', rCaduco.json?.error);

  const rOtraVez = await pedir('/api/pair', { metodo: 'POST', cuerpo: { token: eBarra.token } });
  check(7, rOtraVez.status === 410 && rOtraVez.json?.motivo === 'USADO', 'un QR ya usado se rechaza (un solo uso)');
  const nDisp = (await uno(`SELECT COUNT(*) AS n FROM dbo.dispositivos_locales`)).n;
  check(7, nDisp === 1, 'y no crea una segunda pantalla', `${nDisp} pantalla(s)`);

  const doble = await hostA.emparejar({ stationId: barra, nombre: 'Doble', userId: 1 });
  const tDoble = doble.url.split('/pair/')[1];
  const [d1, d2] = await Promise.all([1, 2].map(() => pedir('/api/pair', { metodo: 'POST', cuerpo: { token: tDoble } })));
  check(7, [d1.status, d2.status].sort().join() === '200,410', 'dos tablets con el mismo QR a la vez: solo entra una');

  const eCocina = await emparejar(hostA, { stationId: cocina, nombre: 'Tablet Cocina' });
  const eBarra2 = { cookie: d1.status === 200 ? String(d1.headers['set-cookie'][0]).split(';')[0] : String(d2.headers['set-cookie'][0]).split(';')[0] };

  // ================================================== ALCANCE Y EVENTOS
  seccion('Tiempo real y alcance por estación');
  const sBarra = escuchar(eBarra.cookie);
  const sBarra2 = escuchar(eBarra2.cookie);
  const sCocina = escuchar(eCocina.cookie);
  check(12, !!(await sBarra.esperar(e => e.evento === 'hola')) && !!(await sCocina.esperar(e => e.evento === 'hola')), 'las pantallas se conectan al tiempo real');

  /* 13. Commit ANTES del aviso: la orden se envia dentro de una transaccion
     abierta. Mientras no hay commit no puede salir ningun aviso. */
  const tx = new sql.Transaction(poolCaja2);
  await tx.begin();
  const cuentaTx = (await new sql.Request(tx).query(`EXEC dbo.sp_hosp_cuenta_abrir @mesa_id = ${mesas[0]}, @user_id = 1`)).recordset[0].id;
  const rTx = await new sql.Request(tx).query(`
    DECLARE @l dbo.HospOrdenLineaV2Type;
    INSERT INTO @l (linea, product_id, cantidad, nota, origen) VALUES (1, ${americano}, 1, NULL, NEWID()), (2, ${chilaquiles}, 1, NULL, NEWID());
    DECLARE @o dbo.HospOrdenOpcionType;
    EXEC dbo.sp_hosp_orden_enviar @cuenta_id = ${cuentaTx}, @user_id = 1, @lineas = @l, @opciones = @o;`);
  const [cBarra1, cCocina1] = [(rTx.recordsets[1] || []).find(c => c.station_id === barra).id, (rTx.recordsets[1] || []).find(c => c.station_id === cocina).id];
  await dormir(2200);
  const antesDelCommit = sBarra.eventos.some(e => e.datos?.id === cBarra1);
  await tx.commit();
  const tCommit = Date.now();
  const evBarra = await sBarra.esperar(e => e.evento === 'evento' && e.datos?.tipo === 'PREPARATION_TICKET_CREATED' && e.datos?.id === cBarra1, 6000);
  check(13, !antesDelCommit && !!evBarra && evBarra.t >= tCommit, 'sin commit no hay aviso; el aviso sale después del commit',
    evBarra ? `${evBarra.t - tCommit} ms después` : 'no llegó');
  check(12, !!evBarra && evBarra.datos.datos?.comanda?.destino === '1' && evBarra.datos.datos?.comanda?.lineas?.[0]?.nombre === 'Americano' && evBarra.datos.sonar === true,
    'la comanda nueva llega en tiempo real con su mesa y sus líneas');
  const evCocina = await sCocina.esperar(e => e.evento === 'evento' && e.datos?.tipo === 'PREPARATION_TICKET_CREATED' && e.datos?.id === cCocina1, 6000);
  await dormir(1000);
  check(10, !!evCocina && !sCocina.eventos.some(e => e.datos?.id === cBarra1), 'Cocina recibe solo lo de Cocina');
  check(11, !sBarra.eventos.some(e => e.datos?.id === cCocina1), 'Barra recibe solo lo de Barra');

  const stBarra = await pedir('/api/kds/estado', { cookie: eBarra.cookie });
  const stCocina = await pedir('/api/kds/estado', { cookie: eCocina.cookie });
  check(10, stCocina.json?.comandas?.every(c => c.stationId === cocina) && stCocina.json.comandas.some(c => c.id === cCocina1),
    'el estado de Cocina trae solo sus comandas');
  check(11, stBarra.json?.comandas?.every(c => c.stationId === barra) && stBarra.json.comandas.some(c => c.id === cBarra1),
    'el estado de Barra trae solo las suyas');

  const ajena = await pedir(`/api/kds/comandas/${cBarra1}/avanzar`, { metodo: 'POST', cuerpo: { desde: 'NUEVA' }, cookie: eCocina.cookie });
  check(9, ajena.status === 403 && await estadoDe(cBarra1) === 'NUEVA', 'la tablet de Cocina no puede mover una comanda de Barra', `HTTP ${ajena.status}`);

  // =============================================== PASOS Y DOS PANTALLAS
  seccion('Pasos, idempotencia y dos pantallas');
  const av = (id, desde, cookie = eBarra.cookie) => pedir(`/api/kds/comandas/${id}/avanzar`, { metodo: 'POST', cuerpo: { desde }, cookie });
  const [x1, x2] = await Promise.all([av(cBarra1, 'NUEVA', eBarra.cookie), av(cBarra1, 'NUEVA', eBarra2.cookie)]);
  check(17, x1.status === 200 && x2.status === 200 && [x1.json.repetido, x2.json.repetido].sort().join() === 'false,true'
    && await estadoDe(cBarra1) === 'PREPARANDO', 'dos pantallas pulsan «Empezar» a la vez: avanza UNA vez', await estadoDe(cBarra1));
  const reintento = await av(cBarra1, 'NUEVA');
  check(16, reintento.json?.repetido === true && await estadoDe(cBarra1) === 'PREPARANDO', 'un reintento del mismo toque no la avanza dos veces');
  const lista = await av(cBarra1, 'PREPARANDO');
  check(16, lista.status === 200 && await estadoDe(cBarra1) === 'LISTA', 'Nueva → Preparando → Lista queda en la base');
  const aviso2 = await sBarra2.esperar(e => e.evento === 'evento' && e.datos?.tipo === 'PREPARATION_UPDATED' && e.datos?.id === cBarra1 && e.datos?.estado === 'LISTA', 5000);
  check(17, !!aviso2, 'la otra pantalla de Barra ve el cambio sin recargar');
  const hist = (await uno(`SELECT COUNT(*) AS n FROM dbo.comandas WHERE id = ${cBarra1}`)).n;
  check(16, hist === 1, 'la comanda sigue siendo una sola');

  seccion('Dos cajas, una base, un Host');
  const [envA, envB] = await Promise.all([
    enviar(1, [[americano, 2]], { p: pool }),
    enviar(2, [[americano, 1]], { p: poolCaja2 }),
  ]);
  const idsDos = [...envA, ...envB].map(c => c.id);
  const llegaron = await Promise.all(idsDos.map(id => sBarra.esperar(e => e.evento === 'evento' && e.datos?.tipo === 'PREPARATION_TICKET_CREATED' && e.datos?.id === id, 6000)));
  check(18, llegaron.every(Boolean), 'dos cajas envían a la vez y la Barra recibe las dos', idsDos.join(', '));

  // ============================================ DESCONEXION Y RECUPERACION
  seccion('Desconexión y recuperación');
  sCocina.cerrar();
  await dormir(300);
  const perdida = (await enviar(3, [[chilaquiles, 1]]))[0].id;
  await dormir(1500);
  const recup = await pedir('/api/kds/estado', { cookie: eCocina.cookie });
  check(14, recup.json?.comandas?.filter(c => c.id === perdida).length === 1, 'la tablet vuelve y recupera la comanda que se hizo sin ella');
  const sCocina2 = escuchar(eCocina.cookie);
  await sCocina2.esperar(e => e.evento === 'hola');
  await dormir(1600);
  const ids = recup.json.comandas.map(c => c.id);
  check(15, new Set(ids).size === ids.length && !sCocina2.eventos.some(e => e.datos?.tipo === 'PREPARATION_TICKET_CREATED'),
    'al reconectar no se duplica ni se vuelve a avisar como nueva');

  // ======================================================== REVOCAR
  seccion('Revocar');
  const dispBarra2 = (await uno(`SELECT id FROM dbo.dispositivos_locales WHERE nombre = N'Doble'`)).id;
  const t0 = Date.now();
  await hostA.revocar(dispBarra2, 1);
  const cierre = await sBarra2.esperar(e => e.evento === 'revocado', 3000);
  const tras = await pedir('/api/kds/estado', { cookie: eBarra2.cookie });
  check(26, !!cierre && Date.now() - t0 < 3000, 'revocar corta su conexión al momento', cierre ? `${cierre.t - t0} ms` : '');
  check(8, tras.status === 401, 'y la pantalla revocada ya no entra', `HTTP ${tras.status}`);
  const trasAvanzar = await av(envA[0].id, 'NUEVA', eBarra2.cookie);
  check(8, trasAvanzar.status === 401 && await estadoDe(envA[0].id) === 'NUEVA', 'ni puede mover comandas');

  // ============================================== SUPERFICIE Y SEGURIDAD
  seccion('Superficie expuesta');
  const prohibidas = ['/api/admin', '/api/users', '/api/usuarios', '/api/reportes', '/api/ventas', '/api/sales', '/api/inventario',
    '/api/config', '/api/sql', '/api/query', '/api/kds/../usuarios', '/api/pair/lista', '/api/kds/comandas/1/cancelar',
    '/api/kds/comandas/1/estado', '/api/dispositivos', '/api/localhost/revocar', '/electron/main.js', '/kds/../../db.js', '/.env'];
  const resp = [];
  for (const r of prohibidas) {
    for (const m of ['GET', 'POST']) resp.push({ r, m, x: await pedir(r, { metodo: m, cookie: eBarra.cookie, cuerpo: m === 'POST' ? {} : null }) });
  }
  const abiertas = resp.filter(z => z.x.status !== 404 && z.x.status !== 401);
  check(24, !abiertas.length, 'una credencial KDS no abre nada administrativo (todo 404)', abiertas.map(z => `${z.m} ${z.r} → ${z.x.status}`).join(', '));
  const cors = await pedir('/api/kds/estado', { cookie: eBarra.cookie, cabeceras: { Origin: 'http://evil.example' } });
  check(24, !cors.headers['access-control-allow-origin'], 'sin CORS: ningún otro sitio puede leer la API');
  const malo = await pedir(`/api/kds/comandas/${envA[0].id}/avanzar`, { metodo: 'POST', cookie: eBarra.cookie, crudo: '{no es json' });
  const grande = await pedir('/api/pair', { metodo: 'POST', crudo: JSON.stringify({ token: 'x'.repeat(10000) }) });
  const desde = await av(envA[0].id, "NUEVA'; DROP TABLE comandas;--");
  check(24, malo.status === 400 && grande.status === 413, 'entradas malformadas o enormes se rechazan', `${malo.status} / ${grande.status}`);
  check(24, desde.status === 400 && await estadoDe(envA[0].id) === 'NUEVA', 'un estado inventado no llega a SQL');

  const todo = [h127, stBarra, stCocina, recup, ajena, malo, grande, desde, tras, ...resp.map(z => z.x)].map(x => x.texto).join('\n');
  const web = readdirSync('electron/local-host/kds-web').map(f => readFileSync(join('electron/local-host/kds-web', f), 'utf8')).join('\n');
  const fuga = /Server=|Integrated Security|password|contrase|mssql|msnodesqlv8|1433|Wybix_Tmp|\bat .+\.js:\d+/i;
  check(25, !fuga.test(todo), 'ninguna respuesta trae cadena de conexión, nombre de base, 1433 ni trazas');
  /* `type: 'password'` del campo del PIN de administrador es legitimo: lo que
     no puede haber es SQL, su puerto ni credenciales de la base. */
  check(25, !/1433|\bsql\b|mssql|Integrated Security|Server=|sa_password|db-config/i.test(web), 'la página de la tablet no sabe nada de SQL');
  check(25, !/1433/.test(readFileSync('electron/local-host/firewall.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
    'la regla del firewall solo toca el puerto del Local Host, nunca SQL');
  const cab = h127.headers;
  check(25, /default-src 'self'/.test(cab['content-security-policy'] || '') && cab['x-frame-options'] === 'DENY' && cab['x-content-type-options'] === 'nosniff',
    'cabeceras de seguridad: CSP same-origin, sin iframes, sin sniffing');

  // =================================================== UN HOST POR BASE
  seccion('Un solo Host por base');
  hostB = nuevoHost('PC-SEGUNDA', configB, PUERTO_B);
  await hostB.iniciar();
  const iB = hostB.instantanea();
  check(19, iB.fase === 'OTRO_HOST' && !(await puertoAbierto(PUERTO_B)), 'una segunda computadora con la misma base NO se hace Host', iB.fase);
  check(19, (await hostB.emparejar({ stationId: barra, nombre: 'x', userId: 1 })).ok === false, 'y no puede generar QRs');

  // ======================================================== REINICIO
  seccion('Reinicio del Host');
  const sBarraR = escuchar(eBarra.cookie);
  await sBarraR.esperar(e => e.evento === 'hola');
  await hostA.detener();
  await dormir(500);
  check(20, sBarraR.cerrado && !(await puertoAbierto(PUERTO)), 'el Host se apaga y la conexión se corta');
  const trasCaida = (await enviar(4, [[americano, 1]]))[0].id;
  hostA = nuevoHost('PC-PRINCIPAL', configA, PUERTO);
  await hostA.iniciar();
  const vuelve = await pedir('/api/kds/estado', { cookie: eBarra.cookie });
  const sBarraR2 = escuchar(eBarra.cookie);
  check(20, vuelve.status === 200 && vuelve.json.comandas.some(c => c.id === trasCaida) && !!(await sBarraR2.esperar(e => e.evento === 'hola')),
    'al volver, la misma tablet entra sin emparejar otra vez y recupera lo pendiente');
  await hostB.detener();

  // ================================================== CON Y SIN INTERNET
  seccion('Internet no forma parte del flujo');
  const hayInternetReal = red.hayInternet;
  for (const [n, conInternet, titulo] of [[21, true, 'con Internet + red local'], [22, false, 'sin Internet + red local'], [23, false, 'WAN desconectada del router']]) {
    red.hayInternet = async () => conInternet;
    await hostA.detener();
    hostA = nuevoHost('PC-PRINCIPAL', configA, PUERTO);
    await hostA.iniciar();
    const st = hostA.instantanea();
    const sx = escuchar(eBarra.cookie);
    await sx.esperar(e => e.evento === 'hola');
    const id = (await enviar(4 + n - 20, [[americano, 1]]))[0].id;
    const ev = await sx.esperar(e => e.evento === 'evento' && e.datos?.tipo === 'PREPARATION_TICKET_CREATED' && e.datos?.id === id, 6000);
    const a1 = await av(id, 'NUEVA');
    const a2 = await av(id, 'PREPARANDO');
    check(n, st.fase === 'ACTIVO' && st.internet === conInternet && !!ev && a1.status === 200 && a2.status === 200 && await estadoDe(id) === 'LISTA',
      `${titulo}: la comanda llega y se opera igual`, `internet=${st.internet} lan=${st.lan}`);
    sx.cerrar();
  }
  red.hayInternet = hayInternetReal;

  // ====================================== NAVEGADOR: SONIDO, TEMA, TACTO
  seccion('La pantalla en un navegador (Chromium)');
  let chromium = null, devices = null;
  try { ({ chromium, devices } = require('playwright')); } catch { /* sin playwright */ }
  if (!chromium) {
    for (const n of [27, 28, 29, 30]) salto(n, 'pruebas de navegador', 'playwright no está disponible');
  } else {
    navegador = await chromium.launch();
    /* Cuenta cada vez que la pagina genera sonido. */
    const espiaAudio = () => {
      window.__sonidos = 0;
      const Orig = window.AudioContext;
      window.AudioContext = class extends Orig {
        createOscillator() { const o = super.createOscillator(); const st = o.start.bind(o); o.start = (...a) => { window.__sonidos++; return st(...a); }; return o; }
      };
    };
    const base = `http://127.0.0.1:${PUERTO}`;
    const tablet = await navegador.newContext({ ...devices['Galaxy Tab S4'], baseURL: base });
    await tablet.addInitScript(espiaAudio);
    const pagina = await tablet.newPage();
    const errores = [];
    pagina.on('pageerror', e => errores.push(e.message));
    const qr = await hostA.emparejar({ stationId: barra, nombre: 'Tablet navegador', userId: 1 });
    await pagina.goto(qr.url.replace(/^http:\/\/[^/]+/, base));
    await foto(pagina, 'kds-tablet-emparejar');
    await pagina.getByRole('button', { name: 'Conectar esta pantalla' }).tap();
    await pagina.getByRole('heading', { name: 'Barra' }).waitFor({ timeout: 8000 });
    const activar = pagina.getByRole('button', { name: 'Activar sonido' });
    if (await activar.isVisible().catch(() => false)) await activar.tap();
    await pagina.waitForFunction(() => document.querySelector('.con')?.textContent === 'Red local · Conectada');
    const sonidosAntes = await pagina.evaluate(() => window.__sonidos);
    const nuevaVivo = (await enviar(0, [[americano, 1]]))[0].id;
    await pagina.locator(`[data-id="${nuevaVivo}"]`).waitFor({ timeout: 8000 });
    await dormir(400);
    const sonidosVivo = await pagina.evaluate(() => window.__sonidos) - sonidosAntes;
    await foto(pagina, 'kds-tablet-nueva');
    check(27, sonidosVivo === 2, 'una comanda nueva en tiempo real suena (un aviso de dos notas)', `${sonidosVivo} notas`);

    /* Sin red entre la tablet y el Host: se apaga el Host (la conexion se corta
       igual que al apagar el Wi-Fi de la tablet), las cajas siguen enviando a
       la base, y el Host vuelve. */
    await hostA.detener();
    await pagina.waitForFunction(() => /Reconectando|Sin conexión/.test(document.querySelector('.con')?.textContent || ''), null, { timeout: 15000 });
    const perdidas = [];
    for (const m of [5, 6, 7]) perdidas.push((await enviar(m, [[americano, 1]]))[0].id);
    await dormir(5500);
    const sonidosPrevios = await pagina.evaluate(() => window.__sonidos);
    hostA = nuevoHost('PC-PRINCIPAL', configA, PUERTO);
    await hostA.iniciar();
    await pagina.getByText(/3 comandas pendientes recuperadas/).waitFor({ timeout: 20000 });
    await dormir(1500);
    await foto(pagina, 'kds-tablet-recuperadas');
    const tarjetas = await pagina.locator('[data-id]').evaluateAll(n => n.map(x => x.getAttribute('data-id')));
    check(14, perdidas.every(id => tarjetas.includes(String(id))), 'en el navegador: al volver la red, aparecen las comandas perdidas');
    check(15, new Set(tarjetas).size === tarjetas.length, 'sin tarjetas duplicadas', `${tarjetas.length} tarjetas`);
    check(28, await pagina.evaluate(() => window.__sonidos) === sonidosPrevios, 'recuperar 3 comandas no suena 3 veces: se anuncia una vez en texto');

    const paso = pagina.locator(`[data-id="${nuevaVivo}"] .paso`);
    await paso.tap();
    await pagina.locator(`.carril.es-preparando [data-id="${nuevaVivo}"]`).waitFor({ timeout: 6000 });
    check(30, await estadoDe(nuevaVivo) === 'PREPARANDO', 'tableta táctil: tocar «Empezar» mueve la comanda en la base');
    const alto = await pagina.locator(`[data-id="${nuevaVivo}"] .paso`).evaluate(b => b.getBoundingClientRect().height);
    check(30, alto >= 48, 'los botones miden al menos 48 px para el dedo', `${Math.round(alto)} px`);
    for (const ancho of [360, 768, 1280]) {
      await pagina.setViewportSize({ width: ancho, height: 800 });
      const desborda = await pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(30, !desborda, `sin scroll horizontal a ${ancho} px`);
    }

    const fondo = async (esquema) => {
      await pagina.emulateMedia({ colorScheme: esquema });
      return pagina.evaluate(() => getComputedStyle(document.body).backgroundColor);
    };
    const oscuro = await fondo('dark');
    await foto(pagina, 'kds-tablet-oscuro');
    const claro = await fondo('light');
    check(29, oscuro === 'rgb(10, 17, 25)' && claro === 'rgb(242, 245, 249)', 'sigue el tema del sistema: oscuro y claro', `${oscuro} / ${claro}`);
    await pagina.getByRole('button', { name: 'Ajustes' }).tap();
    await pagina.getByRole('button', { name: 'Oscuro' }).tap();
    check(29, await pagina.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(10, 17, 25)', 'y se puede fijar a mano en la tablet');
    const probar = await pagina.evaluate(() => window.__sonidos);
    await pagina.getByRole('button', { name: 'Probar sonido' }).tap();
    await dormir(300);
    check(27, await pagina.evaluate(() => window.__sonidos) - probar === 2, '«Probar sonido» suena');
    await pagina.getByLabel('Sonido de avisos').uncheck();
    const apagado0 = await pagina.evaluate(() => window.__sonidos);
    const silenciosa = (await enviar(0, [[americano, 1]]))[0].id;
    await pagina.locator(`[data-id="${silenciosa}"]`).waitFor({ timeout: 8000 });
    await dormir(300);
    check(27, await pagina.evaluate(() => window.__sonidos) === apagado0, 'con el sonido apagado, una comanda nueva no suena');

    await pagina.reload();
    await pagina.getByRole('heading', { name: 'Barra' }).waitFor();
    check(30, !errores.length, 'la página carga sin errores de JavaScript', errores.join(' | '));
    const textoSuelto = await pagina.evaluate(() => [...document.getElementById('app').childNodes]
      .filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()));
    check(30, !textoSuelto.length, 'no se cuela texto suelto («null», «undefined») en la pantalla', textoSuelto.join(', '));
    await pagina.setViewportSize({ width: 800, height: 1280 });
    const pag2 = await tablet.newPage();
    const qr2 = await hostA.emparejar({ stationId: barra, nombre: 'Tablet alto', userId: 1 });
    await pag2.goto(qr2.url.replace(/^http:\/\/[^/]+/, base));
    const altoTarjeta = await pag2.locator('.aviso-pantalla').evaluate(e => e.getBoundingClientRect().height);
    check(30, altoTarjeta < 500, 'la tarjeta de emparejar mide lo que su contenido, no toda la pantalla', `${Math.round(altoTarjeta)} px`);
    await pag2.close();
    await tablet.close();
  }

  /* Al final: agota el limite de emparejar de esta IP a proposito. */
  let limitado = false;
  for (let i = 0; i < 30 && !limitado; i++) limitado = (await pedir('/api/pair', { metodo: 'POST', cuerpo: { token: 'A'.repeat(43) } })).status === 429;
  check(24, limitado, 'emparejar tiene límite de intentos por IP');
} catch (e) {
  console.error('\nERROR', e.stack || e.message);
  resultados.push({ n: 0, ok: false, titulo: 'la prueba se interrumpió', detalle: e.message });
} finally {
  try { await navegador?.close(); } catch { /* noop */ }
  try { await hostA?.detener(); } catch { /* noop */ }
  try { await hostB?.detener(); } catch { /* noop */ }
  try { await pool?.close(); await poolCaja2?.close(); } catch { /* noop */ }
  try { eliminar(DB); } catch { /* noop */ }
}

// ================================================================ RESUMEN
const porN = new Map();
for (const r of resultados) {
  const x = porN.get(r.n) || { fallos: 0, oks: 0, saltos: 0 };
  if (r.ok === true) x.oks++; else if (r.ok === false) x.fallos++; else x.saltos++;
  porN.set(r.n, x);
}
const pasa = [...porN].filter(([, x]) => !x.fallos && x.oks).map(([n]) => n);
const falla = [...porN].filter(([, x]) => x.fallos).map(([n]) => n);
const salta = [...porN].filter(([, x]) => !x.fallos && !x.oks).map(([n]) => n);
console.log(`\nPASS ${pasa.length}: ${pasa.sort((a, b) => a - b).join(', ')}`);
console.log(`FAIL ${falla.length}: ${falla.sort((a, b) => a - b).join(', ')}`);
console.log(`SKIPPED ${salta.length}: ${salta.sort((a, b) => a - b).join(', ')}`);
console.log(`(${resultados.filter(r => r.ok).length} comprobaciones ok de ${resultados.length})`);
process.exit(falla.length ? 1 : 0);
