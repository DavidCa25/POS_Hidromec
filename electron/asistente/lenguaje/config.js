/**
 * CONFIGURACIÓN HABLADA (reglas, no clasificador)
 *
 *   Usuarios:  «desactiva al usuario pedro», «activa a pedro», «haz encargado a pedro»,
 *              «pedro ahora es cajero», «dale a pedro permiso de devoluciones»,
 *              «quítale a pedro el permiso de ver costos»
 *   Cajas:     «agrega la Caja 3», «desactiva la caja 2»
 *   Apps:      «enciende Servicios», «apaga la venta suelta»
 *   Giro:      «el giro es panadería»
 *   Respaldos: «haz un respaldo ahora», «respalda todos los días a las 11 de la noche», «guarda 30 días de respaldos»
 *   Asistencia:«checa mi entrada», «salgo a comer», «ya regresé», «checa mi salida»,
 *              «el horario de pedro es de lunes a viernes de 9 a 6»
 *   Propinas:  «activa propinas repartidas parejo»
 */
'use strict';

const { llano } = require('./edicion');
const { dias, hora } = require('./servicios');

const ROL = [[/\b(?:administrador|admin|dueno|duena)\b/, 'admin'], [/\b(?:encargad[oa]|supervisor[a]?|gerente)\b/, 'supervisor'], [/\b(?:cajer[oa]|vendedor[a]?|mesero|mesera|empleado|empleada)\b/, 'cajero']];
const MODULOS = [
  [/\bfidelizacion\b|\bpromociones de clientes\b/, 'loyalty'], [/\bservicios\b|\bagenda\b|\bcitas\b/, 'servicios'], [/\bmesas\b/, 'mesas'],
  [/\bcomandas\b|\bcocina\b/, 'comandas'], [/\bventa suelta\b|\bvender suelto\b/, 'venta-suelta'], [/\basistencia\b|\bchecador\b/, 'asistencia'],
  [/\bsocios\b/, 'socios'], [/\bpropinas\b/, 'propinas'], [/\bpago de servicios\b|\brecargas\b/, 'pago-servicios'],
];
const GIROS = [['abarrotes', 'abarrotes'], ['tienda', 'abarrotes'], ['ferreteria', 'ferreteria'], ['refaccionaria', 'refaccionaria'], ['farmacia', 'farmacias'],
  ['papeleria', 'papeleria'], ['cafeteria', 'cafeteria'], ['cafe', 'cafeteria'], ['panaderia', 'panaderia'], ['restaurante', 'restaurante'], ['taqueria', 'taqueria'], ['bar', 'bar']];

