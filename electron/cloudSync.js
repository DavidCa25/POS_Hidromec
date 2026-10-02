const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, safeStorage } = require('electron');
const { poolPromise, sql } = require('./db');
const { crearSecretos } = require('./seguridad/secretos');
const { crearIdentidad, metadataSql } = require('./nube/identidad');
const { crearEnvioHechos } = require('./nube/hechos');

// ============================================================
// cloudSync.js - Emisor hacia Supabase (espejo de solo lectura)
// - Empuja resumenes (ventas, top, cortes) a Supabase
// - Genera alertas (corte, caja fuera de horario, diferencia)
// - Aprovisiona negocio/sucursal y arma el QR de vinculacion
// El POS sigue 100% offline; si no hay internet, encola y reintenta.
//
// SIN SERVICE ROLE. Antes esto escribia en PostgREST con la service_role
// de Supabase guardada en cada caja: con ella se podia modificar TODO el
// proyecto, licencias incluidas. Ahora todo pasa por la Edge Function
// `pos-sync` con un token propio de la sucursal (que entrega al
// aprovisionar); el servidor solo deja escribir filas de ESA sucursal. La
// service key ya no se pide, no se lee y se borra de la config si estaba.
//
// FASE 1. La credencial es del EQUIPO, no de la sucursal (nube/identidad.js):
// empresa -> ubicacion -> equipo. Ademas del espejo, la caja principal manda
// HECHOS (ventas, turnos, cortes, movimientos) por el outbox (nube/hechos.js).
// Los secretos se guardan con safeStorage o no se guardan: base64 no es
// cifrado (seguridad/secretos.js).
// ============================================================

function log(msg) { console.log(`[CLOUD] ${msg}`); }

// machine_id de la LICENCIA (sha256), para ligar licencias↔negocio en el admin.
let licenseMachineId = null;
let stampedLicense = false;
function setLicenseMachineId(id) { licenseMachineId = id ? String(id) : null; }

/* Destino por omision (el proyecto de Wybix) y la LICENCIA: en Venta
   Esencial los servicios conectados se pausan. Los pone main.js. */
let destino = { url: '', funciones: '', anonKey: '' };
let permitido = () => true;
/* Lo que la nube necesita saber de esta instalacion (lo pone main.js). */
const instalacion = {
  esPrincipal: () => true,
  nombres: () => ({ negocio: os.hostname() || 'Mi negocio', sucursal: 'Matriz', equipo: os.hostname() || 'Caja' }),
  huella: () => licenseMachineId,
  version: null,
};
function configurar({ url, funciones, anonKey, licenciaPermite, esPrincipal, nombres, version } = {}) {
  destino = { url: url || destino.url, funciones: funciones || destino.funciones, anonKey: anonKey || destino.anonKey };
  if (typeof licenciaPermite === 'function') permitido = licenciaPermite;
  if (typeof esPrincipal === 'function') instalacion.esPrincipal = esPrincipal;
  if (typeof nombres === 'function') instalacion.nombres = nombres;
  if (version) instalacion.version = version;
}

// ---- Configuracion (cloud-config.json en userData) ----

function getConfigPath() {
  return path.join(app.getPath('userData'), 'cloud-config.json');
}

function loadConfig() {
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('[CLOUD] Error leyendo cloud-config.json:', e.message);
  }
  return {
    url: '', anonKey: '', sucursalId: '', negocioId: '', deviceKey: '',
    syncTokenEnc: '', syncTokenMethod: '',
    intervalMs: 300000, enabled: false,
    horaApertura: 8, horaCierre: 21, umbralDiferencia: 200
  };
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

// ---- Secretos: credencial del equipo y token anterior de la sucursal ----
// safeStorage o nada. Lo que venga en base64 de versiones anteriores se lee
// una vez y se vuelve a guardar cifrado.

const secretos = crearSecretos(safeStorage);
const CAMPOS = { equipo: ['deviceTokenEnc', 'deviceTokenMethod'], legado: ['syncTokenEnc', 'syncTokenMethod'] };
const enMemoria = {};   // si el sistema no ofrece cifrado, la credencial vive solo en esta sesion

