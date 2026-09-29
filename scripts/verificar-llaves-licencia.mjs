/**
 * ANTES DE EMPAQUETAR: ¿el instalador podrá verificar licencias?
 *
 *     node scripts/verificar-llaves-licencia.mjs
 *
 * El instalador confía SOLO en las claves públicas de PRODUCCIÓN
 * (electron/licencia/llaves-publicas.js). Si no hay ninguna, ese Wybix no
 * podría verificar ni una licencia y todos los equipos quedarían sin poder
 * activarse: se detiene la construcción aquí, no en casa del cliente.
 *
 * Comprueba además que cada clave sea una pública P-256 válida con KID
 * wybix-lic-N, y que ninguna de desarrollo se haya colado en producción.
 */
import { createRequire } from 'node:module';
import { createPublicKey } from 'node:crypto';

const require = createRequire(import.meta.url);
const { PRODUCCION, DESARROLLO } = require('../electron/licencia/llaves-publicas.js');

const errores = [];
const kids = Object.keys(PRODUCCION);
if (!kids.length) errores.push('No hay ninguna clave pública de PRODUCCIÓN. Genera la clave en la ceremonia (wybix-owner: docs/licenciamiento-despliegue.md) y pega la pública en PRODUCCION.');
for (const kid of kids) {
  if (!/^wybix-lic-\d+$/.test(kid)) errores.push(`KID de producción inválido: ${kid} (se espera wybix-lic-N).`);
  try {
    const k = createPublicKey(PRODUCCION[kid]);
    if (k.asymmetricKeyType !== 'ec' || k.asymmetricKeyDetails?.namedCurve !== 'prime256v1') errores.push(`${kid} no es una clave P-256.`);
  } catch { errores.push(`${kid} no es una clave pública legible.`); }
  const pem = String(PRODUCCION[kid]).replace(/\s+/g, '');
  if (Object.values(DESARROLLO).some(d => String(d).replace(/\s+/g, '') === pem)) errores.push(`${kid} es una clave de DESARROLLO: no puede ir en producción.`);
}

if (errores.length) {
  console.error('\nNo se puede empaquetar Wybix:\n' + errores.map(e => `  - ${e}`).join('\n') + '\n');
  process.exit(1);
}
console.log(`Claves de licencia de producción: ${kids.join(', ')}`);
