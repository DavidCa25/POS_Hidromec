const path = require('path');
const ambito = require('./empresas/ambito');  // archivos de la empresa activa (docs/multiempresa.md)
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');

const API_BASE = 'https://api.mercadopago.com';

function getConfigPath() {
  return ambito.ruta('mp-config.json');
}

function loadConfig() {
  const fromEnv = {
    accessToken: process.env.MP_ACCESS_TOKEN || '',
    terminalId: process.env.MP_TERMINAL_ID || '',
    storeId: process.env.MP_STORE_ID || '',
    posId: process.env.MP_POS_ID || '',
    userId: process.env.MP_USER_ID || ''
  };

  let fromFile = {};
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) fromFile = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('MP: error leyendo mp-config.json:', e);
  }

  return {
    accessToken: fromEnv.accessToken || fromFile.accessToken || '',
    terminalId: fromEnv.terminalId || fromFile.terminalId || '',
    storeId: fromEnv.storeId || fromFile.storeId || '',
    posId: fromEnv.posId || fromFile.posId || '',
    userId: fromEnv.userId || fromFile.userId || '',
    // Modo prueba: habilita la auto-simulacion. En produccion debe quedar false.
    testMode: String(process.env.MP_TEST_MODE).toLowerCase() === 'true' || !!fromFile.testMode || false
  };
}

