/**
 * TIEMPO REAL: DE LA BASE A LAS PANTALLAS OPERATIVAS.
 *
 * La caja 1, la caja 2 o una tablet guardan en la base y hacen commit. El Host
 * se entera porque pregunta a la base «¿que cambio desde la version N?» (un
 * ROWVERSION por tabla). Solo se lee lo confirmado: un aviso nunca llega
 * antes del commit.
 *
 * FUENTES. Cada tabla que alguna superficie necesita es una fuente, con su
 * cursor. Se consulta UNA vez por vuelta sin importar cuantas pantallas haya
 * (10 tablets no son 10 consultas), y solo si hay alguien conectado que la
 * necesite: sin Mi jornada abierta, nadie mira `appointments`.
 *
 * SEMANTICA. El cambio crudo («la fila 42 de comandas») lo traduce cada
 * superficie a un evento de negocio (PREPARATION_TICKET_CREATED,
 * CLIENT_ARRIVED, WORK_ASSIGNED...) y decide si suena. Aqui no hay nada de
 * pantallas. Y el aviso no es la verdad: la pantalla pide su estado completo
 * al (re)conectar.
 *
 *   `nueva`     fila creada DESPUES de arrancar el Host y vista por primera vez
 *   `anterior`  el estado que tenia la ultima vez que se vio (si se vio)
 */
const CADA_MS = 700;
const LATIDO_MS = 20_000;
const MAX_MEMORIA = 50_000;

const FUENTES = {
  comandas: {
    tabla: 'dbo.comandas',
    columnas: 'id, station_id, estado, cuenta_id',
    estado: (f) => f.estado,
  },
  cuentas: {
    tabla: 'dbo.hosp_cuentas',
    columnas: 'id, mesa_id, estado, abierta_por',
    estado: (f) => f.estado,
  },
  citas: {
    tabla: 'dbo.appointments',
    columnas: 'id, professional_id, status',
    estado: (f) => f.status,
  },
  lineas: {
    tabla: 'dbo.service_order_lines',
    columnas: 'id, order_id, professional_id, status, line_kind',
    estado: (f) => f.status,
  },
  inventario: {
    tabla: 'dbo.inventario_reportes',
    columnas: 'id, product_id, tipo, estado, user_id',
    estado: (f) => f.estado,
  },
};