function config(texto, { usuarios = [] } = {}) {
  const raw = String(texto || '').trim().replace(/[¿?¡!]+/g, '');
  const t = llano(raw);
  if (!t || /^(?:cuanto|cuantos|que(?!\s+(?:no\s+)?(?:tengan|deban))|cual|como|dime|quien)\b/.test(t)) return null;
  const usuario = (s) => { const x = llano(s).replace(/^(?:al?\s+)?(?:usuario|usuaria|cajero|cajera|encargado|encargada)\s+/, '').trim(); return usuarios.find((u) => llano(u.nombre) === x) || null; };

  /* ---------------------------------------------------------- asistencia */
  if (/^(?:checa|checame|marca|registra)\s+(?:mi\s+)?entrada$|^(?:ya\s+)?llegue$|^(?:entro|entre)\s+a\s+trabajar$/.test(t)) return { intent: 'asistencia.marcar', tipo: 'ENTRADA' };
  if (/^(?:checa|checame|marca|registra)\s+(?:mi\s+)?salida$|^(?:ya\s+)?me voy$|^(?:salgo|termine)\s+(?:de\s+)?(?:trabajar|mi turno)$/.test(t)) return { intent: 'asistencia.marcar', tipo: 'SALIDA' };
  if (/^(?:salgo|me voy|voy)\s+a\s+(?:comer|descansar|mi descanso)$|^(?:empieza|inicia)\s+(?:mi\s+)?descanso$/.test(t)) return { intent: 'asistencia.marcar', tipo: 'INICIO_DESCANSO' };
  if (/^(?:ya\s+)?(?:regrese|volvi)(?:\s+de\s+(?:comer|mi descanso|descansar))?$|^(?:termina|fin de)\s+(?:mi\s+)?descanso$/.test(t)) return { intent: 'asistencia.marcar', tipo: 'FIN_DESCANSO' };
  let m = t.match(/^(?:el\s+)?horario\s+de\s+(.+?)\s+es\s+(.+?)\s+de\s+(\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)\s+a\s+(\d{1,2}(?::\d{2})?(?:\s*(?:am|pm|de la tarde|de la noche))?)(?:\s+con\s+(\d+)\s+(?:minutos|min)\s+de\s+(?:comida|descanso))?$/);
  if (m) {
    const u = usuario(m[1]);
    const ds = dias(m[2]);
    const ini = hora(m[3]), fin = hora(m[4], true);
    if (u && ds && ini && fin) return { intent: 'asistencia.horario', usuario: u.id, usuarioNombre: u.nombre, dias: ds, desde: ini, hasta: fin, descanso: m[5] ? Number(m[5]) : 0 };
  }

  /* «Las propinas se reparten por horas». */
  m = t.match(/^(?:las\s+)?propinas\s+(?:se\s+)?(?:reparten|repartan|van)\s+(parejo|parejas|por horas|a quien atendio|al que atendio|por quien atendio)$/);
  if (m) return { intent: 'propinas.config', reparto: /horas/.test(m[1]) ? 'HORAS' : /atendio/.test(m[1]) ? 'ATENDIO' : 'PAREJO' };
  /* Reglas de asistencia. */
  m = t.match(/^(no\s+)?(?:marques|marca|marcar)\s+(?:los\s+)?retardos$/);
  if (m) return { intent: 'asistencia.reglas', regla: 'marcaRetardos', valor: !m[1] };
  m = t.match(/^(?:que\s+)?(no\s+)?(?:tengan que|tienen que|deban|hay que)\s+checar\s+(?:entrada\s+)?(?:antes de|para)\s+vender$/);
  if (m) return { intent: 'asistencia.reglas', regla: 'entradaParaVender', valor: !m[1] };
  m = t.match(/^(?:el\s+)?descanso\s+(no\s+)?(?:es|sea)\s+pagado$/);
  if (m) return { intent: 'asistencia.reglas', regla: 'descansoPagado', valor: !m[1] };
  /* «Corrige la entrada de Pedro de ayer a las 9», «la salida de Ana del lunes fue a las 6». */
  m = t.match(/^(?:corrige|corregir|cambia|arregla)\s+(?:la\s+)?(entrada|salida)\s+de\s+(.+?)\s+(?:de|del)\s+(hoy|ayer|antier|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+a\s+las\s+(\d{1,2}(?::\d{2})?)\s*(am|pm|de la manana|de la tarde|de la noche)?(?:\s*[,;]?\s*(?:porque|por que)\s+(.+))?$/);
  if (m) {
    const u = usuario(m[2]);
    const h = hora(`${m[4]}${m[5] ? ' ' + m[5] : ''}`, m[1] === 'salida');
    if (u && h) return { intent: 'asistencia.corregir', usuario: u.id, usuarioNombre: u.nombre, cual: m[1], dia: m[3], hora: h, motivo: m[6] ? raw.slice(t.length - m[6].length).trim() : null };
  }

  /* ----------------------------------------------------------- usuarios */
  m = t.match(/^(desactiva|desactivar|da de baja|bloquea|activa|activar|reactiva|desbloquea)\s+(?:al?\s+)?(?:la\s+)?(?:usuario|usuaria|cajero|cajera)?\s*(.+)$/);
  if (m) { const u = usuario(m[2]); if (u) return { intent: 'usuario.activar', usuario: u.id, usuarioNombre: u.nombre, activo: /^(activa|activar|reactiva|desbloquea)$/.test(m[1]) }; }
  m = t.match(/^(?:haz|hazlo|hazla|pon|ponle|nombra)\s+(?:a\s+)?(.+?)\s+(?:como\s+)?(administrador|admin|encargad[oa]|supervisor[a]?|gerente|cajer[oa]|vendedor[a]?|mesero|mesera)$/)
    || t.match(/^(.+?)\s+(?:ahora\s+)?(?:es|va a ser|sera)\s+(?:el\s+|la\s+)?(administrador|admin|encargad[oa]|supervisor[a]?|gerente|cajer[oa]|vendedor[a]?|mesero|mesera)$/);
  if (m) { const u = usuario(m[1]); const r = ROL.find(([re]) => re.test(m[2])); if (u && r) return { intent: 'usuario.rol', usuario: u.id, usuarioNombre: u.nombre, rol: r[1] }; }
  /* «Haz encargado a Pedro»: el puesto antes del nombre. */
  m = t.match(/^(?:haz|hazme|pon|nombra)\s+(?:como\s+)?(administrador|admin|encargad[oa]|supervisor[a]?|gerente|cajer[oa]|vendedor[a]?|mesero|mesera)\s+a\s+(.+)$/);
  if (m) { const u = usuario(m[2]); const r = ROL.find(([re]) => re.test(m[1])); if (u && r) return { intent: 'usuario.rol', usuario: u.id, usuarioNombre: u.nombre, rol: r[1] }; }
  m = t.match(/^(?:dale|darle|da)\s+(?:a\s+)?(.+?)\s+(?:el\s+)?permiso\s+(?:de|para)\s+(.+)$/) || t.match(/^(?:quitale|quita|quitar)\s+(?:a\s+)?(.+?)\s+(?:el\s+)?permiso\s+(?:de|para)\s+(.+)$/);
  if (m) { const u = usuario(m[1]); if (u) return { intent: 'usuario.permiso', usuario: u.id, usuarioNombre: u.nombre, permisoTexto: m[2], quitar: /^quit/.test(t) }; }

  /* -------------------------------------------------------------- cajas */
  m = t.match(/^(?:agrega|crea|nueva|da de alta)\s+(?:la\s+|una\s+)?caja\s+(?:llamada\s+)?(.+)$/);
  if (m) { const nombre = raw.slice(t.length - m[1].length).trim(); return { intent: 'caja.alta', nombre: /^\d+$/.test(nombre) ? `Caja ${nombre}` : nombre.charAt(0).toUpperCase() + nombre.slice(1) }; }
  m = t.match(/^(desactiva|desactivar|apaga|activa|activar|reactiva)\s+(?:la\s+)?caja\s+(.+)$/);
  if (m) return { intent: 'caja.activar', cajaTexto: m[2], activo: /^(activa|activar|reactiva)$/.test(m[1]) };

  /* -------------------------------------------------------- aplicaciones */
  m = t.match(/^(enciende|prende|activa|activar|instala|apaga|desactiva|desactivar|quita)\s+(?:la\s+|el\s+)?(?:aplicacion\s+(?:de\s+)?|modulo\s+(?:de\s+)?)?(.+)$/);
  if (m) {
    const mod = MODULOS.find(([re]) => re.test(m[2]));
    if (mod && !/\bpuntos\b/.test(m[2])) {
      const enciende = /^(enciende|prende|activa|activar|instala)$/.test(m[1]);
      const reparto = (m[2].match(/\brepartidas?\s+(parejo|por horas|a quien atendio|por quien atendio)\b/) || [])[1];
      return { intent: 'modulo.activar', modulo: mod[1], activo: enciende, reparto: reparto ? (/horas/.test(reparto) ? 'HORAS' : /atendio/.test(reparto) ? 'ATENDIO' : 'PAREJO') : null };
    }
  }

  /* ---------------------------------------------------------------- giro */
  m = t.match(/^(?:el\s+)?giro\s+(?:del negocio\s+)?(?:es|sera)\s+(?:una?\s+)?(.+)$/) || t.match(/^(?:cambia|pon)\s+el\s+giro\s+(?:a|en)\s+(?:una?\s+)?(.+)$/);
  if (m) { const g = GIROS.find(([k]) => m[1].includes(k)); if (g) return { intent: 'negocio.giro', giro: g[1] }; }

  /* ----------------------------------------------------------- respaldos */
  if (/^(?:haz|hazme|saca|sacame|corre)\s+(?:un\s+)?respaldo(?:\s+ahora|\s+ya)?$|^respalda(?:\s+la base)?(?:\s+ahora|\s+ya)?$/.test(t)) return { intent: 'respaldo.ahora' };
  m = t.match(/^(?:respalda|haz (?:el\s+)?respaldo)\s+(?:todos los dias|diario|cada dia)\s+a\s+las\s+(\d{1,2}(?::\d{2})?)\s*(de la noche|de la tarde|de la manana|am|pm)?$/);
  if (m) { const h = hora(`${m[1]}${m[2] ? ' ' + m[2] : ''}`, false); if (h) return { intent: 'respaldo.config', hora: h, activo: true }; }
  m = t.match(/^(?:guarda|conserva|manten)\s+(\d+)\s+dias\s+de\s+respaldos?$/);
  if (m) return { intent: 'respaldo.config', retencion: Number(m[1]) };
  if (/^(?:apaga|desactiva|ya no hagas)\s+(?:los\s+)?respaldos?(?:\s+automaticos?)?$/.test(t)) return { intent: 'respaldo.config', activo: false };
  return null;
}

module.exports = { config };
