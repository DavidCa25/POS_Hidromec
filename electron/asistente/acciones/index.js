'use strict';
/**
 * LO QUE WYBIX RESPONDE A CADA INTENT, por área (un archivo por área).
 *
 *   consulta  responde con datos reales y opciones (no escribe nada).
 *   accion    arma un PLAN: qué se va a hacer, la vista previa (antes y
 *             después) y qué API de la pantalla lo ejecuta. No ejecuta: la
 *             persona confirma y la pantalla llama la API que ya existe, con
 *             sus permisos y aprobaciones (PIN o app del dueño).
 *   pantalla  lo que por seguridad solo se hace en su pantalla (cobrar,
 *             devolver, facturar, cortar): Wybix dice cómo y lleva ahí.
 *
 * Los textos son plantillas con los números de la base. Si falta un dato,
 * se pregunta con botones; nunca se adivina.
 */
const crypto = require('crypto');
const formato = require('../formato');
const { porId, INTENTS } = require('../lenguaje/intents');
const { crearAnalitica } = require('../analitica');
const { hayFiltros } = require('../lenguaje/filtros');
const voz = require('./voz');

const { MOTIVOS_DEVOLUCION } = require('../lenguaje/extractores');
const MOTIVOS = [
  { etiqueta: 'Caducó', valor: 'CADUCADO' }, { etiqueta: 'Se cayó', valor: 'SE_CAYO' },
  { etiqueta: 'Salió mal', valor: 'MAL_HECHO' }, { etiqueta: 'Degustación', valor: 'DEGUSTACION' },
];
const METODOS = [
  { etiqueta: 'Efectivo', valor: 'EFECTIVO' }, { etiqueta: 'Tarjeta', valor: 'TARJETA' }, { etiqueta: 'Transferencia', valor: 'TRANSFERENCIA' },
];
const PREGUNTAS = {
  cantidad: '¿Cuántas?', producto: '¿De cuál producto?', motivo: '¿Por qué fue la merma?', precio: '¿A qué precio?',
  nombre: '¿Cómo se llama?', categoria: '¿En qué categoría va?', destino: '¿A dónde te llevo?', monto: '¿De cuánto?',
  metodo: '¿Cómo se pagó?', concepto: '¿De qué fue el gasto?', cliente: '¿Qué cliente?', proveedor: '¿Qué proveedor?',
  profesional: '¿Con quién?', servicio: '¿Qué servicio?', fecha: '¿Qué día?', hora: '¿A qué hora?', folio: '¿Qué folio?',
  mesa: '¿Qué mesa?', renglones: '¿Qué productos y cuántos?', impuesto: '¿Qué impuesto?',
  razon: '¿Por qué lo devuelve?',
  costo: '¿Cuánto te cuesta cada uno, sin IVA? Si todavía no sabes, dime «no sé».',
  existencia: '¿Cuántos tienes ahorita? Si todavía ninguno, dime «ninguno».',
};
const PREGUNTA_CAMPO = {
  costo: '¿A qué costo, sin IVA?', nombre: '¿Cómo se va a llamar?', codigo_barras: '¿Cuál es el código de barras?',
  sku: '¿Cuál es el número de parte?', iva: '¿Con qué IVA? 16%, 8% o exento.',
  telefono: '¿Cuál es el teléfono? (10 dígitos)', correo: '¿Cuál es el correo?', rfc: '¿Cuál es el RFC?',
  limite: '¿De cuánto es el límite de crédito?', dias: '¿Cuántos días de crédito?',
};
/* Lo que no encontró, dicho por tipo. */
const NO_ENCONTRADO = {
  producto: (t) => `No encuentro «${t}» en tu catálogo. ¿Cómo se llama exactamente?`,
  servicio: (t) => `No encuentro el servicio «${t}». ¿Cómo se llama exactamente?`,
  cliente: (t) => `No encuentro a «${t}» en tus clientes. ¿Cómo está registrado?`,
  proveedor: (t) => `No encuentro a «${t}» en tus proveedores. ¿Cómo está registrado?`,
  profesional: (t) => `No encuentro a «${t}» en tus profesionales. ¿Quién es?`,
};
const msg = (texto, extra = {}) => ({ autor: 'wybix', texto, ...extra });

/* Rangos de fechas por periodo, en SQL (hora local del servidor). Cada uno
   trae el periodo anterior equivalente para comparar. */
