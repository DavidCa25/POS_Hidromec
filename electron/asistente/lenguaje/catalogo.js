/**
 * CATÁLOGO HABLADO (reglas, no clasificador)
 *
 *   «crea la categoría Lácteos», «agrega la marca Lala»
 *   «Bimbo me surte las conchas», «el proveedor principal de la concha es Bimbo»,
 *   «Bimbo ya no me surte las conchas»
 *
 * Aquí solo se entiende la frase; quién es el producto y quién el proveedor
 * lo resuelve el intérprete con su catálogo.
 */
'use strict';

const { llano } = require('./edicion');

const ALTA = /^(?:por favor\s+)?(?:crea|crear|creame|agrega|agregar|agregame|anade|da de alta|dar de alta|registra|registrar|haz|hazme|abre)\s+(?:una?\s+|la\s+|el\s+)?(?:nueva\s+)?(categoria|marca)\s+(?:nueva\s+)?(?:de\s+|llamada\s+|que se llame\s+)?(.+)$/;

const limpio = (s) => String(s || '').trim().replace(/^["'«“]+|["'»”.]+$/g, '').trim();
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * @returns null o
 *   { intent: 'categoria.alta' | 'marca.alta', nombre }
 *   { intent: 'producto.proveedor', accion: 'agregar' | 'principal' | 'quitar', textoProveedor, textoProducto }
 */
function catalogo(texto) {
  const raw = String(texto || '').trim().replace(/[¿?¡!]+/g, '');
  const t = llano(raw);
  if (!t) return null;

  const alta = t.match(ALTA);
  if (alta) {
    const nombre = capital(limpio(raw.slice(t.length - alta[2].length)));
    if (nombre) return { intent: alta[1] === 'categoria' ? 'categoria.alta' : 'marca.alta', nombre };
  }

  /* «Bimbo ya no me surte las conchas», «quita a Bimbo como proveedor de la concha». */
  let m = t.match(/^(.+?)\s+ya no (?:me |nos )?(?:surte|vende|trae|provee)\s+(.+)$/)
    || t.match(/^(?:quita|quitale|borra|elimina)\s+(?:a\s+)?(.+?)\s+(?:como|de)\s+proveedor\s+(?:de|del|de la|de las|de los)\s+(.+)$/);
  if (m) return { intent: 'producto.proveedor', accion: 'quitar', textoProveedor: m[1], textoProducto: m[2] };

  /* «El proveedor principal de la concha es Bimbo», «las conchas se las compro a Bimbo». */
  m = t.match(/^(?:el\s+)?proveedor\s+(?:principal|de siempre|fijo)\s+(?:de|del|de la|de las|de los)\s+(.+?)\s+(?:es|sera|va a ser)\s+(.+)$/)
    || t.match(/^(?:pon|ponle|ponme|haz|deja)\s+(?:a\s+)?(.+?)\s+(?:como\s+)?(?:el\s+)?proveedor\s+principal\s+(?:de|del|de la|de las|de los)\s+(.+)$/);
  if (m) {
    const [prod, prov] = /^el\s+proveedor|^proveedor/.test(t) ? [m[1], m[2]] : [m[2], m[1]];
    return { intent: 'producto.proveedor', accion: 'principal', textoProveedor: prov, textoProducto: prod };
  }

  /* «Bimbo me surte las conchas», «agrega a Bimbo como proveedor de la concha». */
  m = t.match(/^(.+?)\s+(?:tambien\s+)?(?:me |nos )?(?:surte|provee)\s+(?:de\s+)?(.+)$/)
    || t.match(/^(?:agrega|agregale|pon|ponle|anade|registra)\s+(?:a\s+)?(.+?)\s+(?:como|de)\s+proveedor\s+(?:de|del|de la|de las|de los)\s+(.+)$/);
  if (m && !/^(?:quien|que|cual|cuanto|donde)\b/.test(m[1])) return { intent: 'producto.proveedor', accion: 'agregar', textoProveedor: m[1], textoProducto: m[2] };
  m = t.match(/^(?:el\s+)?proveedor\s+(?:de|del|de la|de las|de los)\s+(.+?)\s+(?:es|sera)\s+(.+)$/);
  if (m) return { intent: 'producto.proveedor', accion: 'principal', textoProveedor: m[2], textoProducto: m[1] };
  return null;
}

module.exports = { catalogo };
