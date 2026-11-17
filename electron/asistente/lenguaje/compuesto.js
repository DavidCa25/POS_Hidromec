'use strict';
/**
 * FRASES COMPUESTAS: «registra $500 de luz y dime cuánto me queda en caja».
 *
 * Se parte en «y», «luego», «después», «también», comas y puntos, pero SOLO
 * donde lo que sigue empieza como una orden o una pregunta nueva. Así
 * «3 cocas y 2 sabritas» o «cuánto vendí hoy y ayer» siguen siendo una sola
 * cosa.
 *
 * Partir no decide: conversacion.js interpreta cada pedazo y solo acepta la
 * partición si cada uno se entiende por sí solo.
 */
const { normalizar } = require('./normalizar');

/* Cómo empieza una orden o pregunta nueva. */
const INICIO = /^(?:y |tambien |luego |despues |ademas |de paso |otra cosa )*(?:dime|dame|cuanto|cuantos|cuantas|que|quien|quienes|cual|cuales|como|cuando|donde|registra|registrame|apunta|anota|agrega|agregale|abre|sube|subele|baja|bajale|pon|ponle|cambia|cambiale|cobra|cobrale|paga|pagale|abona|abonale|crea|creame|da de alta|ajusta|ajustale|merma|tira|planea|agenda|agendale|cancela|mueve|muestrame|ensename|busca|revisa|llevame|saca|mete|guarda|haz|hazme|calcula|compara|avisame|recuerdame|vende|vendele|hay|tengo|me queda|me quedan|se me acaba|olvida)\b/;
const CORTES = /\s*(?:[;.!?]+\s+|,\s*(?:y\s+)?(?:luego|despues|tambien|ademas)?\s*|\s+y\s+(?:luego|despues|tambien|ademas|de paso)\s+|\s+(?:luego|despues|ademas)\s+|\s+y\s+)/g;

/** @returns string[] — un solo elemento si no hay nada que partir. */
function partir(texto) {
  const t = String(texto || '').trim();
  if (t.length < 12) return [t];
  const piezas = [];
  let desde = 0, m;
  CORTES.lastIndex = 0;
  while ((m = CORTES.exec(t))) {
    if (!m[0].trim() && m[0].length === 0) { CORTES.lastIndex++; continue; }
    const resto = t.slice(m.index + m[0].length);
    const corte = /^\s*[;.!?]/.test(m[0]) ? '.' : m[0].trim();
    /* «y luego …» ya trae su propio conector; «… y dime …» necesita el verbo. */
    const empieza = INICIO.test(normalizar((/^(?:y|,)?\s*$/.test(corte) ? '' : corte.replace(/^[,y\s]+/, '')) + ' ' + resto).texto);
    if (!empieza) continue;
    piezas.push(t.slice(desde, m.index));
    desde = m.index + m[0].length;
  }
  piezas.push(t.slice(desde));
  const limpias = piezas.map((p) => p.replace(/^[\s,;.y]+|[\s,;.]+$/g, '').trim()).filter(Boolean);
  /* Una pieza de una palabra no es una orden: no se parte. */
  if (limpias.length < 2 || limpias.some((p) => normalizar(p).tokens.length < 2)) return [t];
  return limpias.slice(0, 3);
}

module.exports = { partir };
