/**
 * CLAVES PÚBLICAS CON LAS QUE WYBIX VERIFICA SUS CERTIFICADOS DE LICENCIA.
 *
 * Solo públicas: con esto se puede comprobar una firma, no fabricarla. Cada
 * una va con su KID (el `kid` del certificado dice con cuál se firmó).
 *
 * PRODUCCIÓN. La privada vive ÚNICAMENTE en el gestor de secretos de Supabase
 * (LICENSE_SIGNING_KEY) y su respaldo en el gestor de contraseñas de la
 * empresa: nunca en un repositorio. Se genera en la ceremonia de
 * docs/licenciamiento-despliegue.md (wybix-owner) y aquí se pega SOLO la
 * pública. Mientras esté vacío, el instalador NO se puede construir
 * (scripts/verificar-llaves-licencia.mjs lo impide): un Wybix sin clave de
 * producción no podría verificar ninguna licencia.
 *
 * ROTAR: se AGREGA la nueva sin quitar la anterior. La anterior se retira en
 * una versión posterior, cuando ya pasaron 45 días (validez sin red) desde que
 * el servidor firma con la nueva. Un KID comprometido no se retira aquí: llega
 * en `revoked_kids` dentro de los certificados nuevos y el POS lo rechaza
 * desde ese momento, sin esperar una actualización.
 *
 * DESARROLLO. Claves de .secrets/ en wybix-owner: solo se confía en ellas sin
 * empaquetar (npm start, pruebas). Nunca en el instalador.
 */
const PRODUCCION = {
  // 'wybix-lic-1': `-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----`,
};

/**
 * KIDs REVOCADOS que esta versión ya trae de fábrica (compromisos conocidos al
 * publicarla). Se suman a los que lleguen en `revoked_kids`; nunca se quitan.
 */
const REVOCADAS = [];

const DESARROLLO = {
  'wybix-dev-1': `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEVotUnnIpWqargEgSyba3GvFWzfOl
zF+Bw15wa2dLpwZGa77FlNdWtBX82oP3Oy9m9mXgW1N3/vpmoON/bdgPMg==
-----END PUBLIC KEY-----`,
};

/**
 * Las claves en las que confía ESTA instalación.
 * @param {{ empaquetado: boolean, extra?: Record<string,string> }} o
 *   extra: una clave de PRUEBAS E2E; el proceso principal solo la pasa sin
 *   empaquetar y con WYBIX_E2E=1.
 */
function llavesDeConfianza({ empaquetado, extra = null } = { empaquetado: true }) {
  if (empaquetado) return { ...PRODUCCION };
  return { ...PRODUCCION, ...DESARROLLO, ...(extra || {}) };
}

module.exports = { PRODUCCION, DESARROLLO, REVOCADAS, llavesDeConfianza };
