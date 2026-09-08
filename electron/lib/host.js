// host.js
// La frontera entre el HOST de la sucursal y una caja secundaria.
//
// Wybix usa UNA base SQL Server por sucursal y N cajas en la misma red. El
// equipo donde vive ese SQL Server es el HOST: es el unico que respalda,
// restaura y aplica migraciones. Las demas cajas solo operan.
//
// Vive aparte y sin dependencias -ni Electron, ni la conexion a la base- para
// que la regla se pueda probar sola y para que importarla no abra conexiones.

const os = require('os');

/**
 * El servidor configurado, esta en esta misma maquina?
 *
 * Acepta las formas con las que la gente escribe un servidor local
 * (localhost, ".", "(local)", 127.0.0.1, el nombre del equipo) y descarta
 * la instancia y el puerto antes de comparar.
 */
function servidorEsLocal(server) {
  const s = String(server ?? '').trim().toLowerCase();
  if (!s) return false;
  const equipo = s.split('\\')[0].split(',')[0].trim();
  const propios = new Set([
    'localhost', '127.0.0.1', '::1', '.', '(local)', '(localdb)',
    String(os.hostname() || '').toLowerCase()
  ]);
  return propios.has(equipo);
}

module.exports = { servidorEsLocal };