const HOY = 'CAST(GETDATE() AS DATE)';
const MANANA = 'DATEADD(DAY, 1, CAST(GETDATE() AS DATE))';
const INI_MES = 'DATEADD(DAY, 1 - DAY(GETDATE()), CAST(GETDATE() AS DATE))';
const RANGOS = {
  hoy: { desde: HOY, hasta: MANANA, antesDesde: `DATEADD(DAY, -7, ${HOY})`, antesHasta: `DATEADD(DAY, -6, ${HOY})`,
         nombre: 'Hoy', de: 'de hoy', contra: 'el mismo día de la semana pasada' },
  ayer: { desde: `DATEADD(DAY, -1, ${HOY})`, hasta: HOY, antesDesde: `DATEADD(DAY, -8, ${HOY})`, antesHasta: `DATEADD(DAY, -7, ${HOY})`,
          nombre: 'Ayer', de: 'de ayer', contra: 'el mismo día de la semana anterior' },
  semana: { desde: `DATEADD(DAY, -6, ${HOY})`, hasta: MANANA, antesDesde: `DATEADD(DAY, -13, ${HOY})`, antesHasta: `DATEADD(DAY, -6, ${HOY})`,
            nombre: 'En los últimos 7 días', de: 'de los últimos 7 días', contra: 'los 7 días anteriores' },
  semana_pasada: { desde: `DATEADD(DAY, -13, ${HOY})`, hasta: `DATEADD(DAY, -6, ${HOY})`, antesDesde: `DATEADD(DAY, -20, ${HOY})`, antesHasta: `DATEADD(DAY, -13, ${HOY})`,
                   nombre: 'La semana pasada', de: 'de la semana pasada', contra: 'la semana anterior' },
  mes: { desde: INI_MES, hasta: MANANA, antesDesde: `DATEADD(MONTH, -1, ${INI_MES})`, antesHasta: `DATEADD(MONTH, -1, ${MANANA})`,
         nombre: 'Este mes', de: 'del mes', contra: 'el mes pasado a la misma fecha' },
  mes_pasado: { desde: `DATEADD(MONTH, -1, ${INI_MES})`, hasta: INI_MES, antesDesde: `DATEADD(MONTH, -2, ${INI_MES})`, antesHasta: `DATEADD(MONTH, -1, ${INI_MES})`,
                nombre: 'El mes pasado', de: 'del mes pasado', contra: 'el mes anterior' },
  anio: { desde: 'DATEFROMPARTS(YEAR(GETDATE()), 1, 1)', hasta: MANANA, antesDesde: 'DATEFROMPARTS(YEAR(GETDATE()) - 1, 1, 1)', antesHasta: `DATEADD(YEAR, -1, ${MANANA})`,
          nombre: 'En el año', de: 'del año', contra: 'el año pasado a la misma fecha' },
};

const AREAS = ['general', 'venta', 'caja', 'inventario', 'compras', 'proveedores', 'clientes', 'gastos', 'finanzas',
               'facturacion', 'personal', 'hospitality', 'servicios', 'analisis', 'apodos', 'preferencias'];

/**
 * @param d { sql, pool, sensores, listarHallazgos, sistema(), apodos: { listar() }, preferencias: { guardar, olvidar } }
 */
