/**
 * RECETAS, FÓRMULAS, PRESENTACIONES, OPCIONES Y DUEÑO (reglas, no clasificador)
 *
 *   «la hamburguesa lleva 150 gramos de carne, 1 pan y 2 rebanadas de queso»
 *   «quítale el queso a la receta de la hamburguesa», «borra la receta de la hamburguesa»
 *   «la fórmula de las conchas: 1 kilo de harina y 200 gramos de azúcar, rinde 20», «borra la fórmula de las conchas»
 *   «la coca también se vende en caja de 24», «borra la presentación caja de 24 de la coca»
 *   «crea el grupo Tamaño con chico, mediano +5 y grande +10», «el latte lleva el grupo Tamaño»,
 *   «quítale el grupo Tamaño al latte», «borra el grupo Tamaño»
 *   «las conchas son de Juan» (Socios)
 *   «aplica el conteo de la coca», «descarta el reporte de la coca», «ya revisé el inventario»
 */
'use strict';

const { llano } = require('./edicion');

const UNIDAD = [
  [/^(?:g|gr|grs|gramos?)$/, 'g'], [/^(?:kg|kgs|kilos?|kilogramos?)$/, 'kg'], [/^(?:mg|miligramos?)$/, 'mg'],
  [/^(?:ml|mililitros?)$/, 'ml'], [/^(?:l|lt|lts|litros?)$/, 'L'], [/^(?:oz|onzas?)$/, 'oz'],
  [/^(?:pza|pzas|piezas?|unidad(?:es)?|rebanadas?|hojas?|tortillas?)$/, 'pza'],
];
const NUM = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, medio: 0.5, media: 0.5 };

/** «150 gramos de carne», «1 pan», «2 rebanadas de queso» → { cantidad, unidad, texto }. */
function renglon(s) {
  const t = s.trim().replace(/^(?:y|e|con)\s+/, '');
  const m = t.match(/^(\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|medio|media)\s+(?:(\w+)\s+de\s+)?(.+)$/);
  if (!m) return null;
  const cantidad = NUM[m[1]] ?? Number(String(m[1]).replace(',', '.'));
  let unidad = null, texto = m[3];
  if (m[2]) {
    const u = UNIDAD.find(([re]) => re.test(m[2]));
    if (u) unidad = u[1]; else texto = `${m[2]} de ${m[3]}`;
  }
  if (unidad === 'pza' && /^(?:rebanadas?|hojas?)$/.test(m[2] || '')) texto = m[3];
  return cantidad > 0 ? { cantidad, unidad, texto: texto.trim() } : null;
}
const renglones = (s) => s.split(/\s*,\s*|\s+y\s+(?=\d|un\b|una\b|uno\b|dos\b|tres\b|cuatro\b|cinco\b|medio\b|media\b)/).map(renglon);

