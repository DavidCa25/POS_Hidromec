'use strict';
/* COMPRAS: qué comprar, qué se compró y a qué costo. */
module.exports = [
  {
    id: 'consulta.comprar', etiqueta: '¿Qué me falta comprar?', tipo: 'consulta',
    slots: {},
    claves: ['comprar', 'acaba', 'agotarse', 'pedir', 'surtir', 'resurtir'],
    ejemplos: [
      'que me falta comprar', 'que tengo que comprar', 'que se esta acabando', 'que se acaba', 'lista de compras',
      'que debo pedir al proveedor', 'que necesito comprar esta semana', 'que productos estan por agotarse', 'sugerencia de compra',
      'que tengo que surtir', 'que pido', 'que se me esta terminando', 'arma la lista de compras', 'hay algo que surtir',
    ],
  },
  {
    id: 'compra.pedido', etiqueta: 'Pedido para un proveedor', tipo: 'consulta',
    slots: { proveedor: { requerido: true } },
    claves: ['pedido', 'pedirle', 'pido', 'orden', 'surtir', 'viene'],
    ejemplos: ['que le pido a {persona}', 'arma el pedido de {persona}', 'pedido para {persona}', 'que le encargo a {persona}',
               'ya viene {persona} que le pido', 'orden de compra para {persona}', 'que necesito de {persona}'],
  },
  {
    id: 'compra.ultima', etiqueta: 'Última compra de un producto', tipo: 'consulta', permiso: 'VER_COSTOS',
    slots: { producto: { requerido: true } },
    claves: ['ultima', 'compre', 'compramos', 'costo', 'cuando', 'pague'],
    ejemplos: ['cuando compre {prod} por ultima vez', 'a cuanto compre {prod}', 'ultima compra de {prod}', 'a quien le compre {prod}',
               'cuanto me costo {prod} la ultima vez', 'en cuanto me dejaron {prod}', 'a como lo compre {prod}'],
  },
  {
    id: 'compra.resumen', etiqueta: '¿Cuánto he comprado?', tipo: 'consulta', permiso: 'VER_COSTOS',
    slots: { periodo: {} },
    claves: ['compre', 'compras', 'comprado', 'gaste', 'mercancia'],
    ejemplos: ['cuanto he comprado {periodo}', 'compras del mes', 'cuanto gaste en mercancia', 'cuanto le compre a proveedores {periodo}',
               'total de compras', 'cuanto he invertido en compras'],
  },
  {
    id: 'compra.registrar', etiqueta: 'Registrar una compra', tipo: 'pantalla', permiso: 'INVENTARIO_OPERAR',
    slots: { proveedor: {} },
    claves: ['registrar', 'llego', 'llegaron', 'recibi', 'entrada', 'factura', 'compra'],
    ejemplos: ['registra una compra', 'llego el pedido de {persona}', 'recibi mercancia de {persona}', 'quiero meter una compra',
               'capturar la factura de {persona}', 'entrada de mercancia', 'ya llego {persona}'],
  },
];
