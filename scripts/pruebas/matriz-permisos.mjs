/**
 * MATRIZ DE PERMISOS: CADA CANAL PROTEGIDO × ADMINISTRADOR, ENCARGADO, OPERADOR.
 *
 *     node scripts/pruebas/matriz-permisos.mjs
 *
 * Pasa cada canal de `canales.EXIGE` por la MISMA puerta que usa la app
 * (`sesion.proteger`) con una sesión de cada puesto, y mira qué pasa:
 *
 *   si        llega al manejador
 *   autoriza  pide el PIN de un encargado o la aprobación del dueño
 *   no        acceso denegado
 *
 * El manejador es de mentira: aquí no se ejecuta nada de verdad (cobrar,
 * restaurar un respaldo, instalar una versión). Lo que se prueba es la
 * decisión, que es lo único que decide `proteger`.
 *
 * Además:
 *   · lo que se acordó para cada casilla de «Qué puede hacer» y cada opción de
 *     «Qué puede ver», escrito a mano (no calculado del catálogo);
 *   · cada ajuste por persona: dárselo al Operador y quitárselo al Encargado;
 *   · con las aprobaciones apagadas, quien vende hace lo aprobable sin PIN.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const permisos = require('../../electron/seguridad/permisos.js');
const canales = require('../../electron/seguridad/canales.js');
const sesion = require('../../electron/seguridad/sesion.js');
const B = permisos.BUNDLES;

let ok = 0, mal = 0;
const fallas = [];
function check(c, que, detalle = '') {
  if (c) { ok++; return; }
  mal++; fallas.push(`${que}${detalle ? '  · ' + detalle : ''}`);
}

const USUARIOS = {
  1: { id: 1, usuario: 'admin', rol: 'admin', active: 1, extras: [] },
  2: { id: 2, usuario: 'encargado', rol: 'supervisor', active: 1, extras: [] },
  3: { id: 3, usuario: 'operador', rol: 'cajero', active: 1, extras: [] },
};
let aprobaciones = true;
sesion.configurar({
  leerRevision: async () => 1,
  leerUsuario: async (id) => USUARIOS[id] ?? null,
  modulosActivos: async () => new Set(),
  licencia: () => null,
  registrar: () => {},
  aprobacionesActivas: () => aprobaciones,
});

async function abrir(id, extras = []) {
  sesion.cerrarTodas();
  USUARIOS[id].extras = extras;
  await sesion.abrir(100 + id, { ...USUARIOS[id] });
  return 100 + id;
}

async function resultado(canal, ventana) {
  let llego = false;
  const h = sesion.proteger(canal, async () => { llego = true; return { success: true }; });
  const r = await h({ sender: { id: ventana } }, {});
  if (llego) return 'si';
  if (r?.motivo === 'REQUIERE_AUTORIZACION') return 'autoriza';
  if (r?.motivo === 'SIN_PERMISO') return 'no';
  return 'raro:' + (r?.motivo ?? JSON.stringify(r));
}

/** Lo esperado por el modelo: con el permiso sí; sin él, lo aprobable se pide. */
function esperado(canal, tiene) {
  const p = canales.exigePara(canal);
  if (tiene.has(p)) return 'si';
  const ap = canales.aprobable(canal);
  if (ap && !ap.enCanal) return aprobaciones ? 'autoriza' : (tiene.has(B.VENTAS_OPERAR) ? 'si' : 'autoriza');
  return 'no';
}

const PUESTOS = [[1, 'admin', 'Administrador'], [2, 'supervisor', 'Encargado'], [3, 'cajero', 'Operador']];
const CANALES = Object.keys(canales.EXIGE);
const resumen = {};

// ---------------------------------------------------------------- 1. todos los canales
for (const modo of [true, false]) {
  aprobaciones = modo;
  for (const [id, rol, nombre] of PUESTOS) {
    const v = await abrir(id);
    const tiene = permisos.permisosDeUsuario(rol, []);
    const cuenta = { si: 0, autoriza: 0, no: 0 };
    for (const c of CANALES) {
      const r = await resultado(c, v);
      cuenta[r] = (cuenta[r] || 0) + 1;
      check(r === esperado(c, tiene), `${nombre} · ${c} (aprobaciones ${modo ? 'encendidas' : 'apagadas'})`, `dio ${r}, se esperaba ${esperado(c, tiene)}`);
    }
    resumen[`${nombre} · aprobaciones ${modo ? 'encendidas' : 'apagadas'}`] = cuenta;
  }
}
aprobaciones = true;

