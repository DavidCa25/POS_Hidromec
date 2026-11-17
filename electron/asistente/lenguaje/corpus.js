'use strict';
/**
 * EL CORPUS DE FÁBRICA, en dos partes:
 *
 *   1. FRASES COMPLETAS (lenguaje/frases/*.txt): escritas a mano, como las
 *      dice la gente en un mostrador, con jerga y sin ortografía. Son el
 *      grueso del entrenamiento. Formato:
 *
 *          @ consulta.existencia
 *          cuántas [cocas de 600] me quedan
 *          {doña mary} abonó 200
 *
 *      [entre corchetes] el producto, {entre llaves} la persona (cliente,
 *      proveedor o profesional). El resto se normaliza como cualquier texto.
 *
 *   2. PLANTILLAS de intents/*.js, multiplicadas con muletillas: cubren lo
 *      básico de cada intent aunque todavía tenga pocas frases.
 *
 * Determinista: el mismo corpus da el mismo modelo en todas las cajas.
 * `apartadas` separa 1 de cada 5 frases (por su texto, no al azar) para
 * medir con frases que el modelo nunca vio.
 */
const fs = require('fs');
const path = require('path');
const { INTENTS, porId } = require('./intents');
const { normalizar } = require('./normalizar');
const { indicesNumericos, marcar, tipoPersonaDe } = require('./marcas');
const TIPOS_CORTOS = { cli: 'cliente', cliente: 'cliente', prov: 'proveedor', proveedor: 'proveedor', pro: 'profesional', profesional: 'profesional' };

function prng(semilla = 7) {
  let s = semilla >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const elegir = (r, xs) => xs[Math.floor(r() * xs.length)];

const FECHAS = ['hoy', 'manana', 'para manana', 'el viernes', 'el sabado', 'pasado manana', ''];
const PERIODOS = ['hoy', 'ayer', 'esta semana', 'este mes', 'la semana pasada', 'el mes pasado', ''];
const HORAS = ['a las 5', 'a las 10 de la manana', 'a las 4 y media', 'a las 6 pm', 'a las 11'];
const UNIDADES_N = ['', '', 'piezas', 'pzas', 'kilos', 'litros'];
const NUEVOS = ['pay de queso', 'agua de jamaica', 'torta de jamon', 'galleta de avena', 'cafe de olla', 'chilaquiles',
                'garrafon 20 litros', 'aceite 5w30', 'cuaderno profesional', 'shampoo', 'frappe de moka', 'pan de muerto',
                'distribuidora lopez', 'juan perez', 'maria gonzalez', 'abarrotes el sol'];
const ANTES = ['', '', '', 'oye ', 'wybix ', 'por favor ', 'oye wybix ', 'ayudame a '];
const DESPUES = ['', '', '', ' por favor', ' porfa', ' ahorita'];

/** Una plantilla → tokens marcados. */
function tokensDe(plantilla, r, def = null) {
  const out = [];
  for (const parte of plantilla.split(' ')) {
    if (parte === '{prod}') out.push('<prod>');
    else if (parte === '{persona}') out.push(`<${tipoPersonaDe(def, out[out.length - 1] === 'con')}>`);
    else if (parte === '{n}') { out.push('<num>'); const u = elegir(r, UNIDADES_N); if (u) out.push(...normalizar(u).tokens); }
    else if (parte === '{precio}' || parte === '{monto}') out.push('<dinero>');
    else if (parte === '{folio}' || parte === '{mesa}') out.push('<num>');
    else if (parte === '{hora}') out.push(...normalizar(elegir(r, HORAS)).tokens.map((t) => (/^\d/.test(t) ? '<num>' : t)));
    else if (parte === '{fecha}') { const f = elegir(r, FECHAS); if (f) out.push(...normalizar(f).tokens); }
    else if (parte === '{periodo}') { const f = elegir(r, PERIODOS); if (f) out.push(...normalizar(f).tokens); }
    else if (parte === '{nuevo}') out.push(...normalizar(elegir(r, NUEVOS)).tokens);
    else out.push(...normalizar(parte).tokens);
  }
  return out;
}

/* ------------------------------------------------------------ las frases */
const DIR_FRASES = path.join(__dirname, 'frases');

/**
 * Una frase anotada → { texto (limpio, como lo escribiría la persona),
 * tokens (marcados), productos [], personas [] }.
 */
function marcarFrase(linea, def = null) {
  const partes = [];
  const re = /\[([^\]]+)\]|\{([^}]+)\}/g;
  let m, desde = 0;
  while ((m = re.exec(linea))) {
    if (m.index > desde) partes.push({ t: 'txt', s: linea.slice(desde, m.index) });
    if (m[1] != null) partes.push({ t: 'prod', s: m[1] });
    else {
      /* {pedro:pro} fija el tipo; sin él, lo decide el intent. */
      const [nombre, tipo] = m[2].split(':');
      partes.push({ t: 'persona', s: nombre, tipo: TIPOS_CORTOS[(tipo || '').trim()] || null });
    }
    desde = re.lastIndex;
  }
  if (desde < linea.length) partes.push({ t: 'txt', s: linea.slice(desde) });
  const tokens = [], prodIdx = new Set(), personaIdx = new Set(), personaTipo = new Map();
  for (const p of partes) {
    const ts = normalizar(p.s).tokens;
    const tipo = p.t === 'persona' ? (p.tipo || tipoPersonaDe(def, tokens[tokens.length - 1] === 'con')) : null;
    for (const t of ts) {
      if (p.t === 'prod') prodIdx.add(tokens.length);
      if (p.t === 'persona') { personaIdx.add(tokens.length); personaTipo.set(tokens.length, tipo); }
      tokens.push(t);
    }
  }
  const { dineroIdx, numIdx } = indicesNumericos(tokens);
  for (const i of [...prodIdx, ...personaIdx]) { dineroIdx.delete(i); numIdx.delete(i); }
  return {
    texto: partes.map((p) => p.s).join('').replace(/\s+/g, ' ').trim(),
    tokens: marcar(tokens, { dineroIdx, numIdx, prodIdx, personaIdx, personaTipo }),
    productos: partes.filter((p) => p.t === 'prod').map((p) => p.s.trim()),
    personas: partes.filter((p) => p.t === 'persona').map((p) => p.s.trim()),
  };
}

