/**
 * SOCIOS Y PROPINAS HABLADOS (reglas, no clasificador)
 *
 *   «Juan retiró 500 de la caja», «Juan aportó 2,000», «le pagué 1,000 a Juan por transferencia»
 *   «la compra 45 la pagó Juan», «el gasto 12 es de Juan», «el gasto 12 lo pagó Juan»
 *   «liquida a los socios», «cierra el periodo de socios hasta ayer»
 *   «reparte las propinas»
 *
 * El nombre del socio va como texto: quién es lo decide la respuesta con la
 * lista de socios activos (no están en el catálogo de personas).
 */
'use strict';

const { llano } = require('./edicion');

const num = (s) => { const m = String(s || '').replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : null; };
const metodo = (t) => (/\btransferencia|transferi|spei|deposito\b/.test(t) ? 'TRANSFERENCIA' : /\b(efectivo|caja|cajon)\b/.test(t) ? 'EFECTIVO' : null);
const quitaArticulos = (s) => String(s || '').replace(/\b(?:el|la|los|las|al|a|socio|socia|de|del)\b/g, ' ').replace(/\s+/g, ' ').trim();

/** @returns null o { intent, ...datos } */
function socios(texto) {
  const raw = String(texto || '').trim().replace(/[¿?¡!]+/g, '');
  const t = llano(raw);
  if (!t || /^(?:cuanto|cuanta|que|quien|cual|como|dime)\b/.test(t)) return null;

  if (/\b(?:reparte|repartir|repartamos|reparto de|paga|pagar|paguemos)\s+(?:las\s+|la\s+)?propinas?\b/.test(t)) return { intent: 'propinas.repartir' };

  if (/\b(?:liquida|liquidar|liquidame|cierra|cerrar)\b.*\b(?:socios|periodo de socios|cuentas de socios)\b/.test(t)) {
    return { intent: 'socio.liquidar', hasta: /\bhoy\b/.test(t) ? 'hoy' : 'ayer' };
  }

  /* «la compra 45 la pagó Juan», «el gasto 12 lo pagó Juan», «el gasto 12 es de Juan». */
  let m = t.match(/\b(compra|gasto)\s+(?:numero\s+|folio\s+|#\s*)?(\d+)\s+(?:la|lo)\s+(?:pago|puso|cubrio)\s+(.+)$/);
  if (m) return { intent: m[1] === 'compra' ? 'socio.compra' : 'socio.gasto', folio: Number(m[2]), socio: quitaArticulos(m[3]), pago: true };
  m = t.match(/\bgasto\s+(?:numero\s+|folio\s+|#\s*)?(\d+)\s+(?:es|va|corre)\s+(?:a cargo\s+)?de\s+(.+)$/);
  if (m) return { intent: 'socio.gasto', folio: Number(m[1]), socio: quitaArticulos(m[2]), pago: false };

  /* «le pagué 1,000 a Juan», «pago a socio Juan de 1000». */
  m = t.match(/^(?:le\s+)?(?:pague|pagamos|pagale|paga)\s+\$?([\d.,]+)\s*(?:pesos\s+)?(?:al?\s+socio\s+|a la socia\s+|a\s+)(.+?)(?:\s+(?:por|en|con)\s+(?:transferencia|efectivo|spei|deposito).*)?$/);
  if (m && /\bsoci[oa]\b/.test(t) || (m && /^le\s/.test(t))) return { intent: 'socio.movimiento', tipo: 'PAGO', monto: num(m[1]), socio: quitaArticulos(m[2]), metodo: metodo(t) };

  /* «Juan retiró 500 (de la caja)», «Juan aportó 2000», «retiro del socio Juan de 500». */
  m = t.match(/^(?:el socio\s+|la socia\s+)?(.+?)\s+(retiro|saco|se llevo|tomo|aporto|puso|metio|invirtio)\s+\$?([\d.,]+)/);
  if (m && !/\b(?:producto|piezas?|pzas?|kg|litros?)\b/.test(t)) {
    const tipo = /^(retiro|saco|se llevo|tomo)$/.test(m[2]) ? 'RETIRO' : 'APORTACION';
    return { intent: 'socio.movimiento', tipo, monto: num(m[3]), socio: quitaArticulos(m[1]), metodo: metodo(t) };
  }
  m = t.match(/^(retiro|aportacion)\s+(?:del?\s+)?(?:socio|socia)\s+(.+?)\s+(?:de|por)\s+\$?([\d.,]+)/);
  if (m) return { intent: 'socio.movimiento', tipo: m[1] === 'retiro' ? 'RETIRO' : 'APORTACION', monto: num(m[3]), socio: quitaArticulos(m[2]), metodo: metodo(t) };
  return null;
}

module.exports = { socios };
