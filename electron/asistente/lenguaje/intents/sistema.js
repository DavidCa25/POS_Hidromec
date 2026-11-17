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
  /* Reglas de lenguaje/equipos.js, no clasificador. */
  {
    id: 'empresa.crear', etiqueta: 'Crear una empresa', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { nombre: { requerido: true }, giro: {}, rfc: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'empresa.salir_grupo', etiqueta: 'Salir del grupo de empresas', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: {}, claves: [], ejemplos: [],
  },
  {
    id: 'sucursal.crear', etiqueta: 'Crear una sucursal o evento', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { nombre: { requerido: true }, tipo: {}, desde: {}, hasta: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'localhost.activar', etiqueta: 'Encender o apagar Local Host', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { activo: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'localhost.renombrar', etiqueta: 'Renombrar una pantalla', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { dispositivo: { requerido: true }, nombre: { requerido: true } }, claves: [], ejemplos: [],
  },
  {
    id: 'localhost.revocar', etiqueta: 'Desconectar una pantalla', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { dispositivo: { requerido: true } }, claves: [], ejemplos: [],
  },
  {
    id: 'localhost.funcion', etiqueta: 'Función de una pantalla', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { dispositivo: { requerido: true }, superficie: { requerido: true }, estacionTexto: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'localhost.acceso_revocar', etiqueta: 'Quitar el acceso de alguien a las pantallas', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { usuario: { requerido: true } }, claves: [], ejemplos: [],
  },
  /* Reglas de lenguaje/multi.js, no clasificador. */
  {
    id: 'multi.publicar', etiqueta: 'Publicar el catálogo a las sucursales', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: {}, claves: [], ejemplos: [],
  },
  {
    id: 'multi.recibir', etiqueta: 'Traer el catálogo de la matriz', tipo: 'accion', permiso: 'INVENTARIO_OPERAR', soloRegla: true,
    slots: {}, claves: [], ejemplos: [],
  },
  {
    id: 'multi.reglas', etiqueta: 'Reglas de las sucursales', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { regla: { requerido: true }, valor: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'multi.excepcion', etiqueta: 'Precio o disponibilidad en una sucursal', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { sucursalTexto: { requerido: true }, producto: { requerido: true }, precio: {}, disponible: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'multi.traspaso', etiqueta: 'Mandar mercancía a otra sucursal', tipo: 'accion', permiso: 'INVENTARIO_OPERAR', soloRegla: true,
    slots: { sucursalTexto: { requerido: true }, renglones: { requerido: true } }, claves: [], ejemplos: [],
  },
  {
    id: 'multi.recibir_traspaso', etiqueta: 'Recibir un traspaso', tipo: 'accion', permiso: 'INVENTARIO_OPERAR', soloRegla: true,
    slots: { sucursalTexto: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'multi.cancelar_traspaso', etiqueta: 'Cancelar un traspaso', tipo: 'accion', permiso: 'INVENTARIO_OPERAR', soloRegla: true,
    slots: { sucursalTexto: { requerido: true } }, claves: [], ejemplos: [],
  },
  {
    id: 'multi.alcance', etiqueta: 'A qué sucursales entra un usuario', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { usuario: { requerido: true }, todas: {}, sucursalTexto: {} }, claves: [], ejemplos: [],
  },
  {
    id: 'negocio.datos', etiqueta: 'Datos del negocio', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { campo: { requerido: true }, valor: { requerido: true } }, claves: [], ejemplos: [],
  },
  {
    id: 'evento.enviar', etiqueta: 'Mandar mercancía a un evento', tipo: 'accion', permiso: 'INVENTARIO_OPERAR', soloRegla: true,
    slots: { eventoTexto: { requerido: true }, renglones: { requerido: true } }, claves: [], ejemplos: [],
  },
  {
    id: 'empresa.desvincular', etiqueta: 'Sacar una empresa del grupo', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { empresaTexto: { requerido: true } }, claves: [], ejemplos: [],
  },
  {
    id: 'empresa.pedir', etiqueta: 'Pedirle un cambio a otra empresa', tipo: 'accion', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { empresaTexto: { requerido: true }, tipo: { requerido: true }, productoTexto: { requerido: true }, precio: { requerido: true } }, claves: [], ejemplos: [],
  },
];
