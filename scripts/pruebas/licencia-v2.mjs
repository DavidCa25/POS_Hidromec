/**
 * LICENCIAMIENTO v2 EN EL POS: certificado firmado, estados, Venta Esencial,
 * entitlements, cuotas de Pantallas Operativas y archivo offline.
 *
 *     node scripts/pruebas/licencia-v2.mjs
 *
 * Contra el código REAL: electron/license.js (almacén cifrado en un
 * directorio temporal), electron/licencia/* y la puerta de canales
 * (seguridad/sesion.js). Los certificados los FIRMA el mismo módulo que usan
 * las Edge Functions (wybix-owner/supabase/functions/_shared/certificado.ts)
 * si el repo está al lado; si no, se firma aquí con el mismo formato y se
 * avisa. Claves efímeras: nada de esto usa la clave de producción.
 */
import fs, { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateKeyPairSync, sign as firmarNode } from 'node:crypto';
import Module, { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'wxlic2-'));
const cargaOriginal = Module._load;
Module._load = function (peticion, ...resto) {
  if (peticion === 'electron') return { app: { getPath: () => dir } };
  return cargaOriginal.call(this, peticion, ...resto);
};
const require = createRequire(import.meta.url);
const store = require('../../electron/license.js');
const { crearLicencia } = require('../../electron/licencia/index.js');
const { crearRevocaciones } = require('../../electron/licencia/revocaciones.js');
const { verificarCertificado, leerArchivo } = require('../../electron/licencia/certificado.js');
const { calcularEstado } = require('../../electron/licencia/estado.js');
const { crearEvaluador } = require('../../electron/licencia/entitlements.js');
const { crearLicenciaPantallas } = require('../../electron/local-host/licencia-pantallas.js');
const sesion = require('../../electron/seguridad/sesion.js');

let fallos = 0, pasos = 0;
const grupos = {};
let grupo = '';
const seccion = (t) => { grupo = t; grupos[t] = grupos[t] || { ok: 0, falla: 0 }; console.log(`\n-- ${t}`); };
const check = (ok, msg, det = '') => {
  pasos++; if (!ok) fallos++;
  grupos[grupo][ok ? 'ok' : 'falla']++;
  console.log(`   ${ok ? 'ok   ' : 'FALLA'}  ${msg}${det ? '  · ' + det : ''}`);
};
const DIA = 86_400_000;

