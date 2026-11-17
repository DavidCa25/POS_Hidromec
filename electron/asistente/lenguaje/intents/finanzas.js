'use strict';
/* FINANZAS: cuánto se gana de verdad. */
module.exports = [
  {
    id: 'finanzas.ganancia', etiqueta: '¿Cuánto he ganado?', tipo: 'consulta', permiso: 'VER_COSTOS',
    slots: { periodo: {}, filtros: {} }, analitica: { medida: 'ganancia' },
    claves: ['ganado', 'ganancia', 'utilidad', 'gane', 'ganamos', 'gano'],
    ejemplos: ['cuanto he ganado {periodo}', 'cuanto gane {periodo}', 'ganancia del mes', 'utilidad de la semana', 'cuanto ganamos hoy',
               'cuanto me queda de ganancia', 'cuanto es ganancia de lo que vendi'],
  },
  {
    id: 'finanzas.resultado', etiqueta: 'Estado de resultados', tipo: 'consulta', permiso: 'VER_COSTOS',
    slots: { periodo: {} },
    claves: ['resultados', 'numeros', 'balance', 'quedo', 'neto', 'rentable', 'negocio'],
    ejemplos: ['como van los numeros del mes', 'estado de resultados', 'me queda dinero despues de gastos', 'cuanto gane limpio',
               'es rentable mi negocio', 'utilidad neta del mes', 'balance del mes'],
  },
  {
    /* Socios (0079) y Propinas: reglas de lenguaje/socios.js, no clasificador. */
    id: 'socio.movimiento', etiqueta: 'Retiro, pago o aportación de un socio', tipo: 'accion', modulo: 'socios', permiso: 'SOCIOS_GESTIONAR', soloRegla: true,
    slots: { socio: { requerido: true }, tipo: { requerido: true }, monto: { requerido: true }, metodo: {} }, claves: ['socio'], ejemplos: [],
  },
  {
    id: 'socio.liquidar', etiqueta: 'Liquidar a los socios', tipo: 'accion', modulo: 'socios', permiso: 'SOCIOS_GESTIONAR', soloRegla: true,
    slots: { hasta: {} }, claves: ['liquida', 'socios'], ejemplos: [],
  },
  {
    id: 'socio.compra', etiqueta: 'Quién pagó una compra', tipo: 'accion', modulo: 'socios', permiso: 'INVENTARIO_OPERAR', soloRegla: true,
    slots: { folio: { requerido: true }, socio: { requerido: true } }, claves: ['compra', 'pago'], ejemplos: [],
  },
  {
    id: 'socio.gasto', etiqueta: 'De quién es un gasto', tipo: 'accion', modulo: 'socios', permiso: 'RETIROS_EGRESOS', soloRegla: true,
    slots: { folio: { requerido: true }, socio: { requerido: true }, pago: {} }, claves: ['gasto'], ejemplos: [],
  },
  {
    id: 'propinas.repartir', etiqueta: 'Repartir las propinas', tipo: 'accion', modulo: 'propinas', permiso: 'CAJA_CORTES', soloRegla: true,
    slots: {}, claves: ['propinas', 'reparte'], ejemplos: [],
  },
];
