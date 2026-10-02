/**
 * CONTRASEÑAS DE USUARIO: scrypt, con migración gradual desde SHA-256.
 *
 * QUÉ HABÍA
 * ---------
 * `users.password_hash` guardaba `CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256',
 * @password), 2)`: SHA-256 sin sal, en hexadecimal mayúscula. Con un volcado
 * de la tabla, una contraseña corta se recupera en segundos, y dos usuarios
 * con la misma contraseña tienen el mismo hash.
 *
 * QUÉ HAY
 * -------
 * scrypt con sal propia por usuario, el mismo algoritmo que ya protege los PIN
 * de Local Host (`local-host/credenciales.js`), disponible en `crypto` de Node
 * sin dependencias. El formato vive en la MISMA columna, con prefijo:
 *
 *     $wx-scrypt$N.r.p$<sal base64>$<hash base64>
 *
 * MIGRACIÓN SIN RESETEAR A NADIE
 * ------------------------------
 * Un hash sin prefijo es legado. Al iniciar sesión con la contraseña correcta,
 * se verifica contra el formato legado y se guarda el nuevo (`rehash: true`).
 * Nadie tiene que cambiar su contraseña; cada cuenta se migra la primera vez
 * que alguien entra con ella.
 *
 * DETALLE QUE NO SE PUEDE PERDER
 * ------------------------------
 * `HASHBYTES('SHA2_256', @password)` con `@password NVARCHAR` hashea los bytes
 * UTF-16LE, no UTF-8. Si aquí se hasheara en UTF-8, ningún usuario existente
 * podría volver a entrar.
 *
 * Nada de este módulo registra contraseñas ni hashes.
 */
const crypto = require('crypto');

const PREFIJO = '$wx-scrypt$';
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
/* scrypt con N=16384, r=8 usa 16 MiB; el límite por defecto de Node es 32 MiB. */
const MAXMEM = 64 * 1024 * 1024;

function hashear(contrasena) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(contrasena), sal, SCRYPT.keylen,
    { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: MAXMEM });
  return `${PREFIJO}${SCRYPT.N}.${SCRYPT.r}.${SCRYPT.p}$${sal.toString('base64')}$${h.toString('base64')}`;
}

function esLegado(guardado) {
  return !String(guardado || '').startsWith(PREFIJO);
}

/** El hash que producía SQL Server: SHA-256 de los bytes UTF-16LE, hex mayúscula. */
function legadoSha256(contrasena) {
  return crypto.createHash('sha256').update(Buffer.from(String(contrasena), 'utf16le')).digest('hex').toUpperCase();
}

function iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * ¿Coincide? `rehash` = coincidió con el formato legado: hay que guardar el nuevo.
 */
function verificar(contrasena, guardado) {
  const g = String(guardado || '');
  if (!g || contrasena == null || contrasena === '') return { ok: false, rehash: false };

  if (!esLegado(g)) {
    const partes = g.slice(PREFIJO.length).split('$');
    if (partes.length !== 3) return { ok: false, rehash: false };
    const [params, salB64, hashB64] = partes;
    const [N, r, p] = params.split('.').map(Number);
    if (![N, r, p].every(Number.isFinite)) return { ok: false, rehash: false };
    const esperado = Buffer.from(hashB64, 'base64');
    const h = crypto.scryptSync(String(contrasena), Buffer.from(salB64, 'base64'), esperado.length,
      { N, r, p, maxmem: MAXMEM });
    const ok = h.length === esperado.length && crypto.timingSafeEqual(h, esperado);
    /* Si algún día suben los parámetros, se re-hashea igual que el legado. */
    const vigentes = N === SCRYPT.N && r === SCRYPT.r && p === SCRYPT.p;
    return { ok, rehash: ok && !vigentes };
  }

  const ok = iguales(legadoSha256(contrasena), g.toUpperCase());
  return { ok, rehash: ok };
}

module.exports = { PREFIJO, hashear, verificar, esLegado, legadoSha256 };
