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
// ============================================================

function log(msg) { console.log(`[CLOUD] ${msg}`); }

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
    serviceKeyEnc: '', serviceKeyMethod: '',
    intervalMs: 300000, enabled: false,
    horaApertura: 8, horaCierre: 21, umbralDiferencia: 200
  };
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

// ---- Cifrado de la service key (mismo patron que db.js) ----

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
    console.error('[CLOUD] No se pudo descifrar la service key:', e.message);
    return '';
  }
}

function setCloudConfig(partial = {}) {
  const cfg = loadConfig();
  const merged = { ...cfg, ...partial };
  if (partial.serviceKey) {
    const { enc, method } = encryptSecret(partial.serviceKey);
    merged.serviceKeyEnc = enc;
    merged.serviceKeyMethod = method;
  }
  delete merged.serviceKey;
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
    hasServiceKey: !!cfg.serviceKeyEnc
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

async function supabaseRequest(method, pathAndQuery, body, extraHeaders = {}) {
  const cfg = loadConfig();
  const key = decryptSecret(cfg.serviceKeyEnc, cfg.serviceKeyMethod);
  if (!cfg.url || !key) throw new Error('Falta url o service key de Supabase.');

  const res = await fetch(`${cfg.url}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...extraHeaders
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase ${pathAndQuery} HTTP ${res.status}: ${txt}`);
  }
  const text = await res.text().catch(() => '');
  return text ? JSON.parse(text) : null;
}

async function supabaseUpsert(table, rows, onConflict) {
  const q = table + (onConflict ? `?on_conflict=${onConflict}` : '');
  return supabaseRequest('POST', q, rows, { 'Prefer': 'resolution=merge-duplicates' });
}

// ---- Aprovisionamiento (crear negocio/sucursal) + QR ----

async function ensureProvisioned(nombreNegocio) {
  const cfg = loadConfig();
  // Idempotente: si ya hay negocio y sucursal, no recrea
  if (cfg.sucursalId && cfg.negocioId) {
    return { success: true, sucursalId: cfg.sucursalId, negocioId: cfg.negocioId, already: true };
  }

  const nombre = (nombreNegocio && String(nombreNegocio).trim()) || (os.hostname() || 'Mi negocio');
  const deviceKey = cfg.deviceKey || crypto.randomUUID();

  // 1) Crear negocio (owner_id se llena cuando el dueno se registra)
  const negocio = await supabaseRequest('POST', 'negocios', [{ nombre }], { 'Prefer': 'return=representation' });
  const negocioId = Array.isArray(negocio) ? negocio[0]?.id : negocio?.id;
  if (!negocioId) throw new Error('No se pudo crear el negocio.');

  // 2) Crear sucursal ligada al negocio
  const sucursal = await supabaseRequest('POST', 'sucursales',
    [{ negocio_id: negocioId, nombre: os.hostname() || 'Matriz', device_key: deviceKey }],
    { 'Prefer': 'return=representation' });
  const sucursalId = Array.isArray(sucursal) ? sucursal[0]?.id : sucursal?.id;
  if (!sucursalId) throw new Error('No se pudo crear la sucursal.');

  // 3) Guardar en la config local
  cfg.negocioId = negocioId;
  cfg.sucursalId = sucursalId;
  cfg.deviceKey = deviceKey;
  writeConfig(cfg);

  return { success: true, sucursalId, negocioId };
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

// ---- Generacion de alertas ----

async function alertaYaExiste(sucursalId, tipo, closureIdLocal) {
  const q = `alertas?select=id&sucursal_id=eq.${sucursalId}` +
            `&tipo=eq.${tipo}&mensaje=like=*corte ${closureIdLocal}*&limit=1`;
  try {
    const rows = await supabaseRequest('GET', q);
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function crearAlerta(sucursalId, tipo, titulo, mensaje) {
  await supabaseUpsert('alertas', [{
    sucursal_id: sucursalId,
    tipo, titulo, mensaje,
    leida: false,
    created_at: new Date().toISOString()
  }]);
}

async function evaluarAlertas(sucursalId, shifts, cfg) {
  const ahora = new Date();
  const hora = ahora.getHours();
  const fueraHorario = (hora < Number(cfg.horaApertura ?? 8) || hora >= Number(cfg.horaCierre ?? 21));
  const umbral = Number(cfg.umbralDiferencia ?? 200);

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
  const hoy = (daily?.fecha ? new Date(daily.fecha) : new Date());
  const fechaStr = hoy.toISOString().slice(0, 10);

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
    await evaluarAlertas(sucursalId, shifts, cfg);
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
    await evaluarAlertas(sucursalId, shifts, cfg);
  }

  return { success: true, at: new Date().toISOString() };
}

async function pushSafe() {
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
  pushNow: pushSafe,
  startScheduler,
  stopScheduler
};