const secreto = {
  leer(nombre) {
    if (enMemoria[nombre]) return enMemoria[nombre];
    const cfg = loadConfig();
    const [e, m] = CAMPOS[nombre];
    const { valor, legado } = secretos.descifrar(cfg[e], cfg[m]);
    if (valor && legado) secreto.guardar(nombre, valor);
    return valor;
  },
  guardar(nombre, valor) {
    const cfg = loadConfig();
    const [e, m] = CAMPOS[nombre];
    const c = secretos.cifrar(valor);
    if (c) { cfg[e] = c.enc; cfg[m] = c.method; delete enMemoria[nombre]; }
    else {
      // Nunca base64: sin cifrado del sistema se usa en memoria y se pide de nuevo al reiniciar.
      enMemoria[nombre] = valor; cfg[e] = ''; cfg[m] = '';
      log('El sistema no ofrece cifrado: la credencial de la nube no se guarda en disco.');
    }
    delete cfg.serviceKeyEnc; delete cfg.serviceKeyMethod;
    writeConfig(cfg);
  },
  borrar(nombre) {
    const cfg = loadConfig();
    const [e, m] = CAMPOS[nombre];
    cfg[e] = ''; cfg[m] = ''; delete enMemoria[nombre];
    writeConfig(cfg);
  },
};

function setCloudConfig(partial = {}) {
  const cfg = loadConfig();
  const merged = { ...cfg, ...partial };
  // La service key ya no se acepta ni se conserva: se borra si estaba.
  delete merged.serviceKey; delete merged.serviceKeyEnc; delete merged.serviceKeyMethod;
  // Cambiar de sucursal a mano obliga a reclamarla de nuevo (y solo si es de este equipo).
  if (partial.sucursalId && partial.sucursalId !== cfg.sucursalId) { merged.syncTokenEnc = ''; merged.syncTokenMethod = ''; }
  // La identidad del equipo no se edita a mano.
  for (const k of ['deviceTokenEnc', 'deviceTokenMethod', 'deviceId', 'companyId', 'locationId', 'deviceKind', 'deviceUuid']) {
    if (k in partial) merged[k] = cfg[k];
  }
  writeConfig(merged);
  return { success: true };
}

function getCloudConfig() {
  const cfg = loadConfig();
  return {
    url: cfg.url,
    anonKey: cfg.anonKey,
    sucursalId: cfg.sucursalId,
    negocioId: cfg.negocioId,
    intervalMs: cfg.intervalMs,
    enabled: cfg.enabled,
    horaApertura: cfg.horaApertura,
    horaCierre: cfg.horaCierre,
    umbralDiferencia: cfg.umbralDiferencia,
    // Ya no hay clave que pegar: la caja se vincula sola con su token.
    hasServiceKey: true,
    vinculadaConToken: !!(cfg.deviceTokenEnc || cfg.syncTokenEnc),
    // Fase 1: identidad del equipo (sin secretos).
    equipo: { registrado: !!cfg.deviceTokenEnc, kind: cfg.deviceKind || null, companyId: cfg.companyId || null, locationId: cfg.locationId || null },
    esPrincipal: instalacion.esPrincipal(),
  };
}

// La anon key es publica; se guarda en claro (va en el QR).
function setAnonKey(anonKey) {
  const cfg = loadConfig();
  cfg.anonKey = anonKey;
  writeConfig(cfg);
  return { success: true };
}

// ---- Llamada REST a Supabase ----

function baseFunciones() {
  const cfg = loadConfig();
  /* pos-sync va por el dominio de Wybix (ver FUNCIONES_URL en main.js). La
     `url` guardada es la de Supabase que viaja en el QR de la app del dueño;
     solo si una sucursal apunta a OTRO proyecto se respeta tal cual. */
  const propia = cfg.url && cfg.url !== destino.url;
  const url = propia ? cfg.url : (destino.funciones || destino.url);
  const anon = cfg.anonKey || destino.anonKey;
  if (!url || !anon) throw new Error('Falta la configuracion de la nube.');
  return { url, anon };
}

/**
 * Llama a una Edge Function. `token` = credencial del equipo; `legado` = el
 * token de sucursal anterior (solo para actualizar un POS que ya sincronizaba).
 * Los errores llevan `code` y `status` de la respuesta.
 */
