/**
 * WYBIX LOCAL HOST: LA SUPERFICIE QUE VE UNA TABLET.
 *
 * Todo lo que existe, y nada mas:
 *
 *   GET  /health, /salud                     ¿estas vivo? (sin datos del negocio)
 *   GET  /, /app, /kds, /pair/:t, /w/:t      la pagina (estatica; no canjea nada)
 *   GET  /app/*, /kds/*                      sus JS y CSS
 *   POST /api/pair                           canjea el QR de emparejar por la credencial
 *
 *   -- el telefono del CLIENTE, sin credencial --
 *   GET  /pedidos                            el tablero de pedidos (la misma superficie
 *                                            que la TV; lo abre el QR de la caja)
 *   GET  /api/pedidos                        su DTO publico: numero, estado, primer nombre
 *   GET  /p/:codigo, /api/p/:codigo          seguimiento individual (conservado; hoy
 *                                            ningun QR lleva aqui, ver seguimiento.js)
 *
 *   -- con la credencial del DISPOSITIVO --
 *   GET  /api/s/estado                       su funcion, su sesion y lo que puede ver
 *   GET  /api/s/consulta/:nombre             una lectura acotada de su funcion
 *   POST /api/s/accion/:nombre               una accion de su funcion
 *   GET  /api/s/eventos                      tiempo real (Server-Sent Events)
 *   GET  /api/trabajador/personas            nombres para entrar con PIN
 *   POST /api/trabajador/entrar              QR o PIN -> sesion de trabajador
 *   POST /api/trabajador/salir
 *   GET  /api/dispositivo/funciones          a que funciones puede cambiar
 *   POST /api/dispositivo/funcion            cambiarla, con PIN de administrador
 *
 *   -- compatibilidad con las pantallas de cocina ya abiertas --
 *   GET  /api/kds/estado, POST /api/kds/comandas/:id/avanzar
 *
 * No hay nada administrativo: ni usuarios, ni reportes, ni configuracion, ni
 * SQL, ni IPC. Cada peticion se decide aqui con: credencial del dispositivo ->
 * su funcion (registro) -> la capacidad del negocio -> la sesion de
 * trabajador si la funcion la pide -> los permisos de esa persona -> la accion
 * declarada. Conocer la IP o las URLs no da nada: no se confia por IP.
 *
 * MISMO ORIGEN. La pagina y la API salen del mismo Host: sin CORS. Las
 * credenciales van en cookies HttpOnly y SameSite=Strict.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { nuevoSecreto, pareceSecreto } = require('./credenciales');

const COOKIE = 'wx_disp';
const COOKIE_TRAB = 'wx_trab';
const DIR_WEB = path.join(__dirname, 'kds-web');
const { pedidosPublicos } = require('./superficies/pedidos-dia');
/* Los iconos de la pantalla: la MISMA fuente Phosphor que ya usa Wybix, leida
   de su paquete instalado. No se copia ni se descarga nada. */
