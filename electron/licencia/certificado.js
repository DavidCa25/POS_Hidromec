/**
 * VERIFICAR UN CERTIFICADO DE LICENCIA (.wybix-license).
 *
 * Lo emite Supabase (license-check / trial-license) firmado con ES256. Aquí
 * solo se verifica con la clave pública: el POS no puede fabricar ni estirar
 * una licencia, y editar un campo -cajas, fechas, giros, pantallas- rompe la
 * firma. Sin red: la verificación es local.
 *
 *   { "format": "wybix-license", "v": 1, "kid": "...",
 *     "payload": "<base64url JSON>", "sig": "<base64url ES256 r||s>" }
 */
const crypto = require('crypto');
// Por omisión, SOLO producción (lo que confía el instalador). El proceso
// principal pasa las de su entorno con llavesDeConfianza().
const LLAVES = require('./llaves-publicas').PRODUCCION;

const CAMPOS = ['schema', 'kind', 'machine_id', 'edition', 'verticals', 'screens', 'entitlements',
                'grace_days', 'offline_days', 'issued_at', 'valid_until'];

function b64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * @returns {{ ok: true, payload, kid } | { ok: false, motivo }}
 * motivo: FORMATO | CLAVE_DESCONOCIDA | CLAVE_REVOCADA | FIRMA | ESTRUCTURA | VERSION
 *
 * @param revocadas KIDs comprometidos que esta instalación ya conoce (llegan
 *                  en `revoked_kids` de certificados posteriores): nunca más.
 */
function verificarCertificado(cert, llaves = LLAVES, revocadas = []) {
  llaves = llaves || LLAVES;
  if (!cert || typeof cert !== 'object' || cert.format !== 'wybix-license' || typeof cert.payload !== 'string' || typeof cert.sig !== 'string') {
    return { ok: false, motivo: 'FORMATO' };
  }
  if (cert.v !== 1) return { ok: false, motivo: 'VERSION' };
  if ((revocadas || []).includes(cert.kid)) return { ok: false, motivo: 'CLAVE_REVOCADA' };
  const pem = llaves[cert.kid];
  if (!pem) return { ok: false, motivo: 'CLAVE_DESCONOCIDA' };

  let valida = false;
  try {
    valida = crypto.verify('sha256', Buffer.from(cert.payload, 'utf8'),
      { key: crypto.createPublicKey(pem), dsaEncoding: 'ieee-p1363' }, b64url(cert.sig));
  } catch { valida = false; }
  if (!valida) return { ok: false, motivo: 'FIRMA' };

  let payload;
  try { payload = JSON.parse(b64url(cert.payload).toString('utf8')); }
  catch { return { ok: false, motivo: 'ESTRUCTURA' }; }
  if (!payload || typeof payload !== 'object' || CAMPOS.some(c => !(c in payload))) return { ok: false, motivo: 'ESTRUCTURA' };
  if (payload.schema !== 1) return { ok: false, motivo: 'VERSION' };
  if (!['LICENSE', 'TRIAL'].includes(payload.kind) || !['mono', 'multi'].includes(payload.edition)) return { ok: false, motivo: 'ESTRUCTURA' };
  if (!Array.isArray(payload.verticals) || !Array.isArray(payload.entitlements)) return { ok: false, motivo: 'ESTRUCTURA' };
  if (!Number.isFinite(Date.parse(payload.issued_at)) || !Number.isFinite(Date.parse(payload.valid_until))) return { ok: false, motivo: 'ESTRUCTURA' };
  return { ok: true, payload, kid: cert.kid };
}

/** Lee un archivo .wybix-license (texto) sin lanzar. */
function leerArchivo(texto) {
  try {
    const obj = JSON.parse(String(texto || '').replace(/^﻿/, ''));
    // Se acepta el archivo tal cual o la respuesta completa del servidor.
    return obj && obj.format === 'wybix-license' ? obj : (obj?.certificate ?? null);
  } catch { return null; }
}

module.exports = { verificarCertificado, leerArchivo };
