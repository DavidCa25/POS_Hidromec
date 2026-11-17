'use strict';
/**
 * WYBIX, ASISTENTE OPERATIVO: arma las piezas con lo que main.js ya tiene.
 *
 *   sensores.js       cómo está el negocio (SQL que ya existe) y el equipo
 *   motor.js          reglas → hallazgos (puro)
 *   packs/*.js        las reglas: core, hospitality, sistema (doctor técnico)
 *   store.js          hallazgos, planes, bitácora, chat y frases (0082)
 *   lenguaje/         texto → intent + datos (sin IA generativa): intents por
 *                     área, frases de entrenamiento, léxico, señales, filtros
 *                     combinados y apodos del negocio
 *   analitica/        el cubo de ventas, «¿por qué?», pronósticos y «¿y si…?»
 *   acciones/         respuestas y planes con vista previa, un archivo por área
 *   conversacion.js   el chat
 *
 * Nada aquí ejecuta una operación del negocio: los planes los confirma una
 * persona y los ejecuta la pantalla con la API de siempre.
 * Diseño: docs/arquitectura/asistente-operativo.md
 */
const fs = require('fs');
const { crearSensores } = require('./sensores');
const { crearMotor } = require('./motor');
const { crearStore } = require('./store');
const { crearAcciones } = require('./acciones');
const { crearConversacion, mensajeDeHallazgo } = require('./conversacion');
const { crearInterprete, prepararCatalogo } = require('./lenguaje/interprete');

const PACKS = [require('./packs/core'), require('./packs/hospitality'), require('./packs/sistema')];
const CADA_MS = 10 * 60_000;

/**
 * @param {object} d
 *   sql, poolPromise
 *   modulosActivos()      Set de módulos encendidos (CapabilityService del negocio)
 *   licenciaEstado()      { modo, diasRestantes, relojAtrasado }
 *   respaldo()            backup-config de la empresa activa
 *   nubeActiva()          ¿la nube está configurada?
 *   equipo()              device-config (impresora)
 *   carpetaDatos          para medir el disco
 *   avisar(resumenFn)     manda el resumen nuevo a las ventanas
 */
