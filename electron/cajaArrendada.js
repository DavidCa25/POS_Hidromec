// cajaArrendada.js
// El lado del cliente del arriendo de caja: reclamar, latir y soltar.
//
// QUE PROBLEMA RESUELVE
// ---------------------
// "Esta maquina es la Caja 2" vivia SOLO en el `device-config.json` local.
// Nadie mas lo sabia, asi que dos equipos podian declararse la misma caja. Y
// el turno es de la CAJA (`cash_closures.register_id`): dos equipos en C1
// comparten turno y comparten corte, las ventas de ambos caen en el mismo
// arqueo y cerrar en uno cierra para el otro.
//
// La regla de verdad vive en SQL (`sp_register_lease_touch`). Aqui solo esta
// el equipo dando senales de vida.
//
// POR QUE UN ARRIENDO QUE CADUCA Y NO UNA MARCA "ocupada"
// -------------------------------------------------------
// Una marca resuelve el conflicto y crea otro peor: la laptop se queda sin
// bateria y C2 queda tomada para siempre por un equipo que ya no contesta. El
// arriendo caduca solo. Cinco minutos, renovados cada minuto: un corte de red
// de dos minutos no le quita la caja a nadie, y un equipo muerto la suelta en
// cinco sin que nadie llame a soporte.
//
// LA VENTA TAMBIEN RENUEVA
// ------------------------
// Ademas de este temporizador, `sp_register_sale` y `sp_open_shift` renuevan
// el arriendo por su cuenta. No es redundancia: Chromium estrangula los
// temporizadores de las ventanas ocultas, y una caja que esta cobrando no
// puede perder su identidad porque el reloj de la interfaz se durmio.

const db = require('./db');

const SEGUNDOS_ARRIENDO = 300;      // 5 min
const MS_LATIDO = 60 * 1000;        // 1 min

let ctx = {
  machineId: '',
  machineName: '',
  leerCaja: () => null,     // () => { id, name } | null
};

let temporizador = null;
let estado = {
  registerId: null,
  registerName: null,
  vigente: false,
  hasta: null,
  ultimo: null,          // RECLAMADA | RENOVADA | RECUPERADA | OCUPADA | SIN_CAJA
  mensaje: null,
  error: null,
};

function log(m) { console.log(`[CAJA] ${m}`); }

function configurar({ machineId, machineName, leerCaja }) {
  ctx = {
    machineId: String(machineId || '').trim(),
    machineName: String(machineName || '').trim().slice(0, 120),
    leerCaja: typeof leerCaja === 'function' ? leerCaja : (() => null),
  };
}

/** La identidad que se manda a los procedimientos transaccionales. */
function identidad() {
  if (!ctx.machineId) return { machineId: null, machineName: null };
  return { machineId: ctx.machineId, machineName: ctx.machineName || null };
}

function instantanea() {
  return { ...estado, machineId: ctx.machineId, machineName: ctx.machineName };
}

/**
 * Reclamar / renovar / recuperar: para SQL es la misma operacion.
 *
 * No lanza. Un fallo de red durante un latido no puede tumbar la app: se
 * anota y se reintenta al minuto siguiente. El arriendo dura cinco veces mas
 * que el periodo del latido justo para que cuatro fallos seguidos no cuesten
 * la caja.
 */
async function reclamar(registerId, registerName) {
  const id = Number(registerId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'Caja invalida.' };
  if (!ctx.machineId) return { ok: false, error: 'Esta maquina todavia no tiene identidad.' };

  try {
    const pool = await db.getPool();
    const r = await pool.request()
      .input('register_id', db.sql.Int, id)
      .input('machine_id', db.sql.NVarChar(64), ctx.machineId)
      .input('machine_name', db.sql.NVarChar(120), ctx.machineName || null)
      .input('lease_seconds', db.sql.Int, SEGUNDOS_ARRIENDO)
      .execute('sp_register_claim');

    const f = r.recordset?.[0] ?? null;
    estado = {
      registerId: id,
      registerName: registerName ?? f?.register_name ?? estado.registerName,
      vigente: f?.ok === 1 || f?.ok === true,
      hasta: f?.lease_until ?? null,
      ultimo: f?.resultado ?? null,
      mensaje: f?.mensaje ?? null,
      error: null,
    };
    return { ok: estado.vigente, data: f };
  } catch (e) {
    // `sp_register_claim` no existe todavia (base sin migrar). No se bloquea
    // a nadie por eso: sin arriendo se opera como siempre, que es exactamente
    // el comportamiento anterior.
    const msg = String(e.message || e);
    estado = { ...estado, registerId: id, vigente: false, error: msg };
    log('No se pudo reclamar la caja: ' + msg.split('\n')[0]);
    return { ok: false, error: msg };
  }
}