// ---------------------------------------------------------------- firma
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const KID = 'prueba-1';
const LLAVES = { [KID]: publicKey.export({ type: 'spki', format: 'pem' }) };
const OWNER = resolve(process.env.WYBIX_OWNER_REPO || join(process.cwd(), '..', 'Documents', 'wybix-owner'));
const compartido = join(OWNER, 'supabase', 'functions', '_shared', 'certificado.ts');
let firmarPayload, payloadDeLicencia, payloadDePrueba, origenFirma, importarClave = null;
if (existsSync(compartido)) {
  const m = await import(pathToFileURL(compartido).href);
  const clave = await m.importarClavePrivada(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  firmarPayload = (p, kid = KID, c = clave) => m.firmar(p, c, kid);
  importarClave = m.importarClavePrivada;
  payloadDeLicencia = m.payloadDeLicencia;
  payloadDePrueba = m.payloadDePrueba;
  origenFirma = 'módulo de las Edge Functions (wybix-owner)';
} else {
  const b64 = (b) => Buffer.from(b).toString('base64url');
  firmarPayload = async (p) => {
    const cuerpo = b64(JSON.stringify(p));
    return { format: 'wybix-license', v: 1, kid: KID, payload: cuerpo, sig: b64(firmarNode('sha256', Buffer.from(cuerpo), { key: privateKey, dsaEncoding: 'ieee-p1363' })) };
  };
  const iso = (t) => new Date(t).toISOString();
  payloadDeLicencia = (rt, machineId, ahora) => ({
    schema: 1, kind: 'LICENSE', license_id: rt.license_id, customer: rt.customer, machine_id: machineId, edition: rt.edition,
    registers_max: rt.registers_max, verticals: rt.verticals.map(v => v.vertical).sort(), screens: rt.screens, entitlements: rt.entitlements,
    addons: [], trial_started_at: null, trial_ends_at: null, first_activated_at: rt.first_activated_at, paid_until: rt.paid_until,
    grace_days: 45, grace_until: rt.paid_until ? iso(Date.parse(rt.paid_until) + 45 * DIA) : null, offline_days: 45,
    issued_at: iso(ahora), valid_until: iso(ahora + 45 * DIA) });
  payloadDePrueba = (t, g, ahora) => ({ ...payloadDeLicencia({ license_id: null, customer: '', edition: 'mono', registers_max: 1, verticals: g.verticals.map(v => ({ vertical: v })), screens: g.screens, entitlements: g.entitlements, first_activated_at: null, paid_until: null }, t.machine_id, ahora),
    kind: 'TRIAL', trial_started_at: t.started_at, trial_ends_at: t.expires_at, grace_days: 0, grace_until: null, valid_until: t.expires_at });
  origenFirma = 'firma local (wybix-owner no está al lado): SKIPPED la integración con el módulo del servidor';
}
console.log(`\nLICENCIA v2 · certificados firmados con: ${origenFirma}`);

const BASE = ['sales', 'customers', 'reports', 'invoicing', 'loyalty', 'inventory', 'purchases', 'suppliers', 'cloud_sync', 'backup'];
const COMERCIO = ['commerce', 'operational_surfaces', 'operational.inventory_floor'];
const RESTAURANTE = ['hospitality', 'hospitality.tables', 'hospitality.kds', 'operational_surfaces', 'operational.preparation', 'operational.waiter', 'operational.customer_status', 'operational.inventory_floor'];
const SERVICIOS = ['services', 'services.agenda', 'services.orders', 'operational_surfaces', 'operational.staff_day', 'operational.technician', 'operational.inventory_floor'];
const rt = (o = {}) => ({
  license_id: 'L-1', customer: 'Taller Casillas', edition: 'mono', registers_max: 1,
  verticals: [{ vertical: 'COMMERCE', screen_tier: 'BASE' }], screens: { COMMERCE: 3 }, entitlements: [...new Set([...BASE, ...COMERCIO])],
  first_activated_at: '2026-10-01T15:00:00.000Z', paid_until: '2027-10-01T15:00:00.000Z', ...o,
});
const ACT = Date.parse('2026-10-01T15:00:00Z');

// ============================================================ certificado
seccion('Firma del certificado');
const cert = await firmarPayload(payloadDeLicencia(rt(), 'PC-A', ACT));
check(verificarCertificado(cert, LLAVES).ok, 'un certificado del servidor verifica con la clave pública');
check(verificarCertificado(cert).motivo === 'CLAVE_DESCONOCIDA', 'con las claves de producción, un certificado de otra clave no se acepta');
const alterar = (c, cambio) => {
  const o = JSON.parse(Buffer.from(c.payload, 'base64url').toString('utf8'));
  cambio(o);
  return { ...c, payload: Buffer.from(JSON.stringify(o)).toString('base64url') };
};
check(verificarCertificado(alterar(cert, o => { o.registers_max = null; o.edition = 'multi'; }), LLAVES).motivo === 'FIRMA', 'max_registers 1 -> ilimitado a mano: firma inválida');
check(verificarCertificado(alterar(cert, o => { o.paid_until = '2099-01-01T00:00:00Z'; }), LLAVES).motivo === 'FIRMA', 'paid_until a mano: firma inválida');
check(verificarCertificado(alterar(cert, o => { o.verticals.push('HOSPITALITY'); o.entitlements.push('hospitality'); }), LLAVES).motivo === 'FIRMA', 'agregar un giro a mano: firma inválida');
check(verificarCertificado(alterar(cert, o => { o.screens.COMMERCE = 99; }), LLAVES).motivo === 'FIRMA', 'cambiar el límite de pantallas a mano: firma inválida');
check(verificarCertificado({ ...cert, sig: cert.sig.slice(0, -4) + 'AAAA' }, LLAVES).motivo === 'FIRMA', 'firma dañada: se rechaza');
check(!verificarCertificado({ format: 'otro' }, LLAVES).ok && leerArchivo('no es json') === null && leerArchivo(JSON.stringify({ certificate: cert }))?.sig === cert.sig,
  'estructura inválida: se rechaza; el archivo acepta el certificado o la respuesta completa del servidor');

// ============================================================ estados
seccion('Estados (sin red, deterministas)');
const pru = (await firmarPayload(payloadDePrueba({ machine_id: 'PC-A', started_at: '2026-10-01T15:00:00Z', expires_at: '2026-10-31T15:00:00Z' }, { verticals: [], entitlements: BASE, screens: {} }, ACT)));
const pp = verificarCertificado(pru, LLAVES).payload;
const en = (p, t) => calcularEstado(p, { ahora: t });
check(en(pp, ACT + 0 * DIA).modo === 'TRIAL' && en(pp, ACT + 28 * DIA).modo === 'TRIAL', 'prueba: día 1 y día 29 -> TRIAL');
check(en(pp, ACT + 30.5 * DIA).modo === 'EXPIRED', 'prueba: día 31 sin compra -> EXPIRED (como hoy: activar una licencia)');
const pl = verificarCertificado(cert, LLAVES).payload;
check(pl.paid_until === '2027-10-01T15:00:00.000Z', 'primera activación 2026-10-01 -> primer año hasta 2027-10-01');
// Para fechas lejanas se usa un certificado recién emitido (si no, vencería su validez sin red).
const certEn = async (t, o = {}) => verificarCertificado(await firmarPayload(payloadDeLicencia(rt(o), 'PC-A', t)), LLAVES).payload;
const VENCE = Date.parse('2027-10-01T15:00:00Z');
check(en(await certEn(VENCE - 10 * DIA), VENCE - 1 * DIA).modo === 'ACTIVE', 'ACTIVE antes del vencimiento');
check(en(await certEn(VENCE), VENCE + 1 * DIA).modo === 'GRACE', 'día +1 -> GRACE');
const g44 = en(await certEn(VENCE), VENCE + 44 * DIA);
check(g44.modo === 'GRACE' && g44.diasRestantes === 1, 'día +44 -> GRACE (queda 1 día)', `quedan ${g44.diasRestantes}`);
check(en(await certEn(VENCE + 30 * DIA), VENCE + 46 * DIA).modo === 'SALE_ONLY', 'día +46 -> SALE_ONLY (Venta Esencial)');
const sinRed = en(await certEn(ACT), ACT + 46 * DIA);
check(sinRed.modo === 'SALE_ONLY' && sinRed.motivo === 'SIN_VALIDAR', 'pagado pero 46 días sin validar: Venta Esencial (vende), hasta refrescar');
check(en(await certEn(ACT), ACT + 40 * DIA).refrescarEnDias === 5, 'aviso: validar en los próximos 5 días');
const atrasado = calcularEstado(await certEn(VENCE + 30 * DIA), { ahora: VENCE - 200 * DIA, ultimaVista: VENCE + 50 * DIA });
check(atrasado.modo === 'SALE_ONLY' && atrasado.relojAtrasado, 'atrasar el reloj de Windows no devuelve días (se usa la última hora vista)');

// ============================================================ entitlements
seccion('Entitlements y Venta Esencial');
const evSale = crearEvaluador({ modo: 'SALE_ONLY', entitlements: [...BASE, ...RESTAURANTE, ...SERVICIOS], verticals: ['HOSPITALITY', 'SERVICES'], screens: { HOSPITALITY: 3, SERVICES: 3 } });
check(evSale.permiteCanal('sp-register-sale', 'VENTAS_OPERAR').ok && evSale.permiteCanal('backup-run-now', 'CONFIGURACION_ADMINISTRAR').ok
      && evSale.permiteCanal('export-sales-pdf', 'REPORTES_VER').ok && evSale.permiteCanal('open-shift', 'VENTAS_OPERAR').ok,
  'SALE_ONLY: vender, turno, reportes y respaldo siguen');
check(!evSale.permiteCanal('sp-register-purchase', 'INVENTARIO_OPERAR').ok && !evSale.permiteCanal('inventario:reporte-resolver', 'INVENTARIO_OPERAR').ok,
  'SALE_ONLY: compras e inventario operativo, no');
check(!evSale.permiteCanal('servicios:orden-crear', 'SERVICIOS_OPERAR').ok && !evSale.permiteCanal('cuentas:enviar', 'VENTAS_OPERAR', 'hospitality').ok
      && !evSale.permiteCanal('kds:estado', 'VENTAS_OPERAR', 'comandas').ok && !evSale.permiteCanal('salon:get', 'VENTAS_OPERAR', 'mesas').ok,
  'SALE_ONLY: agenda, mesas, comandas y KDS, no');
check(!evSale.permiteCanal('localhost:emparejar', 'CONFIGURACION_ADMINISTRAR').ok && !evSale.permiteSuperficie('PREPARATION') && !evSale.permiteSuperficie('STAFF_DAY'),
  'SALE_ONLY: Pantallas Operativas, no');
check(!evSale.permiteCanal('cloud-push-now', 'CONFIGURACION_ADMINISTRAR').ok && evSale.permiteCanal('cloud-delete-account', 'CONFIGURACION_ADMINISTRAR').ok,
  'SALE_ONLY: servicios conectados en pausa, pero borrar tus datos de la nube siempre se puede');
const evCom = crearEvaluador({ modo: 'ACTIVE', entitlements: [...BASE, ...COMERCIO], verticals: ['COMMERCE'], screens: { COMMERCE: 3 } });
check(evCom.permiteCanal('sp-register-purchase', 'INVENTARIO_OPERAR').ok && !evCom.permiteCanal('cuentas:enviar', 'VENTAS_OPERAR', 'hospitality').ok
      && !evCom.permiteCanal('servicios:orden-crear', 'SERVICIOS_OPERAR').ok && !evCom.permiteSuperficie('WAITER') && evCom.permiteSuperficie('INVENTORY_FLOOR'),
  'Comercio (ACTIVE): inventario sí; restaurante, servicios y mesero no aunque el código esté instalado');
const evHib = crearEvaluador({ modo: 'ACTIVE', entitlements: [...BASE, ...COMERCIO, ...SERVICIOS], verticals: ['COMMERCE', 'SERVICES'], screens: { COMMERCE: 3, SERVICES: 3 } });
check(evHib.permiteCanal('servicios:orden-crear', 'SERVICIOS_OPERAR').ok && evHib.permiteSuperficie('TECHNICIAN') && !evHib.permiteSuperficie('PREPARATION'),
  'híbrido Comercio + Servicios: servicios y técnico sí; cocina no');
check(crearEvaluador({ modo: 'GRACE', entitlements: [...BASE, ...RESTAURANTE] }).permiteCanal('cuentas:enviar', 'VENTAS_OPERAR', 'hospitality').ok,
  'GRACE: todo lo contratado sigue funcionando');

// ============================================================ puerta de canales
seccion('Puerta de canales (backend, no UI)');
sesion.configurar({ leerRevision: async () => 1, modulosActivos: async () => new Set(['hospitality', 'mesas', 'comandas', 'servicios']), licencia: () => evSale });
await sesion.abrir(77, { id: 1, usuario: 'dueno', rol: 'admin' });
const denegado = await sesion.proteger('cuentas:enviar', async () => ({ success: true }), { modulo: 'hospitality' })({ sender: { id: 77 } });
const permitido = await sesion.proteger('sp-register-sale', async () => ({ success: true }))({ sender: { id: 77 } });
check(denegado.success === false && denegado.motivo === 'VENTA_ESENCIAL' && /renovar/i.test(denegado.error) && permitido.success === true,
  'llamar el canal de mesas directo en Venta Esencial se rechaza con un mensaje claro; vender pasa', denegado.error);
sesion.configurar({ licencia: () => evCom });
const sinPlan = await sesion.proteger('servicios:orden-crear', async () => ({ success: true }))({ sender: { id: 77 } });
check(sinPlan.motivo === 'SIN_LICENCIA', 'un canal fuera del plan se rechaza aunque el menú no lo muestre', sinPlan.error);
sesion.configurar({ licencia: () => null });

// ============================================================ cuotas
seccion('Pantallas Operativas: cuota por giro');
const repoFalso = (disp, pend = []) => ({ ocupacionPorSuperficie: async () => ({ dispositivos: disp.map((s, i) => ({ id: `d${i}`, superficie: s })), pendientes: pend.map(s => ({ superficie: s })) }) });
const evRS = crearEvaluador({ modo: 'ACTIVE', entitlements: [...BASE, ...RESTAURANTE, ...SERVICIOS], verticals: ['HOSPITALITY', 'SERVICES'], screens: { HOSPITALITY: 3, SERVICES: 3 } });
const lp = (disp, pend, ev = evRS) => crearLicenciaPantallas({ repo: repoFalso(disp, pend), licencia: () => ev });
check((await lp(['PREPARATION', 'PREPARATION'], []).cuota('CUSTOMER_STATUS')).ok, 'Restaurantes: la 3.ª pantalla entra');
const cuarta = await lp(['PREPARATION', 'PREPARATION', 'CUSTOMER_STATUS'], []).cuota('WAITER');
check(!cuarta.ok && /hasta 3/.test(cuarta.error), 'Restaurantes: la 4.ª se rechaza con un mensaje claro', cuarta.error);
check((await lp(['PREPARATION', 'PREPARATION'], []).cuota('WAITER', { excluirId: 'd1' })).ok, 'revocar/reasignar una libera su lugar: Barra -> Mesero entra');
check((await lp(['PREPARATION', 'PREPARATION'], ['CUSTOMER_STATUS']).cuota('WAITER')).ok === false, 'un QR pendiente aparta su lugar');
check((await lp(['PREPARATION', 'STAFF_DAY', 'STAFF_DAY'], []).cuota('TECHNICIAN')).ok
      && !(await lp(['PREPARATION', 'STAFF_DAY', 'STAFF_DAY', 'TECHNICIAN'], []).cuota('STAFF_DAY')).ok,
  'híbrido: 3 de Servicios aparte de Restaurantes; la 4.ª de Servicios se rechaza aunque Restaurantes use 1');
check((await lp(['STAFF_DAY', 'STAFF_DAY', 'STAFF_DAY'], []).cuota('WAITER', { excluirId: 'd0' })).ok,
  'Mi jornada -> Mesero: deja de contar en Servicios y cuenta en Restaurantes (no dos veces)');
const ev10 = crearEvaluador({ modo: 'ACTIVE', entitlements: [...BASE, ...RESTAURANTE], verticals: ['HOSPITALITY'], screens: { HOSPITALITY: 10 } });
check((await lp(['PREPARATION', 'PREPARATION', 'CUSTOMER_STATUS'], [], ev10).cuota('WAITER')).ok, 'ampliación a 10: la 4.ª entra');
const evInf = crearEvaluador({ modo: 'ACTIVE', entitlements: [...BASE, ...RESTAURANTE], verticals: ['HOSPITALITY'], screens: { HOSPITALITY: null } });
check((await lp(Array(40).fill('PREPARATION'), [], evInf).cuota('WAITER')).ok, 'ilimitadas: sin límite');
check(evRS.giroDeSuperficie('INVENTORY_FLOOR') === 'HOSPITALITY' && evHib.giroDeSuperficie('INVENTORY_FLOOR') === 'COMMERCE',
  'inventario de piso cuenta en Comercio si lo tiene; si no, en el primer giro');

// ============================================================ servicio + archivo
seccion('Licencia en el equipo y archivo offline');
let reloj = ACT + 2 * DIA;
const ctx = () => ({ machineIdV1: 'PC-A', candidatosV1: ['PC-A'], huella: null });
const lic = crearLicencia({ store, contexto: ctx, ahora: () => reloj, llaves: LLAVES });
check(lic.aplicarRespuesta({ certificate: cert }).ok && lic.estado(true).modo === 'ACTIVE', 'se guarda el certificado del servidor y queda ACTIVE');
const otraPc = await firmarPayload(payloadDeLicencia(rt(), 'PC-B', ACT));
const alterado = alterar(cert, o => { o.edition = 'multi'; o.registers_max = null; });
check(!lic.importar(JSON.stringify(alterado)).ok && lic.estado(true).edition === 'mono', 'importar una licencia alterada: rechazo, y la actual sigue intacta');
check(/otra computadora/.test(lic.importar(JSON.stringify(otraPc)).error), 'importar la licencia de otra computadora: rechazo');
const nueva = await firmarPayload(payloadDeLicencia(rt({ paid_until: '2028-10-01T15:00:00.000Z' }), 'PC-A', ACT + 1 * DIA));
check(lic.importar(JSON.stringify(nueva)).ok && lic.estado(true).paidUntil === '2028-10-01T15:00:00.000Z', 'importar la renovación válida (USB): aplica');
check(/más antiguo/.test(lic.importar(JSON.stringify(cert)).error) && lic.estado(true).paidUntil === '2028-10-01T15:00:00.000Z',
  'importar un archivo más antiguo: no retrocede');
check(!lic.importar('{"format":"wybix-license","v":1,"kid":"x","payload":"a","sig":"b"}').ok, 'un archivo con otra clave: rechazo');
/* Renovación tras Venta Esencial: el aviso de inventario. */
const vencida = await firmarPayload(payloadDeLicencia(rt({ paid_until: '2026-08-01T15:00:00.000Z' }), 'PC-A', ACT + 2 * DIA));
lic.aplicarRespuesta({ certificate: vencida });
check(lic.estado(true).modo === 'SALE_ONLY', 'vencida hace más de 45 días: Venta Esencial');
reloj += 3 * DIA;
const renovada = await firmarPayload(payloadDeLicencia(rt({ paid_until: '2027-12-01T15:00:00.000Z' }), 'PC-A', reloj));
lic.aplicarRespuesta({ certificate: renovada });
const trasRenovar = lic.estado(true);
check(trasRenovar.modo === 'ACTIVE' && trasRenovar.revisionInventario?.desde && trasRenovar.revisionInventario?.hasta,
  'renovar: ACTIVE de inmediato (sin reinstalar) y queda el aviso de revisar el inventario, con desde/hasta');
lic.descartarRevisionInventario();
check(!lic.estado(true).revisionInventario, 'el aviso se descarta y no vuelve');
store.clearLicense();
check(lic.estado(true).modo === 'NONE', 'liberada la computadora: deja de estar autorizada');

// ============================================================ offline 45 días
seccion('Validación periódica: 45 días sin Internet');
{
  /* El caso pedido: suscripción anual vigente hasta 2027-10-01; última
     verificación en línea 2026-10-01; sin Internet desde entonces. */
  const ULT = Date.parse('2026-10-01T12:00:00Z');
  const PAGADO = '2027-10-01T12:00:00.000Z';
  const rtA = (o = {}) => rt({ paid_until: PAGADO, verticals: [{ vertical: 'HOSPITALITY', screen_tier: 'BASE' }], screens: { HOSPITALITY: 3 },
                               entitlements: [...new Set([...BASE, ...RESTAURANTE])], ...o });
  let t = ULT;
  const ctxO = () => ({ machineIdV1: 'PC-O', candidatosV1: ['PC-O'], huella: null });
  store.clearLicense();
  const lo = crearLicencia({ store, contexto: ctxO, ahora: () => t, llaves: LLAVES });
  const certUlt = await firmarPayload(payloadDeLicencia(rtA(), 'PC-O', ULT));
  check(lo.aplicarRespuesta({ certificate: certUlt }).ok, 'última validación en línea: 2026-10-01 (certificado emitido ese día)');
  const vu = lo.estado(true).validUntil;
  check(vu === '2026-11-15T12:00:00.000Z', 'vale sin red hasta 2026-11-15 (45 días, lo dice el certificado)', vu);

  t = ULT + 44 * DIA;
  const d44 = lo.estado(true), ev44 = lo.evaluador(true);
  check(d44.modo === 'ACTIVE' && d44.refrescarEnDias === 1 && ev44.permiteCanal('cuentas:enviar', 'VENTAS_OPERAR', 'hospitality').ok
        && ev44.permiteCanal('sp-register-purchase', 'INVENTARIO_OPERAR').ok && !ev44.ventaEsencial,
    'día 44: TODO funciona (ACTIVE) y avisa «valida tu licencia en el próximo día»', `${d44.modo}, refrescar en ${d44.refrescarEnDias}`);
  t = ULT + 45 * DIA;
  check(lo.estado(true).modo === 'ACTIVE', 'día 45 (hasta la hora de la última validación): todavía ACTIVE');
  t = ULT + 46 * DIA;
  const d46 = lo.estado(true), ev46 = lo.evaluador(true);
  check(d46.modo === 'SALE_ONLY' && d46.motivo === 'SIN_VALIDAR' && d46.paidUntil === PAGADO,
    'día 46: Modo Venta Esencial por falta de validación (motivo SIN_VALIDAR); lo pagado sigue siendo 2027-10-01', `${d46.modo}/${d46.motivo}`);
  check(ev46.ventaEsencial && ev46.permiteCanal('sp-register-sale', 'VENTAS_OPERAR').ok && ev46.permiteCanal('backup-run-now', 'CONFIGURACION_ADMINISTRAR').ok
        && ev46.permiteCanal('export-sales-pdf', 'REPORTES_VER').ok
        && !ev46.permiteCanal('sp-register-purchase', 'INVENTARIO_OPERAR').ok && !ev46.permiteCanal('cuentas:enviar', 'VENTAS_OPERAR', 'hospitality').ok,
    'día 46: vende, cobra, respalda y exporta; inventario, compras y mesas esperan a validar');

  // El archivo firmado, descargado en otro equipo el día 46 (misma suscripción).
  const certD46 = await firmarPayload(payloadDeLicencia(rtA(), 'PC-O', ULT + 46 * DIA));
  const imp = lo.importar(JSON.stringify(certD46));
  const tras = lo.estado(true);
  check(imp.ok && tras.modo === 'ACTIVE' && tras.paidUntil === PAGADO && tras.issuedAt === new Date(ULT + 46 * DIA).toISOString(),
    'importar el archivo del día 46: vuelve a ACTIVE; renueva la validación (issued_at) SIN cambiar paid_until', `${tras.modo} · pagado ${tras.paidUntil}`);
  check(tras.validUntil === new Date(ULT + 91 * DIA).toISOString(), 'y la próxima validación hace falta 45 días después de la DESCARGA', tras.validUntil);
  check(!!tras.revisionInventario, 'al salir de Venta Esencial queda el aviso de revisar el inventario');
  const forjado = alterar(certD46, o => { o.paid_until = '2030-01-01T00:00:00.000Z'; });
  check(!lo.importar(JSON.stringify(forjado)).ok && lo.estado(true).paidUntil === PAGADO, 'un archivo con paid_until editado se rechaza: no se puede estirar la suscripción');
  t = ULT + 30 * DIA;
  check(lo.estado(true).modo === 'ACTIVE' && lo.estado(true).ahoraEfectivo >= new Date(ULT + 46 * DIA).toISOString(),
    'atrasar el reloj después de importar no «devuelve» días (se usa la última hora vista)');
  // Descargado el día 40, importado el día 50: vale 45 días desde la descarga.
  t = ULT + 50 * DIA;
  store.clearLicense(); lo.olvidar();
  lo.aplicarRespuesta({ certificate: certUlt });
  const certD40 = await firmarPayload(payloadDeLicencia(rtA(), 'PC-O', ULT + 40 * DIA));
  check(lo.importar(JSON.stringify(certD40)).ok && lo.estado(true).modo === 'ACTIVE' && lo.estado(true).validUntil === new Date(ULT + 85 * DIA).toISOString(),
    'archivo descargado el día 40 e importado el 50: ACTIVE hasta el día 85 (cuenta desde que el servidor lo firmó)');
  store.clearLicense();
}

// ============================================================ rotación de claves
seccion('Rotación y revocación de claves (POS)');
{
  const { llavesDeConfianza, PRODUCCION, DESARROLLO } = require('../../electron/licencia/llaves-publicas.js');
  const inst = llavesDeConfianza({ empaquetado: true, extra: { 'e2e-1': 'x' } });
  check(!Object.keys(inst).some(k => k in DESARROLLO) && !('e2e-1' in inst) && Object.keys(inst).length === Object.keys(PRODUCCION).length,
    'el instalador confía SOLO en las claves de producción (ni desarrollo ni la de pruebas E2E)');
  check('wybix-dev-1' in llavesDeConfianza({ empaquetado: false }), 'sin empaquetar también en la de desarrollo (npm start, pruebas)');
  if (!importarClave) {
    check(true, 'SKIPPED: rotación con el módulo del servidor (wybix-owner no está al lado)');
  } else {
    const par = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const k1 = par(), k2 = par();
    const c1 = await importarClave(k1.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const c2 = await importarClave(k2.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const pub = (k) => k.publicKey.export({ type: 'spki', format: 'pem' });
    const AMBAS = { 'wybix-lic-1': pub(k1), 'wybix-lic-2': pub(k2) };
    let t = ACT;
    const ctxR = () => ({ machineIdV1: 'PC-R', candidatosV1: ['PC-R'], huella: null });
    store.clearLicense();
    const lr = crearLicencia({ store, contexto: ctxR, ahora: () => t, llaves: AMBAS });
    const cK1 = await firmarPayload(payloadDeLicencia(rt(), 'PC-R', ACT), 'wybix-lic-1', c1);
    check(lr.aplicarRespuesta({ certificate: cK1 }).ok && lr.estado(true).modo === 'ACTIVE', 'KID 1: la licencia existente verifica');
    t = ACT + DIA;
    const cK2 = await firmarPayload(payloadDeLicencia(rt(), 'PC-R', ACT + DIA), 'wybix-lic-2', c2);
    check(lr.aplicarRespuesta({ certificate: cK2 }).ok && lr.estado(true).modo === 'ACTIVE', 'KID 2: las nuevas se firman con la clave nueva y el mismo POS las acepta');
    // Compromiso de KID 1: el servidor lo anuncia en los certificados nuevos.
    t = ACT + 2 * DIA;
    const cRev = await firmarPayload({ ...payloadDeLicencia(rt(), 'PC-R', ACT + 2 * DIA), revoked_kids: ['wybix-lic-1'] }, 'wybix-lic-2', c2);
    check(lr.aplicarRespuesta({ certificate: cRev }).ok, 'un certificado nuevo anuncia KID 1 como revocado');
    const cK1Nuevo = await firmarPayload(payloadDeLicencia(rt({ paid_until: '2099-01-01T00:00:00.000Z' }), 'PC-R', ACT + 3 * DIA), 'wybix-lic-1', c1);
    const r1 = lr.importar(JSON.stringify(cK1Nuevo));
    check(!r1.ok && /ya no es válida/.test(r1.error) && lr.estado(true).paidUntil !== '2099-01-01T00:00:00.000Z',
      'desde entonces, nada firmado con KID 1 se acepta (aunque sea válido y más nuevo)', r1.error);
    const cAuto = await firmarPayload({ ...payloadDeLicencia(rt(), 'PC-R', ACT + 4 * DIA), revoked_kids: ['wybix-lic-2'] }, 'wybix-lic-2', c2);
    check(!lr.aplicarRespuesta({ certificate: cAuto }).ok, 'un certificado firmado con un KID que él mismo revoca se rechaza');

    // MONOTÓNICO: la revocación vive aparte de la licencia.
    const archivoRev = join(dir, 'kids-revocados.json');
    const revA = crearRevocaciones({ archivo: archivoRev });
    store.clearLicense();
    const lm = crearLicencia({ store, contexto: ctxR, ahora: () => t, llaves: AMBAS, revocaciones: revA });
    check(lm.aplicarRespuesta({ certificate: cRev }).ok && revA.leer().includes('wybix-lic-1'), 'la revocación de KID 1 se guarda en su propio almacén');
    store.clearLicense(); lm.olvidar();
    check(!lm.importar(JSON.stringify(cK1)).ok, 'liberar el equipo (borrar la licencia) NO des-revoca: un archivo viejo de KID 1 sigue rechazado');
    const trasReiniciar = crearLicencia({ store, contexto: ctxR, ahora: () => t, llaves: AMBAS, revocaciones: crearRevocaciones({ archivo: archivoRev }) });
    check(!trasReiniciar.importar(JSON.stringify(cK1Nuevo)).ok && !trasReiniciar.aplicarRespuesta({ certificate: cK1 }).ok,
      'tras reiniciar Wybix, KID 1 sigue revocado (nuevos y viejos)');
    check(!revA.agregar([]) && crearRevocaciones({ archivo: archivoRev }).leer().includes('wybix-lic-1'),
      'no existe operación que quite un KID revocado');
    const fijas = crearLicencia({ store, contexto: ctxR, ahora: () => t, llaves: AMBAS, revocaciones: crearRevocaciones({ fijas: ['wybix-lic-1'] }) });
    check(!fijas.aplicarRespuesta({ certificate: cK1 }).ok, 'un POS que ya trae KID 1 como revocado de fábrica (REVOCADAS) lo rechaza sin esperar un certificado');
    // Retiro de KID 1 del POS con un certificado KID 1 guardado: no verifica, pero se puede refrescar.
    store.clearLicense();
    const soloK1 = crearLicencia({ store, contexto: ctxR, ahora: () => t, llaves: { 'wybix-lic-1': pub(k1) } });
    soloK1.aplicarRespuesta({ certificate: cK1 });
    const retirado = crearLicencia({ store, contexto: ctxR, ahora: () => t, llaves: { 'wybix-lic-2': pub(k2) } });
    const er = retirado.estado(true);
    check(er.modo === 'TAMPER' && er.motivo === 'clave-desconocida' && retirado.tipoGuardado() === 'paid',
      'si una versión del POS retira KID 1 antes de tiempo: no verifica, pero sabe que es una licencia pagada y la pide al servidor', `${er.modo}/${er.motivo}`);
    store.clearLicense();
  }
}

// ============================================================ anterior al certificado y prueba de un giro
seccion('Sin legacy: certificado firmado obligatorio');
{
  const { llavesDeConfianza } = require('../../electron/licencia/llaves-publicas.js');
  const INSTALADOR = llavesDeConfianza({ empaquetado: true });
  const ctxL = () => ({ machineIdV1: 'PC-L', candidatosV1: ['PC-L'], huella: null });
  store.clearLicense();
  const prod = crearLicencia({ store, contexto: ctxL, ahora: () => ACT, llaves: INSTALADOR });
  store.saveLicense(ctxL(), { success: true, type: 'paid', plan: 'multi', customerName: 'Formato anterior', revalidateBy: '2099-01-01T00:00:00Z' });
  const eL = prod.estado(true), evL = prod.evaluador(true);
  check(eL.modo === 'TAMPER' && eL.motivo === 'sin-firma' && prod.tipoGuardado() === 'paid',
    'licencia SIN firma en el runtime del instalador: se rechaza («necesita actualizarse»), no hay estado especial', `${eL.modo}/${eL.motivo}`);
  check(!evL.permiteCanal('sp-register-sale', 'VENTAS_OPERAR').ok && !evL.permiteSuperficie('PREPARATION'),
    'y no concede nada: ni vender ni pantallas, hasta actualizarla');
  const app = fs.readFileSync(new URL('../../src/app/app.html', import.meta.url), 'utf8');
  const pantalla = fs.readFileSync(new URL('../../src/app/licencia/licencia-vencida.component.ts', import.meta.url), 'utf8');
  check(/motivo === 'sin-firma' \? 'actualizar'/.test(app) && pantalla.includes('Esta licencia necesita actualizarse.')
        && /actualizar\(\)/.test(pantalla) && /importar\(\)/.test(pantalla),
    'la pantalla dice «Esta licencia necesita actualizarse.» con actualizar en línea e importar archivo (no un error técnico)');
  store.saveLicense(ctxL(), { success: true, type: 'trial', plan: 'trial', expiresAt: '2099-01-01T00:00:00Z', revalidateBy: '2099-01-01T00:00:00Z' });
  const eT = prod.estado(true);
  check(eT.modo === 'TAMPER' && eT.motivo === 'sin-firma' && prod.tipoGuardado() === 'trial',
    'una prueba sin firma también: se actualiza con el servicio de pruebas', `${eT.modo}/${eT.motivo}`);

  // Firmada con la clave de PRODUCCIÓN (aquí, una efímera en el lugar de wybix-lic-1): válida.
  const kp = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const PROD = { ...INSTALADOR, 'wybix-lic-1': kp.publicKey.export({ type: 'spki', format: 'pem' }) };
  const certProd = await (async () => {
    if (!importarClave) return null;
    const c = await importarClave(kp.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    return firmarPayload(payloadDeLicencia(rt(), 'PC-L', ACT), 'wybix-lic-1', c);
  })();
  if (certProd) {
    store.clearLicense();
    const conProd = crearLicencia({ store, contexto: ctxL, ahora: () => ACT, llaves: PROD });
    check(conProd.aplicarRespuesta({ certificate: certProd }).ok && conProd.estado(true).modo === 'ACTIVE',
      'firmada con la clave de producción: válida en el instalador');
    // KID de DESARROLLO dentro del instalador.
    const certDev = await firmarPayload(payloadDeLicencia(rt(), 'PC-L', ACT), 'wybix-dev-1',
      await importarClave(generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' })));
    const rDev = verificarCertificado(certDev, INSTALADOR);
    check(!rDev.ok && rDev.motivo === 'CLAVE_DESCONOCIDA' && !conProd.importar(JSON.stringify(certDev)).ok,
      'firmada con el KID de DESARROLLO dentro del instalador: rechazo');
    // QA / E2E: su clave efímera solo vale sin empaquetar.
    const kq = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pubQ = kq.publicKey.export({ type: 'spki', format: 'pem' });
    const certQa = await firmarPayload({ ...payloadDeLicencia(rt(), 'PC-L', ACT), origin: 'QA' }, 'e2e-1',
      await importarClave(kq.privateKey.export({ type: 'pkcs8', format: 'pem' })));
    const qaOk = verificarCertificado(certQa, llavesDeConfianza({ empaquetado: false, extra: { 'e2e-1': pubQ } }));
    const qaInst = verificarCertificado(certQa, llavesDeConfianza({ empaquetado: true, extra: { 'e2e-1': pubQ } }));
    check(qaOk.ok && qaOk.payload.origin === 'QA' && !qaInst.ok && qaInst.motivo === 'CLAVE_DESCONOCIDA',
      'licencia QA firmada: válida en el entorno de pruebas; el instalador no confía en esa clave');
  } else {
    check(true, 'SKIPPED: producción/desarrollo/QA con el módulo del servidor (wybix-owner no está al lado)');
  }
  store.clearLicense();
}

seccion('Prueba de UN giro');
{
  const ctxL = () => ({ machineIdV1: 'PC-L', candidatosV1: ['PC-L'], huella: null });
  store.clearLicense();
  const ll = crearLicencia({ store, contexto: ctxL, ahora: () => ACT, llaves: LLAVES });
  store.saveLicense(ctxL(), { success: true, type: 'trial', plan: 'trial', expiresAt: '2026-01-01T00:00:00Z', revalidateBy: '2026-01-01T00:00:00Z' });
  const antes = JSON.stringify(store.readLicense(ctxL()).data);
  check(!ll.aplicarRespuesta({ success: true, plan: 'multi', maxRegisters: 0 }).ok && JSON.stringify(store.readLicense(ctxL()).data) === antes,
    'una respuesta del servidor SIN certificado no se guarda: la licencia actual queda intacta');

  store.clearLicense();
  const T0 = { machine_id: 'PC-L', started_at: '2026-10-01T15:00:00Z', expires_at: '2026-10-31T15:00:00Z' };
  const sinGiro = await firmarPayload(payloadDePrueba(T0, { verticals: [], entitlements: BASE, screens: {} }, ACT));
  ll.aplicarRespuesta({ certificate: sinGiro });
  const e0 = ll.estado(true), ev0 = ll.evaluador(true);
  check(e0.modo === 'TRIAL' && e0.verticals.length === 0 && ev0.permiteCanal('sp-register-sale', 'VENTAS_OPERAR').ok
        && !ev0.permiteCanal('cuentas:enviar', 'VENTAS_OPERAR', 'hospitality').ok && !ev0.permiteCanal('servicios:orden-crear', 'SERVICIOS_OPERAR').ok,
    'prueba recién iniciada, antes de elegir giro: vende, pero ningún giro (nunca los tres)');
  check(ll.recordarGiroPrueba('HOSPITALITY').ok && ll.giroPruebaPendiente() === 'HOSPITALITY', 'sin red en el alta: el giro elegido queda pendiente para el siguiente refresco');
  const conGiro = await firmarPayload(payloadDePrueba(T0, { verticals: ['HOSPITALITY'], entitlements: [...new Set([...BASE, ...RESTAURANTE])], screens: { HOSPITALITY: 3 } }, ACT + DIA));
  ll.aplicarRespuesta({ certificate: conGiro });
  const e1 = ll.estado(true), ev1 = ll.evaluador(true);
  check(e1.modo === 'TRIAL' && JSON.stringify(e1.verticals) === '["HOSPITALITY"]' && ev1.permiteCanal('cuentas:enviar', 'VENTAS_OPERAR', 'hospitality').ok
        && !ev1.permiteCanal('servicios:orden-crear', 'SERVICIOS_OPERAR').ok && ev1.cuotaDe('HOSPITALITY') === 3 && ev1.cuotaDe('SERVICES') === 0,
    'el servidor confirma Restaurantes: 30 días de ese giro y 3 Pantallas Operativas de ese giro; Servicios no');
  check(ll.giroPruebaPendiente() === null, 'confirmado por el servidor, ya no queda pendiente');
  store.clearLicense();
}

rmSync(dir, { recursive: true, force: true });
console.log('\nPOR BLOQUE');
for (const [g, r] of Object.entries(grupos)) console.log(`   ${g.padEnd(44)} PASS ${r.ok} · FAIL ${r.falla}`);
console.log(fallos ? `\nRESULTADO: ${fallos} fallas de ${pasos}` : `\nRESULTADO: ${pasos} ok · 0 fallas`);
process.exit(fallos ? 1 : 0);
