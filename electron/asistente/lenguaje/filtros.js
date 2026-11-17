'use strict';
/**
 * FILTROS DE UNA PREGUNTA: lo que acota una consulta y se puede combinar.
 *
 *   «los sábados», «entre semana», «fines de semana»       → diasSemana
 *   «después de las 6», «entre 2 y 4», «en la mañana»       → horaDesde / horaHasta
 *   «en tarjeta», «con transferencia», «de fiado»           → metodo
 *   «de refrescos», «la panadería» (categorías del negocio) → categoria
 *   «lo que cobró Ana», «la cajera Lupita»                  → cajero
 *   «en octubre», «del 1 al 15», «los últimos 10 días»      → rango (fechas)
 *
 * «El sábado» (singular) NO es filtro: es una fecha («¿cuánto vendo el
 * sábado?»). «Los sábados» sí.
 *
 * Devuelve también las palabras que usó: así «¿y los domingos?» se reconoce
 * como «la misma pregunta con otro dato».
 */
const { raiz } = require('./normalizar');
const { MESES, DIAS, DIAS_PLURAL, iso, mas, dia0 } = require('../analitica/periodos');

const DIA_N = { domingo: 0, domingos: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, sabados: 6 };
const MES_N = Object.fromEntries(MESES.map((m, i) => [m, i]));
const METODO = { efectivo: 'EFECTIVO', tarjeta: 'TARJETA', tarjetas: 'TARJETA', terminal: 'TARJETA', transferencia: 'TRANSFERENCIA',
                 transferencias: 'TRANSFERENCIA', credito: 'CREDITO', fiado: 'CREDITO', vales: 'VALES' };

/** Hora dicha → hora del día. Sin «am/pm», de 1 a 7 es de la tarde (horario de negocio). */
function horaDe(n, sufijo = '') {
  let h = Number(n);
  if (!(h >= 0 && h <= 24)) return null;
  if (/pm|tarde|noche/.test(sufijo) && h < 12) h += 12;
  else if (/am|manana/.test(sufijo)) { if (h === 12) h = 0; }
  else if (h >= 1 && h <= 7) h += 12;
  return h;
}
const SUF = '(?:\\s*(am|pm|de la manana|de la tarde|de la noche|hrs|horas))?';
const hTexto = (h) => (h === 0 || h === 24 ? '12 am' : h === 12 ? '12 pm' : h > 12 ? `${h - 12} pm` : `${h} am`);

/**
 * @param norm  texto normalizado (sin acentos, números con dígitos)
 * @param o { categorias: [{id, nombre}], usuarios: [{id, nombre}], ahora }
 * @returns { valor: {…}, texto, confianza, usados: Set<string> } | null
 */
