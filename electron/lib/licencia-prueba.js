/**
 * Sella una respuesta remota como PRUEBA antes de guardarla.
 *
 * QUE PASABA
 * ----------
 * `license:start-trial` guardaba literalmente lo que devolvia la funcion
 * remota, y `computeStatus` clasifica asi:
 *
 *     const type = data.type || (data.plan === 'trial' ? 'trial' : 'paid');
 *
 * Si la respuesta no traia `type` y su `plan` tampoco decia 'trial', la
 * licencia quedaba clasificada como de pago: el estado salia `active` con
 * `plan: 'mono'`, y la pantalla anunciaba "Licencia MonoCaja activada" a quien
 * acababa de pedir una prueba gratuita. La interfaz decia la verdad sobre un
 * estado mal guardado; el arreglo no estaba en el texto.
 *
 * POR QUE AQUI
 * ------------
 * Este flujo es el unico que SABE, sin depender de nadie, que lo que se acaba
 * de pedir es una prueba: lo acaba de pedir el. No se toca `saveLicense`, que
 * tambien guarda activaciones de pago, ni se adivina nada en la pantalla.
 *
 * Modulo puro y sin dependencias: se puede ejercitar fuera de Electron.
 */

/**
 * Devuelve el payload remoto con la semantica de prueba garantizada.
 * Conserva todos los demas campos tal cual llegaron.
 */
function sellarComoPrueba(payload) {
  return { ...(payload || {}), type: 'trial' };
}

module.exports = { sellarComoPrueba };