/** Hash estable de un texto (FNV-1a): decide qué frases se apartan. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

let cacheFrases = null;
/** Todas las frases de fábrica: [{ intent, archivo, texto, tokens, productos, personas, apartada }]. */
function frases() {
  if (cacheFrases) return cacheFrases;
  const out = [];
  const vistas = new Map();
  const archivos = fs.existsSync(DIR_FRASES) ? fs.readdirSync(DIR_FRASES).filter((f) => f.endsWith('.txt')).sort() : [];
  for (const archivo of archivos) {
    let intent = null;
    const lineas = fs.readFileSync(path.join(DIR_FRASES, archivo), 'utf8').split(/\r?\n/);
    lineas.forEach((l, n) => {
      const s = l.trim();
      if (!s || s.startsWith('#')) return;
      if (s.startsWith('@')) {
        intent = s.slice(1).trim();
        if (!porId(intent)) throw new Error(`${archivo}:${n + 1}: intent desconocido «${intent}»`);
        return;
      }
      if (!intent) throw new Error(`${archivo}:${n + 1}: frase sin «@ intent» antes`);
      const f = marcarFrase(s, porId(intent));
      /* La misma frase dos veces no suma: se queda la primera. Si dos intents
         reclaman la misma frase, es un error del corpus. */
      const clave = normalizar(f.texto).texto;
      const ya = vistas.get(clave);
      if (ya) {
        if (ya !== intent) throw new Error(`${archivo}:${n + 1}: «${f.texto}» ya está en ${ya}`);
        return;
      }
      vistas.set(clave, intent);
      out.push({ intent, archivo, ...f, apartada: hash(f.texto.toLowerCase()) % 5 === 0 });
    });
  }
  cacheFrases = out;
  return out;
}

/**
 * Ejemplos de entrenamiento: [{ tokens, intent }].
 * @param o.sinApartadas  deja fuera 1 de cada 5 frases (para medir con ellas)
 */
function generar({ semilla = 7, porPlantilla = 4, sinApartadas = false } = {}) {
  const r = prng(semilla);
  const out = [];
  for (const it of INTENTS) {
    for (const p of it.ejemplos || []) {
      for (let k = 0; k < porPlantilla; k++) {
        const pre = elegir(r, ANTES), post = elegir(r, DESPUES);
        out.push({ intent: it.id, tokens: [...normalizar(pre).tokens, ...tokensDe(p, r, it), ...normalizar(post).tokens] });
      }
    }
  }
  /* Las frases completas pesan el doble que una plantilla. */
  for (const f of frases()) {
    if (sinApartadas && f.apartada) continue;
    out.push({ intent: f.intent, tokens: f.tokens }, { intent: f.intent, tokens: f.tokens });
  }
  return out;
}

module.exports = { generar, tokensDe, frases, marcarFrase };
