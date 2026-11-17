'use strict';
/**
 * LA VOZ DE WYBIX: que no conteste siempre con la misma frase.
 *
 * Cada respuesta frecuente tiene varias formas de decirse. Cuál se usa sale
 * de un hash de (persona, clave, turno de la conversación): determinista
 * —la misma conversación da las mismas palabras, las pruebas no parpadean—
 * pero cambia de un mensaje a otro. Nada de Math.random.
 *
 *   di(clave, ctx, vars)   una variante con {variables} llenas
 *   saludo(ahora, nombre)  según la hora
 *   nombreDe(usuario)      el nombre de pila, si el usuario parece uno
 */

const FRASES = {
  'no.entendi': ['No te entendí bien. ¿Quisiste decir…?', 'Creo que no te entendí. ¿Es alguna de estas?', 'No te entendí del todo. ¿Alguna de estas?'],
  'no.entendi.nada': ['No te entendí. Prueba con alguno de estos:', 'Eso no lo entendí. Puedo ayudarte con cosas como estas:', 'No entendí eso. Prueba así:'],
  'cual': ['¿Qué quieres hacer?', '¿Cuál de estas?', '¿Me aclaras cuál?'],
  'listo': ['Listo: {titulo}.', 'Hecho: {titulo}.', 'Ya quedó: {titulo}.'],
  'cancelado': ['Cancelado. No cambié nada.', 'Va, no hice nada.', 'Sin cambios: lo dejé como estaba.'],
  'sin.ventas': ['{periodo} no hay ventas todavía.', '{periodo} todavía no se ha vendido nada.', 'Aún no hay ventas {de}.'],
  'ventas.total': ['{periodo} llevas {total} en {tickets}.', '{periodo} van {total} en {tickets}.', '{periodo}: {total} en {tickets}.'],
  'aprendi': ['Ya sé que «{alias}» es {nombre}.', 'Anotado: «{alias}» es {nombre}.', 'Aprendí que «{alias}» es {nombre}.'],
  'compuesto': ['Van las dos cosas:', 'Hago las dos:', 'Va, una por una:'],
};

/** FNV-1a: el mismo texto, el mismo número. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

function llenar(t, vars = {}) { return t.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')); }

/** Una variante de la frase `clave` (o de una lista dada). */
function di(clave, ctx = {}, vars = {}) {
  const xs = Array.isArray(clave) ? clave : FRASES[clave];
  if (!xs?.length) return '';
  const semilla = `${ctx.userId ?? 0}|${Array.isArray(clave) ? xs[0] : clave}|${ctx.turno ?? 0}`;
  return llenar(xs[hash(semilla) % xs.length], vars).replace(/\s+([.,:])/g, '$1').trim();
}

/** «Juan» de «juan», «jperez» → null (no parece nombre), «admin» → null. */
function nombreDe(usuario) {
  const u = String(usuario || '').trim().split(/[\s._-]+/)[0];
  if (!/^[a-záéíóúñ]{3,15}$/i.test(u) || /^(admin|administrador|cajero|caja|usuario|user|root|encargado|gerente|dueno|dueño|demo|prueba|test)$/i.test(u)) return null;
  return u[0].toUpperCase() + u.slice(1).toLowerCase();
}

function saludo(ahora = new Date(), nombre = null) {
  const h = ahora.getHours();
  const base = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  return nombre ? `${base}, ${nombre}.` : `¡${base}!`;
}

module.exports = { di, saludo, nombreDe, hash, FRASES };
