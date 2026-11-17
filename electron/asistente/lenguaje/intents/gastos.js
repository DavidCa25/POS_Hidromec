'use strict';
/* GASTOS: luz, renta, gas, sueldos… lo que sale y no es mercancía. */
module.exports = [
  {
    id: 'gasto.registrar', etiqueta: 'Registrar un gasto', tipo: 'accion', permiso: 'RETIROS_EGRESOS',
    slots: { concepto: { requerido: true }, monto: { requerido: true }, metodo: { requerido: true } },
    claves: ['gasto', 'pague', 'pagamos', 'gaste', 'recibo', 'egreso'],
    ejemplos: ['pague {monto} de luz', 'registra un gasto de {monto} de renta', 'gasto de gas {monto}', 'pagamos {monto} de agua',
               'se pagaron {monto} de internet', 'gaste {monto} en limpieza', 'egreso de {monto} por papeleria', 'anota {monto} de gasolina'],
  },
  {
    id: 'gasto.resumen', etiqueta: '¿Cuánto he gastado?', tipo: 'consulta', permiso: 'VER_NUMEROS_DIA',
    slots: { periodo: {}, concepto: {} },
    claves: ['gastado', 'gastos', 'gaste', 'egresos', 'pagado'],
    ejemplos: ['cuanto he gastado {periodo}', 'gastos del mes', 'en que se me va el dinero', 'cuanto pague de luz', 'resumen de gastos',
               'cuanto gaste {periodo}', 'mis gastos fijos'],
  },
  {
    /* Reglas de lenguaje/gastos.js, no clasificador. */
    id: 'gasto.cancelar', etiqueta: 'Cancelar un gasto', tipo: 'accion', permiso: 'RETIROS_EGRESOS', soloRegla: true,
    slots: { folio: { requerido: true }, motivo: {} }, claves: ['cancela', 'gasto'], ejemplos: [],
  },
  {
    id: 'gasto.concepto', etiqueta: 'Conceptos de gasto', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { accion: { requerido: true }, nombre: {}, concepto: {} }, claves: ['concepto'], ejemplos: [],
  },
];
