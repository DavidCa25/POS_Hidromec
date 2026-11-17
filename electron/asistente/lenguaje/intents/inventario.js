'use strict';
/* INVENTARIO Y CATÁLOGO: existencias, merma, ajustes, precios y altas. */
module.exports = [
  {
    id: 'consulta.existencia', etiqueta: '¿Cuánto queda de un producto?', tipo: 'consulta',
    slots: { producto: { requerido: true } },
    claves: ['quedan', 'queda', 'hay', 'existencia', 'stock', 'tengo', 'tenemos'],
    ejemplos: [
      'cuantas {prod} quedan', 'cuanto {prod} hay', 'hay {prod}', 'tengo {prod}', 'existencia de {prod}', 'cuantos {prod} tengo',
      'queda {prod}', 'stock de {prod}', 'cuanto me queda de {prod}', 'inventario de {prod}', 'todavia hay {prod}',
    ],
  },
  {
    id: 'producto.info', etiqueta: 'Precio y datos de un producto', tipo: 'consulta',
    slots: { producto: { requerido: true } },
    claves: ['precio', 'como', 'esta', 'vale', 'cuesta', 'codigo', 'datos'],
    ejemplos: ['a como esta {prod}', 'cuanto vale {prod}', 'en cuanto damos {prod}', 'precio de {prod}', 'a como das {prod}',
               'que precio tiene {prod}', 'codigo de {prod}', 'datos de {prod}', 'en cuanto vendo {prod}'],
  },
  {
    id: 'inventario.agotados', etiqueta: '¿Qué está agotado?', tipo: 'consulta',
    slots: {},
    claves: ['agotado', 'agotados', 'cero', 'acabo', 'acabaron', 'sin', 'faltantes'],
    ejemplos: ['que esta agotado', 'que productos estan en cero', 'que se acabo', 'que ya no tengo', 'productos sin existencia',
               'que me falta en el anaquel', 'que esta en ceros', 'que se termino'],
  },
  {
    id: 'inventario.sin_movimiento', etiqueta: '¿Qué no se vende?', tipo: 'consulta',
    slots: {},
    claves: ['mueve', 'movimiento', 'menos', 'estancado', 'parado', 'rezagado', 'muerto'],
    ejemplos: ['que no se vende', 'que productos no se mueven', 'que es lo que menos se vende', 'producto estancado',
               'que tengo parado', 'que lleva mucho sin venderse', 'que esta muerto en el inventario'],
  },
  {
    id: 'inventario.valor', etiqueta: '¿Cuánto vale mi inventario?', tipo: 'consulta', permiso: 'VER_COSTOS',
    slots: {},
    claves: ['valor', 'vale', 'invertido', 'dinero', 'mercancia', 'inventario'],
    ejemplos: ['cuanto vale mi inventario', 'cuanto dinero tengo en mercancia', 'valor del inventario', 'cuanto tengo invertido en producto',
               'cuanto vale lo que hay en la tienda', 'valor de la mercancia'],
  },
  {
    id: 'inventario.movimientos', etiqueta: 'Movimientos de un producto', tipo: 'consulta',
    slots: { producto: { requerido: true } },
    claves: ['movimientos', 'kardex', 'paso', 'historial', 'entradas', 'salidas'],
    ejemplos: ['movimientos de {prod}', 'que ha pasado con {prod}', 'kardex de {prod}', 'historial de {prod}', 'entradas y salidas de {prod}',
               'por que bajo la existencia de {prod}', 'quien movio {prod}'],
  },
  {
    id: 'inventario.ajuste', etiqueta: 'Ajustar existencia', tipo: 'accion', permiso: 'INVENTARIO_OPERAR',
    slots: { producto: { requerido: true }, cantidad: { requerido: true } },
    claves: ['ajusta', 'ajustar', 'ajuste', 'corrige', 'conte', 'conteo', 'realidad', 'fisico'],
    ejemplos: ['ajusta {prod} a {n}', 'en realidad hay {n} {prod}', 'conte {n} {prod}', 'corrige la existencia de {prod} a {n}',
               'deja {prod} en {n}', 'el fisico de {prod} es {n}', 'pon la existencia de {prod} en {n}', 'hay {n} {prod} no los que dice'],
  },
  {
    id: 'merma.registrar', etiqueta: 'Registrar merma', tipo: 'accion', permiso: 'PRODUCCION_OPERAR',
    slots: { cantidad: { requerido: true }, producto: { requerido: true }, motivo: { requerido: true } },
    claves: ['merma', 'cayo', 'cayeron', 'tirar', 'tiramos', 'tira', 'caduc', 'perder', 'quemaron', 'rompieron', 'desperdicio'],
    ejemplos: [
      'registra merma de {n} {prod}', 'merma {n} {prod}', 'se cayeron {n} {prod}', 'tira {n} {prod} caducadas', 'se echaron a perder {n} {prod}',
      'dar de baja {n} {prod} por caducidad', 'se rompieron {n} {prod}', 'tiramos {n} {prod}', 'caducaron {n} {prod}', 'merma {prod}',
      'registra merma', 'quiero registrar una merma', '{n} {prod} a la basura', 'descuenta {n} {prod} por merma',
    ],
  },
  {
    id: 'producto.precio', etiqueta: 'Cambiar un precio', tipo: 'accion', permiso: 'PRECIOS',
    slots: { producto: { requerido: true }, precio: { requerido: true } },
    claves: ['precio', 'sube', 'subele', 'baja', 'bajale', 'cambia', 'cueste'],
    ejemplos: [
      'cambia el precio de {prod} a {precio}', 'sube {prod} a {precio}', 'baja el precio de {prod} a {precio}', 'pon {prod} a {precio}',
      'ahora {prod} cuesta {precio}', '{prod} a {precio}', 'nuevo precio {prod} {precio}', 'subele al {prod} a {precio}',
      'que {prod} cueste {precio}', 'cambiar precio de {prod}', 'quiero cambiar el precio del {prod}', 'ponle {precio} al {prod}', 'sube el precio',
    ],
  },
  {
    id: 'producto.crear', etiqueta: 'Dar de alta un producto', tipo: 'accion', permiso: 'CATALOGO_EDITAR',
    /* costo y existencia se PREGUNTAN (una vez) pero no son obligatorios:
       «no sé» / «ninguno» los deja vacíos. Es un formulario hablado. */
    slots: { nombre: { requerido: true }, precio: { requerido: true }, categoria: { requerido: true },
             costo: { preguntar: true }, existencia: { preguntar: true } },
    claves: ['crea', 'crear', 'alta', 'nuevo', 'agrega', 'registra'],
    ejemplos: [
      'crea producto {nuevo} a {precio}', 'crear {nuevo} a {precio}', 'dar de alta {nuevo} en {precio}', 'nuevo producto {nuevo} {precio}',
      'agrega producto {nuevo} de {precio}', 'alta de {nuevo} a {precio}', 'quiero vender {nuevo} a {precio}', 'crea un producto {nuevo}',
      'dar de alta un producto', 'nuevo producto', 'agrega {nuevo} al catalogo a {precio}',
    ],
  },
  {
    id: 'consulta.ganancia', etiqueta: '¿Cuánto le gano a un producto?', tipo: 'consulta', permiso: 'VER_COSTOS',
    slots: { producto: { requerido: true } },
    claves: ['gano', 'ganancia', 'margen', 'rentable', 'utilidad', 'deja', 'costo'],
    ejemplos: [
      'cuanto gano con {prod}', 'que margen tiene {prod}', 'ganancia de {prod}', 'cuanto le gano a {prod}', 'es rentable {prod}',
      'cuanto me deja {prod}', 'utilidad de {prod}', 'cuanto me cuesta {prod}', 'costo de {prod}', 'cuanto le saco a {prod}',
    ],
  },
  {
    id: 'inventario.traspaso', etiqueta: 'Traspaso entre sucursales', tipo: 'pantalla', permiso: 'INVENTARIO_OPERAR',
    slots: {},
    claves: ['traspaso', 'traspasa', 'manda', 'envia', 'sucursal', 'mover'],
    ejemplos: ['haz un traspaso', 'manda {n} {prod} a la otra sucursal', 'traspasa {prod} a la sucursal', 'enviar mercancia a la sucursal',
               'mover producto entre sucursales', 'traspaso de inventario'],
  },
];
