// mercadoPagoPoint.js
// Integración con Mercado Pago Point (API Orders) para cobros presenciales.
// El Access Token vive solo en el proceso principal, nunca llega al renderer.
// Requiere Electron con Node 18+ (usa el fetch global).

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');

const API_BASE = 'https://api.mercadopago.com';

function getConfigPath() {
  return path.join(app.getPath('userData'), 'mp-config.json');
}

function loadConfig() {
  // Las variables de entorno tienen prioridad sobre el archivo
  const fromEnv = {
    accessToken: process.env.MP_ACCESS_TOKEN || '',
    terminalId: process.env.MP_TERMINAL_ID || '',
    storeId: process.env.MP_STORE_ID || '',
    posId: process.env.MP_POS_ID || ''
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
    posId: fromEnv.posId || fromFile.posId || ''
  };
}

function saveConfig(cfg = {}) {
  const current = loadConfig();
  const merged = { ...current, ...cfg };
  fs.writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

// Nunca expone el token al renderer, solo si está presente
function getPublicConfig() {
  const c = loadConfig();
  return {
    success: true,
    data: {
      hasToken: !!c.accessToken,
      terminalId: c.terminalId,
      storeId: c.storeId,
      posId: c.posId
    }
  };
}

function setConfig(cfg = {}) {
  try {
    const saved = saveConfig(cfg);
    return { success: true, data: { hasToken: !!saved.accessToken, terminalId: saved.terminalId } };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Wrapper con auth, manejo de errores y parseo seguro de la respuesta
async function mpFetch(method, urlPath, { body = null, idempotency = false } = {}) {
  const cfg = loadConfig();
  if (!cfg.accessToken) {
    return { ok: false, status: 0, error: 'Falta el Access Token de Mercado Pago (mp-config.json o MP_ACCESS_TOKEN).' };
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
      const msg = data?.message || data?.error || `HTTP ${resp.status}`;
      return { ok: false, status: resp.status, error: msg, data };
    }
    return { ok: true, status: resp.status, data };
  } catch (e) {
    // error de red transitorio: el loop de polling reintenta
    return { ok: false, status: 0, error: e.message };
  }
}

// Traduce el status de la order al flujo del POS
function classifyOrder(order) {
  const status = order?.status || '';
  switch (status) {
    case 'processed':
      return 'approved';          // pago acreditado
    case 'created':
    case 'at_terminal':
      return 'pending';           // sigue en proceso, hay que seguir consultando
    case 'action_required':
      return 'action_required';   // estado final que no cambia: verificar en terminal
    case 'failed':
    case 'expired':
    case 'canceled':
    case 'refunded':
      return 'failed';            // no se completó (o ya fue reembolsada)
    default:
      return 'pending';
  }
}

async function createPointOrder({ amount, externalReference, expirationTime = 'PT3M', printOnTerminal = 'no_ticket' } = {}) {
  const cfg = loadConfig();
  if (!cfg.terminalId) {
    return { success: false, error: 'Falta terminalId en la configuración de Mercado Pago.' };
  }

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { success: false, error: 'Monto inválido para la orden.' };
  }

  const body = {
    type: 'point',
    external_reference: String(externalReference || `POS-${Date.now()}`),
    expiration_time: expirationTime,
    transactions: {
      payments: [{ amount: value.toFixed(2) }]
    },
    config: {
      point: {
        terminal_id: cfg.terminalId,
        print_on_terminal: printOnTerminal
      }
    }
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

// Solo funciona si la order sigue en estado 'created'.
// Si ya está 'at_terminal' (el cliente ya está pagando), debe cancelarse desde la terminal.
async function cancelOrder(orderId) {
  if (!orderId) return { success: false, error: 'orderId requerido.' };

  const r = await mpFetch('POST', `/v1/orders/${orderId}/cancel`, { idempotency: true });
  if (!r.ok) return { success: false, error: r.error, data: r.data };

  return { success: true, status: r.data?.status ?? null };
}

// Útil para descubrir el terminal_id sin tener que armar el request a mano
async function listTerminals({ limit = 50, offset = 0 } = {}) {
  const r = await mpFetch('GET', `/terminals/v1/list?limit=${limit}&offset=${offset}`);
  if (!r.ok) return { success: false, error: r.error, data: r.data };

  const terminals = r.data?.data?.terminals ?? [];
  return { success: true, data: terminals };
}

module.exports = {
  createPointOrder,
  getOrder,
  cancelOrder,
  listTerminals,
  getPublicConfig,
  setConfig
};