function saveConfig(cfg = {}) {
  const current = loadConfig();
  const merged = { ...current, ...cfg };
  fs.writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function getPublicConfig() {
  const c = loadConfig();
  return {
    success: true,
    data: {
      hasToken: !!c.accessToken,
      terminalId: c.terminalId,
      storeId: c.storeId,
      posId: c.posId,
      userId: c.userId,
      testMode: !!c.testMode
    }
  };
}

function setConfig(cfg = {}) {
  try {
    const saved = saveConfig(cfg);
    return {
      success: true,
      data: { hasToken: !!saved.accessToken, terminalId: saved.terminalId, testMode: !!saved.testMode }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Wrapper con auth, manejo de errores y parseo seguro de la respuesta
async function mpFetch(method, urlPath, { body = null, idempotency = false } = {}) {
  const cfg = loadConfig();
  if (!cfg.accessToken) {
    return { ok: false, status: 0, error: 'Falta el Access Token de Mercado Pago.' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.accessToken}`
  };
  if (idempotency) headers['X-Idempotency-Key'] = crypto.randomUUID();

  try {
    const resp = await fetch(`${API_BASE}${urlPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!resp.ok) {
      // arma un mensaje legible aunque MP devuelva el error en distintos formatos
      const msg =
        data?.message ||
        data?.error ||
        data?.errors?.[0]?.message ||
        data?.cause?.[0]?.description ||
        `HTTP ${resp.status}`;
      return { ok: false, status: resp.status, error: msg, data };
    }
    return { ok: true, status: resp.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

function classifyOrder(order) {
  const status = order?.status || '';
  switch (status) {
    case 'processed':
      return 'approved';
    case 'created':
    case 'at_terminal':
      return 'pending';
    case 'action_required':
      return 'action_required';
    case 'failed':
    case 'expired':
    case 'canceled':
    case 'refunded':
      return 'failed';
    default:
      return 'pending';
  }
}

// ============================================================
// CONFIGURACION GUIADA (wizard)
// ============================================================

// Valida el token contra /users/me y guarda el userId para los pasos siguientes
async function validateToken() {
  const r = await mpFetch('GET', '/users/me');
  if (!r.ok) return { success: false, error: r.error, data: r.data };

  const userId = r.data?.id != null ? String(r.data.id) : '';
  /* Un usuario de prueba de MP trae la etiqueta `test_user`. El modo prueba
     sale de la cuenta, no de una casilla: con una cuenta de prueba no se puede
     cobrar de verdad, y con una real la simulación no aplica. */
  const tags = Array.isArray(r.data?.tags) ? r.data.tags : [];
  const testUser = tags.includes('test_user');
  const previo = loadConfig();
  const cambio = { userId, testMode: testUser };
  // Otra cuenta: lo guardado de la anterior ya no le pertenece.
  if (previo.userId && userId && previo.userId !== userId) Object.assign(cambio, { storeId: '', posId: '', terminalId: '' });
  if (userId) saveConfig(cambio);

  return {
    success: true,
    userId,
    nickname: r.data?.nickname || '',
    siteId: r.data?.site_id || '',
    testUser
  };
}

async function createStore(payload = {}) {
  const cfg = loadConfig();
  if (!cfg.userId) return { success: false, error: 'Valida el token antes de crear la sucursal.' };

  const lat = Number(payload.latitude);
  const lng = Number(payload.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { success: false, error: 'Latitud/longitud invalidas.' };
  }

  const body = {
    name: payload.name || 'Sucursal Principal',
    // MP pide external_id alfanumérico y único por cuenta: uno fijo choca al repetir.
    external_id: limpiarExternalId(payload.externalId) || `SUC${Date.now().toString(36).toUpperCase()}`,
    location: {
      street_number: String(payload.streetNumber ?? ''),
      street_name: String(payload.streetName ?? ''),
      city_name: String(payload.cityName ?? ''),
      state_name: String(payload.stateName ?? ''),
      latitude: lat,
      longitude: lng,
      reference: String(payload.reference ?? '')
    }
  };

  const r = await mpFetch('POST', `/users/${cfg.userId}/stores`, { body });
  if (!r.ok) return { success: false, error: r.error, data: r.data };

  const storeId = r.data?.id != null ? String(r.data.id) : null;
  if (storeId) saveConfig({ storeId });
  return { success: true, storeId };
}

async function createPos(payload = {}) {
  const cfg = loadConfig();
  if (!cfg.storeId) return { success: false, error: 'Crea la sucursal antes de crear la caja.' };

  // Sin category: MP solo acepta un par de MCC y para refaccionaria queda generica
  const body = {
    name: payload.name || 'Caja 1',
    store_id: cfg.storeId,
    external_id: limpiarExternalId(payload.externalId) || `POS${Date.now().toString(36).toUpperCase()}`
  };

  const r = await mpFetch('POST', '/pos', { body });
  if (!r.ok) return { success: false, error: r.error, data: r.data };

  const posId = r.data?.id != null ? String(r.data.id) : null;
  if (posId) saveConfig({ posId });
  return { success: true, posId, qr: r.data?.qr ?? null };
}

function limpiarExternalId(v) {
  return String(v ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
}

/* Todas las terminales de la cuenta, sin filtrar por la caja guardada: si la
   terminal se vinculó a otra caja desde la app de MP, igual debe aparecer. */
async function listTerminals({ limit = 50, offset = 0 } = {}) {
  const r = await mpFetch('GET', `/terminals/v1/list?limit=${limit}&offset=${offset}`);
  if (!r.ok) return { success: false, error: r.error, data: r.data };

  const terminals = r.data?.data?.terminals ?? r.data?.terminals ?? [];
  return { success: true, data: terminals };
}

/* Lo que ya existe en la cuenta: sucursales, cajas y terminales, con nombres.
   Así el asistente se salta lo que ya está hecho (una cuenta que ya cobraba
   con su Point no vuelve a crear nada). Una lista que falle no tumba las otras. */
async function discover() {
  const cfg = loadConfig();
  if (!cfg.userId) return { success: false, error: 'Verifica el Access Token primero.' };

  const [t, s, p] = await Promise.all([
    listTerminals(),
    mpFetch('GET', `/users/${cfg.userId}/stores/search?limit=50`),
    mpFetch('GET', '/pos?limit=100'),
  ]);

  const stores = (s.ok ? (s.data?.results ?? []) : []).map((x) => ({
    id: String(x.id), name: x.name || `Sucursal ${x.id}`, externalId: x.external_id || ''
  }));
  const pos = (p.ok ? (p.data?.results ?? []) : []).map((x) => ({
    id: String(x.id), name: x.name || `Caja ${x.id}`, storeId: x.store_id != null ? String(x.store_id) : '', externalId: x.external_id || ''
  }));
  const nombreSucursal = new Map(stores.map((x) => [x.id, x.name]));
  const nombreCaja = new Map(pos.map((x) => [x.id, x.name]));
  const terminals = (t.success ? t.data : []).map((x) => {
    const storeId = x.store_id != null ? String(x.store_id) : '';
    const posId = x.pos_id != null ? String(x.pos_id) : '';
    return {
      id: String(x.id),
      operatingMode: x.operating_mode || '',
      storeId, posId,
      storeName: nombreSucursal.get(storeId) || '',
      posName: nombreCaja.get(posId) || x.external_pos_id || ''
    };
  });

  return {
    success: true,
    terminals, stores, pos,
    errores: [!t.success && `terminales: ${t.error}`, !s.ok && `sucursales: ${s.error}`, !p.ok && `cajas: ${p.error}`].filter(Boolean),
    actual: { storeId: cfg.storeId, posId: cfg.posId, terminalId: cfg.terminalId, testMode: !!cfg.testMode }
  };
}

/* Elegir lo que ya existe: solo ids que la cuenta devolvió en `discover`. */
function select({ storeId, posId, terminalId } = {}) {
  const cambio = {};
  if (storeId !== undefined) cambio.storeId = String(storeId || '');
  if (posId !== undefined) cambio.posId = String(posId || '');
  if (terminalId !== undefined) cambio.terminalId = String(terminalId || '');
  try { saveConfig(cambio); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
}

// Activa el modo PDV en la terminal (solo PAX_A910 y NEWLAND_N950)
async function setPdv(terminalId) {
  if (!terminalId) return { success: false, error: 'terminalId requerido.' };

  const body = { terminals: [{ id: terminalId, operating_mode: 'PDV' }] };
  const r = await mpFetch('PATCH', '/terminals/v1/setup', { body });
  if (!r.ok) return { success: false, error: r.error, data: r.data };

  saveConfig({ terminalId });
  return { success: true, data: r.data ?? null };
}

// ============================================================
// COBRO (Orders)
// ============================================================

async function createPointOrder({ amount, externalReference, expirationTime = 'PT3M', printOnTerminal = 'no_ticket' } = {}) {
  const cfg = loadConfig();
  if (!cfg.terminalId) {
    return { success: false, error: 'Falta terminalId en la configuracion de Mercado Pago.' };
  }

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { success: false, error: 'Monto invalido para la orden.' };
  }

  const body = {
    type: 'point',
    external_reference: String(externalReference || `POS-${Date.now()}`),
    expiration_time: expirationTime,
    transactions: { payments: [{ amount: value.toFixed(2) }] },
    config: { point: { terminal_id: cfg.terminalId, print_on_terminal: printOnTerminal } }
  };

  const r = await mpFetch('POST', '/v1/orders', { body, idempotency: true });
  if (!r.ok) return { success: false, error: r.error, data: r.data };

  const order = r.data;
  return {
    success: true,
    orderId: order?.id ?? null,
    paymentId: order?.transactions?.payments?.[0]?.id ?? null,
    status: order?.status ?? null
  };
}

async function getOrder(orderId) {
  if (!orderId) return { success: false, error: 'orderId requerido.' };

  const r = await mpFetch('GET', `/v1/orders/${orderId}`);
  if (!r.ok) return { success: false, error: r.error, data: r.data };

  const order = r.data;
  return {
    success: true,
    state: classifyOrder(order),
    status: order?.status ?? null,
    statusDetail: order?.status_detail ?? null,
    order
  };
}

async function cancelOrder(orderId) {
  if (!orderId) return { success: false, error: 'orderId requerido.' };

  const r = await mpFetch('POST', `/v1/orders/${orderId}/cancel`, { idempotency: true });
  if (!r.ok) return { success: false, error: r.error, data: r.data };

  return { success: true, status: r.data?.status ?? null };
}

// SOLO PRUEBAS: simula el resultado de una orden via el endpoint de eventos
async function simulateOrderEvent(orderId, status = 'processed', opts = {}) {
  if (!orderId) return { success: false, error: 'orderId requerido.' };
  // Solo con una cuenta de prueba: con una real, «aprobar» sin tarjeta no existe.
  if (!loadConfig().testMode) return { success: false, error: 'La simulación solo funciona con una cuenta de prueba.' };

  let body;
  if (status === 'processed' || status === 'failed') {
    body = {
      status,
      payment_method_type: opts.paymentMethodType || 'credit_card',
      installments: opts.installments || 1,
      payment_method_id: opts.paymentMethodId || 'visa',
      status_detail: opts.statusDetail || (status === 'processed' ? 'accredited' : 'rejected_other_reason')
    };
  } else {
    body = { status };
  }

  const r = await mpFetch('POST', `/v1/orders/${orderId}/events`, { body });
  if (!r.ok) return { success: false, error: r.error, data: r.data };

  return { success: true };
}

module.exports = {
  // wizard
  validateToken,
  createStore,
  createPos,
  listTerminals,
  discover,
  select,
  setPdv,
  // cobro
  createPointOrder,
  getOrder,
  cancelOrder,
  simulateOrderEvent,
  // config
  getPublicConfig,
  setConfig
};