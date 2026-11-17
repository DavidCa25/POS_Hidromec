'use strict';
/* Conversación y navegación: lo que no es de un área del negocio. */
module.exports = [
  {
    id: 'saludo', etiqueta: 'Saludo', tipo: 'consulta', slots: {},
    claves: ['hola', 'buenos', 'buenas', 'gracias', 'hey', 'adios', 'bye'],
    ejemplos: ['hola', 'buenos dias', 'buenas tardes', 'buenas noches', 'que tal', 'hey wybix', 'gracias', 'ok gracias', 'hola wybix',
               'muchas gracias', 'que onda', 'perfecto gracias', 'listo gracias', 'adios', 'nos vemos'],
  },
  {
    id: 'ayuda', etiqueta: '¿Qué puedes hacer?', tipo: 'consulta', slots: {},
    claves: ['ayuda', 'puedes', 'sabes', 'funcionas', 'comandos'],
    ejemplos: ['que puedes hacer', 'ayuda', 'como funcionas', 'que sabes hacer', 'en que me ayudas', 'comandos', 'que te puedo pedir',
               'para que sirves', 'como te uso', 'que haces', 'necesito ayuda'],
  },
  {
    id: 'ayuda.como', etiqueta: '¿Cómo se hace algo en Wybix?', tipo: 'consulta',
    slots: { destino: {} },
    claves: ['como', 'hago', 'donde', 'pasos', 'enseñame', 'ensename', 'tutorial'],
    ejemplos: ['como hago una devolucion', 'como registro una compra', 'donde veo los cortes', 'como doy de alta un producto',
               'como le hago para facturar', 'enseñame a cobrar', 'donde se cambian los precios', 'como agrego un cliente',
               'pasos para hacer el corte', 'donde estan los reportes', 'como se usa el inventario'],
  },
  {
    id: 'ir_a', etiqueta: 'Ir a una pantalla', tipo: 'consulta',
    slots: { destino: { requerido: true } },
    claves: ['abre', 'abrir', 'llevame', 'ir', 've', 'muestrame', 'entra', 'pantalla', 'pasame', 'mandame'],
    ejemplos: [
      'abre inventario', 'llevame a compras', 'ir a ventas', 'abre la venta', 'quiero ver clientes', 'muestrame produccion',
      've a configuracion', 'abrir recetas', 'ir al corte', 'entra a reportes', 'abre alertas', 'llevame a proveedores',
      'abre gastos', 'ir a inicio', 'muestrame el inventario', 'abre el cierre del dia',
      'pasame a inventario', 'pasame a compras', 'mandame a clientes', 'llevame al inventario', 'vamos a produccion',
    ],
  },
  {
    id: 'consulta.pendientes', etiqueta: '¿Qué debo revisar?', tipo: 'consulta', slots: {},
    claves: ['pendientes', 'pendiente', 'revisar', 'problemas', 'recomiendas', 'avisos', 'negocio', 'atender', 'atencion'],
    ejemplos: [
      'que pendientes tengo', 'que tengo que revisar', 'que problemas hay', 'hay algo mal', 'que me recomiendas',
      'como esta mi negocio', 'algo que deba saber', 'avisos', 'que esta mal', 'revisa mi negocio', 'que hay pendiente',
      'que necesita mi atencion', 'dame los pendientes', 'que me falta revisar', 'como ves el negocio', 'que mejorarias',
    ],
  },
];