// ---------------------------------------------------------------- 2. lo acordado, escrito a mano
/* Por casilla de «Qué puede hacer» y opción de «Qué puede ver», qué pasa con
   cada puesto TAL COMO VIENE. Canales representativos de cada permiso. */
const ACORDADO = [
  // [canal, Administrador, Encargado, Operador]
  ['sp-refund-sale', 'si', 'si', 'autoriza'],            // Devoluciones y cambios
  ['devoluciones:cambio', 'si', 'si', 'autoriza'],
  ['sp-register-cash-out', 'si', 'si', 'autoriza'],      // Retiros y egresos
  ['egresos:registrar', 'si', 'si', 'autoriza'],
  ['egresos:cancelar', 'si', 'si', 'no'],
  ['sp-update-sale', 'si', 'si', 'autoriza'],            // Modificar o cancelar una venta cobrada
  ['fiscal:cancelar', 'si', 'si', 'no'],
  ['comandas:cancelar', 'si', 'si', 'no'],
  ['commercial:save', 'si', 'si', 'si'],                 // Promociones y combos
  ['coupons:issue', 'si', 'si', 'no'],                   // Crédito y cupones
  ['inventory:apply-count', 'si', 'si', 'autoriza'],     // Compras, ajustes y proveedores
  ['sp-register-purchase', 'si', 'si', 'autoriza'],
  ['sp-register-supplier-payment', 'si', 'si', 'autoriza'],
  ['sp-add-supplier', 'si', 'si', 'no'],
  ['transferencias:enviar', 'si', 'si', 'no'],
  ['sp-delete-product', 'si', 'si', 'no'],
  ['asistencia:horario-guardar', 'si', 'si', 'no'],      // Asistencia del equipo
  ['sp-get-total-sales-today', 'si', 'si', 'no'],        // Números: del día
  ['sp-get-top-selling-products', 'si', 'si', 'no'],
  ['reportes:cierre-dia', 'si', 'si', 'no'],
  ['reportes:estado-resultados', 'si', 'si', 'no'],      // Números: todo
  ['sp-get-profit-overview', 'si', 'si', 'no'],
  ['sp-get-suppliers-account', 'si', 'si', 'no'],        // Costos: visibles
  ['users:create', 'si', 'no', 'no'],                    // Administrar el negocio
  ['users:set-permissions', 'si', 'no', 'no'],
  ['sp-register-sale', 'si', 'si', 'si'],                // Vender: de todos
  ['sp-register-cash-in', 'si', 'si', 'si'],             // Entrada de efectivo
  ['sp-close-shift', 'si', 'si', 'si'],
];
for (const [canal, ...esperados] of ACORDADO) {
  if (!(canal in canales.EXIGE)) { check(false, `el canal ${canal} existe y está protegido`); continue; }
  for (let i = 0; i < PUESTOS.length; i++) {
    const [id, , nombre] = PUESTOS[i];
    const r = await resultado(canal, await abrir(id));
    check(r === esperados[i], `acordado · ${nombre} · ${canal}`, `dio ${r}, se esperaba ${esperados[i]}`);
  }
}
/* El equipo de la caja y los cortes de otros, por su canal. */
const canalDe = (p) => Object.keys(canales.EXIGE).find((c) => canales.EXIGE[c] === p);
for (const [p, enc, op] of [[B.CONFIGURACION_EQUIPO, 'si', 'no'], [B.CAJA_CORTES, 'si', 'si']]) {
  const c = canalDe(p);
  check(!!c, `hay un canal que exige ${p}`);
  if (!c) continue;
  check(await resultado(c, await abrir(2)) === enc, `acordado · Encargado · ${c} (${p})`);
  check(await resultado(c, await abrir(3)) === op, `acordado · Operador · ${c} (${p})`);
}

// ---------------------------------------------------------------- 3. cada ajuste por persona
/* Dar al Operador y quitar al Encargado CADA permiso ajustable, uno por uno,
   y comprobarlo en TODOS los canales que exigen ese permiso. */
