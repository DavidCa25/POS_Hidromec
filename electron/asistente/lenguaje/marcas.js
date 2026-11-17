'use strict';
/**
 * LAS MARCAS: cómo ve el clasificador una frase. Los datos concretos se
 * vuelven marcas para que «merma de 6 donas» y «merma de 3 conchas» sean la
 * misma frase:
 *
 *   <num>      una cantidad (y su unidad)
 *   <dinero>   un importe («$65», «65 pesos», «a 65» cuando es precio)
 *   <prod>     un producto del catálogo
 *   <persona>  un cliente, proveedor o profesional
 *
 * Lo usan el intérprete (con el catálogo real) y el corpus (con las frases
 * anotadas a mano), así que las dos marcan igual.
 */
const ex = require('./extractores');

/** Índices de dinero y de números de una frase ya normalizada. */
function indicesNumericos(tokens, { precioConPreposicion = true } = {}) {
  const dineroIdx = new Set(), numIdx = new Set();
  tokens.forEach((t, i) => {
    if (t.startsWith('$')) dineroIdx.add(i);
    if (t === 'pesos' && i > 0 && /^\d/.test(tokens[i - 1])) { dineroIdx.add(i); dineroIdx.add(i - 1); }
  });
  const cants = ex.cantidades(tokens).filter((c) => !dineroIdx.has(c.inicio));
  for (const c of cants) { numIdx.add(c.inicio); if (c.conUnidad) numIdx.add(c.inicio + 1); }
  const din = ex.dinero(tokens.join(' '), { conPreposicion: precioConPreposicion });
  if (din && din.confianza === 'probable') {
    const m = din.texto.match(/(\d+(?:\.\d+)?)$/);
    const i = m ? tokens.lastIndexOf(m[1]) : -1;
    if (i >= 0) { dineroIdx.add(i); numIdx.delete(i); }
  }
  return { dineroIdx, numIdx, cants, din };
}

/**
 * Tokens con marcas. Un producto o una persona de varias palabras es UNA marca.
 * La persona sale con su tipo cuando se sabe (<cliente>, <proveedor>,
 * <profesional>): «cuánto me debe <cliente>» es fiado y «cuánto le debo a
 * <proveedor>» es una cuenta por pagar, aunque las palabras se parezcan.
 */
function marcar(tokens, { dineroIdx, numIdx, prodIdx = new Set(), personaIdx = new Set(), personaTipo = new Map() }) {
  const out = [];
  tokens.forEach((t, i) => {
    if (dineroIdx.has(i)) { if (out[out.length - 1] !== '<dinero>') out.push('<dinero>'); return; }
    if (prodIdx.has(i)) { if (!(prodIdx.has(i - 1))) out.push('<prod>'); return; }
    if (personaIdx.has(i)) { if (!(personaIdx.has(i - 1))) out.push(`<${personaTipo.get(i) || 'persona'}>`); return; }
    if (numIdx.has(i)) { out.push('<num>'); return; }
    out.push(t);
  });
  return out;
}

/**
 * El tipo de persona que espera un intent, para las frases de entrenamiento:
 * su único dato de persona; si pide cliente y profesional (citas), el que va
 * después de «con» es el profesional.
 */
function tipoPersonaDe(def, despuesDeCon = false) {
  const s = def?.slots || {};
  const tipos = ['cliente', 'proveedor', 'profesional'].filter((k) => s[k]);
  if (!tipos.length) return 'persona';
  if (tipos.length === 1) return tipos[0];
  return despuesDeCon && tipos.includes('profesional') ? 'profesional' : tipos[0];
}

module.exports = { indicesNumericos, marcar, tipoPersonaDe };
