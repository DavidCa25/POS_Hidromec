/**
 * TOKENS Y CREDENCIALES DE LAS PANTALLAS LOCALES.
 *
 * Dos secretos distintos, y ninguno se guarda en claro:
 *
 *   token de emparejar   va en el QR. Un solo uso, caduca en minutos, ligado a
 *                        una estacion. No sirve para operar: solo para pedir
 *                        una credencial.
 *   credencial           la del dispositivo, que la pantalla guarda en una
 *                        cookie HttpOnly. Cada pantalla tiene la suya: no hay
 *                        un token universal. Revocarla la deja fuera.
 *
 * En la base solo queda el SHA-256. 32 bytes aleatorios son 256 bits: un hash
 * sin sal basta, porque no hay nada que adivinar por diccionario.
 */
const crypto = require('crypto');

const MINUTOS_EMPAREJAR = 10;

function nuevoSecreto() {
  return crypto.randomBytes(32).toString('base64url');
}

function hash(secreto) {
  return crypto.createHash('sha256').update(String(secreto), 'utf8').digest('hex');
}

/** Solo lo que puede ser un secreto nuestro: evita consultas con basura. */
function pareceSecreto(s) {
  return typeof s === 'string' && /^[A-Za-z0-9_-]{40,60}$/.test(s);
}

function iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/*
 * PIN DE TRABAJADOR.
 *
 * Un PIN es corto (4 a 8 digitos): con un SHA-256 simple se adivina en
 * segundos a partir del hash. Por eso scrypt, con sal propia por persona, y
 * ademas limite de intentos y bloqueo en el servidor (trabajadores.js).
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function pinValido(pin) {
  const p = String(pin ?? '');
  if (!/^\d{4,8}$/.test(p)) return 'El PIN son de 4 a 8 números.';
  if (/^(\d)\1+$/.test(p)) return 'El PIN no puede ser el mismo número repetido.';
  if ('0123456789'.includes(p) || '9876543210'.includes(p)) return 'El PIN no puede ser una serie seguida.';
  return null;
}

function hashPin(pin, sal = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(String(pin), sal, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString('hex');
  return { hash: h, sal };
}

function pinCoincide(pin, hashGuardado, sal) {
  if (!hashGuardado || !sal) return false;
  const { hash: h } = hashPin(pin, sal);
  return iguales(h, hashGuardado);
}

module.exports = { MINUTOS_EMPAREJAR, nuevoSecreto, hash, pareceSecreto, iguales, pinValido, hashPin, pinCoincide };
