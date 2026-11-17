'use strict';
/* VENTA: lo que se vendió, lo que más se vende y cuánto sale una cuenta. */
module.exports = [
  {
    id: 'consulta.hoy', etiqueta: '¿Cómo voy de ventas?', tipo: 'consulta', permiso: 'VER_NUMEROS_DIA',
    slots: { periodo: {}, filtros: {} }, analitica: { medida: 'ventas' },
    claves: ['vendido', 'vendi', 'ventas', 'llevamos', 'voy', 'vamos', 'resumen', 'tickets', 'vendimos', 'entrado'],
    ejemplos: [
      'como voy hoy', 'cuanto he vendido', 'cuanto vendi {periodo}', 'ventas de {periodo}', 'como van las ventas', 'cuanto llevamos',
      'como vamos', 'resumen del dia', 'cuantos tickets llevo', 'como estuvo ayer', 'total de ventas', 'cuanto llevo vendido',
      'como va el dia', 'cuanto entro hoy', 'que tal van las ventas', 'como cerramos ayer', 'cuanto dinero ha entrado',
    ],
  },
  {
    id: 'venta.top', etiqueta: '¿Qué es lo que más se vende?', tipo: 'consulta', permiso: 'VER_NUMEROS_DIA',
    slots: { periodo: {}, producto: {}, filtros: {} }, analitica: { agrupar: 'producto', orden: 'piezas' },
    claves: ['mas', 'vendido', 'vende', 'top', 'estrella', 'popular', 'sale'],
    ejemplos: ['que es lo que mas se vende', 'lo mas vendido {periodo}', 'top de productos', 'que se vendio mas {periodo}',
               'cual es mi producto estrella', 'que sale mas', 'los 10 mas vendidos', 'que es lo que mas me compran'],
  },
  {
    id: 'venta.por_pago', etiqueta: 'Ventas por forma de pago', tipo: 'consulta', permiso: 'VER_NUMEROS_DIA',
    slots: { periodo: {}, metodo: {}, filtros: {} }, analitica: { agrupar: 'metodo' },
    claves: ['efectivo', 'tarjeta', 'transferencia', 'forma', 'pago', 'cobrado', 'terminal'],
    ejemplos: ['cuanto vendi en efectivo {periodo}', 'cuanto entro con tarjeta', 'ventas por forma de pago', 'cuanto fue de tarjeta {periodo}',
               'cuanto me pagaron con transferencia', 'cuanto se cobro en la terminal', 'desglose por forma de pago'],
  },
  {
    id: 'venta.horas', etiqueta: '¿A qué hora vendo más?', tipo: 'consulta', permiso: 'VER_NUMEROS_DIA',
    slots: { periodo: {}, filtros: {} }, analitica: { agrupar: 'hora', orden: 'clave' },
    claves: ['hora', 'horas', 'horario', 'llena', 'pico', 'concurrida'],
    ejemplos: ['a que hora vendo mas', 'cual es mi hora pico', 'que horario se vende mas', 'a que hora se llena', 'horas de mas venta',
               'cuando vendo mas en el dia', 'en que horario hay mas clientes'],
  },
  {
    id: 'venta.comparar', etiqueta: '¿Por qué subieron o bajaron las ventas?', tipo: 'consulta', permiso: 'VER_NUMEROS_DIA',
    slots: { periodo: {}, producto: {}, filtros: {} },
    claves: ['comparar', 'compara', 'contra', 'bajaron', 'subieron', 'baje', 'mejor', 'peor', 'diferencia'],
    ejemplos: ['por que bajaron las ventas', 'compara esta semana con la pasada', 'vendi mas o menos que la semana pasada',
               'como voy contra el mes pasado', 'por que vendi menos {periodo}', 'que diferencia hay con la semana pasada', 'estoy vendiendo mas o menos'],
  },
  {
    id: 'venta.buscar', etiqueta: 'Buscar una venta', tipo: 'consulta',
    slots: { folio: { requerido: true } },
    claves: ['folio', 'ticket', 'venta', 'nota', 'busca'],
    ejemplos: ['busca la venta {folio}', 'ticket {folio}', 'que tenia el ticket {folio}', 'muestrame la venta {folio}', 'folio {folio}',
               'quien vendio el ticket {folio}', 'de cuanto fue la venta {folio}'],
  },
  {
    id: 'venta.cotizar', etiqueta: '¿Cuánto es?', tipo: 'consulta',
    slots: { renglones: { requerido: true } },
    claves: ['cuanto', 'es', 'son', 'sale', 'cobro', 'cuenta', 'total', 'suma'],
    ejemplos: ['cuanto es {n} {prod} y {n} {prod}', 'cuanto son {n} {prod}', 'cuanto le cobro por {n} {prod}', 'suma {n} {prod} y {n} {prod}',
               'cuanto sale {n} {prod} con {n} {prod}', 'cuanto seria {n} {prod}', 'total de {n} {prod} y {n} {prod}'],
  },
  {
    /* Con folio arma la devolución (todo el ticket, o lo que se diga de él) y
       la registra por sp-refund-sale con el motivo; sin folio, lo pregunta. */
    id: 'venta.devolucion', etiqueta: 'Hacer una devolución', tipo: 'accion', permiso: 'DEVOLUCIONES',
    slots: { folio: {}, renglones: {}, razon: { requerido: true } },
    claves: ['devolucion', 'devolver', 'regresar', 'reembolso', 'cambio', 'devuelve', 'reembolsa'],
    ejemplos: ['quiero hacer una devolucion', 'devolucion del ticket {folio}', 'el cliente quiere devolver {prod}', 'reembolsa la venta {folio}',
               'regresar dinero de la venta {folio}', 'devuelve el ticket {folio}', 'devuelve {n} {prod} del ticket {folio}',
               'devolucion de {n} {prod} de la venta {folio}', 'el ticket {folio} viene en mal estado devuelvelo'],
  },
  {
    /* Con forma de pago («cóbrale 2 cocas en efectivo») cobra desde el chat
       con el mismo SaleService.checkout de Venta; sin ella, deja la cuenta
       cargada en Venta para elegirla ahí. */
    id: 'venta.cobrar', etiqueta: 'Cobrar una venta', tipo: 'accion', permiso: 'VENTAS_OPERAR',
    slots: { renglones: {}, metodo: {}, monto: {} },
    claves: ['cobra', 'cobrale', 'vende', 'vendele', 'cobrar', 'cobrame', 'despacha'],
    ejemplos: ['cobrale {n} {prod}', 'vendele {n} {prod} y {n} {prod}', 'cobra {n} {prod}', 'quiero cobrar {n} {prod}',
               'hazme una venta de {n} {prod}', 'despacha {n} {prod}', 'cobrame {n} {prod} y {n} {prod}',
               'cobrale {n} {prod} en efectivo', 'cobra {n} {prod} con tarjeta', 'vendele {n} {prod} pago con transferencia'],
  },
  {
    id: 'venta.reimprimir', etiqueta: 'Reimprimir un ticket', tipo: 'accion', permiso: 'VENTAS_OPERAR',
    slots: { folio: {} },
    claves: ['reimprime', 'reimprimir', 'imprime', 'imprimir', 'reimpresion', 'otra', 'vez', 'copia'],
    ejemplos: ['reimprime el ticket {folio}', 'imprime otra vez el ticket {folio}', 'vuelve a imprimir el ultimo ticket',
               'reimprime el ultimo ticket', 'imprime el ticket {folio}', 'sacame una copia del ticket {folio}',
               'reimpresion del ticket {folio}', 'imprime el ultimo ticket otra vez'],
  },
];
