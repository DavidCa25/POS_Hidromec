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
  /* Configuración: reglas de lenguaje/config.js, no clasificador. */
  {
    id: 'propinas.config', etiqueta: 'Cómo se reparten las propinas', tipo: 'accion', modulo: 'propinas', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { reparto: { requerido: true } }, claves: [], ejemplos: [],
  },
  {
    id: 'asistencia.reglas', etiqueta: 'Reglas de asistencia', tipo: 'accion', modulo: 'asistencia', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { regla: { requerido: true }, valor: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'asistencia.corregir', etiqueta: 'Corregir una checada', tipo: 'accion', modulo: 'asistencia', permiso: 'ASISTENCIA_GESTIONAR', soloRegla: true,
    slots: { usuario: { requerido: true }, cual: { requerido: true }, dia: { requerido: true }, hora: { requerido: true }, motivo: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'usuario.activar', etiqueta: 'Activar o desactivar un usuario', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { usuario: { requerido: true }, activo: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'usuario.rol', etiqueta: 'Cambiar el puesto de un usuario', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { usuario: { requerido: true }, rol: { requerido: true } }, claves: [], ejemplos: [],
  },
  {
    id: 'usuario.permiso', etiqueta: 'Dar o quitar un permiso', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { usuario: { requerido: true }, permisoTexto: { requerido: true }, quitar: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'caja.alta', etiqueta: 'Agregar una caja', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { nombre: { requerido: true } }, claves: [], ejemplos: [],
  },
  {
    id: 'caja.activar', etiqueta: 'Activar o desactivar una caja', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { cajaTexto: { requerido: true }, activo: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'modulo.activar', etiqueta: 'Encender o apagar una aplicación', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { modulo: { requerido: true }, activo: {}, reparto: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'negocio.giro', etiqueta: 'Giro del negocio', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { giro: { requerido: true } }, claves: [], ejemplos: [],
  },
  {
    id: 'respaldo.ahora', etiqueta: 'Hacer un respaldo', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: {}, claves: [], ejemplos: [],
  },
  {
    id: 'respaldo.config', etiqueta: 'Respaldos automáticos', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { hora: {}, activo: {}, retencion: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'asistencia.marcar', etiqueta: 'Checar entrada o salida', tipo: 'accion', modulo: 'asistencia', permiso: 'VENTAS_OPERAR', soloRegla: true,
    slots: { tipo: { requerido: true } }, claves: [], ejemplos: [],
  },
  {
    id: 'asistencia.horario', etiqueta: 'Horario de trabajo', tipo: 'accion', modulo: 'asistencia', permiso: 'ASISTENCIA_GESTIONAR', soloRegla: true,
    slots: { usuario: { requerido: true }, dias: { requerido: true }, desde: {}, hasta: {}, descanso: {} }, claves: [], ejemplos: [],
  },
];
