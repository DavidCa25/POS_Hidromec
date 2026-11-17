/**
 * PROMOCIONES HABLADAS (reglas, no clasificador) — commercial:save
 *
 *   «pon la coca a 15 los martes», «la coca a 15 de 5 a 7», «oferta: concha a 8 hoy»
 *   «10% de descuento en panadería los fines de semana», «descuento de 20% en el latte»
 *   «2x1 en conchas los miércoles», «lleva 3 paga 2 de donas»
 *   «quita la promoción de la coca», «apaga la promoción 2x1 en conchas»
 *
 * Sin día, horario, «hoy» o la palabra oferta/promoción, «pon la coca a 15»
 * sigue siendo cambiar el precio (producto.precio), no una promoción.
 */
'use strict';

const { llano } = require('./edicion');

const DIAS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const hhmm = (s, tarde) => {
  const m = String(s).match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  let h = Number(m[1]);
  if (tarde && h >= 1 && h <= 8) h += 12;
  return h > 23 ? null : `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
};

/** Cuándo: días, horario y fechas dichos. */
function cuando(t, ahora) {
  const r = {};
  if (/\bfines? de semana\b/.test(t)) r.weekdays = [6, 0];
  else if (/\bentre semana\b/.test(t)) r.weekdays = [1, 2, 3, 4, 5];
  else {
    const ds = Object.entries(DIAS).filter(([d]) => new RegExp(`\\b(?:los\\s+|el\\s+)?${d}s?\\b`).test(t)).map(([, n]) => n);
    if (ds.length) r.weekdays = ds;
  }
  const h = t.match(/\bde\s+(\d{1,2}(?::\d{2})?)\s+a\s+(\d{1,2}(?::\d{2})?)\b/);
  if (h) {
    /* «De 5 a 7» es de la tarde; «de 9 a 1», de la mañana a la tarde. */
    const a = parseInt(h[1], 10), b = parseInt(h[2], 10);
    const from = hhmm(h[1], b <= 8 && a <= b), to = hhmm(h[2], true);
    if (from && to) r.windows = [{ from, to }];
  }
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (/\bhoy\b/.test(t)) { r.starts = iso(ahora); r.ends = iso(ahora); }
  if (/\besta semana\b/.test(t)) { const f = new Date(ahora); f.setDate(f.getDate() + (7 - f.getDay()) % 7); r.starts = iso(ahora); r.ends = iso(f); }
  return r;
}
/** Quita del texto lo que es «cuándo», para que quede solo el producto o categoría. */
const sinCuando = (s) => s.replace(/\b(?:los|el)\s+(?:domingo|lunes|martes|miercoles|jueves|viernes|sabado)s?\b(?:\s*(?:,|y)\s*(?:los\s+|el\s+)?(?:domingo|lunes|martes|miercoles|jueves|viernes|sabado)s?)*/g, ' ')
  .replace(/\b(?:los\s+)?fines? de semana\b|\bentre semana\b|\bhoy\b|\besta semana\b|\bde\s+\d{1,2}(?::\d{2})?\s+a\s+\d{1,2}(?::\d{2})?\b/g, ' ')
  .replace(/\b(?:en\s+)?(?:oferta|promocion)\b/g, ' ').replace(/\s+/g, ' ').trim();

function promos(texto, ahora = new Date()) {
  const raw = String(texto || '').trim().replace(/[¿?¡!]+/g, '');
  const t = llano(raw).replace(/^(?:oferta|promocion)\s*:\s*/, 'oferta ');
  if (!t || /^(?:cuanto|cuantos|que|cual|como|dime|hay)\b/.test(t)) return null;
  const c = cuando(t, ahora);
  const conCuando = Object.keys(c).length > 0 || /\b(?:oferta|promocion)\b/.test(t);

  let m = t.match(/^(?:quita|quitar|apaga|termina|cancela|desactiva)\s+(?:la\s+)?(?:promocion|oferta)\s+(?:de\s+|del\s+|en\s+)?(.+)$/);
  if (m) return { intent: 'promo.quitar', texto: m[1].replace(/^(?:la|el|los|las)\s+/, '') };

  m = t.match(/^(\d)\s*x\s*(\d)\s+en\s+(.+)$/) || t.match(/^lleva\s+(\d)\s+paga\s+(\d)\s+(?:de|en)\s+(.+)$/);
  if (m && Number(m[2]) < Number(m[1])) return { intent: 'promo.crear', tipo: 'BUY_PAY', buy: Number(m[1]), pay: Number(m[2]), objetivo: sinCuando(m[3]), cuando: c };

  m = t.match(/^(?:un\s+)?(\d+(?:\.\d+)?)\s*(?:%|por ciento)\s+de\s+descuento\s+en\s+(.+)$/) || t.match(/^(?:pon\s+)?(?:un\s+)?descuento\s+de\s+(\d+(?:\.\d+)?)\s*(?:%|por ciento)\s+(?:en|a)\s+(.+)$/);
  if (m) return { intent: 'promo.crear', tipo: 'PERCENT', valor: Number(m[1]), objetivo: sinCuando(m[2]), cuando: c };

  m = t.match(/^(?:pon|deja|oferta)?\s*(?:la|el|los|las)?\s*(.+?)\s+a\s+\$?(\d+(?:\.\d+)?)\s*(?:pesos)?\b(.*)$/);
  if (m && conCuando) return { intent: 'promo.crear', tipo: 'PRICE', valor: Number(m[2]), objetivo: sinCuando(m[1]), cuando: c };
  return null;
}

module.exports = { promos };
