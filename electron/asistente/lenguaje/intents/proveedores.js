'use strict';
/* PROVEEDORES: a quién le debo, quién me surte, pagos y altas. */
module.exports = [
  {
    id: 'proveedor.deuda', etiqueta: '¿Cuánto le debo a proveedores?', tipo: 'consulta', permiso: 'VER_COSTOS',
    slots: { proveedor: {} },
    claves: ['debo', 'deuda', 'adeudo', 'pagar', 'pendiente', 'cuentas'],
    ejemplos: ['a quien le debo', 'cuanto le debo a {persona}', 'que le debo a los proveedores', 'cuentas por pagar',
               'cuanto debo de mercancia', 'tengo pagos pendientes', 'cuanto se le debe a {persona}'],
  },
  {
    id: 'proveedor.pago', etiqueta: 'Pagar a un proveedor', tipo: 'accion', permiso: 'RETIROS_EGRESOS',
    slots: { proveedor: { requerido: true }, monto: { requerido: true }, metodo: { requerido: true } },
    claves: ['paga', 'pagale', 'pague', 'abona', 'abonale', 'liquida', 'liquidale'],
    ejemplos: ['pagale {monto} a {persona}', 'registra un pago de {monto} a {persona}', 'abonale {monto} a {persona}',
               'le pague {monto} a {persona} en efectivo', 'liquida a {persona}', 'pago a proveedor {persona} {monto}'],
  },
  {
    id: 'proveedor.alta', etiqueta: 'Dar de alta un proveedor', tipo: 'accion', permiso: 'INVENTARIO_OPERAR',
    slots: { nombre: { requerido: true }, telefono: {} },
    claves: ['proveedor', 'alta', 'nuevo', 'agrega', 'registra'],
    ejemplos: ['agrega al proveedor {nuevo}', 'nuevo proveedor {nuevo}', 'da de alta al proveedor {nuevo}', 'registra un proveedor que se llama {nuevo}',
               'alta de proveedor {nuevo} telefono {n}'],
  },
  {
    id: 'proveedor.quien', etiqueta: '¿Quién me surte un producto?', tipo: 'consulta',
    slots: { producto: { requerido: true } },
    claves: ['surte', 'quien', 'trae', 'vende', 'proveedor', 'consigo'],
    ejemplos: ['quien me surte {prod}', 'quien me trae {prod}', 'que proveedor tiene {prod}', 'a quien le compro {prod}',
               'donde consigo {prod}', 'proveedor de {prod}'],
  },
  {
    id: 'proveedor.contacto', etiqueta: 'Contacto de un proveedor', tipo: 'consulta',
    slots: { proveedor: { requerido: true } },
    claves: ['telefono', 'numero', 'contacto', 'correo', 'whatsapp', 'datos'],
    ejemplos: ['telefono de {persona}', 'numero de {persona}', 'pasame el contacto de {persona}', 'datos del proveedor {persona}',
               'como contacto a {persona}', 'correo de {persona}'],
  },
];
