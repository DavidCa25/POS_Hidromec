/**
 * SERVICIOS HABLADOS (reglas, no clasificador)
 *
 * Órdenes de servicio:
 *   «abre una orden para doña Mary: no prende la licuadora»
 *   «la orden 12 ya está lista», «la orden 12 está en proceso», «entrega la orden 12»
 *   «el cliente autorizó la orden 12 por teléfono»
 *   «cancela la orden 12, ya no lo quiso»
 *   «el diagnóstico de la orden 12 es: falla el motor»
 *   «agrégale a la orden 12 un cambio de aceite», «ponle 2 balatas a la orden 12»
 *   «el cambio de aceite de la orden 12 ya está hecho», «… a 350»
 *   «llegó doña Mary a su cita»
 * Profesionales:
 *   «da de alta a la estilista Laura López», «desactiva a Laura», «activa a Laura»
 *   «Laura hace cortes de cabello», «Laura ya no hace tintes»
 *   «Laura trabaja de lunes a viernes de 9 a 6», «Laura trabaja los sábados de 10 a 2»
 *   «Laura no viene el viernes», «Laura falta del 20 al 22», «siempre sí viene Laura el viernes»
 * Catálogo de servicios, activos del cliente y giro:
 *   «crea el servicio Corte de dama a 250 de 45 minutos», «desactiva el servicio Tinte»
 *   «registra el carro de doña Mary: Nissan Versa 2018 placas ABC123»
 *   «mi negocio es una barbería»
 *
 * Aquí solo se parte la frase. Quién es cada persona, producto o servicio lo
 * resuelve el intérprete con su catálogo.
 */
'use strict';

const { llano } = require('./edicion');

const limpio = (s) => String(s || '').trim().replace(/^["'«“:,]+|["'»”.]+$/g, '').trim();
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const original = (raw, t, frag) => raw.slice(t.lastIndexOf(frag), t.lastIndexOf(frag) + frag.length);
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const PROF = '(?:profesional|estilista|barbero|barbera|mecanico|mecanica|tecnico|tecnica|doctor|doctora|terapeuta|manicurista|cosmetologa|cosmetologo|maquillista|ayudante)';

/** «9», «9:30», «6» de la tarde → «HH:MM» 24 h. Sin «am/pm», de 1 a 7 es tarde si va después de otra hora. */
function hora(s, tarde = false) {
  const m = String(s).match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|de la manana|de la tarde|de la noche)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (/pm|tarde|noche/.test(m[3] || '') && h < 12) h += 12;
  else if (!m[3] && tarde && h >= 1 && h <= 8) h += 12;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** «de lunes a viernes», «los sábados», «lunes, miércoles y viernes» → [1..7] (1 = domingo). */
function dias(t) {
  const r = t.match(/\bde\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)s?\s+a\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)s?\b/);
  if (r) {
    const a = DIAS.indexOf(r[1]), b = DIAS.indexOf(r[2]);
    const out = [];
    for (let i = a; ; i = (i + 1) % 7) { out.push(i + 1); if (i === b) break; }
    return out;
  }
  if (/\btodos los dias\b|\bdiario\b/.test(t)) return [1, 2, 3, 4, 5, 6, 7];
  if (/\bentre semana\b/.test(t)) return [2, 3, 4, 5, 6];
  if (/\bfines? de semana\b/.test(t)) return [7, 1];
  const sueltos = DIAS.map((d, i) => (new RegExp(`\\b${d}s?\\b`).test(t) ? i + 1 : null)).filter(Boolean);
  return sueltos.length ? sueltos : null;
}

