'use strict';
/* PERSONAL: quién vino, quién vendió. */
module.exports = [
  {
    id: 'personal.asistencia', etiqueta: '¿Quién vino a trabajar?', tipo: 'consulta', modulo: 'asistencia',
    slots: {},
    claves: ['vino', 'llego', 'falto', 'trabajando', 'asistencia', 'checo', 'turno'],
    ejemplos: ['quien vino hoy', 'quien esta trabajando', 'quien falto', 'quien llego tarde', 'asistencia de hoy', 'quien ya checo',
               'quien no ha llegado'],
  },
  {
    id: 'personal.ventas', etiqueta: 'Ventas por cajero', tipo: 'consulta', permiso: 'VER_VENTAS_TODOS',
    slots: { periodo: {}, filtros: {} }, analitica: { agrupar: 'cajero' },
    claves: ['cajero', 'cajeros', 'vendio', 'empleado', 'vendedor', 'quien'],
    ejemplos: ['cuanto vendio cada cajero', 'quien vendio mas hoy', 'ventas por empleado', 'cuanto lleva cada cajero',
               'que cajero vende mas', 'ventas por vendedor {periodo}'],
  },
];
