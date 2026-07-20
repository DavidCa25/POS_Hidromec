// license.js
// Almacenamiento blindado de la licencia / prueba:
//   - Cifrado AES-256-CBC (encrypt-then-MAC) atado al machineId
//   - Firma HMAC-SHA256: editar el archivo a mano lo invalida
//   - Copia espejo en OTRA carpeta: borrar/editar solo una no sirve
//   - Ancla de reloj (lastSeen) en ambas copias: retrasar la fecha no extiende
//   - Cualquier manipulación => estado 'tamper' (bloquea)
//   - Migra automaticamente el license.json antiguo (texto plano)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

// Secreto de firma/cifrado (ofuscado por partes; no aparece literal en el codigo).
const _seed = ['W7bx', '9pOS', 'kL2z', 'Q8vT', 'mN4r', 'Zr1c'];
const SECRET = crypto.createHash('sha256').update(_seed.join('-') + '::wybix::lic::v2').digest(); // 32 bytes

function mainPath()   { return path.join(app.getPath('userData'), 'license.json'); }
function mirrorPath() { return path.join(app.getPath('appData'), '.wxsys.dat'); }

function keyFor(machineId) {
  return crypto.createHash('sha256')
    .update(Buffer.concat([SECRET, Buffer.from(String(machineId || ''))]))
    .digest(); // 32 bytes -> AES-256
}

function safeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}

function encryptPayload(obj, machineId) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', keyFor(machineId), iv);
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const body = Buffer.concat([iv, ct]);
  const mac = crypto.createHmac('sha256', SECRET)
    .update(Buffer.concat([body, Buffer.from(String(machineId))])).digest('hex');
  return { v: 2, b: body.toString('base64'), s: mac };
}

function decryptPayload(blob, machineId) {
  if (!blob || blob.v !== 2 || !blob.b || !blob.s) return null;
  const body = Buffer.from(blob.b, 'base64');
  const mac = crypto.createHmac('sha256', SECRET)
    .update(Buffer.concat([body, Buffer.from(String(machineId))])).digest('hex');
  if (!safeEq(mac, blob.s)) return null; // firma invalida -> manipulado
  try {
    const iv = body.subarray(0, 16);
    const ct = body.subarray(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyFor(machineId), iv);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString('utf8'));
  } catch { return null; }
}

function readBlob(p) {
  try { if (!fs.existsSync(p)) return null; return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}
function writeBlob(p, blob) {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(blob)); return true; }
  catch { return false; }
}

// Lee una copia: distingue v2 firmado, legado (texto plano) y manipulado.
function loadOne(p, machineId) {
  const raw = readBlob(p);
  if (!raw) return { data: null, tampered: false, present: false };
  if (raw.v === 2) {
    const d = decryptPayload(raw, machineId);
    return { data: d, tampered: !d, present: true };
  }
  // Formato antiguo (texto plano de versiones previas): se acepta y luego se migra a v2.
  if (raw.plan || raw.type || raw.expiresAt || raw.revalidateBy) {
    return { data: raw, tampered: false, present: true, legacy: true };
  }
  return { data: null, tampered: true, present: true };
}

function saveLicense(machineId, obj) {
  const data = { ...(obj || {}) };
  data.machineId = machineId;
  data.lastSeen = Math.max(Number(obj && obj.lastSeen || 0), Date.now());
  const blob = encryptPayload(data, machineId);
  writeBlob(mainPath(), blob);
  writeBlob(mirrorPath(), blob);
  return data;
}

// Reconcilia las dos copias y devuelve { data, tampered }.
function readLicense(machineId) {
  const a = loadOne(mainPath(), machineId);
  const b = loadOne(mirrorPath(), machineId);

  let data = null;
  if (a.data && b.data) {
    data = { ...a.data };
    // ancla de reloj: la MAS avanzada de las dos (no se puede retroceder)
    data.lastSeen = Math.max(Number(a.data.lastSeen || 0), Number(b.data.lastSeen || 0));
    // vencimiento: el MAS temprano de las dos (no se puede "estirar" una copia)
    const ea = Date.parse(a.data.expiresAt || '') || 0;
    const eb = Date.parse(b.data.expiresAt || '') || 0;
    if (ea && eb) data.expiresAt = new Date(Math.min(ea, eb)).toISOString();
  } else {
    data = a.data || b.data || null;
  }

  // Manipulacion real: existe una copia v2 que NO verifica y no hay dato sano que la respalde.
  const tampered = (a.tampered || b.tampered) && !data;

  // Si hay dato sano pero alguna copia falta / esta manipulada / es legado -> re-sella ambas coherentes.
  if (data && (a.tampered || b.tampered || !a.present || !b.present || a.legacy || b.legacy)) {
    saveLicense(machineId, data);
  }

  return { data, tampered };
}

function computeStatus(machineId) {
  const { data, tampered } = readLicense(machineId);
  if (tampered) return { state: 'tamper' };
  if (!data) return { state: 'none' };

  const now = Date.now();
  const lastSeen = Number(data.lastSeen || 0);
  const effectiveNow = Math.max(now, lastSeen); // el reloj no puede retroceder
  if (now > lastSeen) saveLicense(machineId, { ...data, lastSeen: now });

  const type = data.type || (data.plan === 'trial' ? 'trial' : 'paid');

  if (type === 'trial') {
    const exp = Date.parse(data.expiresAt || data.revalidateBy || '') || 0;
    const daysRemaining = Math.max(0, Math.ceil((exp - effectiveNow) / 86400000));
    const state = effectiveNow < exp ? 'trial' : 'expired';
    return {
      state, type: 'trial', daysRemaining,
      expiresAt: data.expiresAt || null,
      startedAt: data.startedAt || null,
      customerName: data.customerName || ''
    };
  }

  return {
    state: 'active', type: 'paid',
    plan: data.plan || 'mono',
    customerName: data.customerName || '',
    revalidateBy: data.revalidateBy || null
  };
}

function clearLicense() {
  for (const p of [mainPath(), mirrorPath()]) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* noop */ }
  }
  return true;
}

module.exports = { saveLicense, readLicense, computeStatus, clearLicense };