function filtros(norm, { categorias = [], usuarios = [], ahora = new Date() } = {}) {
  const v = {};
  const partes = [];
  const usados = new Set();
  const usar = (m) => { for (const w of String(m).split(' ')) if (w) usados.add(w); };

  /* Días de la semana. */
  const dias = new Set();
  let m;
  if ((m = norm.match(/\bentre semana\b/))) { [1, 2, 3, 4, 5].forEach((d) => dias.add(d)); partes.push('entre semana'); usar(m[0]); }
  if ((m = norm.match(/\b(?:los )?fin(?:es)? de semana\b/))) { dias.add(0); dias.add(6); partes.push('en fin de semana'); usar(m[0]); }
  const reDias = /\blos ((?:(?:domingos|lunes|martes|miercoles|jueves|viernes|sabados)(?:,? (?:y |o )?(?:los )?)?)+)/g;
  while ((m = reDias.exec(norm))) {
    const ds = m[1].split(/[ ,]+/).filter((w) => w in DIA_N);
    if (!ds.length) continue;
    for (const d of ds) dias.add(DIA_N[d]);
    partes.push(`los ${ds.map((d) => DIAS_PLURAL[DIA_N[d]]).join(' y ')}`);
    usar(m[0]);
  }
  /* «sábados y domingos» sin «los»: solo los plurales que no se confunden con una fecha. */
  for (const d of ['sabados', 'domingos']) if (!usados.has(d) && new RegExp(`\\b${d}\\b`).test(norm)) { dias.add(DIA_N[d]); partes.push(DIAS_PLURAL[DIA_N[d]]); usar(d); }
  if (dias.size && dias.size < 7) v.diasSemana = [...dias].sort();

  /* Horas. */
  if ((m = norm.match(new RegExp(`\\bentre (?:las |la )?(\\d{1,2})${SUF} y (?:las |la )?(\\d{1,2})${SUF}`)))) {
    const a = horaDe(m[1], m[2] || m[4] || ''), b = horaDe(m[3], m[4] || '');
    if (a != null && b != null && b > a) { v.horaDesde = a; v.horaHasta = b; partes.push(`de ${hTexto(a)} a ${hTexto(b)}`); usar(m[0]); }
  }
  if (v.horaDesde == null && (m = norm.match(new RegExp(`\\b(?:despues de|a partir de|desde) (?:las |la )?(\\d{1,2})${SUF}`)))) {
    const a = horaDe(m[1], m[2] || '');
    if (a != null && a < 24) { v.horaDesde = a; partes.push(`después de las ${hTexto(a)}`); usar(m[0]); }
  }
  if (v.horaHasta == null && (m = norm.match(new RegExp(`\\bantes de (?:las |la )?(\\d{1,2})${SUF}`)))) {
    const b = horaDe(m[1], m[2] || '');
    if (b != null && b > 0) { v.horaHasta = b; partes.push(`antes de las ${hTexto(b)}`); usar(m[0]); }
  }
  if (v.horaDesde == null && v.horaHasta == null) {
    const FRANJAS = [
      [/\b(?:en|por|durante) (?:la|las) mananas?\b|\btemprano\b/, 6, 12, 'en la mañana'],
      [/\b(?:al|a|en el) mediodia\b|\bhora de (?:la )?comida\b/, 12, 16, 'a mediodía'],
      [/\b(?:en|por|durante) (?:la|las) tardes?\b/, 12, 19, 'en la tarde'],
      [/\b(?:en|por|durante) (?:la|las) noches?\b/, 19, 24, 'en la noche'],
    ];
    for (const [re, a, b, t] of FRANJAS) if ((m = norm.match(re))) { v.horaDesde = a; v.horaHasta = b; partes.push(t); usar(m[0]); break; }
  }

  /* Forma de pago: solo con preposición («en tarjeta»), para no confundir «la tarjeta de puntos». */
  if ((m = norm.match(/\b(?:en|con|por|de|pagad[oa]s? (?:en|con)|que pagaron (?:en|con)) (efectivo|tarjetas?|terminal|transferencias?|credito|fiado|vales)\b/))) {
    v.metodo = METODO[m[1]];
    partes.push({ EFECTIVO: 'en efectivo', TARJETA: 'con tarjeta', TRANSFERENCIA: 'por transferencia', CREDITO: 'a crédito', VALES: 'con vales' }[v.metodo]);
    usar(m[0]);
  }

  /* Categoría: todas las palabras de su nombre, en la frase. Gana la más larga. */
  if (categorias.length) {
    const ws = new Set(norm.split(' ').map(raiz));
    const cs = categorias
      .map((c) => ({ c, t: String(c.nombre || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2).map(raiz) }))
      .filter((x) => x.t.length && x.t.every((w) => ws.has(w)))
      .sort((a, b) => b.t.length - a.t.length);
    if (cs[0]) {
      v.categoria = { id: cs[0].c.id, nombre: cs[0].c.nombre };
      partes.push(cs[0].c.nombre);
      for (const w of norm.split(' ')) if (cs[0].t.includes(raiz(w))) usados.add(w);
    }
  }

  /* Cajero: solo después de «cobró», «vendió», «atendió», «cajero/a», «turno de». */
  if (usuarios.length && (m = norm.match(/\b(?:cobro|cobraron|vendio|atendio|cajer[oa]|turno de|lo que hizo)\s+(?:el |la )?([a-z]+)/))) {
    const u = usuarios.find((x) => String(x.nombre).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/)[0] === m[1]);
    if (u) { v.cajero = { id: u.id, nombre: u.nombre }; partes.push(`de ${u.nombre}`); usar(m[0]); }
  }

  /* Rango de fechas. */
  const r = rangoDicho(norm, ahora);
  if (r) { v.rango = r.rango; partes.push(r.rango.nombreCorto); usar(r.texto); }

  if (!Object.keys(v).length) return null;
  return { valor: v, texto: partes.join(' · '), confianza: 'exacto', usados };
}

