/**
 * EMPRESAS, SUCURSALES Y PANTALLAS (Local Host) — reglas, no clasificador
 *
 *   «crea la empresa Panadería Centro, giro panadería», «sal del grupo de empresas»
 *   «crea la sucursal Centro», «crea el evento Feria de mayo del 1 al 5 de mayo»
 *   «enciende Wybix Local Host», «apaga las pantallas»
 *   «renombra la tablet Mesa 1 a Terraza», «desconecta la tablet Terraza»,
 *   «la tablet Terraza ahora es de mesero / cocina / inventario / técnico / estado de pedidos»
 *   «quítale el acceso a Pedro en las tablets»
 */
'use strict';

const { llano } = require('./edicion');
const { rangoFechas } = require('./servicios');

const GIROS = [['abarrotes', 'abarrotes'], ['tienda', 'abarrotes'], ['ferreteria', 'ferreteria'], ['refaccionaria', 'refaccionaria'], ['farmacia', 'farmacias'],
  ['papeleria', 'papeleria'], ['cafeteria', 'cafeteria'], ['panaderia', 'panaderia'], ['restaurante', 'restaurante'], ['taqueria', 'taqueria'], ['bar', 'bar']];
const FUNCION = [[/\bmesero\b|\bmeseros\b|\bcomandero\b/, 'WAITER'], [/\bcocina\b|\bpreparacion\b|\bbarra\b/, 'PREPARATION'], [/\binventario\b|\bconteo\b/, 'INVENTORY_FLOOR'],
  [/\btecnico\b|\btaller\b/, 'TECHNICIAN'], [/\bestado de pedidos\b|\bpantalla de clientes\b|\bturnos\b/, 'CUSTOMER_STATUS'], [/\bmi jornada\b|\bjornada\b|\bagenda\b/, 'STAFF_DAY']];
const DISP = '(?:tablet|pantalla|dispositivo|celular|telefono)';
const original = (raw, t, frag) => { const i = t.lastIndexOf(frag); return raw.slice(i, i + frag.length).trim(); };

function equipos(texto, ahora = new Date()) {
  const raw = String(texto || '').trim().replace(/[¿?¡!]+/g, '');
  const t = llano(raw);
  if (!t || /^(?:cuanto|cuantos|que|cual|como|dime)\b/.test(t)) return null;

  let m = t.match(/^(?:crea|crear|da de alta|abre|nueva)\s+(?:la\s+|una\s+)?(?:nueva\s+)?empresa\s+(?:llamada\s+)?(.+?)(?:\s*,?\s*(?:giro|de giro|que es una?|tipo)\s+(.+?))?(?:\s*,?\s*(?:rfc|con rfc)\s+([a-z&n0-9]{12,13}))?$/);
  if (m) {
    const g = m[2] ? GIROS.find(([k]) => m[2].includes(k)) : null;
    return { intent: 'empresa.crear', nombre: original(raw, t, m[1]), giro: g ? g[1] : null, rfc: m[3] ? m[3].toUpperCase() : null };
  }
  if (/^(?:sal|salte|salir|sacame)\s+del\s+grupo\s+de\s+empresas$|^desvincula\s+esta\s+computadora\s+del\s+grupo$/.test(t)) return { intent: 'empresa.salir_grupo' };

  m = t.match(/^(?:crea|crear|da de alta|abre|nueva)\s+(?:la\s+|una\s+)?(?:nueva\s+)?sucursal\s+(?:llamada\s+)?(.+)$/);
  if (m) return { intent: 'sucursal.crear', nombre: original(raw, t, m[1]), tipo: 'BRANCH' };
  m = t.match(/^(?:crea|crear|da de alta|nuevo)\s+(?:el\s+|un\s+)?(?:nuevo\s+)?evento\s+(?:llamado\s+)?(.+?)(?:\s+(del\s+\d{1,2}\s+al\s+\d{1,2}(?:\s+de\s+\w+)?))?$/);
  if (m) {
    const f = m[2] ? rangoFechas(m[2], ahora) : null;
    return { intent: 'sucursal.crear', nombre: original(raw, t, m[1]), tipo: 'EVENT', desde: f?.desde || null, hasta: f?.hasta || null };
  }

  m = t.match(/^(enciende|prende|activa|apaga|desactiva)\s+(?:wybix\s+)?(?:local host|localhost|las pantallas|las tablets)$/);
  if (m) return { intent: 'localhost.activar', activo: /^(enciende|prende|activa)$/.test(m[1]) };
  m = t.match(new RegExp(`^(?:renombra|cambia(?:le)? el nombre (?:a|de))\\s+(?:la\\s+|el\\s+)?${DISP}\\s+(.+?)\\s+(?:a|por)\\s+(.+)$`));
  if (m) return { intent: 'localhost.renombrar', dispositivo: m[1], nombre: original(raw, t, m[2]) };
  m = t.match(new RegExp(`^(?:desconecta|revoca|quita|da de baja)\\s+(?:la\\s+|el\\s+)?${DISP}\\s+(.+)$`));
  if (m) return { intent: 'localhost.revocar', dispositivo: m[1] };
  m = t.match(new RegExp(`^(?:la\\s+|el\\s+)?${DISP}\\s+(.+?)\\s+(?:ahora\\s+)?(?:es|sera|va a ser|queda)\\s+(?:de|para|como)\\s+(.+)$`));
  if (m) { const f = FUNCION.find(([re]) => re.test(m[2])); if (f) return { intent: 'localhost.funcion', dispositivo: m[1], superficie: f[1], estacionTexto: f[1] === 'PREPARATION' ? m[2] : null }; }
  m = t.match(/^(?:quitale|quita|revoca)\s+(?:el\s+)?acceso\s+(?:a\s+)?(.+?)\s+(?:en|a)\s+las\s+(?:tablets|pantallas)$/);
  if (m) return { intent: 'localhost.acceso_revocar', personaTexto: m[1] };
  return null;
}

module.exports = { equipos };
