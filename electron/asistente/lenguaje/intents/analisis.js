'use strict';
/* ANÁLISIS: lo que va a pasar y lo que pasaría. Las respuestas salen de
   analitica/ (pronóstico y simulación); ninguna escribe nada. */
module.exports = [
  {
    id: 'analisis.pronostico', etiqueta: '¿Cuánto voy a vender?', tipo: 'consulta', permiso: 'VER_NUMEROS_DIA',
    slots: { fecha: {}, producto: {} },
    claves: ['voy', 'vender', 'vendere', 'venderemos', 'esperar', 'espero', 'pronostico', 'estimado', 'proyeccion', 'hago', 'preparo', 'horneo', 'calcula'],
    ejemplos: ['cuanto voy a vender {fecha}', 'cuanto vamos a vender {fecha}', 'cuanto espero vender {fecha}', 'cuantas {prod} hago {fecha}',
               'cuantos {prod} preparo para {fecha}', 'cuanto se va a vender {fecha}', 'pronostico de ventas', 'cuanto calculas que venda {fecha}'],
  },
  {
    id: 'analisis.agotar', etiqueta: '¿Cuándo se me acaba?', tipo: 'consulta',
    slots: { producto: { requerido: true } },
    claves: ['acaba', 'acabara', 'termina', 'agota', 'alcanza', 'dura', 'durar', 'dias'],
    ejemplos: ['cuando se me acaba {prod}', 'para cuantos dias me alcanza {prod}', 'cuanto me dura {prod}', 'cuando se termina {prod}',
               'hasta cuando me alcanza {prod}', 'en cuantos dias se acaba {prod}'],
  },
  {
    id: 'analisis.simular', etiqueta: '¿Y si cambio el precio?', tipo: 'consulta', permiso: 'VER_COSTOS',
    slots: { producto: { requerido: true }, precio: { requerido: true } },
    claves: ['si', 'subo', 'bajo', 'pasaria', 'conviene', 'simula', 'ganaria', 'perderia', 'subiera', 'bajara'],
    ejemplos: ['si subo {prod} a {precio} cuanto gano', 'que pasa si bajo {prod} a {precio}', 'me conviene subir {prod} a {precio}',
               'cuanto ganaria si vendo {prod} a {precio}', 'simula {prod} a {precio}', 'y si pongo {prod} en {precio}'],
  },
  {
    /* PREGUNTA LIBRE: cualquier combinación de qué medir, cómo agrupar y qué
       filtros («¿qué categoría deja más ganancia los domingos en la tarde?»),
       o comparar dos cosas («café contra concha», «octubre contra
       septiembre»). La reconoce lenguaje/pregunta.js por su forma, no el
       clasificador: por eso no lleva ejemplos. */
    id: 'analisis.libre', etiqueta: 'Pregunta sobre tus ventas', tipo: 'consulta', permiso: 'VER_NUMEROS_DIA', soloRegla: true,
    slots: { pregunta: { requerido: true }, filtros: {}, periodo: {}, producto: {}, producto2: {} },
    claves: ['contra', 'compara', 'categoria', 'hora', 'dia', 'cajero', 'cliente', 'top'],
    ejemplos: [],
  },
];
