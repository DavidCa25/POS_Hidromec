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

  m = t.match(/^(?:dale|darle|regala|regalale|manda|mandale|emite|genera|hazme)\s+(?:a\s+(.+?)\s+)?(?:(\d+)\s+)?(?:un\s+|el\s+|los\s+)?cupon(?:es)?\s+(?:de\s+)?(.+?)(?:\s+(?:a|para)\s+(.+))?$/);
  if (m) return { intent: 'cupon.emitir', textoCliente: m[1] || m[4] || null, cantidad: m[2] ? Number(m[2]) : 1, textoCupon: m[3] };

  /* «Crea el cupón 10% de descuento (vale 30 días)», «… $50 de descuento», «… café gratis». */
  m = t.match(/^(?:crea|da de alta|nuevo)\s+(?:el\s+|un\s+)?cupon\s+(?:de\s+)?(.+?)(?:\s*,?\s*(?:que\s+)?(?:vale|dura|valido)\s+(?:por\s+)?(\d+)\s+dias)?$/);
  if (m) {
    const d = m[1];
    const pct = d.match(/(\d+(?:\.\d+)?)\s*(?:%|por ciento)/), monto = d.match(/\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*pesos/);
    const gratis = d.match(/^(?:un\s+|una\s+)?(.+?)\s+gratis$/);
    const nombre = raw.slice(t.indexOf(d), t.indexOf(d) + d.length).trim();
    if (pct) return { intent: 'cupon.definir', nombre, tipo: 'PERCENT', pct: Number(pct[1]), dias: m[2] ? Number(m[2]) : null };
    if (monto) return { intent: 'cupon.definir', nombre, tipo: 'AMOUNT', monto: Number(monto[1] || monto[2]), dias: m[2] ? Number(m[2]) : null };
    if (gratis) return { intent: 'cupon.definir', nombre, tipo: 'FREE_PRODUCT', textoProducto: gratis[1], dias: m[2] ? Number(m[2]) : null };
  }
  /* «Crea la rifa Navidad, premio una canasta, cierra el 24 de diciembre, 2 ganadores». */
  m = t.match(/^(?:crea|da de alta|nueva|organiza)\s+(?:la\s+|una\s+)?rifa\s+(?:de\s+)?(.+?)(?:\s*,\s*|\s+con\s+)(?:premio|se rifa|el premio es)\s*:?\s+(.+?)(?:\s*,\s*(?:cierra|termina|hasta)\s+(?:el\s+)?(\d{1,2})\s+de\s+(\w+))?(?:\s*,\s*(\d+)\s+ganador(?:es)?)?$/);
  if (m) {
    const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    let hasta = null;
    if (m[3] && MES.includes(m[4])) { const hoy = new Date(); let y = hoy.getFullYear(); const mes = MES.indexOf(m[4]); if (new Date(y, mes, Number(m[3])) < hoy) y += 1; hasta = `${y}-${String(mes + 1).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`; }
    const orig = (frag) => raw.slice(t.indexOf(frag), t.indexOf(frag) + frag.length).trim();
    return { intent: 'rifa.crear', nombre: orig(m[1]), premio: orig(m[2]), hasta, ganadores: m[5] ? Number(m[5]) : 1 };
  }
  m = t.match(/^(?:abre|abrir|empieza|activa)\s+(?:la\s+)?rifa\s+(?:de\s+)?(.+)$/);
  if (m) return { intent: 'rifa.abrir', textoRifa: m[1] };
  /* «Crea la tarjeta de sellos del café: 9 sellos y el 10 gratis». */
  m = t.match(/^(?:crea|da de alta|nueva)\s+(?:la\s+|una\s+)?tarjeta\s+de\s+sellos\s+(?:del?|de la|de los|de las)\s+(.+?)\s*[:,]?\s+(\d+)\s+sellos?(?:\s+y\s+(?:el|la)\s+\d+\s+(?:gratis|de regalo))?$/);
  if (m) return { intent: 'sellos.crear', textoProducto: m[1], sellos: Number(m[2]) };
  /* «Crea el plan Café diario: 1 café al día por 300 al mes». */
  m = t.match(/^(?:crea|da de alta|nuevo)\s+(?:el\s+|un\s+)?plan\s+(?:del club\s+)?(.+?)\s*:\s*(\d+)\s+(.+?)\s+al\s+dia\s+por\s+\$?(\d+(?:\.\d+)?)\s+(?:al|por|cada)\s+(mes|semana|ano|quincena)$/);
  if (m) {
    const orig = raw.slice(t.indexOf(m[1]), t.indexOf(m[1]) + m[1].length).trim();
    return { intent: 'club.plan', nombre: orig, limite: Number(m[2]), textoProducto: m[3], precio: Number(m[4]), dias: { mes: 30, semana: 7, ano: 365, quincena: 15 }[m[5]] };
  }
  /* Campañas: «cada compra de más de 200 da un cupón de 10%», «por cada 100 pesos un boleto de la rifa Navidad». */
  m = t.match(/^(?:cada|toda|en cada)\s+compra\s+de\s+mas\s+de\s+\$?(\d+(?:\.\d+)?)\s*(?:pesos)?\s+(?:da|gana|se lleva|regala)\s+(?:un\s+|el\s+)?cupon\s+(?:de\s+)?(.+)$/);
  if (m) return { intent: 'campana.crear', resultado: 'COUPON', minimo: Number(m[1]), textoCupon: m[2] };
  m = t.match(/^por\s+cada\s+\$?(\d+(?:\.\d+)?)\s*(?:pesos)?\s+(?:de compra\s+)?(?:da|gana|se lleva|regala)?\s*(?:un\s+)?boleto\s+(?:para\s+|de\s+)?(?:la\s+)?rifa\s+(?:de\s+)?(.+)$/);
  if (m) return { intent: 'campana.crear', resultado: 'RAFFLE', porCada: Number(m[1]), textoRifa: m[2] };

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