function crearAsistente(d) {
  const pool = () => d.poolPromise;
  const sql = d.sql;
  const log = d.log || console.log;

  const sensores = crearSensores({ sql, pool, sistema: () => leerSistema() });
  const motor = crearMotor({ packs: PACKS, sensores, log });
  const store = crearStore({ sql, pool });

  // ------------------------------------------------------ sistema (doctor)
  async function leerSistema() {
    const out = {};
    try {
      const r = d.respaldo?.() || {};
      out.respaldo = { activo: !!r.enabled, ultimo: r.lastBackupAt || null, estado: r.lastStatus || null, error: r.lastError || null };
    } catch { /* sin respaldo configurable */ }
    try {
      if (d.nubeActiva?.()) {
        const [x] = (await (await pool()).request().query(`
          SELECT COUNT(*) AS pendientes, MIN(created_at) AS mas_viejo,
                 (SELECT TOP 1 last_error FROM dbo.sync_outbox WHERE status = 'PENDING' AND last_error IS NOT NULL ORDER BY id DESC) AS error
            FROM dbo.sync_outbox WHERE status = 'PENDING';`)).recordset;
        out.nube = { activa: true, pendientes: Number(x?.pendientes) || 0, masViejo: x?.mas_viejo ? new Date(x.mas_viejo).toISOString() : null, error: x?.error || null };
      } else out.nube = { activa: false };
    } catch (e) { out.nube = { activa: false, error: e.message }; }
    try {
      const l = d.licenciaEstado?.() || {};
      out.licencia = { modo: l.modo || null, dias: l.diasRestantes ?? null, relojAtrasado: !!l.relojAtrasado };
    } catch { /* sin licencia legible */ }
    try {
      const e = d.equipo?.() || {};
      const nombre = e?.printer?.ticketPrinterName || e?.printer?.name || '';
      out.impresora = { configurada: !!String(nombre).trim() };
    } catch { /* noop */ }
    try {
      if (d.carpetaDatos && fs.statfsSync) {
        const s = fs.statfsSync(d.carpetaDatos);
        out.disco = { libreGB: Math.round((Number(s.bavail) * Number(s.bsize) / 1e9) * 10) / 10 };
      }
    } catch { /* noop */ }
    return out;
  }

  // ------------------------------------------------------------ catálogo
  /* Lo que el intérprete busca en una frase: productos, personas (clientes,
     proveedores, profesionales), categorías y conceptos de gasto. Cada lista
     se lee por separado: si una tabla no existe en esta base (un módulo sin
     migrar), esa lista queda vacía y lo demás sigue. */
  let cat = { en: 0, productos: [], categorias: [], personas: [], conceptos: [], usuarios: [], apodos: [] };
  async function cargarCatalogo(forzar = false) {
    if (!forzar && Date.now() - cat.en < 2 * 60_000) return cat;
    const db = await pool();
    const leer = async (texto) => { try { return (await db.request().query(texto)).recordset || []; } catch { return []; } };
    const [productos, categorias, clientes, proveedores, profesionales, conceptos, usuarios, apodos] = await Promise.all([
      leer(`SELECT id, nombre, stock, inventory_mode FROM dbo.products WHERE active = 1;`),
      leer(`SELECT id, namee AS nombre FROM dbo.CAT_categories ORDER BY namee;`),
      leer(`SELECT id, customerName AS nombre FROM dbo.customers WHERE active = 1;`),
      leer(`SELECT id, nombre FROM dbo.CAT_suppliers WHERE ISNULL(activo, 1) = 1;`),
      leer(`SELECT id, full_name AS nombre FROM dbo.professionals WHERE active = 1;`),
      leer(`SELECT id, name AS nombre FROM dbo.expense_categories WHERE active = 1 ORDER BY sort_order, name;`),
      leer(`SELECT id, usuario AS nombre FROM dbo.users WHERE active = 1;`),
      store.apodos(),
    ]);
    /* Un apodo es otro nombre del mismo producto o persona: entra al catálogo
       con las palabras del apodo y el nombre real (así se contesta con él). */
    const nombreDe = { producto: new Map(productos.map((p) => [p.id, p.nombre])), cliente: new Map(clientes.map((x) => [x.id, x.nombre])),
                       proveedor: new Map(proveedores.map((x) => [x.id, x.nombre])), profesional: new Map(profesionales.map((x) => [x.id, x.nombre])) };
    const conApodo = (tipo) => apodos.filter((a) => a.tipo === tipo && nombreDe[tipo].has(a.refId))
      .map((a) => ({ ...prepararCatalogo([{ id: a.refId, nombre: a.alias }])[0], nombre: nombreDe[tipo].get(a.refId), apodo: a.alias })).filter((x) => x.tokens);
    cat = {
      en: Date.now(),
      productos: [...prepararCatalogo(productos.map((p) => ({ id: p.id, nombre: p.nombre,
        nota: p.inventory_mode === 'DIRECT' ? `${Number(p.stock) || 0}` : undefined }))), ...conApodo('producto')],
      categorias,
      personas: [...prepararCatalogo([
        ...clientes.map((x) => ({ ...x, tipo: 'cliente' })),
        ...proveedores.map((x) => ({ ...x, tipo: 'proveedor' })),
        ...profesionales.map((x) => ({ ...x, tipo: 'profesional' })),
      ]), ...['cliente', 'proveedor', 'profesional'].flatMap((t) => conApodo(t).map((x) => ({ ...x, tipo: t })))],
      conceptos,
      usuarios,
      apodos: apodos.map((a) => ({ ...a, nombre: nombreDe[a.tipo]?.get(a.refId) || null })),
    };
    return cat;
  }
  const modulos = async () => { try { return await d.modulosActivos?.() || new Set(); } catch { return new Set(); } };
  /** Todo lo que el intérprete necesita para una frase. */
  const datos = async () => {
    const c = await cargarCatalogo();
    return { catalogo: c.productos, categorias: c.categorias, personas: c.personas, conceptos: c.conceptos, usuarios: c.usuarios, modulos: await modulos() };
  };

  // ----------------------------------------------------------- intérprete
  /* Corpus de fábrica + frases confirmadas de este negocio. Se reentrena al
     arrancar y cada 20 frases nuevas (naive Bayes: milisegundos). */
  let interprete = crearInterprete();
  let frasesUsadas = 0;
  async function reentrenar() {
    try {
      const frases = await store.frases();
      if (frases.length === frasesUsadas) return;
      interprete = crearInterprete({ frasesNegocio: frases });
      frasesUsadas = frases.length;
      log(`[ASISTENTE] intérprete entrenado con ${frases.length} frases del negocio`);
    } catch (e) { log(`[ASISTENTE] no se pudo reentrenar: ${e.message}`); }
  }

  // ------------------------------------------------------------- hallazgos
  const visible = (h, puede) => !h.verPermiso || puede(h.verPermiso);
  async function listarHallazgos(ctx) {
    return (await store.listar()).filter((h) => visible(h, ctx.puede));
  }

  async function resumen(ctx) {
    const hs = await listarHallazgos(ctx);
    const negocio = hs.filter((h) => h.dominio !== 'sistema');
    const sistema = hs.filter((h) => h.dominio === 'sistema');
    return { pendientes: hs.filter((h) => h.estado === 'abierto').length, total: hs.length,
             masUrgente: hs[0] || null, sistema: { ok: !sistema.length, problemas: sistema.length },
             negocio: negocio.length, evaluadoEn: ultimaEvaluacion };
  }

  let ultimaEvaluacion = null, corriendo = null;
  async function evaluar({ forzar = false, dominios = null } = {}) {
    if (corriendo) return corriendo;
    corriendo = (async () => {
      const t0 = Date.now();
      try {
        const modulos = await d.modulosActivos?.() || new Set();
        const ctx = {
          ahora: Date.now(),
          tieneCapacidad: (c) => modulos.has(c),
          config: await store.config().catch(() => ({})),
          fatiga: await store.fatiga().catch(() => ({})),
        };
        const r = await motor.evaluar(ctx, { forzar, dominios });
        const s = await store.sincronizar(r.hallazgos, r.evaluadas);
        ultimaEvaluacion = new Date().toISOString();
        log(`[ASISTENTE] ${r.hallazgos.length} hallazgos · ${s.resueltos.length} resueltos · ${r.errores.length} errores · ${Date.now() - t0} ms`);
        d.avisar?.();
        return { ...r, resueltos: s.resueltos };
      } catch (e) {
        log(`[ASISTENTE] no se pudo evaluar: ${e.message}`);
        return { hallazgos: [], errores: [{ error: e.message }] };
      } finally { corriendo = null; }
    })();
    return corriendo;
  }

  /* Después de una venta, compra o merma: se re-evalúa pronto, una vez. */
  let prontoT = null;
  function pronto(ms = 20_000) {
    clearTimeout(prontoT);
    prontoT = setTimeout(() => { motor.olvidarCache(); void evaluar(); }, ms);
    prontoT.unref?.();
  }

  // --------------------------------------------------------------- servicio
  let timer = null, arranque = null;
  const servicio = {
    iniciar() {
      motor.olvidarCache();
      cat.en = 0;
      arranque = setTimeout(() => { void reentrenar(); void evaluar(); }, 15_000);
      timer = setInterval(() => { void evaluar(); }, CADA_MS);
      arranque.unref?.(); timer.unref?.();
    },
    detener() { clearTimeout(arranque); clearInterval(timer); clearTimeout(prontoT); timer = arranque = null; },
  };

  const acciones = crearAcciones({ sql, pool, sensores, listarHallazgos, sistema: () => leerSistema(),
                                   apodos: { listar: async () => (await cargarCatalogo()).apodos },
                                   preferencias: { guardar: (u, c) => store.guardarPreferencias(u, c), olvidar: (u) => store.olvidarPreferencias(u) } });

  /**
   * Un apodo nuevo (enseñado con su tarjeta, o aprendido al elegir una opción).
   * El catálogo se recarga para que la siguiente frase ya lo entienda.
   */
  async function apodo({ accion, alias, tipo, refId, origen = 'ensenado' }, userId = null) {
    const { limpiar, valido } = require('./lenguaje/apodos');
    const { normalizar } = require('./lenguaje/normalizar');
    const a = limpiar(normalizar(String(alias || '')).texto);
    if (!valido(a)) throw new Error('Ese apodo no es válido.');
    if (accion === 'borrar') { const ok = await store.borrarApodo(a, userId); cat.en = 0; return { borrado: ok }; }
    if (!['producto', 'cliente', 'proveedor', 'profesional'].includes(tipo) || !(Number(refId) > 0)) throw new Error('¿A qué apunta ese apodo?');
    await store.guardarApodo({ alias: a, tipo, refId: Number(refId), origen, userId });
    cat.en = 0;
    return { alias: a };
  }

  const conversacion = crearConversacion({ interprete: () => interprete, acciones, store, listarHallazgos, log, datos,
                                           aprender: (x, userId) => apodo({ accion: 'guardar', origen: 'aprendido', ...x }, userId) });

  /** Lo que va entendiendo mientras se escribe: chips, sin responder ni guardar. */
  const { porId } = require('./lenguaje/intents');
  async function entender(texto, userId = null) {
    if (!texto || texto.trim().length < 3) return null;
    const r = interprete.interpretar(texto, { ...(await datos()), ahora: new Date(), contexto: conversacion.contextoDe(userId) });
    if (!r.intent) return null;
    return { intent: r.intent, etiqueta: porId(r.intent)?.etiqueta || r.intent, puntaje: r.puntaje, falta: r.falta,
             datos: Object.entries(r.slots)
               .filter(([k, v]) => !(k === 'periodo' && v.valor === 'hoy'))
               .map(([k, v]) => ({ clave: k, texto: v.texto ?? (typeof v.valor === 'object' ? '' : String(v.valor ?? '')),
                                   dudoso: v.confianza === 'dudoso' || (v.valor == null && v.delta == null) })) };
  }

  return { evaluar, pronto, resumen, entender, listarHallazgos, store, conversacion, servicio, reentrenar, mensajeDeHallazgo, apodo,
           olvidar: () => { motor.olvidarCache(); cat.en = 0; } };
}

module.exports = { crearAsistente };
