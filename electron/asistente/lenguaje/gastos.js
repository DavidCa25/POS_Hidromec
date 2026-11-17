/**
 * GASTOS HABLADOS (reglas, no clasificador)
 *
 *   «cancela el gasto 12», «cancela el gasto 12, era de otra sucursal»
 *   «crea el concepto de gasto Gasolina», «renombra el concepto Luz a Luz y agua»,
 *   «desactiva el concepto Gasolina», «activa el concepto Gasolina»
 */
'use strict';

const { llano } = require('./edicion');

const limpio = (s) => String(s || '').trim().replace(/^["'«“]+|["'»”.]+$/g, '').trim();
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** El texto original desde la posición i del texto llano (misma longitud). */
const desde = (raw, t, i) => raw.slice(i);

function gastos(texto) {
  const raw = String(texto || '').trim().replace(/[¿?¡!]+/g, '');
  const t = llano(raw);
  if (!t || /^(?:cuanto|cuanta|que|cual|como|dime)\b/.test(t)) return null;

  let m = t.match(/^(?:cancela|cancelar|cancelame|anula|anular|borra|elimina)\s+(?:el\s+)?gasto\s+(?:numero\s+|folio\s+|#\s*)?(\d+)(?:\s*[,;:]?\s*(?:porque|por que|era|fue|motivo:?)\s+(.+))?$/);
  if (m) return { intent: 'gasto.cancelar', folio: Number(m[1]), motivo: m[2] ? limpio(raw.slice(t.length - m[2].length)) : null };

  m = t.match(/^(?:crea|crear|agrega|agregar|da de alta|nuevo|nueva|registra)\s+(?:el\s+|un\s+)?(?:nuevo\s+)?concepto\s+(?:de\s+gastos?\s+|de\s+egresos?\s+)?(?:llamado\s+|que se llame\s+)?(.+)$/);
  if (m) return { intent: 'gasto.concepto', accion: 'crear', nombre: capital(limpio(desde(raw, t, t.length - m[1].length))) };

  m = t.match(/^(?:renombra|cambia(?:le)? el nombre (?:a|al|del))\s+(?:el\s+)?concepto\s+(?:de\s+gastos?\s+)?(.+?)\s+(?:a|por)\s+(.+)$/);
  if (m) return { intent: 'gasto.concepto', accion: 'renombrar', concepto: m[1], nombre: capital(limpio(raw.slice(t.length - m[2].length))) };

  m = t.match(/^(desactiva|desactivar|quita|oculta|ya no uso|activa|activar|reactiva|vuelve a usar)\s+(?:el\s+)?concepto\s+(?:de\s+gastos?\s+)?(.+)$/);
  if (m) return { intent: 'gasto.concepto', accion: /^(activa|activar|reactiva|vuelve a usar)$/.test(m[1]) ? 'activar' : 'desactivar', concepto: m[2] };
  return null;
}

module.exports = { gastos };