async function soltar(por = 'EQUIPO', registerId = null) {
  const id = registerId ?? estado.registerId ?? ctx.leerCaja()?.id ?? null;
  if (!id) return { ok: true, data: null };
  try {
    const pool = await db.getPool();
    const req = pool.request()
      .input('register_id', db.sql.Int, Number(id))
      .input('por', db.sql.NVarChar(20), por);
    if (por === 'EQUIPO') req.input('machine_id', db.sql.NVarChar(64), ctx.machineId);
    const r = await req.execute('sp_register_release');
    // Soltar OTRA caja -al cambiar de caja- no puede marcar la actual como
    // libre: son dos cosas distintas y confundirlas dejaria a esta maquina
    // creyendo que no tiene caja.
    if (Number(id) === Number(estado.registerId)) {
      estado = { ...estado, vigente: false, ultimo: r.recordset?.[0]?.resultado ?? 'LIBERADA' };
    }
    return { ok: true, data: r.recordset?.[0] ?? null };
  } catch (e) {
    log('No se pudo soltar la caja: ' + String(e.message).split('\n')[0]);
    return { ok: false, error: e.message };
  }
}

/**
 * Soltar una caja que YA NO es la de esta maquina (al cambiar de caja).
 *
 * Sigue siendo una liberacion de EQUIPO, no de administrador: solo funciona
 * si el arriendo era de este equipo. Cambiar de caja no da derecho a echar a
 * nadie de la caja a la que uno se cambia... ni de la que deja.
 */
function soltarOtra(registerId) {
  return soltar('EQUIPO', Number(registerId));
}

/** Liberacion de administrador: puede soltar la caja de CUALQUIER equipo. */
async function liberarComoAdmin(registerId) {
  try {
    const pool = await db.getPool();
    const r = await pool.request()
      .input('register_id', db.sql.Int, Number(registerId))
      .input('machine_id', db.sql.NVarChar(64), null)
      .input('por', db.sql.NVarChar(20), 'ADMIN')
      .execute('sp_register_release');
    const f = r.recordset?.[0] ?? null;
    if (Number(registerId) === estado.registerId) estado = { ...estado, vigente: false };
    return { ok: f?.ok === 1, data: f, error: f?.mensaje ?? null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function latir() {
  const caja = ctx.leerCaja();
  if (!caja?.id) return;                       // esta maquina no tiene caja aun
  await reclamar(caja.id, caja.name);
  if (!estado.vigente && estado.ultimo === 'OCUPADA') {
    // Perder la caja en caliente es raro -exige que un administrador la
    // liberara y otro equipo la tomara- pero pasa, y callarlo seria peor.
    log(`La caja ${caja.name ?? caja.id} ya no es de este equipo: ${estado.mensaje}`);
  }
}

/**
 * Arranca el arriendo: reclama la caja guardada y empieza a latir.
 *
 * Instalaciones que ya existian: cada equipo reclama la caja que YA tenia en
 * su `device-config.json`. Como nadie mas la tiene, la toma sin conflicto. Una
 * instalacion de una sola caja no se entera de que esto existe.
 */
async function iniciar() {
  detener();
  const caja = ctx.leerCaja();
  if (caja?.id) await reclamar(caja.id, caja.name);
  temporizador = setInterval(() => { latir().catch(() => { /* ya se anoto */ }); }, MS_LATIDO);
  // No debe mantener viva la aplicacion por si sola.
  if (typeof temporizador.unref === 'function') temporizador.unref();
  return instantanea();
}

function detener() {
  if (temporizador) { clearInterval(temporizador); temporizador = null; }
}

module.exports = {
  SEGUNDOS_ARRIENDO,
  MS_LATIDO,
  configurar,
  identidad,
  instantanea,
  reclamar,
  soltar,
  soltarOtra,
  liberarComoAdmin,
  latir,
  iniciar,
  detener,
};
