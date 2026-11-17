'use strict';
/**
 * PRONÓSTICOS sin IA: lo que pasó los mismos días de la semana, con más peso
 * a lo reciente y corregido por la tendencia del último mes.
 *
 *   pronosticoDia   cuánto se espera vender (o cuántas piezas) un día dado
 *   agotamiento     en cuántos días se acaba una existencia al ritmo de venta
 *
 * Funciones puras: reciben la serie diaria (días sin venta = 0) y la fecha.
 * Dicen qué tan confiable es: con menos de 4 semanas de historia, «poca».
 */
const { iso, deIso, mas } = require('./periodos');

/** Serie {dia: valor} completa desde `desde` hasta `hasta` (exclusiva), con ceros. */
function rellenar(filas, desde, hasta) {
  const m = new Map(filas.map((f) => [String(f.dia).slice(0, 10), Number(f.valor) || 0]));
  const out = [];
  for (let d = deIso(desde); d < deIso(hasta); d = mas(d, 1)) out.push({ dia: iso(d), dow: d.getDay(), valor: m.get(iso(d)) || 0 });
  return out;
}

const pctil = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };

/**
 * Tendencia: últimos 28 días contra los 28 anteriores, a medias y acotada
 * (±20 %): un mes bueno no hace que se espere el doble.
 */
function tendencia(serie) {
  if (serie.length < 56) return 1;
  const ult = serie.slice(-28).reduce((a, x) => a + x.valor, 0);
  const prev = serie.slice(-56, -28).reduce((a, x) => a + x.valor, 0);
  if (prev <= 0) return 1;
  const r = 1 + (ult / prev - 1) / 2;
  return Math.min(1.2, Math.max(0.8, r));
}

/**
 * @param serie  [{dia, dow, valor}] de las últimas 8 semanas (rellenar)
 * @param fecha  'AAAA-MM-DD'
 * @returns { estimado, bajo, alto, semanas, confianza: 'buena' | 'poca' | 'ninguna', tendencia }
 */
function pronosticoDia(serie, fecha) {
  const dow = deIso(fecha).getDay();
  const mismos = serie.filter((x) => x.dow === dow && x.dia < fecha).slice(-8);
  /* Un día en cero entre días con venta es un cierre (o la caja no abrió):
     no cuenta como «se vendió cero». */
  const conVenta = mismos.filter((x) => x.valor > 0);
  if (!conVenta.length) return { estimado: 0, bajo: 0, alto: 0, semanas: 0, confianza: 'ninguna', tendencia: 1 };
  const pesos = conVenta.map((_, i) => i + 1);
  const prom = conVenta.reduce((a, x, i) => a + x.valor * pesos[i], 0) / pesos.reduce((a, b) => a + b, 0);
  const t = tendencia(serie);
  const vals = conVenta.map((x) => x.valor);
  return { estimado: prom * t, bajo: pctil(vals, 0.25) * t, alto: pctil(vals, 0.75) * t, semanas: conVenta.length,
           confianza: conVenta.length >= 4 ? 'buena' : 'poca', tendencia: t };
}

/**
 * ¿Cuándo se acaba? Se avanza día por día con lo que se vende cada día de la
 * semana (promedio de las últimas 4 semanas), hasta 60 días.
 *
 * @param existencia  lo que hay hoy
 * @param serie       piezas vendidas por día, últimos 28 días (rellenar)
 * @param hoy         'AAAA-MM-DD'
 * @returns { dias, fecha, porDia, sinVenta } — dias = null si alcanza más de 60 días
 */
function agotamiento(existencia, serie, hoy) {
  const porDow = Array.from({ length: 7 }, (_, d) => {
    const xs = serie.filter((x) => x.dow === d).map((x) => x.valor);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  });
  const porDia = porDow.reduce((a, b) => a + b, 0) / 7;
  if (porDia <= 0) return { dias: null, fecha: null, porDia: 0, sinVenta: true };
  if (existencia <= 0) return { dias: 0, fecha: hoy, porDia, sinVenta: false };
  let queda = existencia;
  for (let i = 0; i < 60; i++) {
    const d = mas(deIso(hoy), i);
    queda -= porDow[d.getDay()];
    if (queda <= 0) return { dias: i, fecha: iso(d), porDia, sinVenta: false };
  }
  return { dias: null, fecha: null, porDia, sinVenta: false };
}

module.exports = { pronosticoDia, agotamiento, rellenar, tendencia };