let FUENTE_ICONOS = null;
try {
  /* El paquete solo expone sus hojas de estilo: la fuente vive junto a ellas. */
  FUENTE_ICONOS = path.join(path.dirname(require.resolve('@phosphor-icons/web/regular')), 'Phosphor.woff2');
  if (!fs.existsSync(FUENTE_ICONOS)) FUENTE_ICONOS = null;
} catch { /* sin iconos: la pantalla funciona igual */ }
const TIPOS = { '.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const CONFIG_ADMIN = 'CONFIGURACION_ADMINISTRAR';

const CABECERAS_SEGURAS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; media-src 'self' data: blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

/** Limite de peticiones por clave (IP o dispositivo), ventana deslizante. */
function limitador(max, ventanaMs) {
  const golpes = new Map();
  return (clave) => {
    const ahora = Date.now();
    const lista = (golpes.get(clave) || []).filter(t => ahora - t < ventanaMs);
    lista.push(ahora);
    golpes.set(clave, lista);
    if (golpes.size > 5000) golpes.clear();
    return lista.length <= max;
  };
}

function crearServidor({ repo, registro, capacidades, trabajadores, auditoria, pool, sql, eventos, seguimiento = null, licenciaPantallas = null, dominios = {}, log = () => {}, alPedir = () => {} }) {
  const limiteApi = limitador(300, 60_000);
  /* Un telefono consulta cada pocos segundos; esto deja de sobra y frena a
     quien pruebe codigos (que ademas son de 128 bits). */
  const limiteSeguimiento = limitador(60, 60_000);
  /* El tablero en un telefono se relee cada 5 s: 12 por minuto. */
  const limiteTablero = limitador(120, 60_000);
  const limitePair = limitador(12, 60_000);
  const limiteEntrar = limitador(20, 60_000);
  /* Credencial -> dispositivo, unos segundos. Revocar vacia la cache. */
  const cache = new Map();
  const CACHE_MS = 3000;
  const errores = [];

  function anotarError(texto) {
    errores.push({ en: new Date().toISOString(), texto: String(texto).slice(0, 200) });
    if (errores.length > 30) errores.shift();
  }

  function responder(res, codigo, cuerpo, extra = {}) {
    const json = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    res.writeHead(codigo, { ...CABECERAS_SEGURAS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
    res.end(json);
  }

  const ipDe = (req) => String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');

  function leerCookie(req, nombre) {
    const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${nombre}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function credencialDe(req) {
    const auth = String(req.headers.authorization || '');
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
    return leerCookie(req, COOKIE);
  }

  const tokenTrabajador = (req) => leerCookie(req, COOKIE_TRAB);

  async function dispositivoDe(req) {
    const cred = credencialDe(req);
    if (!pareceSecreto(cred)) return null;
    const c = cache.get(cred);
    if (c && Date.now() - c.t < CACHE_MS) return c.d;
    const d = await repo.porCredencial(cred);
    cache.set(cred, { d, t: Date.now() });
    if (d) repo.tocar(d.id, ipDe(req)).catch(() => {});
    return d;
  }

  function olvidar() { cache.clear(); trabajadores.olvidar(); }

  function leerCuerpo(req, max = 8192) {
    return new Promise((resolve, reject) => {
      let n = 0, excedido = false; const partes = [];
      req.on('data', (c) => {
        if (excedido) return;
        n += c.length;
        /* Se deja de guardar y se contesta 413; el resto se descarta. */
        if (n > max) { excedido = true; partes.length = 0; reject(new Error('grande')); } else partes.push(c);
      });
      req.on('end', () => {
        if (excedido) return;
        try { resolve(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {}); }
        catch { reject(new Error('json')); }
      });
      req.on('error', reject);
    });
  }

  function rechazarCuerpo(res, e) {
    if (e?.message === 'grande') responder(res, 413, { error: 'Solicitud demasiado grande.' }, { Connection: 'close' });
    else responder(res, 400, { error: 'Solicitud no válida.' });
  }

  function servirEstatico(res, archivo) {
    const ruta = path.normalize(path.join(DIR_WEB, archivo));
    if (!ruta.startsWith(DIR_WEB)) { responder(res, 404, { error: 'No existe.' }); return; }
    fs.readFile(ruta, (err, datos) => {
      if (err) { responder(res, 404, { error: 'No existe.' }); return; }
      res.writeHead(200, { ...CABECERAS_SEGURAS, 'Content-Type': TIPOS[path.extname(ruta)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(datos);
    });
  }

  /**
   * El contexto de una peticion: dispositivo, su funcion, las capacidades del
   * negocio y la sesion de trabajador. Si la funcion ya no esta disponible (se
   * apago el modulo), el dispositivo no hace nada hasta que se le reasigne.
   */
  async function contexto(req, d) {
    const def = registro.obtener(d.superficie);
    const caps = await capacidades.leer();
    const ctx = {
      disp: d, def, caps, sql, dominios,
      pool: async () => pool(),
      sesion: null,
      diferida: String(req.headers['x-wx-diferida'] || '') === '1',
      localCreadoEn: null,
      avisarCambio: () => eventos.revisarYa(),
    };
    const loc = Date.parse(String(req.headers['x-wx-creado'] || ''));
    if (Number.isFinite(loc)) ctx.localCreadoEn = new Date(loc);
    if (def && def.identidad === 'TRABAJADOR') {
      ctx.sesion = await trabajadores.sesionDe(tokenTrabajador(req), d, def);
    }
    return ctx;
  }

  function sinFuncion(res, ctx) {
    if (!ctx.def) { responder(res, 409, { error: 'Esta pantalla tiene una función que ya no existe. Asígnale otra desde Wybix.', codigo: 'SIN_FUNCION' }); return true; }
    /* Licencia antes que capacidad: el mensaje dice la causa real. */
    if (licenciaPantallas && !licenciaPantallas.permite(ctx.def.tipo)) {
      responder(res, 409, { error: licenciaPantallas.mensaje(), codigo: 'LICENCIA' });
      return true;
    }
    if (!ctx.def.disponible(ctx.caps)) {
      responder(res, 409, { error: `«${ctx.def.nombre}» no está encendida en este negocio. Asígnale otra función desde Wybix.`, codigo: 'FUNCION_APAGADA' });
      return true;
    }
    return false;
  }

  function exigeTrabajador(res, ctx) {
    if (ctx.def.identidad === 'TRABAJADOR' && !ctx.sesion) {
      responder(res, 401, { error: 'Entra con tu QR o tu PIN.', codigo: 'SIN_TRABAJADOR' });
      return true;
    }
    return false;
  }

  function publicoDisp(d) {
    return { id: d.id, nombre: d.nombre, superficie: d.superficie, estacion: d.estacion ?? null, stationId: d.stationId ?? null, todas: !!d.todas };
  }

  function sesionPublica(s) {
    if (!s) return null;
    return { persona: trabajadores.publica(s.persona), inicio: s.inicio, via: s.via };
  }

  function errorDeAccion(res, e, que) {
    if (e?.negocio || e?.http) {
      responder(res, e.http || 409, { error: e.message, codigo: e.codigo || null, repetido: !!e.repetido });
      return;
    }
    log(`${que}: ${e?.message}`);
    anotarError(`${que}: ${e?.message}`);
    responder(res, 500, { error: 'Algo falló en Wybix. Vuelve a intentarlo.' });
  }

  function cookieTrabajador(token) {
    return token
      ? `${COOKIE_TRAB}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`
      : `${COOKIE_TRAB}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
  }

  async function manejar(req, res) {
    const url = new URL(req.url, 'http://local');
    const ruta = url.pathname;
    const ip = ipDe(req);

    // ---------------------------------------------------------- salud
    if (req.method === 'GET' && (ruta === '/health' || ruta === '/salud')) {
      responder(res, 200, { ok: true, servicio: 'wybix-local-host', version: 2, hora: new Date().toISOString() });
      return;
    }

    // ------------------------------------------------------- estaticos
    if (req.method === 'GET' && ['/', '/app', '/app/', '/kds', '/kds/'].includes(ruta)) { servirEstatico(res, 'index.html'); return; }
    if (req.method === 'GET' && /^\/(pair|w)\/[A-Za-z0-9_-]{40,60}$/.test(ruta)) { servirEstatico(res, 'index.html'); return; }
    /* El telefono del cliente: otra pagina, que no sabe emparejar ni entrar. */
    if (req.method === 'GET' && /^\/p\/[0-9A-Fa-f]{32}$/.test(ruta)) { servirEstatico(res, 'pedido.html'); return; }
    /* El tablero publico: la misma superficie de la TV, sin credencial. */
    if (req.method === 'GET' && (ruta === '/pedidos' || ruta === '/pedidos/')) { servirEstatico(res, 'tablero.html'); return; }
    if (req.method === 'GET' && /^\/(kds|app)\/[a-z0-9.-]+\.(js|css|svg|png|webmanifest)$/.test(ruta)) { servirEstatico(res, ruta.replace(/^\/(kds|app)\//, '')); return; }
    if (req.method === 'GET' && ruta === '/app/iconos.woff2') {
      if (!FUENTE_ICONOS) { responder(res, 404, { error: 'No existe.' }); return; }
      fs.readFile(FUENTE_ICONOS, (err, datos) => {
        if (err) { responder(res, 404, { error: 'No existe.' }); return; }
        res.writeHead(200, { ...CABECERAS_SEGURAS, 'Content-Type': 'font/woff2', 'Cache-Control': 'max-age=86400' });
        res.end(datos);
      });
      return;
    }

    if (!ruta.startsWith('/api/')) { responder(res, 404, { error: 'No existe.' }); return; }

    // ---------------------------------------------------------- emparejar
    if (req.method === 'POST' && ruta === '/api/pair') {
      if (!limitePair(ip)) { responder(res, 429, { error: 'Demasiados intentos. Espera un minuto.' }); return; }
      let cuerpo;
      try { cuerpo = await leerCuerpo(req, 4096); } catch (e) { rechazarCuerpo(res, e); return; }
      const token = String(cuerpo?.token || '');
      if (!pareceSecreto(token)) { responder(res, 400, { error: 'El código no es válido.' }); return; }
      const credencial = nuevoSecreto();
      const r = await repo.canjear({ token, credencial, agente: req.headers['user-agent'], ip });
      if (!r.ok) {
        const texto = r.motivo === 'USADO' ? 'Este código ya se usó. Genera otro en Wybix.'
          : r.motivo === 'CADUCO' ? 'Este código ya caducó. Genera otro en Wybix.'
          : 'El código no es válido.';
        responder(res, 410, { error: texto, motivo: r.motivo });
        return;
      }
      /* La cuota se vuelve a mirar al canjear: la licencia pudo cambiar desde
         que se generó el QR. Si ya no cabe, este dispositivo nuevo no entra
         (los que ya trabajaban no se tocan). */
      if (licenciaPantallas) {
        const q = await licenciaPantallas.cuota(r.dispositivo.superficie, { excluirId: r.dispositivo.id, contarPendientes: false });
        if (!q.ok) {
          await repo.revocar(r.dispositivo.id, null).catch(() => {});
          responder(res, 403, { error: q.error, motivo: 'CUOTA' });
          return;
        }
      }
      log(`dispositivo emparejado: ${r.dispositivo.nombre} (${r.dispositivo.superficie})`);
      responder(res, 200, { dispositivo: publicoDisp(r.dispositivo) }, {
        'Set-Cookie': `${COOKIE}=${encodeURIComponent(credencial)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=315360000`,
      });
      return;
    }

    // --------------------------------------- tablero publico de pedidos
    if (ruta === '/api/pedidos') {
      if (req.method !== 'GET') { responder(res, 405, { error: 'Solo lectura.' }); return; }
      if (!limiteTablero(ip)) { responder(res, 429, { error: 'Demasiadas consultas. Espera un minuto.' }); return; }
      const caps = await capacidades.leer();
      if (!caps.comandas) { responder(res, 404, { error: 'No existe.' }); return; }
      try {
        /* La MISMA funcion que la TV (superficie CUSTOMER_STATUS). */
        const { pedidos, negocio } = await pedidosPublicos(await pool());
        responder(res, 200, { pedidos, negocio });
      } catch (e) { errorDeAccion(res, e, 'tablero'); }
      return;
    }

    // ------------------------------------ seguimiento: telefono del cliente
    const seg = ruta.match(/^\/api\/p\/([0-9A-Fa-f]{32})$/);
    if (seg) {
      if (req.method !== 'GET') { responder(res, 405, { error: 'Solo lectura.' }); return; }
      if (!limiteSeguimiento(ip)) { responder(res, 429, { error: 'Demasiadas consultas. Espera un minuto.' }); return; }
      const caps = await capacidades.leer();
      if (!seguimiento || !caps.comandas) { responder(res, 404, { error: 'Este pedido ya no está disponible.' }); return; }
      try {
        const datos = await seguimiento.leer(seg[1]);
        if (!datos) { responder(res, 404, { error: 'Este pedido ya no está disponible.' }); return; }
        responder(res, 200, datos);
      } catch (e) { errorDeAccion(res, e, 'seguimiento'); }
      return;
    }

    // ----------------------------------------- todo lo demas: dispositivo
    if (!limiteApi(ip)) { responder(res, 429, { error: 'Demasiadas peticiones.' }); return; }
    const d = await dispositivoDe(req);
    if (!d) { responder(res, 401, { error: 'Esta pantalla no está conectada a Wybix.', motivo: 'SIN_CREDENCIAL' }); return; }
    alPedir(d, req);

    /* ---- compatibilidad: pantallas de cocina abiertas antes de esta version */
    if (req.method === 'GET' && ruta === '/api/kds/estado') {
      if (d.superficie !== 'PREPARATION') { responder(res, 404, { error: 'No existe.' }); return; }
      const ctx = await contexto(req, d);
      if (sinFuncion(res, ctx)) return;
      const e = await ctx.def.estado(ctx);
      responder(res, 200, { dispositivo: publicoDisp(d), umbrales: e.umbrales, comandas: e.comandas, hora: new Date().toISOString() });
      return;
    }
    const legado = ruta.match(/^\/api\/kds\/comandas\/(\d{1,9})\/avanzar$/);
    if (req.method === 'POST' && legado) {
      if (d.superficie !== 'PREPARATION') { responder(res, 404, { error: 'No existe.' }); return; }
      let cuerpo;
      try { cuerpo = await leerCuerpo(req); } catch (e) { rechazarCuerpo(res, e); return; }
      const ctx = await contexto(req, d);
      if (sinFuncion(res, ctx)) return;
      try {
        const { resultado } = await auditoria.unaVez(ctx, 'AVANZAR', null, { entidad: 'COMANDA', entidadId: legado[1] },
          () => ctx.def.acciones.AVANZAR.ejecutar(ctx, { id: Number(legado[1]), desde: cuerpo?.desde }));
        responder(res, 200, { comanda: resultado.comanda, repetido: !!resultado.repetido });
      } catch (e) { errorDeAccion(res, e, 'avanzar'); }
      return;
    }

    // ------------------------------------------------ estado de la funcion
    if (req.method === 'GET' && ruta === '/api/s/estado') {
      const ctx = await contexto(req, d);
      if (sinFuncion(res, ctx)) return;
      const base = {
        dispositivo: publicoDisp(d),
        superficie: registro.publica(ctx.def),
        sesion: sesionPublica(ctx.sesion),
        hora: new Date().toISOString(),
      };
      if (ctx.def.identidad === 'TRABAJADOR' && !ctx.sesion) {
        const conPin = await trabajadores.personasConPin(ctx.def);
        responder(res, 200, { ...base, requiereTrabajador: true, entrar: { qr: true, pin: conPin.length > 0 }, datos: null });
        return;
      }
      try {
        const datos = await ctx.def.estado(ctx);
        responder(res, 200, { ...base, requiereTrabajador: false, datos });
      } catch (e) { errorDeAccion(res, e, `estado ${ctx.def.tipo}`); }
      return;
    }

    const consulta = ruta.match(/^\/api\/s\/consulta\/([a-z]{2,30})$/);
    if (req.method === 'GET' && consulta) {
      const ctx = await contexto(req, d);
      if (sinFuncion(res, ctx) || exigeTrabajador(res, ctx)) return;
      const fn = Object.prototype.hasOwnProperty.call(ctx.def.consultas || {}, consulta[1]) ? ctx.def.consultas[consulta[1]] : null;
      if (!fn) { responder(res, 404, { error: 'No existe.' }); return; }
      try { responder(res, 200, await fn(ctx, Object.fromEntries(url.searchParams))); }
      catch (e) { errorDeAccion(res, e, `consulta ${consulta[1]}`); }
      return;
    }

    const accion = ruta.match(/^\/api\/s\/accion\/([A-Z_]{2,40})$/);
    if (req.method === 'POST' && accion) {
      let cuerpo;
      try { cuerpo = await leerCuerpo(req); } catch (e) { rechazarCuerpo(res, e); return; }
      const ctx = await contexto(req, d);
      if (sinFuncion(res, ctx)) return;
      const a = Object.prototype.hasOwnProperty.call(ctx.def.acciones || {}, accion[1]) ? ctx.def.acciones[accion[1]] : null;
      /* Una accion que esta funcion no declara NO existe para ella: cobrar,
         cambiar precios, administrar... 403 y queda anotado. */
      if (!a) {
        await auditoria.registrar(ctx, 'RECHAZADA', { detalle: `${accion[1]} no está permitida en ${ctx.def.tipo}` });
        responder(res, 403, { error: 'Esta pantalla no puede hacer eso.', codigo: 'PROHIBIDO' });
        return;
      }
      if (exigeTrabajador(res, ctx)) return;
      if (a.paquete && !ctx.sesion?.persona?.paquetes?.has(a.paquete)) {
        responder(res, 403, { error: 'Tu rol no tiene permiso para eso.', codigo: 'PROHIBIDO' });
        return;
      }
      /* Algo que llega desde la cola sin conexion solo se acepta si es seguro. */
      if (ctx.diferida && a.modo !== 'OFFLINE_SAFE') {
        responder(res, 409, { error: 'Esto necesita conexión. Vuelve a hacerlo ahora.', codigo: 'ONLINE_REQUIRED' });
        return;
      }
      const clave = req.headers['idempotency-key'] ? String(req.headers['idempotency-key']) : null;
      const entidadId = cuerpo?.id ?? cuerpo?.citaId ?? cuerpo?.lineaId ?? cuerpo?.ordenId ?? cuerpo?.cuentaId ?? cuerpo?.mesaId ?? cuerpo?.productId ?? null;
      try {
        const { resultado, repetido } = await auditoria.unaVez(ctx, accion[1], clave,
          { entidadId, localCreadoEn: ctx.localCreadoEn },
          () => a.ejecutar(ctx, cuerpo));
        const publico = { ...(resultado || {}) };
        delete publico.auditoria;
        responder(res, 200, { ok: true, repetido: repetido || !!publico.repetido, resultado: publico });
      } catch (e) { errorDeAccion(res, e, `accion ${ctx.def.tipo}.${accion[1]}`); }
      return;
    }

    if (req.method === 'GET' && ruta === '/api/s/eventos') {
      const ctx = await contexto(req, d);
      if (sinFuncion(res, ctx) || exigeTrabajador(res, ctx)) return;
      res.writeHead(200, {
        ...CABECERAS_SEGURAS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      await eventos.suscribir({ ctx, def: ctx.def, res });
      return;
    }

    // ------------------------------------------------------- trabajador
    if (req.method === 'GET' && ruta === '/api/trabajador/personas') {
      const ctx = await contexto(req, d);
      if (sinFuncion(res, ctx)) return;
      if (ctx.def.identidad !== 'TRABAJADOR') { responder(res, 404, { error: 'No existe.' }); return; }
      responder(res, 200, { personas: await trabajadores.personasConPin(ctx.def) });
      return;
    }

    if (req.method === 'POST' && ruta === '/api/trabajador/entrar') {
      if (!limiteEntrar(`${ip}|${d.id}`)) { responder(res, 429, { error: 'Demasiados intentos. Espera un minuto.' }); return; }
      let cuerpo;
      try { cuerpo = await leerCuerpo(req, 4096); } catch (e) { rechazarCuerpo(res, e); return; }
      const ctx = await contexto(req, d);
      if (sinFuncion(res, ctx)) return;
      if (ctx.def.identidad !== 'TRABAJADOR') { responder(res, 404, { error: 'No existe.' }); return; }
      const r = cuerpo?.qr
        ? await trabajadores.entrarQr(cuerpo.qr, d, ctx.def)
        : await trabajadores.entrarPin(cuerpo?.accesoId, String(cuerpo?.pin ?? ''), d, ctx.def);
      if (!r.ok) {
        await auditoria.registrar(ctx, 'ENTRADA_FALLIDA', { detalle: cuerpo?.qr ? 'QR' : 'PIN' });
        responder(res, r.bloqueado ? 429 : 401, { error: r.error, codigo: r.bloqueado ? 'BLOQUEADO' : 'NO_ENTRA' });
        return;
      }
      await auditoria.registrar({ ...ctx, sesion: { id: r.sesion.id, persona: r.persona || {} } }, 'ENTRADA',
        { detalle: `${r.sesion.persona.nombre} (${cuerpo?.qr ? 'QR' : 'PIN'})` });
      responder(res, 200, { sesion: r.sesion }, { 'Set-Cookie': cookieTrabajador(r.token) });
      return;
    }

    if (req.method === 'POST' && ruta === '/api/trabajador/salir') {
      const ctx = await contexto(req, d);
      if (ctx.sesion) {
        await auditoria.registrar(ctx, 'SALIDA', { detalle: ctx.sesion.persona.nombre });
        await trabajadores.cerrarSesion(ctx.sesion.id, 'SALIR');
      }
      responder(res, 200, { ok: true }, { 'Set-Cookie': cookieTrabajador(null) });
      return;
    }

    // ---------------------------------------------- cambiar la funcion
    if (req.method === 'GET' && ruta === '/api/dispositivo/funciones') {
      const caps = await capacidades.leer();
      const disponibles = registro.disponibles(caps);
      responder(res, 200, {
        actual: d.superficie,
        funciones: disponibles.map(x => ({ tipo: x.tipo, nombre: x.nombre, descripcion: x.descripcion, requiereEstacion: !!x.requiereEstacion })),
        estaciones: disponibles.some(x => x.requiereEstacion) ? (await repo.estaciones()).map(e => ({ id: e.id, nombre: e.nombre })) : [],
        autorizan: await trabajadores.administradoresConPin(CONFIG_ADMIN),
      });
      return;
    }

    if (req.method === 'POST' && ruta === '/api/dispositivo/funcion') {
      if (!limiteEntrar(`${ip}|${d.id}`)) { responder(res, 429, { error: 'Demasiados intentos. Espera un minuto.' }); return; }
      let cuerpo;
      try { cuerpo = await leerCuerpo(req, 4096); } catch (e) { rechazarCuerpo(res, e); return; }
      const ctx = await contexto(req, d);
      /* Cambiar la funcion es una decision del negocio: PIN de alguien con
         CONFIGURACION_ADMINISTRAR. Un trabajador cualquiera no reasigna la tablet. */
      const ok = await trabajadores.autorizarConPin(cuerpo?.accesoId, String(cuerpo?.pin ?? ''), CONFIG_ADMIN);
      if (!ok.ok) {
        await auditoria.registrar(ctx, 'CAMBIO_FUNCION_RECHAZADO', { detalle: ok.error });
        responder(res, 403, { error: ok.error, codigo: 'PROHIBIDO' });
        return;
      }
      const caps = await capacidades.leer();
      const nueva = registro.obtener(String(cuerpo?.superficie || ''));
      if (!nueva || !nueva.disponible(caps)) { responder(res, 400, { error: 'Esa función no está disponible en este negocio.' }); return; }
      if (licenciaPantallas) {
        const q = await licenciaPantallas.cuota(nueva.tipo, { excluirId: d.id });
        if (!q.ok) { responder(res, 403, { error: q.error, codigo: 'CUOTA' }); return; }
      }
      const stationId = Number(cuerpo?.stationId) || null;
      const todas = !!cuerpo?.todas;
      if (nueva.requiereEstacion && !todas && !(await repo.estaciones()).some(e => Number(e.id) === stationId)) {
        responder(res, 400, { error: 'Elige la estación.' }); return;
      }
      await repo.cambiarFuncion({ id: d.id, superficie: nueva.tipo, stationId: nueva.requiereEstacion ? stationId : null, todas: nueva.requiereEstacion ? todas : false, config: null, userId: null });
      /* Primero se avisa a la pantalla de su nueva funcion; despues se cierran
         las sesiones (cerrarlas antes cortaba la conexion con «sesion» y la
         pantalla no se enteraba del cambio). */
      eventos.cambioDeFuncion(d.id);
      await trabajadores.cerrarSesionesDeDispositivo(d.id, 'FUNCION');
      await auditoria.registrar(ctx, 'CAMBIO_FUNCION', { entidad: 'DISPOSITIVO', entidadId: d.id, detalle: `${d.superficie} -> ${nueva.tipo} (autorizó ${ok.persona.nombre})` });
      olvidar();
      responder(res, 200, { ok: true, superficie: nueva.tipo }, { 'Set-Cookie': cookieTrabajador(null) });
      return;
    }

    responder(res, 404, { error: 'No existe.' });
  }

  const servidor = http.createServer((req, res) => {
    manejar(req, res).catch((e) => {
      /* Nunca una traza al navegador. */
      log(`error ${req.method} ${req.url}: ${e.message}`);
      anotarError(`${req.method} ${String(req.url).split('?')[0]}: ${e.message}`);
      if (!res.headersSent) responder(res, 500, { error: 'Algo falló en Wybix. Vuelve a intentarlo.' });
      else try { res.end(); } catch { /* noop */ }
    });
  });
  servidor.keepAliveTimeout = 65_000;
  servidor.headersTimeout = 70_000;

  return { servidor, olvidar, errores: () => [...errores] };
}

module.exports = { crearServidor, COOKIE, COOKIE_TRAB };
