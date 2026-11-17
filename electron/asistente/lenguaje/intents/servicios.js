'use strict';
/* SERVICIOS (salón, barbería, spa, consultorio, taller): citas, profesionales, membresías. */
module.exports = [
  {
    id: 'cita.lista', etiqueta: 'Citas', tipo: 'consulta', modulo: 'servicios',
    slots: { fecha: {}, profesional: {} },
    claves: ['citas', 'cita', 'agenda', 'agendados', 'quien', 'viene'],
    ejemplos: ['que citas tengo hoy', 'citas de {fecha}', 'agenda de {persona}', 'quien viene {fecha}', 'cuantas citas hay {fecha}',
               'a quien le toca ahorita', 'que tiene {persona} {fecha}'],
  },
  {
    id: 'cita.agendar', etiqueta: 'Agendar una cita', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_OPERAR',
    slots: { cliente: { requerido: true }, servicio: { requerido: true }, fecha: { requerido: true }, hora: { requerido: true }, profesional: {} },
    claves: ['agenda', 'agendale', 'cita', 'aparta', 'reserva', 'anota'],
    ejemplos: ['agenda a {persona} {fecha} a las {hora}', 'cita para {persona} {fecha} {hora}', 'apartale a {persona} un {prod} {fecha} a las {hora}',
               'reserva {prod} para {persona} {fecha}', 'anota a {persona} para {prod} a las {hora}', 'agendar cita'],
  },
  {
    id: 'cita.cancelar', etiqueta: 'Cancelar una cita', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_OPERAR',
    slots: { cliente: { requerido: true } },
    claves: ['cancela', 'cancelar', 'cancelo', 'quita', 'borra', 'no viene'],
    ejemplos: ['cancela la cita de {persona}', '{persona} cancelo su cita', 'quita la cita de {persona}', '{persona} ya no viene',
               'cancelar cita'],
  },
  {
    id: 'cita.mover', etiqueta: 'Cambiar una cita', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_OPERAR',
    slots: { cliente: { requerido: true }, fecha: {}, hora: {} },
    claves: ['mueve', 'cambia', 'recorre', 'pasa', 'reprograma', 'pospon'],
    ejemplos: ['mueve la cita de {persona} a las {hora}', 'cambia a {persona} para {fecha}', 'recorre la cita de {persona} a las {hora}',
               'pasa a {persona} al {fecha}', 'reprograma a {persona}'],
  },
  {
    id: 'cita.libre', etiqueta: '¿Hay espacio en la agenda?', tipo: 'consulta', modulo: 'servicios',
    slots: { fecha: {}, hora: {}, profesional: {} },
    claves: ['espacio', 'libre', 'disponible', 'hueco', 'lugar', 'cabe'],
    ejemplos: ['hay espacio {fecha} a las {hora}', 'esta libre {persona} a las {hora}', 'a que hora hay lugar {fecha}', 'tengo hueco {fecha}',
               'cuando esta disponible {persona}', 'cabe alguien a las {hora}'],
  },
  {
    id: 'servicios.profesional', etiqueta: '¿Cuánto ha generado un profesional?', tipo: 'consulta', modulo: 'servicios', permiso: 'VER_NUMEROS_DIA',
    slots: { profesional: {}, periodo: {} },
    claves: ['genero', 'comision', 'comisiones', 'atendio', 'servicios', 'produjo'],
    ejemplos: ['cuanto ha generado {persona}', 'comisiones de {persona} {periodo}', 'cuantos servicios hizo {persona}', 'a cuantos atendio {persona}',
               'quien atendio mas {periodo}', 'comisiones de la semana'],
  },
  {
    id: 'membresia.vencer', etiqueta: 'Membresías por vencer', tipo: 'consulta',
    slots: {},
    claves: ['membresia', 'membresias', 'vencer', 'vencen', 'vencidas', 'renovar', 'mensualidad'],
    ejemplos: ['que membresias se vencen', 'membresias vencidas', 'quien tiene que renovar', 'mensualidades por vencer',
               'a quien se le vence la membresia esta semana'],
  },
  {
    id: 'orden.pendientes', etiqueta: 'Órdenes de servicio abiertas', tipo: 'consulta', modulo: 'servicios',
    slots: {},
    claves: ['ordenes', 'orden', 'taller', 'equipos', 'reparacion', 'entregar'],
    ejemplos: ['que ordenes estan abiertas', 'ordenes pendientes', 'que equipos faltan por entregar', 'como va el taller',
               'ordenes por autorizar', 'que reparaciones hay'],
  },
  /* Reglas de lenguaje/servicios.js, no clasificador. */
  {
    id: 'orden.crear', etiqueta: 'Abrir una orden de servicio', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_OPERAR', soloRegla: true,
    slots: { cliente: { requerido: true }, reportado: {} }, claves: ['orden'], ejemplos: [],
  },
  {
    id: 'orden.estado', etiqueta: 'Cambiar el estado de una orden', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_OPERAR', soloRegla: true,
    slots: { folio: { requerido: true }, estado: { requerido: true } }, claves: ['orden'], ejemplos: [],
  },
  {
    id: 'orden.autorizar', etiqueta: 'El cliente autorizó una orden', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_OPERAR', soloRegla: true,
    slots: { folio: { requerido: true }, via: {}, autoriza: {} }, claves: ['autorizo'], ejemplos: [],
  },
  {
    id: 'orden.cancelar', etiqueta: 'Cancelar una orden', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_OPERAR', soloRegla: true,
    slots: { folio: { requerido: true }, motivo: {} }, claves: ['cancela'], ejemplos: [],
  },
  {
    id: 'orden.diagnostico', etiqueta: 'Diagnóstico de una orden', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_OPERAR', soloRegla: true,
    slots: { folio: { requerido: true }, diagnostico: { requerido: true } }, claves: ['diagnostico'], ejemplos: [],
  },
  {
    id: 'orden.linea', etiqueta: 'Agregar a una orden', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_OPERAR', soloRegla: true,
    slots: { folio: { requerido: true }, producto: { requerido: true }, cantidad: {} }, claves: ['agrega'], ejemplos: [],
  },
  {
    id: 'orden.linea_cambiar', etiqueta: 'Cambiar un renglón de una orden', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_OPERAR', soloRegla: true,
    slots: { folio: { requerido: true }, producto: { requerido: true }, estado: {}, precio: {} }, claves: ['orden'], ejemplos: [],
  },
  {
    id: 'cita.orden', etiqueta: 'Pasar una cita a orden', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_OPERAR', soloRegla: true,
    slots: { cliente: { requerido: true } }, claves: ['cita'], ejemplos: [],
  },
  {
    id: 'servicio.crear', etiqueta: 'Crear un servicio', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_ADMINISTRAR', soloRegla: true,
    slots: { nombre: { requerido: true }, precio: {}, duracion: {} }, claves: ['servicio'], ejemplos: [],
  },
  {
    id: 'servicio.activar', etiqueta: 'Activar o desactivar un servicio', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_ADMINISTRAR', soloRegla: true,
    slots: { producto: { requerido: true }, activo: {} }, claves: ['servicio'], ejemplos: [],
  },
  {
    id: 'servicio.giro', etiqueta: 'Elegir el giro de servicios', tipo: 'accion', modulo: 'servicios', permiso: 'CONFIGURACION_ADMINISTRAR', soloRegla: true,
    slots: { preset: { requerido: true } }, claves: ['negocio'], ejemplos: [],
  },
  {
    id: 'activo.crear', etiqueta: 'Registrar un activo del cliente', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_OPERAR', soloRegla: true,
    slots: { cliente: { requerido: true }, clase: {}, etiqueta: {}, identificador: {}, anio: {} }, claves: ['registra'], ejemplos: [],
  },
  {
    id: 'profesional.alta', etiqueta: 'Dar de alta un profesional', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_ADMINISTRAR', soloRegla: true,
    slots: { nombre: { requerido: true }, puesto: {} }, claves: ['profesional'], ejemplos: [],
  },
  {
    id: 'profesional.activar', etiqueta: 'Activar o desactivar un profesional', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_ADMINISTRAR', soloRegla: true,
    slots: { profesional: { requerido: true }, activo: {} }, claves: ['desactiva'], ejemplos: [],
  },
  {
    id: 'profesional.servicio', etiqueta: 'Qué servicios hace un profesional', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_ADMINISTRAR', soloRegla: true,
    slots: { profesional: { requerido: true }, producto: { requerido: true }, quitar: {} }, claves: ['hace'], ejemplos: [],
  },
  {
    id: 'profesional.horario', etiqueta: 'Horario de un profesional', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_ADMINISTRAR', soloRegla: true,
    slots: { profesional: { requerido: true }, dias: { requerido: true }, desde: { requerido: true }, hasta: { requerido: true } }, claves: ['trabaja'], ejemplos: [],
  },
  {
    id: 'profesional.ausencia', etiqueta: 'Ausencia de un profesional', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_ADMINISTRAR', soloRegla: true,
    slots: { profesional: { requerido: true }, fechas: { requerido: true }, motivo: {} }, claves: ['falta'], ejemplos: [],
  },
  {
    id: 'profesional.ausencia_borrar', etiqueta: 'Quitar una ausencia', tipo: 'accion', modulo: 'servicios', permiso: 'SERVICIOS_ADMINISTRAR', soloRegla: true,
    slots: { profesional: { requerido: true }, fechas: { requerido: true } }, claves: ['viene'], ejemplos: [],
  },
];
