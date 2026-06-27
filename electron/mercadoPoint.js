const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');

const API_BASE = 'https://api.mercadopago.com';

function getConfigPath() {
  return path.join(app.getPath('userData'), 'mp-config.json');
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
  if (userId) saveConfig({ userId });

  return {
    success: true,
    userId,
    nickname: r.data?.nickname || '',
    siteId: r.data?.site_id || ''
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
    external_id: payload.externalId || `SUC-${Date.now()}`,
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
    external_id: payload.externalId || `POS-${Date.now()}`
  };

  const r = await mpFetch('POST', '/pos', { body });
  if (!r.ok) return { success: false, error: r.error, data: r.data };

  const posId = r.data?.id != null ? String(r.data.id) : null;
  if (posId) saveConfig({ posId });
  return { success: true, posId, qr: r.data?.qr ?? null };
}

// Lista las terminales, filtrando por la sucursal/caja ya creadas
async function listTerminals({ limit = 50, offset = 0 } = {}) {
  const cfg = loadConfig();
  let qs = `limit=${limit}&offset=${offset}`;
  if (cfg.storeId) qs += `&store_id=${cfg.storeId}`;
  if (cfg.posId) qs += `&pos_id=${cfg.posId}`;

  const r = await mpFetch('GET', `/terminals/v1/list?${qs}`);
  if (!r.ok) return { success: false, error: r.error, data: r.data };

  const terminals = r.data?.data?.terminals ?? [];
  return { success: true, data: terminals };
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