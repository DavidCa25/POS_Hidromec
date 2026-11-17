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
];
