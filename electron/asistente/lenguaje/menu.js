/**
 * MENÚ EN LÍNEA Y PLATAFORMAS DE REPARTO (reglas, no clasificador)
 *
 *   «acepta el pedido en línea 12», «acepta el pedido de Juan», «rechaza el pedido 12, no hay gas»
 *   «activa el menú en línea», «ya no recibas pedidos en línea», «el tiempo de entrega es de 30 minutos»,
 *   «el mensaje del menú es …», «la frase del menú es …», «el horario del menú es …», «la dirección del menú es …»
 *   «oculta la concha del menú en línea», «muestra la concha en el menú», «destaca el latte en el menú»,
 *   «la descripción del latte en el menú es …», «quita la foto de la concha del menú»
 *   «confirma la liquidación de Rappi», «cancela la liquidación de Rappi, venía mal»,
 *   «llegó el depósito de Rappi por 4,500», «el pedido A123 de Rappi es la venta 456», «el canal didi es de DiDi Food»
 */
'use strict';

const { llano } = require('./edicion');

const PLAT = (t) => (/\brappi\b/.test(t) ? 'RAPPI' : /\bdidi\b/.test(t) ? 'DIDI_FOOD' : /\buber\b/.test(t) ? 'UBER_EATS' : null);
const desdeRaw = (raw, t, frag) => raw.slice(t.length - frag.length).trim().replace(/^["'«“:]+|["'»”.]+$/g, '').trim();
const MENU = '(?:menu en linea|menu digital|menu)';

function menu(texto) {
  const raw = String(texto || '').trim().replace(/[¿?¡!]+/g, '');
  const t = llano(raw);
  if (!t || /^(?:cuanto|cuantos|que|cual|como|dime|hay)\b/.test(t)) return null;

  /* --------------------------------------------------- pedidos en línea */
  let m = t.match(/^(acepta|aceptar|aceptale|rechaza|rechazar|rechazale)\s+(?:el\s+)?pedido\s+(?:en linea\s+|por internet\s+|del menu\s+)?(?:(?:numero\s+|#\s*)?(\d+)|de\s+(.+?))(?:\s*[,;:]\s*|\s+(?:porque|por que)\s+(.+)|$)(.*)$/);
  if (m) {
    const acepta = /^acept/.test(m[1]);
    const motivo = (m[4] || m[5] || '').trim();
    return { intent: acepta ? 'pedido.aceptar' : 'pedido.rechazar', pedido: m[2] ? Number(m[2]) : null, clienteTexto: m[3] || null,
             motivo: !acepta && motivo ? desdeRaw(raw, t, motivo) : null };
  }

  /* ------------------------------------------------------ configuración */
  m = t.match(new RegExp(`^(activa|prende|enciende|publica|apaga|desactiva|quita)\\s+(?:el\\s+)?${MENU}$`));
  if (m) return { intent: 'menu.config', campo: 'activo', valor: /^(activa|prende|enciende|publica)$/.test(m[1]) };
  if (/^(?:ya\s+)?no\s+(?:recibas|aceptes|tomes)\s+pedidos(?:\s+en linea|\s+por internet)?$|^(?:cierra|para|deten)\s+(?:los\s+)?pedidos(?:\s+en linea)?$/.test(t)) return { intent: 'menu.config', campo: 'recibePedidos', valor: false };
  if (/^(?:recibe|acepta|abre|vuelve a recibir)\s+(?:los\s+)?pedidos(?:\s+en linea|\s+por internet)?$/.test(t)) return { intent: 'menu.config', campo: 'recibePedidos', valor: true };
  m = t.match(/^(?:el\s+)?tiempo\s+de\s+(?:entrega|espera|preparacion)\s+(?:del menu\s+)?(?:es|son|sera)\s+(?:de\s+)?(\d+)\s*(?:minutos|min)$/);
  if (m) return { intent: 'menu.config', campo: 'minutos', valor: Number(m[1]) };
  m = t.match(new RegExp(`^(?:el\\s+)?mensaje\\s+del\\s+${MENU}\\s+(?:es|sera)\\s*:?\\s+(.+)$`));
  if (m) return { intent: 'menu.config', campo: 'mensaje', valor: desdeRaw(raw, t, m[1]) };
  m = t.match(new RegExp(`^(?:la\\s+|el\\s+)?(frase|horario|direccion|color|acento)\\s+del\\s+${MENU}\\s+(?:es|sera)\\s*:?\\s+(.+)$`));
  if (m) {
    const v = desdeRaw(raw, t, m[2]);
    if ((m[1] === 'color' || m[1] === 'acento') && !/^#[0-9a-f]{6}$/i.test(v)) return null;
    return { intent: 'menu.diseno', campo: m[1], valor: v };
  }

  /* ----------------------------------------------------- productos del menú */
  m = t.match(new RegExp(`^(oculta|esconde|quita|muestra|ensena|pon|destaca|resalta|ya no destaques)\\s+(?:el\\s+|la\\s+|los\\s+|las\\s+)?(.+?)\\s+(?:del|en el|al)\\s+${MENU}$`));
  if (m && !/^(?:foto|imagen)\b/.test(m[2])) {
    const accion = /^(oculta|esconde|quita)$/.test(m[1]) ? { campo: 'oculto', valor: true } : /^(muestra|ensena|pon)$/.test(m[1]) ? { campo: 'oculto', valor: false }
      : /^ya no destaques$/.test(m[1]) ? { campo: 'destacado', valor: false } : { campo: 'destacado', valor: true };
    return { intent: 'menu.producto', textoProducto: m[2], ...accion };
  }
  m = t.match(new RegExp(`^(?:la\\s+)?descripcion\\s+(?:del?|de la|de los|de las)\\s+(.+?)\\s+en\\s+el\\s+${MENU}\\s+(?:es|sera)\\s*:?\\s+(.+)$`));
  if (m) return { intent: 'menu.producto', textoProducto: m[1], campo: 'descripcion', valor: desdeRaw(raw, t, m[2]) };
  m = t.match(new RegExp(`^(?:quita|borra|elimina)\\s+(?:la\\s+)?(?:foto|imagen)\\s+(?:del?|de la|de los|de las)\\s+(.+?)\\s+(?:del|en el)\\s+${MENU}$`));
  if (m) return { intent: 'menu.foto_quitar', textoProducto: m[1] };
  m = t.match(new RegExp(`^(?:quitale|borrale)\\s+(?:la\\s+)?(?:foto|imagen)\\s+(?:a|al)\\s+(?:la\\s+|el\\s+|los\\s+|las\\s+)?(.+?)\\s+(?:del|en el)\\s+${MENU}$`));
  if (m) return { intent: 'menu.foto_quitar', textoProducto: m[1] };

  /* ---------------------------------------------------------- plataformas */
  const p = PLAT(t);
  if (p) {
    m = t.match(/^(?:confirma|confirmar|cierra)\s+(?:la\s+)?liquidacion\s+(?:de|del)\s+\w+(?:\s+(?:food|eats))?(?:\s+de\s+(?:esta|la)\s+semana|\s+de\s+(?:hoy|ayer))?$/);
    if (m) return { intent: 'plataforma.confirmar', plataforma: p };
    m = t.match(/^(?:cancela|cancelar|anula)\s+(?:la\s+)?liquidacion\s+(?:de|del)\s+\w+(?:\s+food|\s+eats)?(?:(?:\s*[,;:]\s*|\s+(?:porque|por que)\s+)(.+))?$/);
    if (m) return { intent: 'plataforma.cancelar', plataforma: p, motivo: m[1] ? desdeRaw(raw, t, m[1]) : null };
    m = t.match(/^(?:ya\s+)?(?:llego|cayo|entro|depositaron)\s+(?:el\s+)?(?:deposito|pago|dinero)\s+de\s+\w+(?:\s+food|\s+eats)?\s+(?:por|de)\s+\$?([\d.,]+)(?:\s+pesos)?(?:\s+(hoy|ayer|antier))?$/);
    if (m) return { intent: 'plataforma.deposito', plataforma: p, importe: Number(m[1].replace(/,/g, '')), dia: m[2] || 'hoy' };
    m = t.match(/^(?:el\s+)?pedido\s+(\S+)\s+de\s+\w+(?:\s+food|\s+eats)?\s+es\s+(?:la\s+)?venta\s+(\d+)$/);
    if (m) return { intent: 'plataforma.emparejar', plataforma: p, pedido: desdeRaw(raw, t, m[1] + t.slice(t.indexOf(m[1]) + m[1].length)).split(/\s+/)[0], venta: Number(m[2]) };
    m = t.match(/^(?:el\s+)?canal\s+(\S+)\s+es\s+de\s+\w+/);
    if (m) return { intent: 'plataforma.canal', plataforma: p, canal: desdeRaw(raw, t, m[1] + t.slice(t.indexOf(m[1]) + m[1].length)).split(/\s+/)[0] };
  }
  return null;
}

module.exports = { menu };
