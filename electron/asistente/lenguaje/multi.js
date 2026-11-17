/**
 * MULTISUCURSAL HABLADO (reglas, no clasificador)
 *
 *   «publica el catálogo a las sucursales», «trae el catálogo de la matriz»
 *   «que las sucursales puedan cambiar sus precios», «que las sucursales no tengan productos propios»
 *   «en la sucursal Centro la coca cuesta 18», «en la sucursal Centro no se vende la coca»
 *   «manda 20 cocas a la sucursal Centro», «recibe el traspaso de la matriz», «cancela el traspaso a Centro»
 *   «Pedro puede entrar a todas las sucursales», «Pedro solo entra a la sucursal Centro»
 */
'use strict';

const { llano } = require('./edicion');

function multi(texto, { usuarios = [] } = {}) {
  const raw = String(texto || '').trim().replace(/[¿?¡!]+/g, '');
  const t = llano(raw);
  if (!t || /^(?:cuanto|cuantos|que(?!\s+las sucursales)|cual|como|dime)\b/.test(t)) return null;

  if (/^(?:publica|manda|sube)\s+(?:el\s+)?catalogo(?:\s+(?:a|en)\s+(?:las\s+sucursales|todas))?$/.test(t)) return { intent: 'multi.publicar' };
  if (/^(?:trae|baja|recibe|actualiza)\s+(?:el\s+)?catalogo\s+(?:de|desde)\s+la\s+(?:matriz|principal)$|^(?:trae|baja|recibe)\s+(?:el\s+)?catalogo$/.test(t)) return { intent: 'multi.recibir' };

  let m = t.match(/^que\s+las\s+sucursales\s+(no\s+)?(?:puedan|pueden)\s+(cambiar sus precios|poner sus precios|tener productos propios|dar de alta productos)$/)
    || t.match(/^que\s+las\s+sucursales\s+(no\s+)?(?:tengan|puedan tener)\s+(productos propios)$/);
  if (m) return { intent: 'multi.reglas', regla: /precio/.test(m[2]) ? 'precios_sucursal' : 'productos_locales', valor: !m[1] };

  m = t.match(/^en\s+(?:la\s+)?sucursal\s+(.+?)\s+(?:el|la|los|las)?\s*(.+?)\s+(?:cuesta|cuestan|vale|valen|se vende a|sale a|a)\s+\$?(\d+(?:\.\d+)?)(?:\s*pesos)?$/);
  if (m) return { intent: 'multi.excepcion', sucursalTexto: m[1], textoProducto: m[2], precio: Number(m[3]) };
  m = t.match(/^en\s+(?:la\s+)?sucursal\s+(.+?)\s+(no\s+)?se\s+venden?\s+(?:el|la|los|las)?\s*(.+)$/);
  if (m) return { intent: 'multi.excepcion', sucursalTexto: m[1], textoProducto: m[3], disponible: !m[2] };

  m = t.match(/^(?:manda|mandale|envia|lleva|llevate)\s+(.+?)\s+(?:al|a la|para el|para la)\s+(?:evento|feria|expo)\s+(?:de\s+)?(.+)$/);
  if (m) return { intent: 'evento.enviar', textoPedido: m[1], eventoTexto: m[2] };
  m = t.match(/^(?:manda|mandale|envia|traspasa|pasa)\s+(.+?)\s+a\s+(?:la\s+)?sucursal\s+(.+)$/);
  if (m) return { intent: 'multi.traspaso', textoPedido: m[1], sucursalTexto: m[2] };
  if (/^(?:recibe|recibir|recibi|ya llego)\s+(?:el\s+)?traspaso(?:\s+de\s+.+)?$/.test(t)) return { intent: 'multi.recibir_traspaso', sucursalTexto: (t.match(/traspaso\s+de\s+(?:la\s+)?(?:sucursal\s+)?(.+)$/) || [])[1] || null };
  m = t.match(/^(?:cancela|cancelar)\s+(?:el\s+)?(?:ultimo\s+)?traspaso\s+(?:a|para)\s+(?:la\s+)?(?:sucursal\s+)?(.+)$/);
  if (m) return { intent: 'multi.cancelar_traspaso', sucursalTexto: m[1] };

  m = t.match(/^(.+?)\s+puede\s+entrar\s+a\s+todas\s+las\s+sucursales$/);
  if (m) { const u = usuarios.find((x) => llano(x.nombre) === m[1]); if (u) return { intent: 'multi.alcance', usuario: u.id, usuarioNombre: u.nombre, todas: true }; }
  m = t.match(/^(.+?)\s+solo\s+(?:entra|puede entrar)\s+a\s+(?:la\s+)?sucursal\s+(.+)$/);
  if (m) { const u = usuarios.find((x) => llano(x.nombre) === m[1]); if (u) return { intent: 'multi.alcance', usuario: u.id, usuarioNombre: u.nombre, sucursalTexto: m[2] }; }
  return null;
}

module.exports = { multi };