function crearEventos({ dominio, pool, sql, log = () => {} }) {
  const subs = new Set();
  const cursores = new Map();       // fuente -> { version, idBase, apagada }
  const memoria = new Map();        // `${fuente}:${id}` -> { estado, profesional }
  let reloj = null;
  let latido = null;
  let corriendo = false;
  let pendiente = false;

  function enviar(res, evento, datos) {
    try { res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`); } catch { /* conexion ida */ }
  }

  function necesarias() {
    const n = new Set();
    for (const s of subs) for (const f of s.def.fuentes || []) n.add(f);
    return n;
  }

  async function iniciarCursor(nombre) {
    const f = FUENTES[nombre];
    try {
      const r = await (await pool()).request().query(
        `SELECT CONVERT(BIGINT, ISNULL(MAX(version), 0)) AS v, ISNULL(MAX(id), 0) AS idMax FROM ${f.tabla};`);
      cursores.set(nombre, { version: Number(r.recordset[0].v), idBase: Number(r.recordset[0].idMax) });
    } catch (e) {
      /* Una base sin la migracion de esa fuente: se apaga, no se reintenta en bucle. */
      cursores.set(nombre, { apagada: true });
      log(`eventos: la fuente ${nombre} no esta disponible (${e.message})`);
    }
  }

  async function revisarFuente(nombre) {
    const f = FUENTES[nombre];
    const c = cursores.get(nombre);
    if (!c || c.apagada) return;
    const r = await (await pool()).request().input('v', sql.BigInt, c.version).query(`
      SELECT ${f.columnas}, CONVERT(BIGINT, version) AS version
        FROM ${f.tabla}
       WHERE version > CONVERT(ROWVERSION, CONVERT(BINARY(8), @v))
       ORDER BY version;`);
    for (const fila of r.recordset || []) {
      c.version = Math.max(c.version, Number(fila.version));
      const clave = `${nombre}:${fila.id}`;
      const antes = memoria.get(clave);
      const nueva = !antes && Number(fila.id) > c.idBase;
      memoria.set(clave, { estado: f.estado(fila), profesional: fila.professional_id ?? null });
      if (memoria.size > MAX_MEMORIA) memoria.clear();

      const interesados = [...subs].filter(s => (s.def.fuentes || []).includes(nombre) && typeof s.def.evento === 'function');
      if (!interesados.length) continue;

      /* Lo que varias superficies pueden pedir del mismo cambio, una sola vez. */
      let detalle, dueno;
      const cambio = {
        fuente: nombre, fila, nueva,
        anterior: antes?.estado,
        anteriorProfesional: antes ? antes.profesional : undefined,
        detalle: () => (detalle ??= nombre === 'comandas'
          ? pool().then(p => dominio.una({ pool: p, sql, comandaId: fila.id }))
          : Promise.resolve(null)),
        duenoCuenta: () => (dueno ??= fila.cuenta_id
          ? pool().then(p => p.request().input('c', sql.Int, fila.cuenta_id)
            .query('SELECT abierta_por FROM dbo.hosp_cuentas WHERE id = @c;'))
            .then(x => x.recordset?.[0]?.abierta_por ?? null)
          : Promise.resolve(null)),
      };
      for (const s of interesados) {
        try {
          const ev = await s.def.evento(cambio, s.ctx);
          if (ev) enviar(s.res, 'evento', ev);
        } catch (e) { log(`eventos ${s.def.tipo}: ${e.message}`); }
      }
    }
  }

  async function revisar() {
    if (corriendo) { pendiente = true; return; }
    corriendo = true;
    try {
      for (const nombre of necesarias()) {
        if (!cursores.has(nombre)) await iniciarCursor(nombre);
        await revisarFuente(nombre);
      }
    } catch (e) {
      log(`eventos: ${e.message}`);
    } finally {
      corriendo = false;
      if (pendiente) { pendiente = false; setImmediate(() => void revisar()); }
    }
  }

  async function iniciar() {
    /* Las comandas arrancan ya: son las de siempre y las usan tres superficies. */
    await iniciarCursor('comandas');
    reloj = setInterval(() => { if (subs.size) void revisar(); }, CADA_MS);
    latido = setInterval(() => { for (const s of subs) { try { s.res.write(': sigo aqui\n\n'); } catch { /* noop */ } } }, LATIDO_MS);
  }

  /**
   * Una pantalla se conecta. `ctx` es su contexto (dispositivo, sesion de
   * trabajador si la hay) y `def` su superficie: con eso se filtra y se
   * traduce cada cambio, del lado del servidor.
   */
  async function suscribir({ ctx, def, res }) {
    for (const f of def.fuentes || []) if (!cursores.has(f)) await iniciarCursor(f);
    const s = { ctx, def, res, desde: Date.now() };
    subs.add(s);
    enviar(res, 'hola', { superficie: def.tipo });
    res.on('close', () => subs.delete(s));
    return s;
  }

  function cerrarDonde(pred, evento, datos) {
    for (const s of [...subs]) {
      if (!pred(s)) continue;
      enviar(s.res, evento, datos);
      try { s.res.end(); } catch { /* noop */ }
      subs.delete(s);
    }
  }

  const mismo = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

  /** Revocar: su conexion se corta YA. */
  const cerrarDe = (dispositivoId) => cerrarDonde(s => mismo(s.ctx.disp.id, dispositivoId), 'revocado', {});
  /** El dispositivo cambio de funcion: se recarga con la nueva. */
  const cambioDeFuncion = (dispositivoId) => cerrarDonde(s => mismo(s.ctx.disp.id, dispositivoId), 'funcion', {});
  /** Se cerro la sesion de un trabajador: su pantalla vuelve a «Escanea tu QR». */
  const cerrarSesion = (sesionId, motivo) => cerrarDonde(s => s.ctx.sesion && mismo(s.ctx.sesion.id, sesionId), 'sesion', { motivo });

  function conectados() {
    const m = new Map();
    for (const s of subs) {
      const k = String(s.ctx.disp.id).toLowerCase();
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }

  function detener() {
    clearInterval(reloj); clearInterval(latido);
    for (const s of subs) { try { s.res.end(); } catch { /* noop */ } }
    subs.clear();
  }

  return {
    iniciar, suscribir, revisarYa: () => void revisar(),
    cerrarDe, cambioDeFuncion, cerrarSesion, conectados, detener,
    fuentes: () => [...cursores.entries()].map(([n, c]) => ({ fuente: n, activa: !c.apagada })),
  };
}

module.exports = { crearEventos, FUENTES };