async function llamarFuncion(funcion, cuerpo = {}, { token = null, legado = null, ms = 20000 } = {}) {
  const { url, anon } = baseFunciones();
  const headers = { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` };
  if (token) headers['x-wybix-device'] = token;
  else if (legado) headers['x-wybix-sync'] = legado;
  if (instalacion.version) headers['x-wybix-version'] = String(instalacion.version);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(`${url}/functions/v1/${funcion}`, { method: 'POST', headers, body: JSON.stringify(cuerpo), signal: controller.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const err = new Error(data?.error || `${funcion} HTTP ${res.status}`);
      err.code = data?.code; err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  } finally { clearTimeout(t); }
}

const identidad = crearIdentidad({
  meta: metadataSql({ pool: () => poolPromise, sql }),
  llamar: (action, cuerpo, opt = {}) => llamarFuncion('pos-sync', { action, ...cuerpo }, opt),
  cfg: { leer: loadConfig, escribir: (parcial) => writeConfig({ ...loadConfig(), ...parcial }) },
  secreto,
  esPrincipal: () => instalacion.esPrincipal(),
  nombres: () => instalacion.nombres(),
  huella: () => instalacion.huella(),
  get version() { return instalacion.version; },
  log,
});

/** La credencial con la que habla ESTE equipo (la da de alta si hace falta). */
async function credencial() {
  const t = secreto.leer('equipo');
  if (t) return t;
  await identidad.asegurar();
  return secreto.leer('equipo');
}

/** pos-sync con la credencial del equipo. */
async function gateway(action, cuerpo = {}, conToken = true) {
  if (!conToken) return llamarFuncion('pos-sync', { action, ...cuerpo });
  try {
    return await llamarFuncion('pos-sync', { action, ...cuerpo }, { token: await credencial() });
  } catch (e) {
    // La nube revoco esta credencial (otra principal tomo la sucursal, o se
    // reinstalo): se olvida y la proxima vez se vuelve a dar de alta.
    if (e.status === 401 && secreto.leer('equipo')) secreto.borrar('equipo');
    throw e;
  }
}

/** Funciones fiscales: SIEMPRE con la credencial del equipo (P0 fiscal). */
async function llamarFiscal(funcion, cuerpo) {
  return llamarFuncion(funcion, cuerpo, { token: await credencial(), ms: 60000 });
}

const hechos = crearEnvioHechos({
  pool: () => poolPromise, sql,
  llamar: (action, cuerpo) => gateway(action, cuerpo),
  puedeEnviar: async () => instalacion.esPrincipal() && !!loadConfig().enabled && permitido(),
  log,
});

async function supabaseUpsert(table, rows) {
  return gateway('upsert', { table, rows });
}

// ---- Alta del equipo + QR ----
// (El MachineGuid ya no identifica a nadie: la identidad es empresa ->
// ubicacion -> equipo, ver nube/identidad.js.)

/**
 * Alta de ESTE equipo en la nube (Fase 1): empresa -> ubicacion -> equipo.
 * Ya no crea un negocio por computadora: la base de SQL Server decide la
 * ubicacion (ver nube/identidad.js). Un POS que ya sincronizaba conserva su
 * empresa: su token anterior viaja para que la nube lo reconozca.
 */
async function ensureProvisioned(nombreNegocio) {
  if (nombreNegocio && String(nombreNegocio).trim()) {
    const previo = instalacion.nombres;
    instalacion.nombres = () => ({ ...previo(), negocio: String(nombreNegocio).trim().slice(0, 120) });
  }
  const e = await identidad.asegurar();
  return { success: true, sucursalId: e.locationId, negocioId: e.companyId, kind: e.kind };
}

/** Una sucursal nueva se une a una empresa existente con el codigo del dueño. */
async function unirseConCodigo(codigo) {
  const e = await identidad.unirseConCodigo(codigo);
  return { success: true, sucursalId: e.locationId, negocioId: e.companyId };
}

/** La caja principal crea otra ubicacion de SU empresa y entrega el codigo. */
async function crearSucursal({ nombre, tipo = 'BRANCH', starts_at = null, ends_at = null } = {}) {
  const r = await gateway('create_location', { nombre, tipo, starts_at, ends_at });
  return { success: true, codigo: r.code, expira: r.expires_at, locationId: r.location_id };
}

async function estadoNube() {
  const r = await gateway('whoami');
  return { success: true, company: r.company, location: r.location, device: r.device, entitlements: r.entitlements };
}

/**
 * QR de la app del dueño. Fase 1: lleva una INVITACION de un solo uso (30
 * min). Sin ella, conocer el negocio ya no da acceso a nada. Desde el POS solo
 * se invita al PRIMER dueño; despues invita el dueño desde su app.
 */
async function getPairingPayload() {
  const cfg = loadConfig();
  const url = cfg.url || destino.url;
  const anonKey = cfg.anonKey || destino.anonKey;
  let e;
  try { e = await identidad.asegurar(); }
  catch (err) { return { success: false, error: err.message }; }
  let codigo = null, aviso = null;
  try { codigo = (await gateway('invite_owner')).code; }
  catch (err) {
    if (err.code === 'OWNER_EXISTS') aviso = 'Este negocio ya tiene dueño. Para agregar a otra persona, invitala desde la app del dueño.';
    else return { success: false, error: err.message };
  }
  const payload = { v: 2, url, anonKey, negocioId: e.companyId, sucursalId: e.locationId, codigo, nombre: instalacion.nombres().negocio };
  return { success: true, payload, qrText: JSON.stringify(payload), aviso };
}

// ---- Lectura de los SPs de resumen ----

async function fetchSummaries(registerId = null) {
  const pool = await poolPromise;

  const daily = await pool.request()
    .input('register_id', sql.Int, registerId)
    .execute('sp_cloud_daily_summary');

  const top = await pool.request()
    .input('top', sql.Int, 10)
    .input('register_id', sql.Int, registerId)
    .execute('sp_cloud_top_products');

  const shifts = await pool.request()
    .input('register_id', sql.Int, registerId)
    .execute('sp_cloud_shifts_today');

  return {
    daily: daily.recordset?.[0] ?? null,
    top: top.recordset ?? [],
    shifts: shifts.recordset ?? []
  };
}

async function fetchTrend(registerId = null) {
  const pool = await poolPromise;
  const trend = await pool.request()
    .input('register_id', sql.Int, registerId)
    .execute('sp_cloud_sales_trend');
  return trend.recordset ?? [];
}
 
async function fetchShiftDetail(closureId) {
  const pool = await poolPromise;
  const det = await pool.request()
    .input('closure_id', sql.Int, closureId)
    .execute('sp_cloud_shift_detail');
  return det.recordset ?? [];
}

// Blindaje: riesgo por cajero (anti robo hormiga)
async function fetchRisk() {
  const pool = await poolPromise;
  const r = await pool.request().execute('sp_cashier_risk');
  return r.recordset ?? [];
}

// Utilidad estimada del dia (ganancia = venta - costo)
async function fetchDailyProfit() {
  const pool = await poolPromise;
  const r = await pool.request().execute('sp_cloud_daily_profit');
  return r.recordset?.[0] ?? null;
}

// ---- Generacion de alertas ----

async function alertaYaExiste(sucursalId, tipo, closureIdLocal) {
  try { return !!(await gateway('alert_exists', { tipo, marca: `corte ${closureIdLocal}` })).exists; }
  catch { return false; }
}

async function crearAlerta(sucursalId, tipo, titulo, mensaje) {
  await supabaseUpsert('alertas', [{
    sucursal_id: sucursalId,
    tipo, titulo, mensaje,
    leida: false,
    created_at: new Date().toISOString()
  }]);
}

// Empuja una alerta a la nube AL INSTANTE (para eventos críticos de robo hormiga).
// El resto de la sincronización sigue en bloque cada 5 min; esto no espera.
async function crearAlertaInmediata(tipo, titulo, mensaje) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.sucursalId) return { success: false, skipped: 'sync deshabilitada' };
  if (!permitido()) return { success: false, skipped: 'suscripcion' };
  try {
    await crearAlerta(cfg.sucursalId, tipo, titulo, mensaje);
    return { success: true };
  } catch (e) {
    log('alerta inmediata: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * El dia de hoy DONDE ESTA LA CAJA, no en Londres.
 *
 * `new Date().toISOString().slice(0, 10)` da la fecha en UTC: en Mexico
 * (UTC-6) a partir de las 18:00 empieza a devolver la de manana. Aqui eso
 * significaba marcar como «ya avisado hoy» una alerta con la fecha del dia
 * siguiente -y volver a mandarla- y estampar la venta del dia en el dia que
 * no era.
 *
 * Solo vale para «hoy». Una fecha que ya viene de la base NO pasa por aqui:
 * llega como un instante concreto y esto la moveria un dia.
 */
function fechaLocal(d = new Date()) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Evita repetir la alerta de riesgo del mismo cajero el mismo dia (marca [uID-fecha]).
async function alertaRiesgoYaExiste(sucursalId, userId) {
  const dia = fechaLocal();
  try { return !!(await gateway('alert_exists', { tipo: 'RIESGO_CAJERO', marca: `[u${userId}-${dia}]` })).exists; }
  catch { return false; }
}

// Genericos: evita repetir una alerta que lleva una marca unica en el mensaje (ej. [vc-fecha], [dev-uID-fecha]).
async function alertaMarcaYaExiste(sucursalId, tipo, marca) {
  try { return !!(await gateway('alert_exists', { tipo, marca })).exists; }
  catch { return false; }
}

async function evaluarAlertas(sucursalId, shifts, cfg, daily = null) {
  const ahora = new Date();
  const hora = ahora.getHours();
  const dia = fechaLocal(ahora);
  const horaApertura = Number(cfg.horaApertura ?? 8);
  const fueraHorario = (hora < horaApertura || hora >= Number(cfg.horaCierre ?? 21));
  const umbral = Number(cfg.umbralDiferencia ?? 200);

  // Robo hormiga: caja abierta hace rato pero sin ventas registradas hoy.
  // Se dispara una vez al dia, pasadas >=3 h de la hora de apertura del negocio.
  const totalHoy = Number(daily?.total ?? 0);
  const ticketsHoy = Number(daily?.num_tickets ?? 0);
  const hayCajaAbierta = shifts.some(s => Number(s.abierto) === 1);
  if (hayCajaAbierta && totalHoy === 0 && ticketsHoy === 0 && hora >= horaApertura + 3) {
    if (!(await alertaMarcaYaExiste(sucursalId, 'VENTAS_CERO', `[vc-${dia}]`))) {
      await crearAlerta(sucursalId, 'VENTAS_CERO', 'Sin ventas registradas',
        `Ya pasaron varias horas con la caja abierta y hoy no hay ninguna venta registrada. Verifica que se esten cobrando los tickets. [vc-${dia}]`);
    }
  }

  for (const s of shifts) {
    const cid = Number(s.closure_id_local);
    const caja = s.caja || 'una caja';

    if (s.cerrado_at) {
      if (!(await alertaYaExiste(sucursalId, 'CORTE', cid))) {
        await crearAlerta(sucursalId, 'CORTE', 'Corte de caja',
          `Se hizo el corte de ${caja} (corte ${cid}).`);
      }
      const diff = s.diferencia != null ? Number(s.diferencia) : 0;
      if (Math.abs(diff) >= umbral) {
        if (!(await alertaYaExiste(sucursalId, 'DIFERENCIA', cid))) {
          const signo = diff < 0 ? 'faltante' : 'sobrante';
          await crearAlerta(sucursalId, 'DIFERENCIA', 'Diferencia en caja',
            `${caja} cerro con ${signo} de $${Math.abs(diff).toFixed(2)} (corte ${cid}).`);
        }
      }
    }

    if (Number(s.abierto) === 1 && fueraHorario) {
      if (!(await alertaYaExiste(sucursalId, 'CAJA_FUERA_HORARIO', cid))) {
        await crearAlerta(sucursalId, 'CAJA_FUERA_HORARIO', 'Caja fuera de horario',
          `${caja} esta abierta fuera del horario del negocio (corte ${cid}).`);
      }
    }
  }
}

// ---- Empuje de un ciclo completo ----

async function pushOnce() {
  const cfg0 = loadConfig();
  if (!cfg0.enabled) return { success: false, skipped: 'deshabilitado' };
  // Las secundarias comparten la base: el espejo y los hechos los manda la principal.
  if (!instalacion.esPrincipal()) return { success: false, skipped: 'secundaria' };
  await credencial();
  const cfg = loadConfig();
  if (!cfg.sucursalId) return { success: false, error: 'Falta sucursalId en la config.' };
  // Hechos primero: son la fuente de la Fase 1 (el espejo queda para el tablero actual).
  await hechos.enviar();

  const { daily, top, shifts } = await fetchSummaries();
  const sucursalId = cfg.sucursalId;
  /* Si la fecha viene del resumen, es un dato de la base y se respeta tal cual.
     Si no viene, es «hoy», y «hoy» se lee en la zona del negocio. */
  const fechaStr = daily?.fecha
    ? new Date(daily.fecha).toISOString().slice(0, 10)
    : fechaLocal();

  // Estampa (una vez por proceso) el machine_id de la licencia en la sucursal,
  // para que el panel de admin pueda ligar licencias y prueba con este negocio.
  if (licenseMachineId && !stampedLicense) {
    try {
      await gateway('link_license', { licenseMachineId }).catch(e => { if (e.code !== 'NO_ACTIVATION') throw e; });
      stampedLicense = true;
    } catch (e) { log('stamp licencia: ' + e.message); }
  }

  // Utilidad estimada del dia (si el SP no existe aun, no rompe el ciclo)
  let profit = null;
  try { profit = await fetchDailyProfit(); }
  catch (e) { log('utilidad: ' + e.message); }

  if (daily) {
    await supabaseUpsert('resumen_ventas', [{
      sucursal_id: sucursalId,
      fecha: fechaStr,
      total: Number(daily.total || 0),
      num_tickets: Number(daily.num_tickets || 0),
      ticket_promedio: Number(daily.ticket_promedio || 0),
      total_efectivo: Number(daily.total_efectivo || 0),
      total_tarjeta: Number(daily.total_tarjeta || 0),
      total_credito: Number(daily.total_credito || 0),
      utilidad: Number(profit?.utilidad || 0),
      actualizado_at: new Date().toISOString()
    }], 'sucursal_id,fecha');
  }

  if (Array.isArray(shifts) && shifts.length) {
    const rows = [];
    for (const sft of shifts) {
      const cid = Number(sft.closure_id_local);
      // Trae el detalle solo de cortes CERRADOS (los abiertos cambian aun)
      let movimientos = null;
      if (sft.cerrado_at) {
        const det = await fetchShiftDetail(cid);
        movimientos = det.map(m => ({
          tipo: m.tipo,
          referencia: m.referencia,
          monto: Number(m.monto || 0),
          nota: m.nota,
          fecha: m.fecha ? new Date(m.fecha).toISOString() : null
        }));
      }
      rows.push({
        sucursal_id: sucursalId,
        closure_id_local: cid,
        caja: sft.caja ?? null,
        abierto_at: sft.abierto_at ? new Date(sft.abierto_at).toISOString() : null,
        cerrado_at: sft.cerrado_at ? new Date(sft.cerrado_at).toISOString() : null,
        fondo_inicial: sft.fondo_inicial != null ? Number(sft.fondo_inicial) : null,
        esperado: sft.esperado != null ? Number(sft.esperado) : null,
        entregado: sft.entregado != null ? Number(sft.entregado) : null,
        diferencia: sft.diferencia != null ? Number(sft.diferencia) : null,
        movimientos,
        actualizado_at: new Date().toISOString()
      });
    }
    await supabaseUpsert('cortes_caja', rows, 'sucursal_id,closure_id_local');
    await evaluarAlertas(sucursalId, shifts, cfg, daily);
  }

  const trend = await fetchTrend();
  if (Array.isArray(trend) && trend.length) {
    const trendRows = trend.map(t => ({
      sucursal_id: sucursalId,
      fecha: new Date(t.fecha).toISOString().slice(0, 10),
      total: Number(t.total || 0),
      actualizado_at: new Date().toISOString()
    }));
    await supabaseUpsert('tendencia_ventas', trendRows, 'sucursal_id,fecha');
  }

  if (Array.isArray(shifts) && shifts.length) {
    const rows = shifts.map(sft => ({
      sucursal_id: sucursalId,
      closure_id_local: Number(sft.closure_id_local),
      caja: sft.caja ?? null,
      abierto_at: sft.abierto_at ? new Date(sft.abierto_at).toISOString() : null,
      cerrado_at: sft.cerrado_at ? new Date(sft.cerrado_at).toISOString() : null,
      fondo_inicial: sft.fondo_inicial != null ? Number(sft.fondo_inicial) : null,
      esperado: sft.esperado != null ? Number(sft.esperado) : null,
      entregado: sft.entregado != null ? Number(sft.entregado) : null,
      diferencia: sft.diferencia != null ? Number(sft.diferencia) : null,
      actualizado_at: new Date().toISOString()
    }));
    await supabaseUpsert('cortes_caja', rows, 'sucursal_id,closure_id_local');
    await evaluarAlertas(sucursalId, shifts, cfg, daily);
  }

  // ---- Blindaje: riesgo por cajero (robo hormiga) ----
  try {
    const risk = await fetchRisk();
    if (Array.isArray(risk) && risk.length) {
      const riskRows = risk.map(c => ({
        sucursal_id: sucursalId,
        user_id: Number(c.user_id),
        cajero: c.cajero ?? null,
        anuladas: Number(c.anuladas || 0),
        devoluciones: Number(c.devoluciones || 0),
        cajon_sin_venta: Number(c.cajon_sin_venta || 0),
        eliminados: Number(c.eliminados || 0),
        descuentos: Number(c.descuentos || 0),
        monto_riesgo: Number(c.monto_riesgo || 0),
        score: Number(c.score || 0),
        nivel: c.nivel ?? 'bajo',
        actualizado_at: new Date().toISOString()
      }));
      await supabaseUpsert('seguridad_riesgo', riskRows, 'sucursal_id,user_id');

      const dia = fechaLocal();
      const umbralDev = Number(cfg.umbralDevoluciones ?? 3);
      for (const c of risk) {
        if (c.nivel === 'alto' && !(await alertaRiesgoYaExiste(sucursalId, c.user_id))) {
          await crearAlerta(sucursalId, 'RIESGO_CAJERO', 'Riesgo alto en un cajero',
            `${c.cajero} tiene riesgo ALTO (score ${c.score}). Revisa devoluciones, anulaciones y aperturas de cajón. [u${c.user_id}-${dia}]`);
        }
        // Alerta dedicada de robo hormiga: muchas devoluciones de un mismo cajero
        if (Number(c.devoluciones) >= umbralDev &&
            !(await alertaMarcaYaExiste(sucursalId, 'DEVOLUCIONES', `[dev-u${c.user_id}-${dia}]`))) {
          await crearAlerta(sucursalId, 'DEVOLUCIONES', 'Muchas devoluciones de un cajero',
            `${c.cajero} lleva ${c.devoluciones} devoluciones hoy. Confirma que sean legítimas y con ticket. [dev-u${c.user_id}-${dia}]`);
        }
      }
    }
  } catch (e) { log('riesgo: ' + e.message); }

  return { success: true, at: new Date().toISOString() };
}

// ---- Eliminar cuenta y datos en la nube (cumplimiento Google Play) ----

async function deleteAccount() {
  const cfg = loadConfig();
  if (!cfg.sucursalId || !cfg.negocioId) return { success: false, error: 'No hay una cuenta vinculada en este equipo.' };
  // El servidor decide: solo la principal, y solo si la empresa tiene UNA
  // ubicacion (una sucursal no puede borrar a las demas).
  try { await gateway('delete_account'); }
  catch (e) {
    if (e.code === 'MULTI_LOCATION') return { success: false, error: e.message };
    throw e;
  }
  // Limpiar config local: deja de sincronizar (no borra device_key para no reprovisionar solo)
  cfg.enabled = false; cfg.sucursalId = ''; cfg.negocioId = ''; cfg.syncTokenEnc = ''; cfg.syncTokenMethod = '';
  cfg.deviceTokenEnc = ''; cfg.deviceTokenMethod = ''; cfg.deviceId = ''; cfg.companyId = ''; cfg.locationId = '';
  writeConfig(cfg);
  stopScheduler();
  return { success: true };
}

async function pushSafe() {
  // Venta Esencial: los servicios conectados esperan a la renovacion.
  if (!permitido()) return { success: false, skipped: 'suscripcion' };
  try {
    const r = await pushOnce();
    if (r.success) log('Sincronizado con la nube.');
    return r;
  } catch (e) {
    log(`No se pudo sincronizar (se reintenta): ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ---- Scheduler ----

let timer = null;

function startScheduler() {
  const cfg = loadConfig();
  if (timer) { clearInterval(timer); timer = null; }
  if (!cfg.enabled) { log('Sincronizacion en la nube deshabilitada.'); return; }

  const interval = Number(cfg.intervalMs) || 300000;
  setTimeout(() => { pushSafe(); }, 15000);
  timer = setInterval(() => { pushSafe(); }, interval);
  log(`Sincronizacion cada ${Math.round(interval / 1000)}s.`);
}

function stopScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}

// ---- Exports (todo en un solo lugar) ----

module.exports = {
  hechosAhora: () => hechos.pronto(),
  enviarHechos: () => hechos.enviar(),
  unirseConCodigo,
  crearSucursal,
  estadoNube,
  llamarFiscal,
  getCloudConfig,
  setCloudConfig,
  setAnonKey,
  ensureProvisioned,
  getPairingPayload,
  crearAlertaInmediata,
  setLicenseMachineId,
  configurar,
  deleteAccount,
  pushNow: pushSafe,
  startScheduler,
  stopScheduler
};