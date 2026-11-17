'use strict';
/* FACTURACIÓN: se consulta aquí; timbrar y cancelar siempre en su pantalla. */
module.exports = [
  {
    id: 'factura.resumen', etiqueta: 'Facturas del mes', tipo: 'consulta',
    slots: { periodo: {} },
    claves: ['facturas', 'facture', 'facturado', 'timbradas', 'cfdi', 'pendientes'],
    ejemplos: ['cuantas facturas llevo', 'facturas del mes', 'cuanto he facturado', 'hay facturas con error', 'facturas pendientes',
               'que facturas se timbraron hoy'],
  },
  {
    id: 'factura.emitir', etiqueta: 'Facturar una venta', tipo: 'pantalla',
    slots: { folio: {} },
    claves: ['factura', 'facturar', 'facturale', 'timbra', 'timbrar'],
    ejemplos: ['factura la venta {folio}', 'quiero facturar', 'hazle factura al ticket {folio}', 'timbra el ticket {folio}',
               'el cliente quiere factura', 'facturar una venta'],
  },
  {
    id: 'factura.cancelar', etiqueta: 'Cancelar una factura', tipo: 'pantalla',
    slots: { folio: {} },
    claves: ['cancela', 'cancelar', 'cancelacion', 'anular'],
    ejemplos: ['cancela la factura {folio}', 'quiero cancelar una factura', 'anular factura', 'cancelacion de cfdi'],
  },
];
