/**
 * LOS GIROS DE SALUD, PARA EL PROCESO PRINCIPAL.
 *
 * Igual que electron/servicios/presets.js: no define nada, lee
 * `presets.json` (la fuente única que también importa la interfaz) y valida
 * contra la lista, no contra una expresión regular. Un preset que llega del
 * renderer con algo raro dentro no pasa de aquí.
 */
const DEFINICION = require('./presets.json');

const PRESETS = [...DEFINICION.presets].sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99));
const IDS = PRESETS.map(p => p.id);

function buscar(id) {
  const clave = String(id || '').trim().toUpperCase();
  return PRESETS.find(p => p.id === clave) || null;
}

function exigir(id) {
  const p = buscar(id);
  if (!p) {
    throw new Error(`Giro de Salud desconocido: ${JSON.stringify(id)}. Los que existen son ${IDS.join(', ')}.`);
  }
  return p;
}

module.exports = { PRESETS, IDS, buscar, exigir, version: DEFINICION.version };
