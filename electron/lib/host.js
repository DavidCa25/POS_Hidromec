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
const { hostDe } = require('./servidor-sql');

/**
 * El servidor configurado, esta en esta misma maquina?
 *
 * Acepta las formas con las que la gente escribe un servidor local
 * (localhost, ".", "(local)", 127.0.0.1, el nombre del equipo) y descarta
 * la instancia y el puerto antes de comparar.
 *
 * El troceo lo hace `servidor-sql.js`. Antes estaba aqui -otro
 * `split('\\')[0].split(',')[0]`, el tercero del proyecto- y tener la misma
 * gramatica escrita en tres sitios es como se llego a que el asistente
 * generara `192.168.100.211\SQLEXPRESS\SQLEXPRESS` sin que nada protestara.
 *
 * `hostDe` devuelve cadena vacia si la cadena no es valida, y una cadena
 * vacia nunca esta en la lista: un servidor mal escrito no se da por local.
 */
function servidorEsLocal(server) {
  // `.` y `(local)` son formas legitimas de nombrar el equipo local, pero no
  // son nombres de host: el analizador las rechaza, asi que se atienden antes.
  const bruto = String(server ?? '').trim().toLowerCase();
  if (!bruto) return false;
  const sinAdorno = bruto.split('\\')[0].split(',')[0].trim();
  if (sinAdorno === '.' || sinAdorno === '(local)' || sinAdorno === '(localdb)') return true;

  const equipo = hostDe(server).toLowerCase();
  if (!equipo) return false;
  const propios = new Set([
    'localhost', '127.0.0.1', '::1',
    String(os.hostname() || '').toLowerCase()
  ]);
  return propios.has(equipo);
}

module.exports = { servidorEsLocal };