/** «el viernes», «mañana», «del 20 al 22», «del 1 al 15 de diciembre» → { desde, hasta } (AAAA-MM-DD). */
function rangoFechas(t, ahora = new Date()) {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const delMes = (dia, mes) => {
    const d = new Date(ahora.getFullYear(), mes ?? ahora.getMonth(), dia);
    if (mes == null && dia < ahora.getDate()) d.setMonth(d.getMonth() + 1);
    else if (mes != null && d < new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())) d.setFullYear(d.getFullYear() + 1);
    return d;
  };
  let m = t.match(/\bdel\s+(\d{1,2})\s+al\s+(\d{1,2})(?:\s+de\s+(\w+))?/);
  if (m) {
    const mes = m[3] ? MESES.indexOf(m[3]) : -1;
    const a = delMes(Number(m[1]), mes >= 0 ? mes : null), b = delMes(Number(m[2]), mes >= 0 ? mes : null);
    if (b < a) b.setMonth(b.getMonth() + 1);
    return { desde: iso(a), hasta: iso(b) };
  }
  m = t.match(/\bel\s+(\d{1,2})(?:\s+de\s+(\w+))?\b/);
  if (m) { const mes = m[2] ? MESES.indexOf(m[2]) : -1; const d = delMes(Number(m[1]), mes >= 0 ? mes : null); return { desde: iso(d), hasta: iso(d) }; }
  const mas = (n) => { const d = new Date(ahora); d.setDate(d.getDate() + n); return d; };
  if (/\bpasado manana\b/.test(t)) return { desde: iso(mas(2)), hasta: iso(mas(2)) };
  if (/\bmanana\b/.test(t)) return { desde: iso(mas(1)), hasta: iso(mas(1)) };
  if (/\bhoy\b/.test(t)) return { desde: iso(ahora), hasta: iso(ahora) };
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${DIAS[i]}\\b`).test(t)) { let dif = (i - ahora.getDay() + 7) % 7; if (dif === 0) dif = 7; return { desde: iso(mas(dif)), hasta: iso(mas(dif)) }; }
  }
  return null;
}

const ESTADO = [
  [/\b(?:ya esta|esta|quedo|ya quedo)\s+lista\b|\blista\b|\bterminad[ao]\b|\bya quedo\b|\btermine\b/, 'TERMINADA'],
  [/\ben proceso\b|\bempece\b|\bempezamos\b|\bya estamos trabajando\b|\bya la estoy trabajando\b/, 'EN_PROCESO'],
  [/\bentrega\b|\bentregada\b|\bse la llevo\b|\bse lo llevo\b|\bya se la llevaron\b|\bya se lo llevaron\b|\bentregue\b/, 'ENTREGADA'],
  [/\babierta\b|\babrela\b/, 'ABIERTA'],
];

/** @returns null o { intent, ...partes } */
function servicios(texto, ahora = new Date()) {
  const raw = String(texto || '').trim().replace(/[¿?¡!]+/g, '');
  const t = llano(raw);
  if (!t || /^(?:cuanto|cuanta|que|cual|como|cuando|dime|hay)\b/.test(t)) return null;
  const folio = (t.match(/\borden\s+(?:de servicio\s+)?(?:numero\s+|#\s*|os-?0*)?(\d{1,7})\b/) || [])[1];

  /* ---------------------------------------------------------- órdenes */
  let m = t.match(/^(?:abre|abrir|abreme|crea|crear|nueva|registra|recibe|recibi|levanta)\s+(?:una\s+)?(?:nueva\s+)?orden(?:\s+de servicio)?\s+(?:para|de|a)\s+(.+?)(?:\s*[:,;]\s*|\s+(?:porque|por que|que|trae|traen|trajo)\s+)(.+)$/);
  if (m) return { intent: 'orden.crear', textoCliente: m[1], reportado: capital(limpio(original(raw, t, m[2]))) };
  m = t.match(/^(?:abre|abrir|crea|nueva|registra|levanta)\s+(?:una\s+)?(?:nueva\s+)?orden(?:\s+de servicio)?\s+(?:para|de|a)\s+(.+)$/);
  if (m) return { intent: 'orden.crear', textoCliente: m[1], reportado: null };

  if (folio) {
    m = t.match(/^(?:cancela|cancelar|cancelale)\s+(?:la\s+)?orden\s+\S+(?:\s+\S+)?\s*(?:[,;:]\s*|\s+(?:porque|por que|ya que)\s+)(.+)$/);
    if (m) return { intent: 'orden.cancelar', folio: Number(folio), motivo: capital(limpio(original(raw, t, m[1]))) };
    if (/^(?:cancela|cancelar|cancelale)\s+(?:la\s+)?orden\b/.test(t)) return { intent: 'orden.cancelar', folio: Number(folio), motivo: null };
    m = t.match(/\bdiagnostico\s+(?:de\s+la\s+orden\s+\S+\s+)?(?:es|fue|quedo)?\s*[:,]?\s*(.+)$/);
    if (m && /\bdiagnostico\b/.test(t)) return { intent: 'orden.diagnostico', folio: Number(folio), diagnostico: capital(limpio(original(raw, t, m[1]).replace(/^(?:de la orden\s+\S+\s+)/i, ''))) };
    m = t.match(/\b(?:autorizo|autorizaron|aprobo|aprobaron|acepto|aceptaron|dio el si|dijo que si)\b/);
    if (m || /\borden\s+\S+\s+(?:esta\s+|ya esta\s+)?autorizada\b/.test(t)) {
      const via = /\b(?:telefono|llamada|marco)\b/.test(t) ? 'TELEFONO' : /\bwhats(?:app)?\b|\bmensaje\b/.test(t) ? 'WHATSAPP' : 'MOSTRADOR';
      const quien = (t.match(/^(?:el cliente|la clienta|el senor|la senora|don|dona)?\s*(.+?)\s+(?:autorizo|aprobo|acepto|dio el si|dijo que si)\b/) || [])[1];
      return { intent: 'orden.autorizar', folio: Number(folio), via, autoriza: quien && !/^(?:el cliente|la clienta|ya)$/.test(quien) ? capital(limpio(original(raw, t, quien))) : null };
    }
    /* Renglones: «agrégale a la orden 12 un cambio de aceite». */
    m = t.match(/^(?:agrega|agregale|agregar|ponle|ponerle|anade|anadele|suma|sumale|carga|cargale)\s+(.+)$/);
    if (m) {
      const resto = m[1].replace(/\b(?:a la|en la|de la)?\s*orden\s+(?:de servicio\s+)?(?:numero\s+|#\s*|os-?0*)?\d{1,7}\b/, ' ').replace(/\s+/g, ' ').trim();
      return { intent: 'orden.linea', folio: Number(folio), textoProducto: resto };
    }
    /* «el cambio de aceite de la orden 12 ya está hecho / a 350». */
    m = t.match(/^(?:el|la|los|las)?\s*(.+?)\s+de\s+la\s+orden\s+\S+\s+(?:ya\s+)?(?:esta|estan|quedo|quedaron|queda|va)?\s*(hech[oa]s?|list[oa]s?|en proceso|cancelad[oa]s?|a\s+\$?\d+(?:\.\d+)?(?:\s*pesos)?)\s*$/);
    if (m) {
      const precio = m[2].match(/^a\s+\$?(\d+(?:\.\d+)?)/);
      const estado = precio ? null : /hech|list/.test(m[2]) ? 'HECHA' : /proceso/.test(m[2]) ? 'EN_PROCESO' : 'CANCELADA';
      return { intent: 'orden.linea_cambiar', folio: Number(folio), textoProducto: m[1], estado, precio: precio ? Number(precio[1]) : null };
    }
    const est = ESTADO.find(([re]) => re.test(t.replace(/\borden\b.*?\d+/, ' ')));
    if (est && /\borden\b/.test(t)) return { intent: 'orden.estado', folio: Number(folio), estado: est[1] };
  }

  m = t.match(/^(?:ya\s+)?(?:llego|vino|esta aqui|ya esta aqui)\s+(.+?)\s+(?:a|para)\s+su\s+cita\b/) || t.match(/^(?:convierte|pasa|haz)\s+(?:la\s+)?cita\s+de\s+(.+?)\s+(?:en|a)\s+(?:una\s+)?orden\b/);
  if (m) return { intent: 'cita.orden', textoCliente: m[1] };

  /* ---------------------------------------------------- catálogo y giro */
  m = t.match(/^(?:crea|crear|agrega|agregar|da de alta|nuevo|registra)\s+(?:el\s+|un\s+)?(?:nuevo\s+)?servicio\s+(?:de\s+|llamado\s+)?(.+?)(?:\s+(?:a|en|por|de)\s+\$?(\d+(?:\.\d+)?)\s*(?:pesos)?)?(?:\s+(?:de|que dura|dura|con duracion de)\s+(\d+)\s*(?:minutos|min|hora|horas|hr|hrs))?\s*$/);
  if (m) {
    let dur = m[3] ? Number(m[3]) : null;
    if (dur != null && /\b(?:hora|horas|hr|hrs)\b/.test(t)) dur *= 60;
    return { intent: 'servicio.crear', nombre: capital(limpio(original(raw, t, m[1]))), precio: m[2] ? Number(m[2]) : null, duracion: dur };
  }
  m = t.match(/^(desactiva|desactivar|da de baja|quita|ya no doy|activa|activar|reactiva|vuelve a dar)\s+(?:el\s+)?servicio\s+(?:de\s+)?(.+)$/);
  if (m) return { intent: 'servicio.activar', activo: /^(activa|activar|reactiva|vuelve a dar)$/.test(m[1]), textoProducto: m[2] };
  m = t.match(/^(?:mi negocio es|somos|el negocio es|cambia el giro a)\s+(?:un|una)?\s*(.+)$/);
  if (m) {
    const g = m[1];
    const preset = /taller|mecanic|automo|carro/.test(g) ? 'TALLER_AUTOMOTRIZ' : /barber|estetic|salon|belleza|unas|spa/.test(g) ? 'BELLEZA'
      : /celular|electron|computadora|reparacion/.test(g) ? 'REPARACION_ELECTRONICA' : /mantenimiento|plomer|electricista|tecnic|climas|aire/.test(g) ? 'MANTENIMIENTO' : null;
    if (preset) return { intent: 'servicio.giro', preset };
  }

  /* ---------------------------------------------------- activos del cliente */
  m = t.match(/^(?:registra|agrega|da de alta|anota)\s+(?:el|la|un|una)\s+(carro|auto|coche|camioneta|moto|motocicleta|vehiculo|perro|perrito|gato|gatito|mascota|celular|telefono|laptop|computadora|equipo|tele|television|refri|lavadora|casa|departamento|local)\s+(?:de|del|de la)\s+(.+?)\s*[:,;]\s*(.+)$/);
  if (m) {
    const clase = /carro|auto|coche|camioneta|moto|vehiculo/.test(m[1]) ? 'VEHICULO' : /perro|gato|mascota/.test(m[1]) ? 'MASCOTA'
      : /casa|departamento|local/.test(m[1]) ? 'INMUEBLE' : 'EQUIPO';
    const desc = original(raw, t, m[3]);
    const placas = (desc.match(/\bplacas?\s*:?\s*([A-Z0-9-]{5,10})\b/i) || [])[1];
    const anio = (desc.match(/\b(19[5-9]\d|20[0-4]\d)\b/) || [])[1];
    const etiqueta = capital(limpio(desc.replace(/\bplacas?\s*:?\s*[A-Z0-9-]{5,10}\b/i, '').replace(/\s+/g, ' ')));
    return { intent: 'activo.crear', clase, textoCliente: m[2], etiqueta, identificador: placas ? placas.toUpperCase() : null, anio: anio || null };
  }

  /* ------------------------------------------------------- profesionales */
  m = t.match(new RegExp(`^(?:da de alta|dar de alta|agrega|registra|contrata|contrate|entro)\\s+(?:a\\s+)?(?:al\\s+|la\\s+|el\\s+|una\\s+|un\\s+)?(?:nueva\\s+|nuevo\\s+)?${PROF}\\s+(.+)$`));
  if (m) {
    const puesto = (t.match(new RegExp(PROF)) || [])[0];
    return { intent: 'profesional.alta', nombre: capital(limpio(original(raw, t, m[1]))), puesto: puesto && puesto !== 'profesional' ? capital(puesto) : null };
  }
  m = t.match(/^(?:siempre si|si)\s+(?:viene|va a venir|trabaja)\s+(.+?)\s+(el\s+\d{1,2}.*|el\s+\w+|manana|pasado manana|hoy)$/);
  if (m) return { intent: 'profesional.ausencia_borrar', textoProfesional: m[1], fechas: rangoFechas(m[2], ahora) };
  m = t.match(/^(.+?)\s+(?:no viene|no va a venir|falta|faltara|va a faltar|no trabaja|descansa|sale de vacaciones|esta de vacaciones|tiene vacaciones|esta incapacitad[oa]|tiene permiso)\s+(.+)$/);
  if (m) {
    const f = rangoFechas(m[2], ahora);
    const motivo = /vacacion/.test(t) ? 'Vacaciones' : /incapacit/.test(t) ? 'Incapacidad' : /permiso/.test(t) ? 'Permiso' : 'Ausencia';
    if (f) return { intent: 'profesional.ausencia', textoProfesional: m[1], fechas: f, motivo };
  }
  m = t.match(/^(.+?)\s+(?:trabaja|entra|esta)\s+(.+?)\s+de\s+(\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)\s+a\s+(\d{1,2}(?::\d{2})?(?:\s*(?:am|pm|de la tarde|de la noche))?)\s*$/);
  if (m) {
    const ds = dias(m[2]);
    const ini = hora(m[3]), fin = hora(m[4], true);
    if (ds && ini && fin) return { intent: 'profesional.horario', textoProfesional: m[1], dias: ds, desde: ini, hasta: fin };
  }
  m = t.match(/^(.+?)\s+(?:ya no hace|ya no da|deja de hacer|no hace)\s+(.+)$/);
  if (m) return { intent: 'profesional.servicio', textoProfesional: m[1], textoProducto: m[2], quitar: true };
  m = t.match(/^(.+?)\s+(?:tambien\s+)?(?:hace|da|sabe hacer|puede hacer|atiende)\s+(.+)$/);
  if (m && !/^(?:quien|que)\b/.test(m[1])) return { intent: 'profesional.servicio', textoProfesional: m[1], textoProducto: m[2], quitar: false };
  m = t.match(new RegExp(`^(desactiva|desactivar|da de baja|dar de baja|activa|activar|reactiva)\\s+(?:a\\s+)?(?:la\\s+|el\\s+)?(?:${PROF}\\s+)?(.+)$`));
  if (m) return { intent: 'profesional.activar', activo: /^(activa|activar|reactiva)$/.test(m[1]), textoProfesional: m[2] };
  return null;
}

module.exports = { servicios, rangoFechas, dias, hora };