for (const a of permisos.AJUSTABLES) {
  const deEste = CANALES.filter((c) => canales.exigePara(c) === a);
  const dado = permisos.permisosDeUsuario('cajero', [a]);
  const quitado = permisos.permisosDeUsuario('supervisor', ['-' + a]);
  check(dado.has(a), `Operador + ${a}: lo tiene`);
  check(!quitado.has(a) || (a === B.VER_NUMEROS_DIA && quitado.has(B.REPORTES_VER)), `Encargado − ${a}: ya no lo tiene`);
  for (const c of deEste) {
    const vOp = await abrir(3, [a]);
    check(await resultado(c, vOp) === 'si', `Operador + ${a} · ${c}`, 'debió pasar');
    const vEnc = await abrir(2, ['-' + a]);
    const r = await resultado(c, vEnc);
    const ap = canales.aprobable(c);
    const debe = quitado.has(a) ? 'si' : (ap && !ap.enCanal ? 'autoriza' : 'no');
    check(r === debe, `Encargado − ${a} · ${c}`, `dio ${r}, se esperaba ${debe}`);
  }
}
/* «Números: del día» sin «Todo» para el Encargado. */
{
  const v = await abrir(2, ['-' + B.REPORTES_VER]);
  check(await resultado('sp-get-total-sales-today', v) === 'si', 'Encargado con Números «Del día» ve el total de hoy');
  check(await resultado('reportes:estado-resultados', v) === 'no', 'Encargado con Números «Del día» no ve el estado de resultados');
}
/* «Números: nada» quita los dos. */
{
  const v = await abrir(2, ['-' + B.REPORTES_VER, '-' + B.VER_NUMEROS_DIA]);
  check(await resultado('sp-get-total-sales-today', v) === 'no', 'Encargado con Números «Nada» no ve el total de hoy');
}
/* Lo de todos los días no se quita: «-VENTAS_OPERAR» no hace nada. */
{
  const v = await abrir(3, ['-' + B.VENTAS_OPERAR, '-' + B.CONFIGURACION_ADMINISTRAR]);
  check(await resultado('sp-register-sale', v) === 'si', 'quitar «vender» desde la tabla no deja a nadie sin vender');
}
/* Al Administrador no se le quita nada. */
{
  const v = await abrir(1, permisos.AJUSTABLES.map((a) => '-' + a));
  check(await resultado('sp-refund-sale', v) === 'si' && await resultado('users:create', v) === 'si', 'al Administrador no se le quita nada');
}
/* Un extra de antes («Supervisar ventas» dado en la 0056) conserva lo que daba. */
{
  const v = await abrir(3, [B.VENTAS_SUPERVISAR]);
  for (const c of ['sp-refund-sale', 'sp-register-cash-out', 'sp-update-sale', 'egresos:registrar']) {
    check(await resultado(c, v) === 'si', `Operador con «Supervisar ventas» de antes · ${c}`);
  }
}
/* Quién autoriza con su PIN: el que tiene el permiso de la operación. */
for (const [c, p] of [['sp-refund-sale', B.DEVOLUCIONES], ['sp-register-cash-out', B.RETIROS_EGRESOS],
  ['sp-update-sale', B.MODIFICAR_VENTA], ['open-cash-drawer', B.CAJON_SIN_VENTA], ['sp-update-product', B.INVENTARIO_OPERAR]]) {
  check(canales.autorizaPara(c) === p, `autoriza ${c}: quien tiene ${p}`, String(canales.autorizaPara(c)));
}
/* Sin sesión, nada. */
sesion.cerrarTodas();
{
  let llego = false;
  const r = await sesion.proteger('sp-register-sale', async () => { llego = true; })({ sender: { id: 999 } }, {});
  check(!llego && r?.motivo === 'SIN_SESION', 'sin sesión no se llega a ningún canal');
}

// ---------------------------------------------------------------- reporte
console.log(`\nMATRIZ DE PERMISOS · ${CANALES.length} canales protegidos × 3 puestos × aprobaciones encendidas/apagadas`);
for (const [k, v] of Object.entries(resumen)) console.log(`  ${k.padEnd(42)} si ${String(v.si).padStart(3)} · autoriza ${String(v.autoriza || 0).padStart(2)} · no ${String(v.no).padStart(3)}`);
console.log(`  ajustes por persona probados: ${permisos.AJUSTABLES.length} (dar al Operador y quitar al Encargado, en cada canal de cada uno)`);
if (fallas.length) { console.log('\nFALLAS:'); for (const f of fallas.slice(0, 60)) console.log('   ' + f); }
console.log(`\n${mal ? 'HAY FALLAS' : 'TODO BIEN'} · ${ok}/${ok + mal}`);
process.exit(mal ? 1 : 0);
