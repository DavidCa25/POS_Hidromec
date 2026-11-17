'use strict';
/**
 * APODOS: el idioma de cada negocio.
 *
 * En un mostrador nadie dice «Coca Cola 600 ml»: dicen «la roja», «una de
 * vidrio», «la de la tienda». Wybix los aprende de dos formas:
 *
 *   enseñado   «a la coca de 600 dile la roja», «cuando diga la roja es la
 *              coca de 600», «a doña Mary también le dicen la güera».
 *              Se confirma con una tarjeta (lo usan todos en el negocio).
 *   aprendido  Wybix preguntó «¿cuál?» y la persona eligió: lo que dijo
 *              apunta a lo que eligió (conversacion.js). Se avisa.
 *
 * «Olvida la roja» lo borra. Se guardan en asistente_alias (por negocio) y
 * entran al catálogo como otro nombre del mismo producto o persona.
 */

const LIMPIA = /^(?:oye |wybix |oye wybix |porfa |por favor )+/;
const PATRONES = [
  /* a la coca de 600 dile la roja · al pan bimbo le decimos el bimbo */
  { re: /^(?:a|al) (.+?) (?:dile|llamale|ponle de apodo|ponle|le decimos|le dicen|le digo|tambien le dicen|tambien le decimos|lo conocen como|la conocen como) (.+)$/, objetivo: 1, alias: 2 },
  /* le decimos la roja a la coca de 600 */
  { re: /^(?:le|les) (?:decimos|dicen|digo) (.+?) (?:a|al) (.+)$/, objetivo: 2, alias: 1 },
  /* cuando diga la roja es la coca de 600 · cuando digo la roja me refiero a la coca */
  { re: /^cuando (?:diga|digo|te diga|escriba|escribo|alguien diga) (.+?),? (?:es|son|me refiero a|hablo de|quiero decir|significa) (.+)$/, objetivo: 2, alias: 1 },
  /* la roja es la coca de 600 (solo con «también» o «o sea»: si no, es demasiado amplio) */
  { re: /^(.+?) (?:tambien es|o sea|es lo mismo que|es igual a) (.+)$/, objetivo: 2, alias: 1 },
];
const OLVIDAR = /^(?:olvida|olvidate de|ya no le digas|ya no le decimos|borra el apodo|quita el apodo)(?: que)? (.+)$/;
const VACIAS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'que', 'y', 'a', 'al', 'lo', 'le', 'se', 'me', 'es']);

/** Lo dicho, sin artículos de los extremos ni comillas: «la roja» se guarda como «roja». */
function limpiar(t) {
  const ws = String(t).replace(/["'«»“”]/g, '').trim().split(/\s+/);
  while (ws.length > 1 && VACIAS.has(ws[0])) ws.shift();
  while (ws.length > 1 && VACIAS.has(ws[ws.length - 1])) ws.pop();
  return ws.join(' ');
}
const valido = (t) => t.length >= 2 && t.length <= 40 && !/^\d+$/.test(t) && !VACIAS.has(t) && t.split(' ').length <= 5;

/** @returns { alias, objetivo } | { alias, borrar: true } | null */
function apodo(norm) {
  const t = String(norm || '').replace(LIMPIA, '').trim();
  const o = t.match(OLVIDAR);
  if (o) { const alias = limpiar(o[1]); return valido(alias) ? { alias, borrar: true } : null; }
  for (const p of PATRONES) {
    const m = t.match(p.re);
    if (!m) continue;
    const alias = limpiar(m[p.alias]), objetivo = m[p.objetivo].trim();
    if (valido(alias) && objetivo.length >= 2) return { alias, objetivo };
  }
  return null;
}

module.exports = { apodo, limpiar, valido };
