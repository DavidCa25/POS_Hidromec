/**
 * FIDELIZACIÓN HABLADA (reglas, no clasificador)
 *
 *   «ponle 100 puntos a doña Mary porque se le cobró doble», «quítale 50 puntos a doña Mary»
 *   «cancela la membresía de doña Mary»
 *   «cierra la rifa de Navidad», «sortea la rifa de Navidad con 3 ganadores»
 *   «dale a doña Mary un cupón de 10%», «genera 20 cupones de 2x1»
 *   «da 1 punto por cada 10 pesos», «los puntos caducan a los 12 meses», «apaga los puntos»
 */
'use strict';

const { llano } = require('./edicion');

const limpio = (s) => String(s || '').trim().replace(/^["'«“:,]+|["'»”.]+$/g, '').trim();

function fidelizacion(texto) {
  const raw = String(texto || '').trim().replace(/[¿?¡!]+/g, '');
  const t = llano(raw);
  if (!t || /^(?:cuanto|cuantos|cuanta|que|cual|como|dime|tiene)\b/.test(t)) return null;

  let m = t.match(/^(?:ponle|ponerle|dale|darle|agrega|agregale|abona|abonale|regala|regalale|suma|sumale)\s+(\d+)\s+puntos\s+(?:a|al|para)\s+(.+?)(?:\s*[,;]?\s+(?:porque|por que|por)\s+(.+))?$/);
  if (m) return { intent: 'puntos.ajustar', cantidad: Number(m[1]), textoCliente: m[2], nota: m[3] ? limpio(raw.slice(t.length - m[3].length)) : null };
  m = t.match(/^(?:quitale|quita|quitar|resta|restale|descuenta|descuentale)\s+(\d+)\s+puntos\s+(?:a|al|de|del)\s+(.+?)(?:\s*[,;]?\s+(?:porque|por que|por)\s+(.+))?$/);
  if (m) return { intent: 'puntos.ajustar', cantidad: -Number(m[1]), textoCliente: m[2], nota: m[3] ? limpio(raw.slice(t.length - m[3].length)) : null };

  m = t.match(/^(?:cancela|cancelar|cancelale|da de baja)\s+(?:la\s+|su\s+)?(?:membresia|suscripcion|club)\s+(?:de|del|a)\s+(.+?)(?:\s*[,;]\s*|\s+(?:porque|por que)\s+)(.+)$/)
    || t.match(/^(?:cancela|cancelar|cancelale|da de baja)\s+(?:la\s+|su\s+)?(?:membresia|suscripcion|club)\s+(?:de|del|a)\s+(.+)$/);
  if (m) return { intent: 'club.cancelar', textoCliente: m[1], nota: m[2] ? limpio(raw.slice(t.length - m[2].length)) : null };

  m = t.match(/^(?:cierra|cerrar|cierrale)\s+(?:la\s+)?(?:rifa|sorteo)\s+(?:de\s+|del\s+)?(.+)$/);
  if (m) return { intent: 'rifa.cerrar', textoRifa: m[1] };
  m = t.match(/^(?:sortea|sortear|haz el sorteo de|rifa)\s+(?:la\s+|el\s+)?(?:rifa|sorteo)?\s*(?:de\s+|del\s+)?(.+?)(?:\s+con\s+(\d+)\s+ganador(?:es)?)?(?:\s+y\s+(\d+)\s+suplentes?)?$/);
  if (m && m[1]) return { intent: 'rifa.sortear', textoRifa: m[1], ganadores: m[2] ? Number(m[2]) : null, suplentes: m[3] ? Number(m[3]) : 0 };

  m = t.match(/^(?:dale|darle|regala|regalale|manda|mandale|emite|genera|crea|hazme)\s+(?:a\s+(.+?)\s+)?(?:(\d+)\s+)?(?:un\s+|el\s+|los\s+)?cupon(?:es)?\s+(?:de\s+)?(.+?)(?:\s+(?:a|para)\s+(.+))?$/);
  if (m) return { intent: 'cupon.emitir', textoCliente: m[1] || m[4] || null, cantidad: m[2] ? Number(m[2]) : 1, textoCupon: m[3] };

  m = t.match(/^(?:da|dar|que de|que se den|regala)\s+(\d+)\s+puntos?\s+(?:por cada|cada)\s+\$?(\d+(?:\.\d+)?)\s*(?:pesos)?$/);
  if (m) return { intent: 'puntos.config', puntos: Number(m[1]), cadaMonto: Number(m[2]) };
  m = t.match(/\bpuntos\s+(?:caducan|vencen|expiran)\s+(?:a\s+los\s+|en\s+|cada\s+)?(\d+)\s+mes(?:es)?\b/);
  if (m) return { intent: 'puntos.config', caducaMeses: Number(m[1]) };
  if (/\b(?:los\s+)?puntos\s+(?:ya\s+)?no\s+(?:caducan|vencen|expiran)\b/.test(t)) return { intent: 'puntos.config', caducaMeses: 0 };
  m = t.match(/^(?:da|dar|regala)\s+(\d+)\s+puntos?\s+por\s+(?:cada\s+)?visita$/);
  if (m) return { intent: 'puntos.config', porVisita: Number(m[1]) };
  if (/^(?:apaga|desactiva|quita)\s+(?:los\s+)?puntos$/.test(t)) return { intent: 'puntos.config', activo: false };
  if (/^(?:prende|enciende|activa)\s+(?:los\s+)?puntos$/.test(t)) return { intent: 'puntos.config', activo: true };
  return null;
}

module.exports = { fidelizacion };
