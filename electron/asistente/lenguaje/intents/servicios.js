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
];