/** «en octubre», «del 1 al 15 de octubre», «los últimos 10 días», «el año pasado», «antier». */
function rangoDicho(norm, ahora) {
  const hoy = dia0(ahora);
  let m;
  const rango = (desde, hasta, nombre, extra = {}) => ({ desde: iso(desde), hasta: iso(hasta), nombre, nombreCorto: nombre.replace(/^(En|El|La|Los) /, (x) => x.toLowerCase()),
                                                         de: `de ${nombre.replace(/^(En|El|La|Los) /i, '').toLowerCase()}`, ...extra });
  const anioDe = (mes, dicho) => {
    if (dicho === 'ano pasado' || dicho === 'anio pasado') return hoy.getFullYear() - 1;
    if (/^\d{4}$/.test(dicho || '')) return Number(dicho);
    return mes > hoy.getMonth() ? hoy.getFullYear() - 1 : hoy.getFullYear();
  };
  const MES = MESES.join('|');
  if ((m = norm.match(new RegExp(`\\bdel? (\\d{1,2}) al (\\d{1,2})(?: de (${MES}))?(?: (?:de|del) (\\d{4}|ano pasado))?\\b`)))) {
    const mes = m[3] ? MES_N[m[3]] : hoy.getMonth();
    const y = anioDe(mes, m[4]);
    const a = Number(m[1]), b = Number(m[2]);
    if (a >= 1 && b >= a && b <= 31) {
      return { texto: m[0], rango: rango(new Date(y, mes, a), new Date(y, mes, b + 1), `Del ${a} al ${b} de ${MESES[mes]}`) };
    }
  }
  if ((m = norm.match(new RegExp(`\\bel (\\d{1,2}) de (${MES})(?: (?:de|del) (\\d{4}|ano pasado))?\\b`)))) {
    const mes = MES_N[m[2]], y = anioDe(mes, m[3]), d = Number(m[1]);
    if (d >= 1 && d <= 31) return { texto: m[0], rango: rango(new Date(y, mes, d), new Date(y, mes, d + 1), `El ${d} de ${MESES[mes]}`) };
  }
  if ((m = norm.match(new RegExp(`\\b(?:en|de|durante|todo|el mes de|para) (?:el mes de |todo )?(${MES})(?: (?:de|del) (\\d{4}|ano pasado))?\\b`)))) {
    const mes = MES_N[m[1]], y = anioDe(mes, m[2]);
    const desde = new Date(y, mes, 1);
    const fin = new Date(y, mes + 1, 1);
    const hasta = fin > hoy ? mas(hoy, 1) : fin;
    return { texto: m[0], rango: rango(desde, hasta, `En ${MESES[mes]}${y !== hoy.getFullYear() ? ` de ${y}` : ''}`, { mes: true }) };
  }
  if ((m = norm.match(/\b(?:los )?ultimos (\d{1,3}) dias\b/))) {
    const n = Math.min(365, Math.max(1, Number(m[1])));
    return { texto: m[0], rango: rango(mas(hoy, -(n - 1)), mas(hoy, 1), `En los últimos ${n} días`) };
  }
  if ((m = norm.match(/\b(?:el )?(?:ano|anio) pasado\b/))) {
    const y = hoy.getFullYear() - 1;
    return { texto: m[0], rango: rango(new Date(y, 0, 1), new Date(y + 1, 0, 1), `En ${y}`) };
  }
  if ((m = norm.match(/\b(?:antier|anteayer|antes de ayer)\b/))) {
    return { texto: m[0], rango: rango(mas(hoy, -2), mas(hoy, -1), `Antier (${DIAS[mas(hoy, -2).getDay()]})`) };
  }
  return null;
}

/** Los filtros (sin el rango de fechas) dichos para una respuesta: «los sábados, después de las 6 pm, con tarjeta». */
function describir(v = {}) {
  const out = [];
  if (v.diasSemana) {
    const d = v.diasSemana;
    if (d.length === 5 && [1, 2, 3, 4, 5].every((x) => d.includes(x))) out.push('entre semana');
    else if (d.length === 2 && d.includes(0) && d.includes(6)) out.push('en fin de semana');
    else out.push(`los ${d.map((x) => DIAS_PLURAL[x]).join(' y ')}`);
  }
  if (v.horaDesde != null && v.horaHasta != null) out.push(`de ${hTexto(v.horaDesde)} a ${hTexto(v.horaHasta)}`);
  else if (v.horaDesde != null) out.push(`después de las ${hTexto(v.horaDesde)}`);
  else if (v.horaHasta != null) out.push(`antes de las ${hTexto(v.horaHasta)}`);
  if (v.metodo) out.push({ EFECTIVO: 'en efectivo', TARJETA: 'con tarjeta', TRANSFERENCIA: 'por transferencia', CREDITO: 'a crédito', VALES: 'con vales' }[v.metodo]);
  if (v.categoria) out.push(`de ${v.categoria.nombre}`);
  if (v.cajero) out.push(`de ${v.cajero.nombre}`);
  return out.join(', ');
}

/** ¿Trae algo más que el periodo de siempre? */
const hayFiltros = (f) => !!(f && f.valor && Object.keys(f.valor).length);

/** Filtros dichos → filtros del cubo (sin fechas). */
function aCubo(valor = {}, extra = {}) {
  const f = {};
  if (valor.diasSemana) f.diasSemana = valor.diasSemana;
  if (valor.horaDesde != null) f.horaDesde = valor.horaDesde;
  if (valor.horaHasta != null) f.horaHasta = valor.horaHasta;
  if (valor.metodo) f.metodo = valor.metodo;
  if (valor.categoria) f.categorias = [valor.categoria.id];
  if (valor.cajero) f.cajero = valor.cajero.id;
  if (extra.producto) f.productos = [extra.producto];
  if (extra.cliente) f.cliente = extra.cliente;
  return f;
}

module.exports = { filtros, rangoDicho, hayFiltros, aCubo, horaDe, describir, hTexto };
