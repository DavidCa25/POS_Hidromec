'use strict';
/* CLIENTES: fiado, abonos, mejores clientes, puntos y cumpleaños. */
module.exports = [
  {
    id: 'cliente.deuda', etiqueta: '¿Quién me debe?', tipo: 'consulta',
    slots: { cliente: {} },
    claves: ['debe', 'deben', 'fiado', 'fio', 'credito', 'adeudo', 'cobrar', 'cuenta'],
    ejemplos: ['quien me debe', 'cuanto me debe {persona}', 'cuanto tengo fiado', 'clientes que deben', 'cuentas por cobrar',
               'cuanto debe {persona}', 'cuanto le he fiado a {persona}', 'estado de cuenta de {persona}'],
  },
  {
    id: 'cliente.abono', etiqueta: 'Registrar un abono de cliente', tipo: 'accion', permiso: 'VENTAS_OPERAR',
    slots: { cliente: { requerido: true }, monto: { requerido: true }, metodo: { requerido: true } },
    claves: ['abono', 'abonar', 'abona', 'pago', 'pago', 'dejo', 'trajo'],
    ejemplos: ['{persona} abono {monto}', 'registra un abono de {monto} de {persona}', '{persona} me pago {monto}', 'abono de {persona} {monto}',
               '{persona} dejo {monto} a cuenta', '{persona} trajo {monto} de lo que debe', 'abonale {monto} a la cuenta de {persona}'],
  },
  {
    id: 'cliente.alta', etiqueta: 'Dar de alta un cliente', tipo: 'accion', permiso: 'VENTAS_OPERAR',
    slots: { nombre: { requerido: true }, telefono: {} },
    claves: ['cliente', 'alta', 'nuevo', 'agrega', 'registra'],
    ejemplos: ['agrega al cliente {nuevo}', 'nuevo cliente {nuevo}', 'da de alta a {nuevo} como cliente', 'registra un cliente {nuevo} telefono {n}',
               'alta de cliente {nuevo}'],
  },
  {
    id: 'cliente.top', etiqueta: 'Mis mejores clientes', tipo: 'consulta', permiso: 'VER_NUMEROS_DIA',
    slots: { periodo: {} },
    claves: ['mejores', 'clientes', 'compra', 'frecuentes', 'top', 'gasta'],
    ejemplos: ['quienes son mis mejores clientes', 'que cliente compra mas', 'clientes frecuentes', 'top de clientes',
               'quien gasta mas en la tienda', 'mis clientes mas fieles'],
  },
  {
    id: 'cliente.info', etiqueta: 'Datos de un cliente', tipo: 'consulta',
    slots: { cliente: { requerido: true } },
    claves: ['telefono', 'datos', 'compra', 'vino', 'ultima', 'cliente'],
    ejemplos: ['datos de {persona}', 'telefono de {persona}', 'cuando vino {persona} por ultima vez', 'que compra {persona}',
               'cuanto ha comprado {persona}', 'informacion del cliente {persona}'],
  },
  {
    id: 'cliente.puntos', etiqueta: 'Puntos de un cliente', tipo: 'consulta', modulo: 'loyalty',
    slots: { cliente: { requerido: true } },
    claves: ['puntos', 'monedero', 'sellos', 'acumulado', 'premio'],
    ejemplos: ['cuantos puntos tiene {persona}', 'puntos de {persona}', 'cuanto tiene en monedero {persona}', 'sellos de {persona}',
               'ya tiene premio {persona}'],
  },
  {
    id: 'cliente.cumple', etiqueta: '¿Quién cumple años?', tipo: 'consulta',
    slots: { periodo: {} },
    claves: ['cumple', 'cumpleanos', 'cumpleaños', 'cumplen'],
    ejemplos: ['quien cumple anos hoy', 'cumpleanos de la semana', 'que clientes cumplen este mes', 'hay cumpleanos hoy',
               'quien cumple esta semana'],
  },
  {
    /* Regla (lenguaje/edicion.js: edicionPersona), no clasificador. */
    id: 'cliente.editar', etiqueta: 'Cambiar datos de un cliente', tipo: 'accion', permiso: 'VENTAS_OPERAR', soloRegla: true,
    slots: { cliente: { requerido: true }, campo: { requerido: true }, valor: { requerido: true } },
    claves: ['telefono', 'correo', 'limite', 'rfc'],
    ejemplos: [],
  },
  /* Fidelización: reglas de lenguaje/fidelizacion.js, no clasificador. */
  {
    id: 'puntos.ajustar', etiqueta: 'Ajustar puntos de un cliente', tipo: 'accion', permiso: 'VENTAS_SUPERVISAR', soloRegla: true,
    slots: { cliente: { requerido: true }, cantidad: { requerido: true }, nota: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'club.cancelar', etiqueta: 'Cancelar una membresía', tipo: 'accion', permiso: 'VENTAS_SUPERVISAR', soloRegla: true,
    slots: { cliente: { requerido: true }, nota: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'rifa.cerrar', etiqueta: 'Cerrar una rifa', tipo: 'accion', permiso: 'VENTAS_SUPERVISAR', soloRegla: true,
    slots: { textoRifa: { requerido: true } }, claves: [], ejemplos: [],
  },
  {
    id: 'rifa.sortear', etiqueta: 'Sortear una rifa', tipo: 'accion', permiso: 'VENTAS_SUPERVISAR', soloRegla: true,
    slots: { textoRifa: { requerido: true }, ganadores: {}, suplentes: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'cupon.emitir', etiqueta: 'Emitir cupones', tipo: 'accion', permiso: 'CREDITO_CUPONES', soloRegla: true,
    slots: { textoCupon: { requerido: true }, cantidad: {}, cliente: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'puntos.config', etiqueta: 'Configurar los puntos', tipo: 'accion', permiso: 'COMERCIAL_ADMINISTRAR', soloRegla: true,
    slots: { puntos: {}, cadaMonto: {}, caducaMeses: {}, porVisita: {}, activo: {} }, claves: [], ejemplos: [],
  },
];