function crearAcciones({ sql, pool, sensores, listarHallazgos, sistema = async () => ({}), apodos = { listar: async () => [] }, preferencias = null, equipo = () => null, whatsappConfig = async () => null }) {
  const q = async (texto, entradas = []) => {
    const req = (await pool()).request();
    for (const [n, t, v] of entradas) req.input(n, t, v);
    return (await req.query(texto)).recordset || [];
  };
  const uno = async (texto, entradas) => (await q(texto, entradas))[0] || null;
  const id = (v) => ['id', sql.Int, Number(v) || 0];

  /** El plan, con su id y su caducidad (5 min: los datos de la vista cambian). */
  function plan(intent, { titulo, vista, avisos = [], ejecutar, permiso = null, nivel = 'confirmar', hallazgoId = null }) {
    return { id: crypto.randomUUID(), intent, nivel, titulo, vista, avisos, ejecutar, permiso, hallazgoId,
             caducaEn: new Date(Date.now() + 5 * 60_000).toISOString() };
  }

  /** Pregunta por el dato que falta, con botones cuando hay opciones. */
  function preguntar(interp) {
    const s = interp.slots[interp.falta];
    let opciones = (s?.opciones || []).map((o) => ({ etiqueta: o.nota ? `${o.etiqueta} · ${o.nota}` : o.etiqueta, texto: o.etiqueta }));
    if (interp.falta === 'motivo') opciones = MOTIVOS.map((m) => ({ etiqueta: m.etiqueta, texto: m.etiqueta }));
    if (interp.falta === 'razon') opciones = MOTIVOS_DEVOLUCION.map((m) => ({ etiqueta: m, texto: m }));
    if (interp.falta === 'metodo') opciones = METODOS.map((m) => ({ etiqueta: m.etiqueta, texto: m.etiqueta }));
    if (interp.falta === 'fecha') opciones = ['Hoy', 'Mañana', 'Pasado mañana'].map((x) => ({ etiqueta: x, texto: x }));
    if (interp.falta === 'costo') opciones = [{ etiqueta: 'No sé', texto: 'no sé' }];
    if (interp.falta === 'existencia') opciones = [{ etiqueta: 'Ninguno', texto: 'ninguno' }];
    const noEsta = NO_ENCONTRADO[interp.falta];
    /* «Cambia el costo de la concha» sin decir a cuánto: la pregunta nombra el campo. */
    const deCampo = interp.falta === 'valor' && PREGUNTA_CAMPO[interp.slots.campo?.valor];
    const texto = deCampo || (noEsta && s?.texto && !s.opciones?.length ? noEsta(s.texto) : PREGUNTAS[interp.falta] || '¿Me das ese dato?');
    return msg(texto, { opciones, esperando: { intent: interp.intent, slots: interp.slots, falta: interp.falta } });
  }

  const analitica = crearAnalitica({ q, sql });

  const h = {
    sql, q, uno, id, msg, plan, sensores, listarHallazgos, sistema, apodos, preferencias, analitica, MOTIVOS, METODOS, ...formato,
    di: voz.di, saludo: voz.saludo, nombreDe: voz.nombreDe,
    v: (interp, k) => interp.slots[k]?.valor ?? null,
    r2: (n) => Math.round(Number(n) * 100) / 100,
    rango: (periodo) => RANGOS[periodo] || RANGOS.hoy,
    pct: (a, b) => (Number(b) > 0 ? Math.round((Number(a) / Number(b) - 1) * 100) : null),
    signo: (n) => (n == null ? '' : `${n >= 0 ? '+' : ''}${n}%`),
    plural: (n, uno, varios = `${uno}s`) => `${formato.num(n)} ${Number(n) === 1 ? uno : varios}`,
    /** ¿Puede ver esto? Si no, la respuesta que lo dice. */
    sinPermiso: (ctx, permiso, que = 'eso') => (permiso && !ctx.puede(permiso) ? msg(`Tu usuario no puede ver ${que}. Pídeselo a un encargado.`) : null),
    /** Fecha ISO local (AAAA-MM-DD) + hora → Date local. */
    cuando: (fechaIso, hora) => {
      const [y, m, d] = String(fechaIso).split('-').map(Number);
      return new Date(y, m - 1, d, hora?.h ?? 9, hora?.m ?? 0, 0, 0);
    },
    hoyIso: () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
    horaTexto: (d) => { const x = new Date(d); return `${x.getHours()}:${String(x.getMinutes()).padStart(2, '0')}`; },
    diaTexto: (d) => new Date(d).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' }),
    producto: async (pid) => uno(`
      SELECT p.id, p.nombre, p.part_number, p.bar_code, p.price, p.stock, p.cost, p.inventory_mode, p.base_uom, p.sellable,
             p.clave_prod_serv, p.clave_unidad, p.objeto_impuesto, p.tasa_iva, p.category_id,
             (SELECT TOP 1 namee FROM dbo.CAT_categories c WHERE c.id = p.category_id) AS categoria
        FROM dbo.products p WHERE p.id = @id AND p.active = 1;`, [id(pid)]),
    cliente: async (cid) => uno(`SELECT id, customerName AS nombre, phone, mobile, email, credit_limit, birthdate FROM dbo.customers WHERE id = @id;`, [id(cid)]),
    proveedor: async (pid) => uno(`SELECT id, nombre, telefono, correo, contacto, rfc FROM dbo.CAT_suppliers WHERE id = @id;`, [id(pid)]),
    ir: (texto, ruta, extra = {}) => msg(texto, { ruta, ...extra }),
    pool,
    /** Un procedimiento con sus varios resultados (cabecera + renglones). */
    sp: async (nombre, entradas = []) => {
      const req = (await pool()).request();
      for (const [n, t, v] of entradas) req.input(n, t, v);
      return (await req.execute(nombre)).recordsets || [];
    },
    /** La configuración de ESTE equipo (device-config) y su caja: la misma que usan Venta y Corte. */
    equipo: () => { try { return equipo() || {}; } catch { return {}; } },
    cajaEquipo: () => { try { return Number(equipo()?.register?.id) || null; } catch { return null; } },
    cotizarCuenta: (lineas) => cotizarCuenta(lineas),
    whatsappConfig: async () => { try { return await whatsappConfig(); } catch { return null; } },
    /** Sin acentos, minúsculas y espacios simples: para comparar nombres dichos. */
    llano: (s) => require('../lenguaje/edicion').llano(String(s || '')).replace(/\s+/g, ' ').trim(),
  };

  /**
   * El precio que cobraría Venta por esta cuenta: el mismo motor comercial
   * que `commercial:quote` (lista por canal, promociones, combos), sin cupón
   * ni club y sin guardar una cotización. Sin política activa, precio de lista.
   */
  async function cotizarCuenta(lineas) {
    const deLista = async () => {
      const filas = await q(`SELECT id, price FROM dbo.products WHERE id IN (${lineas.map((l) => Number(l.productId) || 0).join(',') || 0});`);
      const ls = lineas.map((l) => ({ unitPrice: Number(filas.find((f) => f.id === Number(l.productId))?.price || 0), oferta: null }));
      return { total: Math.round(ls.reduce((a, x, i) => a + x.unitPrice * Number(lineas[i].cantidad), 0) * 100) / 100, lineas: ls };
    };
    try {
      const servicio = require('../../comercial/servicio.cjs');
      const { cotizar } = require('../../comercial/motor.cjs');
      const p = await pool();
      const { policy, catalog, ids } = await servicio.catalogo(p);
      const activa = (policy.prices || []).some((x) => x.channel === 'LOCAL') || (policy.promotions || []).some((x) => x.active);
      if (!activa) return deLista();
      const products = catalog.products.filter((x) => x.sellable && x.active);
      const reloj = (await p.request().query("SELECT CONVERT(VARCHAR(10),GETDATE(),23) date,CONVERT(VARCHAR(5),GETDATE(),108) time,DATEDIFF(day,'19000107',CONVERT(date,GETDATE()))%7 weekday")).recordset[0];
      const input = lineas.map((l, i) => ({ key: String(i + 1), product: ids.find((x) => x.id === Number(l.productId))?.uuid,
                                            quantity: Number(l.cantidad).toFixed(2), extras: '0.00' }));
      if (input.some((x) => !x.product || !products.some((y) => y.uuid === x.product))) return deLista();
      const r = cotizar(policy, products.map((x) => ({ id: x.uuid, price: x.price, category: x.category_uuid })), input,
                        { ...reloj, channel: 'LOCAL', audiences: [] });
      const ls = input.map((x, i) => {
        const partes = r.lines.filter((l) => l.source === x.key);
        const importe = partes.reduce((a, l) => a + Number(l.unitPrice) * Number(l.quantity), 0);
        return { unitPrice: Number(lineas[i].cantidad) > 0 ? importe / Number(lineas[i].cantidad) : 0,
                 oferta: partes.find((l) => Number(l.discount) > 0)?.ruleName || null };
      });
      return { total: Math.round(ls.reduce((a, x, i) => a + x.unitPrice * Number(lineas[i].cantidad), 0) * 100) / 100, lineas: ls };
    } catch {
      return deLista();
    }
  }

  h.resumen = require('./resumen')(h);
  const RESPONDER = {};
  for (const area of AREAS) Object.assign(RESPONDER, require(`./${area}`)(h));
  for (const i of INTENTS) if (!RESPONDER[i.id]) throw new Error(`Falta la respuesta de ${i.id}`);
  const cubo = RESPONDER._cubo;
  delete RESPONDER._cubo;

  /**
   * Responde una interpretación ya completa (sin datos faltantes).
   * @param ctx { puede(paquete), userId, hallazgoId? }
   */
  async function responder(interp, ctx) {
    if (interp.falta) return preguntar(interp);
    const fn = RESPONDER[interp.intent];
    if (!fn) return msg('Todavía no sé hacer eso.');
    const def = porId(interp.intent);
    /* Las consultas con permiso se cortan aquí (las acciones las corta el canal). */
    if (def?.tipo === 'consulta' && def.permiso) {
      const no = h.sinPermiso(ctx, def.permiso, 'esa información');
      if (no) return { intent: interp.intent, ...no };
    }
    /* Una consulta de venta con filtros combinados («los sábados después de
       las 6 en tarjeta») no la contesta su SQL fijo: la arma el cubo. */
    const r = def?.analitica && hayFiltros(interp.slots.filtros) ? await cubo(def, interp, ctx) : await fn(interp, ctx);
    return { intent: interp.intent, ...r };
  }

  return { responder, preguntar, MOTIVOS, METODOS, INTENTS };
}

module.exports = { crearAcciones };
