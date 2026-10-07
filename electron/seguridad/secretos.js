'use strict';
/**
 * SECRETOS EN DISCO: CIFRADOS DE VERDAD O NO SE GUARDAN.
 *
 * Antes, si `safeStorage` (DPAPI en Windows) no estaba disponible, la
 * contraseña de SQL y el token de la nube se guardaban en base64 con
 * `method: 'base64'`. Base64 NO es cifrado: cualquiera que abra el JSON lo lee.
 *
 * Ahora:
 *   - cifrar()    safeStorage o null. Nunca base64.
 *   - descifrar() lee lo de antes (incluido base64) para no dejar a nadie sin
 *                 conexión, pero lo marca como `legado`: quien lo lee lo vuelve
 *                 a guardar cifrado en cuanto puede (migración gradual).
 *
 * Es el mismo criterio que ya seguía redMulticaja.js con la contraseña de red.
 * `safeStorage` se inyecta para poder probarlo sin Electron.
 */

function crearSecretos(safeStorage) {
  function hayCifrado() {
    try { return !!(safeStorage && safeStorage.isEncryptionAvailable()); } catch { return false; }
  }

  /** { enc, method: 'safeStorage' } o null si el sistema no ofrece cifrado. */
  function cifrar(plano) {
    if (plano == null || plano === '' || !hayCifrado()) return null;
    return { enc: safeStorage.encryptString(String(plano)).toString('base64'), method: 'safeStorage' };
  }

  /**
   * { valor, legado }. `legado` = venía en base64 (o en claro) y hay que
   * volver a guardarlo cifrado. Un valor que no se puede abrir devuelve ''.
   */
  function descifrar(enc, method) {
    if (!enc) return { valor: '', legado: false };
    if (method === 'safeStorage') {
      if (!hayCifrado()) return { valor: '', legado: false };
      try { return { valor: safeStorage.decryptString(Buffer.from(enc, 'base64')), legado: false }; }
      catch { return { valor: '', legado: false }; }
    }
    // base64 de versiones anteriores: se lee UNA vez para migrarlo.
    try { return { valor: Buffer.from(String(enc), 'base64').toString('utf8'), legado: true }; }
    catch { return { valor: '', legado: false }; }
  }

  return { hayCifrado, cifrar, descifrar };
}

module.exports = { crearSecretos };
