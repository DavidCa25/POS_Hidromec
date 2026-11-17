'use strict';
/* CAJA: el efectivo, los movimientos y los cortes. */
module.exports = [
  {
    id: 'caja.efectivo', etiqueta: '¿Cuánto hay en caja?', tipo: 'consulta', permiso: 'VER_NUMEROS_DIA',
    slots: {},
    claves: ['caja', 'cajon', 'efectivo', 'dinero', 'hay', 'feria', 'billetes'],
    ejemplos: ['cuanto hay en caja', 'cuanto efectivo tengo', 'cuanto dinero hay en el cajon', 'cuanto deberia haber en caja',
               'cuanta feria hay', 'cuanto tengo en efectivo ahorita', 'cuanto hay en el cajon'],
  },
  {
    id: 'caja.entrada', etiqueta: 'Meter dinero a la caja', tipo: 'accion', permiso: 'RETIROS_EGRESOS',
    slots: { monto: { requerido: true }, nota: {} },
    claves: ['entrada', 'meter', 'mete', 'deposito', 'ingreso', 'fondo', 'cambio', 'agrega'],
    ejemplos: ['entrada de efectivo de {monto}', 'mete {monto} a la caja', 'registra una entrada de {monto}', 'ingresa {monto} de cambio',
               'deposito de {monto} a caja', 'agrega {monto} al cajon', 'meti {monto} de feria', 'entrada de dinero {monto}'],
  },
  {
    id: 'caja.salida', etiqueta: 'Sacar dinero de la caja', tipo: 'accion', permiso: 'RETIROS_EGRESOS',
    slots: { monto: { requerido: true }, nota: {} },
    claves: ['salida', 'saca', 'sacar', 'retiro', 'retira', 'retirar', 'saque'],
    ejemplos: ['salida de efectivo de {monto}', 'saca {monto} de la caja', 'registra un retiro de {monto}', 'retira {monto}',
               'saque {monto} del cajon', 'retiro de {monto} para el banco', 'salida de dinero {monto}'],
  },
  {
    id: 'caja.cortes', etiqueta: 'Cortes de caja anteriores', tipo: 'consulta', permiso: 'CAJA_CORTES',
    slots: { periodo: {} },
    claves: ['cortes', 'corte', 'faltante', 'sobrante', 'diferencia', 'cuadro', 'cuadra', 'descuadre'],
    ejemplos: ['como salieron los cortes', 'hubo faltantes en el corte', 'como cuadro la caja ayer', 'diferencias en los cortes',
               'cortes de la semana', 'sobro o falto dinero', 'el ultimo corte cuadro'],
  },
  {
    id: 'caja.turno', etiqueta: '¿Quién tiene la caja abierta?', tipo: 'consulta',
    slots: {},
    claves: ['turno', 'abierta', 'abrio', 'quien', 'cajero'],
    ejemplos: ['quien abrio la caja', 'hay turno abierto', 'desde que hora esta abierta la caja', 'quien esta en caja',
               'esta abierta la caja', 'con cuanto abrieron la caja'],
  },
  {
    /* Con lo contado («haz el corte, conté 3,250») arma la tarjeta y cierra
       el turno por sp-close-shift; sin monto, lo pregunta. Cerrar el propio
       turno es venta diaria, igual que en la pantalla de Corte. */
    id: 'caja.corte', etiqueta: 'Hacer el corte', tipo: 'accion', permiso: 'VENTAS_OPERAR',
    slots: { monto: { requerido: true } },
    claves: ['corte', 'cerrar', 'cierra', 'cierre', 'cortar', 'conte', 'contado'],
    ejemplos: ['quiero hacer el corte', 'hacer corte de caja', 'cierra la caja', 'vamos a cortar', 'corte del dia',
               'cerrar turno', 'ya quiero cerrar', 'haz el corte conte {monto}', 'cierra la caja hay {monto}',
               'corte con {monto} contados', 'cierra el turno con {monto}', 'conte {monto} haz el corte'],
  },
  {
    id: 'caja.abrir', etiqueta: 'Abrir la caja (turno)', tipo: 'accion', permiso: 'VENTAS_OPERAR',
    slots: { monto: { requerido: true } },
    claves: ['abre', 'abrir', 'abro', 'inicia', 'iniciar', 'empieza', 'turno', 'apertura'],
    ejemplos: ['abre la caja con {monto}', 'abrir turno con {monto} de fondo', 'abre el turno', 'inicia el turno con {monto}',
               'empieza la caja con {monto}', 'quiero abrir caja', 'apertura de caja con {monto}', 'abro con {monto} de fondo',
               'abre turno con {monto}'],
  },
  {
    id: 'caja.cajon', etiqueta: 'Abrir el cajón', tipo: 'accion', permiso: 'VENTAS_OPERAR',
    slots: {},
    claves: ['cajon', 'gaveta', 'abre', 'abreme', 'abrir'],
    ejemplos: ['abre el cajon', 'abreme el cajon', 'abrir cajon', 'necesito abrir el cajon', 'abre la gaveta',
               'abre el cajon del dinero', 'puedes abrir el cajon'],
  },
  {
    id: 'caja.corte_correo', etiqueta: 'Mandar el corte por correo', tipo: 'accion', permiso: 'CAJA_CORTES',
    slots: {},
    claves: ['correo', 'mail', 'email', 'manda', 'envia', 'mandame', 'enviame', 'corte'],
    ejemplos: ['manda el corte por correo', 'envia el ultimo corte por correo', 'mandame el corte al correo',
               'manda por mail el corte', 'envia el corte al email', 'manda el corte de hoy por correo'],
  },
];
