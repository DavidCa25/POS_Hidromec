const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const { poolPromise, sql } = require('./db');

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
function configurar({ url, funciones, anonKey, licenciaPermite } = {}) {
  destino = { url: url || destino.url, funciones: funciones || destino.funciones, anonKey: anonKey || destino.anonKey };
  if (typeof licenciaPermite === 'function') permitido = licenciaPermite;
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

// ---- Cifrado del token de sincronizacion (mismo patron que db.js) ----

function encryptSecret(plain) {
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return { enc: safeStorage.encryptString(String(plain)).toString('base64'), method: 'safeStorage' };
    }
  } catch (e) {
    console.error('[CLOUD] safeStorage no disponible:', e.message);
  }
  return { enc: Buffer.from(String(plain), 'utf8').toString('base64'), method: 'base64' };
}

function decryptSecret(b64, method) {
  if (!b64) return '';
  try {
    if (method === 'safeStorage' && safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(b64, 'base64'));
    }
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch (e) {
    console.error('[CLOUD] No se pudo descifrar el token de sincronizacion:', e.message);
    return '';
  }
}

function setCloudConfig(partial = {}) {
  const cfg = loadConfig();
  const merged = { ...cfg, ...partial };
  // La service key ya no se acepta ni se conserva: se borra si estaba.
  delete merged.serviceKey; delete merged.serviceKeyEnc; delete merged.serviceKeyMethod;
  // Cambiar de sucursal a mano obliga a reclamarla de nuevo (y solo si es de este equipo).
  if (partial.sucursalId && partial.sucursalId !== cfg.sucursalId) { merged.syncTokenEnc = ''; merged.syncTokenMethod = ''; }
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
    vinculadaConToken: !!cfg.syncTokenEnc
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

/** Llama a la Edge Function pos-sync. Solo anon key + el token de la sucursal. */
async function gateway(action, cuerpo = {}, conToken = true) {
  const cfg = loadConfig();
  /* pos-sync va por el dominio de Wybix (ver FUNCIONES_URL en main.js). La
     `url` guardada es la de Supabase que viaja en el QR de la app del dueño;
     solo si una sucursal apunta a OTRO proyecto se respeta tal cual. */
  const propia = cfg.url && cfg.url !== destino.url;
  const url = propia ? cfg.url : (destino.funciones || destino.url);
  const anon = cfg.anonKey || destino.anonKey;
  if (!url || !anon) throw new Error('Falta la configuracion de la nube.');
  const headers = { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` };
  if (conToken) headers['x-wybix-sync'] = await tokenDeSync();
  const res = await fetch(`${url}/functions/v1/pos-sync`, { method: 'POST', headers, body: JSON.stringify({ action, ...cuerpo }) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || `pos-sync ${action} HTTP ${res.status}`);
  return data;
}

function guardarToken(token) {
  const cfg = loadConfig();
  const { enc, method } = encryptSecret(token);
  cfg.syncTokenEnc = enc; cfg.syncTokenMethod = method;
  delete cfg.serviceKeyEnc; delete cfg.serviceKeyMethod;
  writeConfig(cfg);
}

/** El token de esta caja. Una instalacion previa lo reclama con su equipo. */
async function tokenDeSync() {
  const cfg = loadConfig();
  const t = decryptSecret(cfg.syncTokenEnc, cfg.syncTokenMethod);
  if (t) return t;
  if (cfg.sucursalId) {
    const r = await gateway('claim', { deviceKey: cfg.deviceKey || getStableDeviceKey(), sucursalId: cfg.sucursalId }, false);
    guardarToken(r.token);
    return r.token;
  }
  throw new Error('Esta caja aun no esta vinculada a la nube.');
}

async function supabaseUpsert(table, rows) {
  return gateway('upsert', { table, rows });
}

// ---- Aprovisionamiento (crear negocio/sucursal) + QR ----

// Huella ESTABLE de la máquina: sobrevive a reinstalaciones del POS.
// Así, al reinstalar, se reusa el mismo negocio/sucursal en vez de crear uno nuevo.
function getStableDeviceKey() {
  const cfg = loadConfig();
  if (cfg.deviceKey) return cfg.deviceKey;
  // Windows: MachineGuid del registro (constante por equipo)
  try {
    const out = require('child_process')
      .execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { windowsHide: true })
      .toString();
    const m = out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i);
    if (m && m[1]) return 'win-' + m[1];
  } catch { /* no disponible: cae al aleatorio */ }
  return crypto.randomUUID();
}

async function ensureProvisioned(nombreNegocio) {
  const cfg = loadConfig();
  // Idempotente local: si ya hay negocio y sucursal, no recrea
  if (cfg.sucursalId && cfg.negocioId) {
    return { success: true, sucursalId: cfg.sucursalId, negocioId: cfg.negocioId, already: true };
  }

  const nombre = (nombreNegocio && String(nombreNegocio).trim()) || (os.hostname() || 'Mi negocio');
  const deviceKey = getStableDeviceKey();

  // El servidor reusa la sucursal de este equipo si ya existe (reinstalar no
  // duplica) o crea negocio + sucursal, y entrega el token de sincronizacion.
  const r = await gateway('provision', { deviceKey, nombre, equipo: os.hostname() || 'Matriz' }, false);
  cfg.negocioId = r.negocioId;
  cfg.sucursalId = r.sucursalId;
  cfg.deviceKey = deviceKey;
  writeConfig(cfg);
  guardarToken(r.token);

  return { success: true, sucursalId: r.sucursalId, negocioId: r.negocioId };
}

// Arma el contenido del QR que escanea la app del dueno (nada secreto).
function getPairingPayload() {
  const cfg = loadConfig();
  if (!cfg.url || !cfg.anonKey || !cfg.sucursalId || !cfg.negocioId) {
    return { success: false, error: 'Falta aprovisionar o configurar (url/anonKey/sucursal/negocio).' };
  }
  const payload = {
    v: 1,
    url: cfg.url,
    anonKey: cfg.anonKey,
    negocioId: cfg.negocioId,
    sucursalId: cfg.sucursalId,
    nombre: os.hostname() || 'Mi negocio'
  };
  return { success: true, payload, qrText: JSON.stringify(payload) };
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
  const cfg = loadConfig();
  if (!cfg.enabled) return { success: false, skipped: 'deshabilitado' };
  if (!cfg.sucursalId) return { success: false, error: 'Falta sucursalId en la config.' };

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
      await gateway('stamp_license', { licenseMachineId });
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
  // El servidor borra, con SU llave, solo lo de la sucursal de este token.
  await gateway('delete_account');
  // Limpiar config local: deja de sincronizar (no borra device_key para no reprovisionar solo)
  cfg.enabled = false; cfg.sucursalId = ''; cfg.negocioId = ''; cfg.syncTokenEnc = ''; cfg.syncTokenMethod = '';
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