function recetas(texto) {
  const raw = String(texto || '').trim().replace(/[¿?¡!]+/g, '');
  const t = llano(raw);
  if (!t || /^(?:cuanto|cuantos|que|cual|como|dime|de que)\b/.test(t)) return null;

  /* ---------------------------------------------------------- fórmulas */
  let m = t.match(/^(?:borra|elimina|quita)\s+(?:la\s+)?formula\s+(?:de\s+produccion\s+)?(?:de|del|de la|de las|de los)\s+(.+)$/);
  if (m) return { intent: 'formula.quitar', textoProducto: m[1] };
  m = t.match(/^(?:la\s+)?formula\s+(?:de\s+produccion\s+)?(?:de|del|de la|de las|de los)\s+(.+?)\s*(?::|es|lleva|son)\s+(.+?)(?:\s*[,;]?\s+(?:y\s+)?rinde\s+(\d+(?:\.\d+)?))?$/);
  if (m) {
    const ls = renglones(m[2]);
    if (ls.length && ls.every(Boolean)) return { intent: 'formula.guardar', textoProducto: m[1], lineas: ls, rinde: m[3] ? Number(m[3]) : null };
  }

  /* ----------------------------------------------------------- recetas */
  m = t.match(/^(?:borra|elimina)\s+(?:la\s+)?receta\s+(?:de|del|de la|de las|de los)\s+(.+)$/);
  if (m) return { intent: 'receta.borrar', textoProducto: m[1] };
  m = t.match(/^(?:quitale|quita|saca|sacale)\s+(?:el|la|los|las)?\s*(.+?)\s+a\s+(?:la\s+)?receta\s+(?:de|del|de la|de las|de los)\s+(.+)$/);
  if (m) return { intent: 'receta.guardar', textoProducto: m[2], quitarTexto: m[1] };
  m = t.match(/^(?:la\s+receta\s+(?:de|del|de la|de las|de los)\s+)?(?:el|la|los|las|cada)?\s*(.+?)\s+(?:lleva|llevan|tambien lleva|tambien llevan|se hace con|se hacen con)\s+(.+)$/);
  if (m) {
    const ls = renglones(m[2]);
    if (ls.length && ls.every(Boolean)) return { intent: 'receta.guardar', textoProducto: m[1], lineas: ls, agrega: /tambien/.test(t) };
  }

  /* ----------------------------------------------------- presentaciones */
  m = t.match(/^(?:borra|elimina|quita)\s+(?:la\s+)?presentacion\s+(.+)\s+(?:de|del|de la|de las|de los)\s+(.+)$/);
  if (m) return { intent: 'presentacion.borrar', presentacion: m[1], textoProducto: m[2] };
  m = t.match(/^(?:el|la|los|las)?\s*(.+?)\s+(?:tambien\s+)?(?:se vende|se venden|se compra|se compran|viene|vienen)\s+(?:tambien\s+)?(?:en|por)\s+(caja|paquete|six|bulto|costal|charola|display|tira|docena|media docena|six pack|reja|bolsa)\s*(?:de\s+)?(\d+)?(?:\s+piezas?)?$/);
  if (m) {
    const factor = m[3] ? Number(m[3]) : m[2] === 'docena' ? 12 : m[2] === 'media docena' ? 6 : m[2] === 'six' || m[2] === 'six pack' ? 6 : null;
    if (factor) return { intent: 'presentacion.guardar', textoProducto: m[1], nombre: `${m[2].charAt(0).toUpperCase() + m[2].slice(1)}${m[3] ? ' de ' + m[3] : ''}`, factor };
  }

  /* --------------------------------------------------- grupos de opciones */
  m = t.match(/^(?:borra|elimina)\s+(?:el\s+)?grupo\s+(?:de\s+opciones\s+)?(.+)$/);
  if (m) return { intent: 'opciones.borrar', grupo: m[1] };
  m = t.match(/^(?:crea|agrega|nuevo)\s+(?:el\s+|un\s+)?grupo\s+(?:de\s+opciones\s+)?(.+?)\s+con\s+(.+)$/);
  if (m) {
    const nombre = raw.slice(t.indexOf(m[1]), t.indexOf(m[1]) + m[1].length);
    const opciones = m[2].split(/\s*,\s*|\s+y\s+/).map((o) => {
      const x = o.trim().match(/^(.+?)(?:\s+(?:\+|mas|por)\s*\$?(\d+(?:\.\d+)?)(?:\s*pesos)?)?$/);
      return x ? { nombre: x[1].trim(), precio: x[2] ? Number(x[2]) : 0 } : null;
    }).filter(Boolean);
    const rol = /tamano|size/.test(m[1]) ? 'SIZE' : /extra|agrega|ingrediente/.test(m[1]) ? 'ADDON' : /sin|nota|indicacion/.test(m[1]) ? 'NOTE' : 'ADDON';
    if (opciones.length) return { intent: 'opciones.crear', nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1), opciones, rol };
  }
  m = t.match(/^(?:quitale|quita)\s+(?:el\s+)?grupo\s+(.+?)\s+(?:al|a la|a los|a las|a)\s+(.+)$/);
  if (m) return { intent: 'opciones.producto', grupo: m[1], textoProducto: m[2], quitar: true };
  m = t.match(/^(?:el|la|los|las)?\s*(.+?)\s+(?:lleva|llevan|tiene|tienen|usa|usan)\s+(?:el\s+)?grupo\s+(?:de\s+)?(.+)$/) || t.match(/^(?:ponle|agregale)\s+(?:el\s+)?grupo\s+(.+?)\s+(?:al|a la|a los|a las|a)\s+(.+)$/);
  if (m) {
    const [prod, grupo] = /^(?:ponle|agregale)/.test(t) ? [m[2], m[1]] : [m[1], m[2]];
    return { intent: 'opciones.producto', grupo, textoProducto: prod, quitar: false };
  }

  /* ------------------------------------------------- dueño (Socios) */
  m = t.match(/^(?:el|la|los|las)?\s*(.+?)\s+(?:es|son)\s+de(?:l socio| la socia)?\s+(.+?)(?:\s+y\s+(?:de\s+)?(.+?))?(?:\s+a medias)?$/);
  if (m && !/\bmesa\b|\bcliente\b/.test(t)) return { intent: 'producto.dueno', textoProducto: m[1], socios: [m[2], m[3]].filter(Boolean) };

  /* ------------------------------------------- reportes de inventario */
  m = t.match(/^(aplica|aplicar|acepta|descarta|descartar|ignora)\s+(?:el\s+)?(?:conteo|reporte|faltante)\s+(?:de|del|de la)\s+(.+)$/);
  if (m) return { intent: 'inventario.reporte', accion: /^(aplica|aplicar|acepta)$/.test(m[1]) ? 'APLICAR' : 'DESCARTAR', textoProducto: m[2] };
  if (/^(?:ya\s+)?revise\s+(?:el\s+)?inventario$|^(?:quita|descarta)\s+(?:el\s+)?aviso\s+de\s+(?:revisar\s+(?:el\s+)?)?inventario$/.test(t)) return { intent: 'inventario.revisado' };
  return null;
}

module.exports = { recetas };
