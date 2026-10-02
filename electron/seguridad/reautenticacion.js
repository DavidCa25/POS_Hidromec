/**
 * COMPROBANTES DE AUTORIZACIÓN DE UN SOLO USO.
 *
 * EL PROBLEMA QUE CIERRA
 * ----------------------
 * `security:authorize` validaba las credenciales del supervisor y devolvía su
 * `authorizedBy` al renderer, que después lo mandaba de vuelta a
 * `security:log`. Entre una llamada y otra, el número viajaba por el renderer:
 * cualquiera podía registrar «autorizó el usuario 1» sin que el usuario 1
 * hubiera tecleado nada.
 *
 * AHORA
 * -----
 * Validar credenciales (contraseña o PIN) produce un COMPROBANTE: un secreto
 * aleatorio que vive solo en memoria del proceso principal, atado a:
 *
 *   - la ventana que lo pidió (no se puede usar desde otra);
 *   - quien opera en esa ventana (si cambia la sesión, no vale);
 *   - el canal de la operación para la que se pidió;
 *   - un vencimiento corto (2 minutos).
 *
 * Y se CONSUME: la primera operación que lo use lo gasta. Quien autorizó lo
 * dice el comprobante, nunca el payload.
 *
 * Esto es la base local de lo que después serán las ApprovalRequest: misma
 * idea (quién, para qué, hasta cuándo, una vez), sin la parte remota.
 */
const crypto = require('crypto');

const VIGENCIA_MS = 2 * 60 * 1000;
const vivos = new Map();   // token -> comprobante

function limpiar(ahora = Date.now()) {
  for (const [t, c] of vivos) if (c.expira <= ahora) vivos.delete(t);
}

/**
 * @param c { webContentsId, actorId, autorizadorId, autorizadorUsuario, autorizadorRol, canal, via }
 */
function emitir(c) {
  limpiar();
  const token = crypto.randomBytes(24).toString('base64url');
  vivos.set(token, { ...c, emitido: Date.now(), expira: Date.now() + VIGENCIA_MS });
  return { token, expira: new Date(Date.now() + VIGENCIA_MS).toISOString() };
}

/**
 * Gasta el comprobante si corresponde a esta ventana, este actor y este canal.
 * Devuelve el comprobante (con `autorizadorId`) o null. Un comprobante que no
 * corresponde NO se gasta: así un intento con el canal equivocado no le quita
 * su autorización a la operación legítima.
 */
function consumir(token, { webContentsId, actorId, canal }) {
  limpiar();
  if (typeof token !== 'string' || !token) return null;
  const c = vivos.get(token);
  if (!c) return null;
  if (c.webContentsId !== webContentsId) return null;
  if (Number(c.actorId) !== Number(actorId)) return null;
  if (canal && c.canal && c.canal !== canal) return null;
  vivos.delete(token);
  return c;
}

function _reiniciar() { vivos.clear(); }

module.exports = { emitir, consumir, VIGENCIA_MS, _reiniciar };
