'use strict';
/* SISTEMA: el doctor técnico, contestado en el chat, y los apodos que el
   negocio le enseña a Wybix. Los de apodo son `soloRegla`: los reconoce la
   forma de la frase (lenguaje/apodos.js), nunca el clasificador. */
module.exports = [
  {
    id: 'sistema.estado', etiqueta: '¿Cómo está el sistema?', tipo: 'consulta',
    slots: {},
    claves: ['respaldo', 'nube', 'licencia', 'impresora', 'sistema', 'internet', 'sincroniza', 'funciona'],
    ejemplos: ['como esta el sistema', 'se hizo el respaldo', 'esta sincronizando la nube', 'cuando vence la licencia',
               'la impresora esta bien', 'todo funciona bien', 'hay algun problema con el sistema', 'esta conectado a internet'],
  },
  {
    id: 'sistema.alias', etiqueta: 'Enseñarle un apodo', tipo: 'accion', soloRegla: true,
    slots: { alias: { requerido: true }, objetivo: { requerido: true } },
    claves: ['dile', 'llamale', 'apodo', 'decimos', 'dicen'],
    ejemplos: [],
  },
  {
    id: 'sistema.alias_olvidar', etiqueta: 'Olvidar un apodo', tipo: 'accion', soloRegla: true,
    slots: { alias: { requerido: true } },
    claves: ['olvida', 'olvidate', 'apodo'],
    ejemplos: [],
  },
  {
    /* «Llámame Jesús», «sin gráficas», «léeme las respuestas»: solo cambia
       cómo le habla Wybix a esa persona (lenguaje/referencias.js). */
    id: 'sistema.preferencia', etiqueta: 'Cómo quieres que te hable', tipo: 'consulta', soloRegla: true,
    slots: { preferencia: { requerido: true } },
    claves: ['llamame', 'resumen', 'graficas', 'voz', 'preferencias'],
    ejemplos: [],
  },
];
