/**
 * VARIOS HABLADOS (reglas, no clasificador)
 *
 *   «cambia la coca del ticket 120 por una pepsi», «corrige la venta 120: eran 3 conchas»
 *   «el cigarro suelto sale de la cajetilla de 20»
 *   «manda el ticket 120 a juan@correo.com», «imprime el corte», «imprime la devolución 5», «quita el logo del ticket»
 *   «da de baja el carro de doña Mary»
 *   «avisa por WhatsApp cuando el pedido esté listo», «ya no avises por WhatsApp de las membresías»
 *   «apaga las aprobaciones», «enciende las aprobaciones»
 *   «crea el impuesto Hospedaje 3%», «crea el impuesto IEPS bebidas 8%», «crea el impuesto IEPS por cuota de 1.64 por litro»
 */
'use strict';

const { llano } = require('./edicion');

const desdeRaw = (raw, t, frag) => raw.slice(t.length - frag.length).trim();

function varios(texto) {
  const raw = String(texto || '').trim().replace(/[¿?¡!]+/g, '');
  const t = llano(raw);
  if (!t || /^(?:cuanto|cuantos|que|cual|como|dime)\b/.test(t)) return null;

  /* «Cambia la coca del ticket 120 por una pepsi». */
  let m = t.match(/^(?:cambia|cambiale|cambiar)\s+(?:el|la|los|las|un|una)?\s*(.+?)\s+del?\s+(?:ticket|venta|folio)\s+(\d+)\s+por\s+(.+?)(?:\s*[,;]\s*|\s+(?:porque|por que)\s+(.+))?$/);
  if (m) return { intent: 'venta.cambio', textoDevuelve: m[1], folio: Number(m[2]), textoLleva: m[3], motivoTexto: m[4] || null };

  /* «Corrige la venta 120: eran 3 conchas», «en la venta 120 eran 2 cocas, no 3». */
  m = t.match(/^(?:corrige|corregir|arregla)\s+(?:la\s+)?(?:venta|ticket)\s+(\d+)\s*[:,]?\s*(?:eran|era|fueron|son)\s+(.+?)(?:\s*,?\s*no\s+\d+)?$/)
    || t.match(/^en\s+(?:la\s+)?(?:venta|ticket)\s+(\d+)\s+(?:eran|era|fueron)\s+(.+?)(?:\s*,?\s*no\s+\d+)?$/);
  if (m) return { intent: 'venta.corregir', folio: Number(m[1]), textoRenglon: m[2] };

  /* «El cigarro suelto sale de la cajetilla de 20». */
  m = t.match(/^(?:el|la|los|las)?\s*(.+?)\s+(?:sale|salen|se saca|se sacan|se vende suelto de|viene)\s+de\s+(?:la|el|un|una)?\s*(.+?)\s+(?:de|con|que trae)\s+(\d+)(?:\s+piezas?)?$/);
  if (m) return { intent: 'venta.suelta', textoProducto: m[1], textoPadre: m[2], piezas: Number(m[3]) };

  /* Tickets. */
  m = t.match(/^(?:manda|mandale|envia|enviale)\s+(?:el\s+)?(?:ticket|comprobante)\s+(?:de la venta\s+)?(\d+)\s+(?:a|al correo)\s+(\S+@\S+)$/);
  if (m) return { intent: 'ticket.correo', folio: Number(m[1]), correo: desdeRaw(raw, t, m[2]).toLowerCase() };
  if (/^(?:imprime|reimprime|vuelve a imprimir)\s+(?:el\s+)?(?:ultimo\s+)?corte$/.test(t)) return { intent: 'ticket.imprimir', documento: 'closure' };
  m = t.match(/^(?:imprime|reimprime)\s+(?:el\s+comprobante\s+de\s+)?(?:la\s+)?devolucion\s+(\d+)$/);
  if (m) return { intent: 'ticket.imprimir', documento: 'refund', folio: Number(m[1]) };
  if (/^(?:quita|borra|elimina)\s+(?:el\s+)?logo\s+(?:del?\s+)?(?:ticket|comprobante)s?$/.test(t)) return { intent: 'ticket.logo_quitar' };

  /* Activos del cliente. */
  m = t.match(/^(?:da de baja|desactiva|quita)\s+(?:el|la)\s+(carro|auto|coche|camioneta|moto|vehiculo|perro|gato|mascota|equipo|celular|laptop|computadora)\s+(?:de|del|de la)\s+(.+)$/);
  if (m) return { intent: 'activo.baja', claseTexto: m[1], textoCliente: m[2] };

  /* WhatsApp. */
  m = t.match(/^(ya no\s+)?(?:avisa|avises|manda aviso|mandes aviso)\s+(?:por\s+)?whats(?:app)?\s+(?:cuando|de)\s+(?:el\s+|los\s+|la\s+|las\s+)?(pedido|pedidos|membresia|membresias)\b/);
  if (m) return { intent: 'whatsapp.config', campo: /^pedido/.test(m[2]) ? 'pedidoListo' : 'membresia', valor: !m[1] };
  m = t.match(/^avisa\s+(?:por\s+whats(?:app)?\s+)?(\d+)\s+dias\s+antes\s+de\s+que\s+venza\s+la\s+membresia$/);
  if (m) return { intent: 'whatsapp.config', campo: 'diasAntes', valor: Number(m[1]) };

  /* Pago de servicios y recargas: desconectar el proveedor. */
  if (/^(?:desconecta|quita|borra|apaga)\s+(?:el\s+)?(?:pago de servicios|recargas|proveedor de recargas|taecel)$/.test(t)) return { intent: 'servicios_pago.desconectar' };

  /* Aprobaciones a distancia. */
  m = t.match(/^(apaga|desactiva|quita|enciende|activa|prende)\s+(?:las\s+)?(?:aprobaciones|autorizaciones)(?:\s+desde la app)?$/);
  if (m) return { intent: 'aprobaciones.politica', activas: /^(enciende|activa|prende)$/.test(m[1]) };

  /* Impuestos. */
  m = t.match(/^(?:crea|agrega|da de alta)\s+(?:el\s+)?impuesto\s+(.+?)\s+(?:(?:por\s+cuota\s+de|de|a)\s+)?\$?(\d+(?:\.\d+)?)\s*(%|por ciento|pesos)?(?:\s+por\s+(litro|kilo|pieza|cajetilla|gramo))?$/);
  if (m) {
    const nombre = raw.slice(t.indexOf(m[1]), t.indexOf(m[1]) + m[1].length).trim();
    const cuota = /por cuota/.test(t) || !!m[4];
    const clase = /\bieps\b/.test(m[1]) ? 'IEPS' : 'LOCAL';
    return { intent: 'impuesto.crear', nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1), clase,
             factor: cuota ? 'Cuota' : 'Tasa', tasa: cuota ? null : Number(m[2]) / 100, cuota: cuota ? Number(m[2]) : null, unidad: m[4] || null };
  }
  return null;
}

module.exports = { varios };
