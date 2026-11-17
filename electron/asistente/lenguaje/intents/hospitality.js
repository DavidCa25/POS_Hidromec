'use strict';
/* HOSPITALITY (restaurante, café, panadería): producción, mesas, cocina, recetas. */
module.exports = [
  {
    id: 'produccion.faltantes', etiqueta: '¿Qué me falta para producir?', tipo: 'consulta', modulo: 'hospitality',
    slots: { cantidad: { requerido: true }, producto: { requerido: true }, fecha: {} },
    claves: ['falta', 'faltan', 'alcanza', 'necesito', 'suficiente', 'ingredientes'],
    ejemplos: [
      'que me falta para producir {n} {prod}', 'que me falta comprar para hacer {n} {prod} {fecha}', 'alcanza para {n} {prod}',
      'me alcanza para hacer {n} {prod}', 'que necesito para producir {n} {prod}', 'tengo suficiente para {n} {prod}',
      'ingredientes para {n} {prod}', 'cuanto necesito para {n} {prod}', 'puedo hacer {n} {prod}', 'cuanta harina necesito para {n} {prod}',
    ],
  },
  {
    id: 'produccion.planear', etiqueta: 'Planear producción', tipo: 'accion', modulo: 'hospitality', permiso: 'PRODUCCION_OPERAR',
    slots: { cantidad: { requerido: true }, producto: { requerido: true }, fecha: {} },
    claves: ['planea', 'planear', 'programa', 'hornear', 'tanda', 'producir', 'agenda'],
    ejemplos: [
      'planea {n} {prod} para {fecha}', 'programa {n} {prod} {fecha}', 'vamos a producir {n} {prod} {fecha}', 'producir {n} {prod}',
      'hornear {n} {prod} {fecha}', 'haz una tanda de {n} {prod}', 'quiero producir {n} {prod} {fecha}', 'pon a producir {n} {prod}',
      'mete al horno {n} {prod}', 'nueva tanda {n} {prod}',
    ],
  },
  {
    id: 'produccion.hoy', etiqueta: 'Producción del día', tipo: 'consulta', modulo: 'hospitality',
    slots: { fecha: {} },
    claves: ['produccion', 'producido', 'hornearon', 'tandas', 'hicieron'],
    ejemplos: ['que se produjo hoy', 'que hay que producir {fecha}', 'tandas de hoy', 'como va la produccion', 'que se horneo hoy',
               'que esta en produccion', 'cuanto hicieron hoy'],
  },
  {
    id: 'hosp.mesas', etiqueta: 'Mesas abiertas', tipo: 'consulta', modulo: 'hospitality',
    slots: {},
    claves: ['mesas', 'ocupadas', 'abiertas', 'libres', 'cuentas'],
    ejemplos: ['cuantas mesas hay ocupadas', 'que mesas estan abiertas', 'hay mesas libres', 'cuentas abiertas', 'como esta el salon',
               'cuanta gente hay'],
  },
  {
    id: 'hosp.cuenta', etiqueta: 'Cuenta de una mesa', tipo: 'consulta', modulo: 'hospitality',
    slots: { mesa: { requerido: true } },
    claves: ['mesa', 'cuenta', 'lleva', 'consumo', 'pide'],
    ejemplos: ['cuanto lleva la mesa {mesa}', 'cuenta de la mesa {mesa}', 'que pidio la mesa {mesa}', 'la mesa {mesa} pide la cuenta',
               'consumo de la mesa {mesa}', 'cuanto debe la {mesa}'],
  },
  {
    id: 'hosp.cocina', etiqueta: 'Comandas en cocina', tipo: 'consulta', modulo: 'hospitality',
    slots: {},
    claves: ['cocina', 'comandas', 'pendientes', 'atrasado', 'tarda', 'preparando', 'barra'],
    ejemplos: ['que hay pendiente en cocina', 'cuantas comandas hay', 'que se esta tardando', 'comandas atrasadas', 'como va la cocina',
               'que esta preparando la barra'],
  },
  {
    id: 'hosp.receta', etiqueta: 'Receta de un producto', tipo: 'consulta', modulo: 'hospitality',
    slots: { producto: { requerido: true } },
    claves: ['receta', 'lleva', 'ingredientes', 'prepara', 'contiene'],
    ejemplos: ['que lleva {prod}', 'receta de {prod}', 'ingredientes de {prod}', 'como se prepara {prod}', 'que contiene {prod}',
               'cuanto lleva de cafe {prod}'],
  },
  {
    id: 'hosp.pedidos', etiqueta: 'Pedidos en línea pendientes', tipo: 'consulta',
    slots: {},
    claves: ['pedidos', 'linea', 'internet', 'whatsapp', 'llegaron', 'pendientes'],
    ejemplos: ['hay pedidos en linea', 'pedidos pendientes', 'llegaron pedidos', 'pedidos de whatsapp', 'cuantos pedidos hay sin aceptar'],
  },
  {
    id: 'hosp.propinas', etiqueta: 'Propinas', tipo: 'consulta', modulo: 'hospitality',
    slots: { periodo: {} },
    claves: ['propinas', 'propina', 'tips'],
    ejemplos: ['cuanto se junto de propinas', 'propinas de hoy', 'cuanta propina hay', 'propinas de la semana', 'cuanto toca de propina'],
  },
];
