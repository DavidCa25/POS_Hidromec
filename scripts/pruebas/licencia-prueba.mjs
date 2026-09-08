/**
 * Una prueba gratuita se guarda como prueba, no como licencia comprada.
 *
 *     node scripts/pruebas/licencia-prueba.mjs
 *
 * QUE SE ROMPIO
 * -------------
 * En la VM se pidio "Prueba gratis" y el sistema acabo anunciando
 * "Licencia MonoCaja activada". La pantalla decia la verdad sobre un estado
 * mal guardado: `license:start-trial` persistia literalmente lo que devolvia la
 * funcion remota, y `computeStatus` clasifica por `data.type`:
 *
 *     const type = data.type || (data.plan === 'trial' ? 'trial' : 'paid');
 *
 * Sin `type`, y con un `plan` que no dijera 'trial', la licencia caia en la
 * rama de pago: `state: 'active'`, `plan: 'mono'`.
 *
 * QUE COMPRUEBA
 * -------------
 * El caso exacto que fallaba -respuesta remota SIN `type` y SIN `plan: 'trial'`-
 * contra el `electron/license.js` REAL: se cifra, se escribe, se relee y se
 * clasifica igual que en una caja. No se simula la libreria de licencias.
 *
 * `license.js` pide `electron` para saber donde escribir; aqui se le da un
 * directorio temporal y nada mas. Lo demas es el codigo de produccion.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'wxlic-'));

// `electron` no existe fuera de Electron: se sustituye por lo justo.
const cargaOriginal = Module._load;
Module._load = function (peticion, ...resto) {
  if (peticion === 'electron') return { app: { getPath: () => dir } };
  return cargaOriginal.call(this, peticion, ...resto);
};

const require = createRequire(import.meta.url);
const licenseStore = require('../../electron/license.js');
const { sellarComoPrueba } = require('../../electron/lib/licencia-prueba.js');
Module._load = cargaOriginal;

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle = '') => {
  if (cond) { ok++; console.log(`   ok    ${titulo}${detalle ? '  · ' + detalle : ''}`); }
  else { fallos.push(titulo); console.log(`   FALLA ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const MAQUINA = 'QA-MACHINE-0001';
const en30dias = new Date(Date.now() + 30 * 86400000).toISOString();

/** Lo que hace hoy `license:start-trial`: sellar y guardar. */
const iniciarPrueba = (respuestaRemota) => {
  licenseStore.clearLicense();
  licenseStore.saveLicense(MAQUINA, sellarComoPrueba(respuestaRemota));
  return licenseStore.computeStatus(MAQUINA);
};

console.log('\nUNA PRUEBA GRATUITA SE GUARDA COMO PRUEBA');

try {
  seccion('El caso que fallaba: la respuesta remota no dice que es una prueba');
  {
    // Ni `type`, ni `plan: 'trial'`. Es el payload que producia el defecto.
    const st = iniciarPrueba({ success: true, expiresAt: en30dias, customerName: 'Cafe QA' });
    check(st.state === 'trial', 'el estado es trial, no active', `state = ${st.state}`);
    check(st.type === 'trial', 'y se clasifica como prueba', `type = ${st.type}`);
    check(st.plan === undefined, 'sin plan que anunciar: nadie compro nada', `plan = ${st.plan}`);
    check(st.daysRemaining > 0 && st.daysRemaining <= 30,
      'con los dias que quedan', `${st.daysRemaining} dias`);
    check(st.customerName === 'Cafe QA', 'y conserva los demas campos remotos', st.customerName);
  }

  seccion('Sin sellar, el defecto se reproduce');
  {
    // Se guarda tal cual llegaba antes: esto es lo que veia el cliente.
    licenseStore.clearLicense();
    licenseStore.saveLicense(MAQUINA, { success: true, expiresAt: en30dias, plan: 'mono' });
    const st = licenseStore.computeStatus(MAQUINA);
    check(st.state === 'active' && st.plan === 'mono',
      'una prueba sin `type` se leia como licencia MonoCaja activada',
      `state = ${st.state}, plan = ${st.plan}`);
  }

  seccion('Si la respuesta remota SI lo dice, nada cambia');
  {
    const st = iniciarPrueba({ success: true, type: 'trial', expiresAt: en30dias });
    check(st.state === 'trial', 'sigue siendo trial', `state = ${st.state}`);
  }
  {
    const st = iniciarPrueba({ success: true, plan: 'trial', expiresAt: en30dias });
    check(st.state === 'trial', 'y con plan trial tambien', `state = ${st.state}`);
  }

  seccion('El sellado no toca las licencias de pago');
  {
    licenseStore.clearLicense();
    licenseStore.saveLicense(MAQUINA, {
      type: 'paid', plan: 'multi', customerName: 'Negocio Real',
      revalidateBy: en30dias,
    });
    const st = licenseStore.computeStatus(MAQUINA);
    check(st.state === 'active' && st.plan === 'multi',
      'una activacion real sigue siendo MultiCaja', `state = ${st.state}, plan = ${st.plan}`);
  }

  seccion('Una prueba vencida sigue venciendo');
  {
    const ayer = new Date(Date.now() - 86400000).toISOString();
    const st = iniciarPrueba({ success: true, expiresAt: ayer });
    check(st.state === 'expired', 'expira, no se convierte en licencia', `state = ${st.state}`);
  }

  seccion('El sellado conserva el resto del payload');
  {
    const remoto = { success: true, expiresAt: en30dias, plan: 'mono', email: 'qa@wybix.mx', otro: 7 };
    const sellado = sellarComoPrueba(remoto);
    check(sellado.type === 'trial', 'anade type: trial');
    check(sellado.email === 'qa@wybix.mx' && sellado.otro === 7 && sellado.plan === 'mono',
      'y no pierde ni cambia ningun otro campo');
    check(remoto.type === undefined, 'sin mutar el objeto que llego');
  }

} finally {
  try { licenseStore.clearLicense(); } catch { /* noop */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(`\nRESULTADO: ${ok} ok · ${fallos.length} fallas`);
if (fallos.length) { fallos.forEach(f => console.log('  - ' + f)); process.exit(1); }
console.log('Quien pide una prueba recibe una prueba.');
