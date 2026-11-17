/**
 * MESAS, CUENTAS, COMANDAS, SALÓN Y ESTACIONES (reglas, no clasificador)
 *
 *   «abre la mesa 4 para 3», «abre una cuenta para llevar a nombre de Juan»
 *   «la mesa 4 pide 2 tacos y una coca», «manda 2 tacos a la mesa 4»
 *   «la mesa 4 pidió la cuenta», «la mesa 4 es de doña Mary», «libera la mesa 4»
 *   «la comanda 12 ya está lista», «cancela la comanda 12, se quemó», «reimprime la comanda 12»
 *   «agrega la mesa 10 en la terraza para 4», «crea el área Terraza»
 *   «crea la estación Barra», «las bebidas van a la barra»
 */
'use strict';

const { llano } = require('./edicion');

const limpio = (s) => String(s || '').trim().replace(/^["'«“:,]+|["'»”.]+$/g, '').trim();
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const desdeRaw = (raw, t, frag) => raw.slice(t.length - frag.length);

function mesas(texto, { estaciones = [] } = {}) {
  const raw = String(texto || '').trim().replace(/[¿?¡!]+/g, '');
  const t = llano(raw);
  if (!t || /^(?:cuanto|cuantas|cuantos|que|cual|como|dime|hay)\b/.test(t)) return null;

  /* ------------------------------------------------------------ cuentas */
  let m = t.match(/^(?:abre|abrir|abreme|sienta|sientame|siento|ocupa)\s+(?:la\s+)?mesa\s+(\S+(?:\s+\d+)?)(?:\s+(?:para|con|de)\s+(\d+)(?:\s+personas?)?)?$/);
  if (m) return { intent: 'cuenta.abrir', mesa: m[1], personas: m[2] ? Number(m[2]) : null };
  /* «Sienta 3 en la mesa 4». */
  m = t.match(/^(?:sienta|sientame|siento)\s+(?:a\s+)?(\d+)\s+(?:personas?\s+)?en\s+(?:la\s+)?mesa\s+(\S+(?:\s+\d+)?)$/);
  if (m) return { intent: 'cuenta.abrir', mesa: m[2], personas: Number(m[1]) };
  m = t.match(/^(?:abre|abrir|abreme)\s+(?:una\s+)?cuenta\s+(?:para llevar\s+|sin mesa\s+)?(?:a nombre de|de|para)\s+(.+)$/);
  if (m) return { intent: 'cuenta.abrir', etiqueta: capital(limpio(desdeRaw(raw, t, m[1]))) };

  /* «La 4 pide la cuenta»: «la» + número es una mesa. */
  m = t.match(/^(?:(?:la\s+)?mesa\s+|la\s+(?=\d))(\S+(?:\s+\d+)?)\s+(?:ya\s+)?(?:pide|pidio|quiere|esta pidiendo)\s+(?:la\s+)?cuenta$/);
  if (m) return { intent: 'cuenta.estado', mesa: m[1], estado: 'POR_COBRAR' };
  m = t.match(/^(?:la\s+)?mesa\s+(\S+(?:\s+\d+)?)\s+(?:siempre no|todavia no|aun no)\s+(?:quiere\s+)?(?:la\s+)?cuenta|^(?:reabre|vuelve a abrir)\s+(?:la\s+)?mesa\s+(\S+(?:\s+\d+)?)$/);
  if (m) return { intent: 'cuenta.estado', mesa: m[1] || m[2], estado: 'ABIERTA' };
  m = t.match(/^(?:la\s+)?(?:mesa|cuenta de la mesa)\s+(\S+(?:\s+\d+)?)\s+es\s+(?:de|para)\s+(.+)$/);
  if (m) return { intent: 'cuenta.cliente', mesa: m[1], textoCliente: m[2] };
  m = t.match(/^(?:libera|liberar|desocupa|desocupar|limpia)\s+(?:la\s+)?mesa\s+(\S+(?:\s+\d+)?)$/);
  if (m) return { intent: 'cuenta.liberar', mesa: m[1] };
  m = t.match(/^(?:(?:la\s+)?mesa\s+|la\s+(?=\d))(\S+(?:\s+\d+)?)\s+(?:pide|quiere|ordena|va a querer|agrega|ademas quiere)\s+(.+)$/)
    || t.match(/^(?:manda|mandale|envia|enviale|pide|pidele|marcha|comanda|agrega|agregale)\s+(.+?)\s+(?:a|para|en)\s+(?:la\s+)?mesa\s+(\S+(?:\s+\d+)?)$/);
  if (m) {
    const [mesa, pedido] = /^(?:la\s+)?mesa\b|^la\s+\d/.test(t) ? [m[1], m[2]] : [m[2], m[1]];
    return { intent: 'cuenta.enviar', mesa, textoPedido: pedido };
  }

  /* ----------------------------------------------------------- comandas */
  m = t.match(/^(?:cancela|cancelar)\s+(?:la\s+)?comanda\s+(\d+)(?:\s*[,;:]\s*|\s+(?:porque|por que)\s+)(.+)$/);
  if (m) return { intent: 'comanda.cancelar', comanda: Number(m[1]), motivo: capital(limpio(desdeRaw(raw, t, m[2]))) };
  m = t.match(/^(?:cancela|cancelar)\s+(?:la\s+)?comanda\s+(\d+)$/);
  if (m) return { intent: 'comanda.cancelar', comanda: Number(m[1]), motivo: null };
  m = t.match(/^(?:reimprime|reimprimir|imprime otra vez|vuelve a imprimir|imprime de nuevo)\s+(?:la\s+)?comanda\s+(\d+)$/);
  if (m) return { intent: 'comanda.reimprimir', comanda: Number(m[1]) };
  m = t.match(/^(?:la\s+)?comanda\s+(\d+)\s+(?:ya\s+)?(?:esta\s+|se\s+)?(lista|preparando|en preparacion|entregada|entrego|salio)$/)
    || t.match(/^(?:ya\s+)?(?:esta\s+)?(lista|salio|se entrego|entregada|empezamos|preparando)\s+(?:la\s+)?comanda\s+(\d+)$/);
  if (m) {
    const [num, palabra] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
    const estado = /lista|salio/.test(palabra) ? 'LISTA' : /entreg/.test(palabra) ? 'ENTREGADA' : 'PREPARANDO';
    return { intent: 'comanda.estado', comanda: Number(num), estado };
  }

  /* -------------------------------------------------------------- salón */
  m = t.match(/^(?:crea|crear|agrega|agregar|nueva|nuevo|anade)\s+(?:el\s+|un\s+|una\s+)?area\s+(?:de\s+|llamada\s+)?(.+)$/);
  if (m) return { intent: 'salon.area', nombre: capital(limpio(desdeRaw(raw, t, m[1]))) };
  m = t.match(/^(?:crea|crear|agrega|agregar|nueva|anade|pon)\s+(?:la\s+|una\s+)?mesa\s+(\S+(?:\s+\d+)?)(?:\s+(?:en|al)\s+(?:la\s+|el\s+)?(?:area\s+)?(.+?))?(?:\s+(?:para|de)\s+(\d+)(?:\s+personas?)?)?$/);
  if (m) return { intent: 'salon.mesa', nombre: m[1], textoArea: m[2] || null, capacidad: m[3] ? Number(m[3]) : null };

  /* --------------------------------------------------------- estaciones */
  m = t.match(/^(?:crea|crear|agrega|agregar|nueva|anade)\s+(?:la\s+|una\s+)?estacion\s+(?:de\s+|llamada\s+)?(.+?)(?:\s+con impresora)?$/);
  if (m) return { intent: 'estacion.crear', nombre: capital(limpio(desdeRaw(raw, t, m[1]).replace(/\s+con impresora$/i, ''))), impresora: /con impresora$/.test(t) };
  m = t.match(/^(?:el|la|los|las)?\s*(.+?)\s+(?:va|van|se prepara|se preparan|sale|salen|se hace|se hacen)\s+(?:a|en)\s+(?:la\s+|el\s+)?(?:estacion\s+(?:de\s+)?)?(.+)$/);
  if (m) {
    const e = estaciones.find((x) => llano(x.nombre) === m[2]);
    if (e) return { intent: 'estacion.producto', textoProducto: m[1], estacion: e.id, estacionNombre: e.nombre };
  }
  return null;
}

module.exports = { mesas };
