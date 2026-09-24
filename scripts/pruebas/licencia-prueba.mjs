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

  seccion('Una prueba guardada ANTES del sellado tambien se repara');
  {
    /*
     * ESTO ANTES COMPROBABA EL DEFECTO, Y AHORA COMPRUEBA SU REPARACION.
     *
     * `sellarComoPrueba` arregla el problema al GUARDAR. Las instalaciones que
     * empezaron su prueba antes de que existiera se quedaron con el archivo
     * clasificado como licencia de pago, y seguian anunciando "MonoCaja"
     * para siempre: el arreglo no llegaba hacia atras.
     *
     * `computeStatus` las reconoce ahora por su FORMA. Una prueba caduca
     * -`expiresAt`- y una licencia de pago se revalida -`revalidateBy`-. Tener
     * caducidad y no tener revalidacion solo le pasa a una prueba.
     */
    licenseStore.clearLicense();
    licenseStore.saveLicense(MAQUINA, { success: true, expiresAt: en30dias, plan: 'mono' });
    const st = licenseStore.computeStatus(MAQUINA);
    check(st.state === 'trial' && st.type === 'trial',
      'una prueba sin `type` ya NO se lee como licencia MonoCaja activada',
      `state = ${st.state}, type = ${st.type}`);
  }

  seccion('PRUEBAS NEGATIVAS: ninguna licencia pagada se reclasifica');
  /*
   * LA REGLA ES `expiresAt` PRESENTE => PRUEBA, y no es una corazonada.
   *
   * Se comprobo contra el servidor: `expiresAt` lo emite UN SOLO archivo de
   * todo el backend, `trial-license`. La activacion de pago (`license-check`)
   * devuelve
   *
   *     { plan, maxRegisters, customerName, machineId,
   *       supportUntil, supportActive, revalidateBy, issuedAt }
   *
   * y ahi no hay `expiresAt`. Una licencia pagada no puede coincidir con la
   * forma de una prueba porque el campo no existe en su contrato.
   *
   * Abajo van TODAS las formas conocidas de licencia de pago. Ninguna puede
   * salir clasificada como prueba.
   */
  const FORMAS_DE_PAGO = [
    ['MonoCaja, respuesta actual completa', {
      success: true, plan: 'mono', maxRegisters: 1, customerName: 'Cliente',
      machineId: 'x', supportUntil: null, supportActive: false,
      revalidateBy: en30dias, issuedAt: new Date().toISOString(),
    }],
    ['MultiCaja, respuesta actual completa', {
      success: true, plan: 'multi', maxRegisters: 99, customerName: 'Cliente',
      revalidateBy: en30dias, issuedAt: new Date().toISOString(),
    }],
    ['MonoCaja legada, solo plan y revalidateBy', {
      success: true, plan: 'mono', revalidateBy: en30dias,
    }],
    ['MultiCaja legada, solo plan y revalidateBy', {
      success: true, plan: 'multi', revalidateBy: en30dias,
    }],
    ['de pago muy vieja, solo plan', { success: true, plan: 'mono' }],
    ['de pago con soporte vigente', {
      success: true, plan: 'multi', supportUntil: en30dias, supportActive: true,
      revalidateBy: en30dias,
    }],
    ['de pago ya sellada con type', {
      success: true, type: 'paid', plan: 'mono', revalidateBy: en30dias,
    }],

    /*
     * EL CASO AMBIGUO, QUE ES EL QUE IMPORTA.
     *
     * `plan` sale de una columna de la tabla de licencias de pago, y esa
     * columna no tiene ninguna restriccion que impida escribir ahi la palabra
     * `trial`. No se puede DEMOSTRAR que nunca pase: solo confiar en que nadie
     * lo escriba. Asi que la regla no confia.
     *
     * Lo que si es demostrable es que `supportUntil` y `supportActive` los
     * emite unicamente `license-check` -se verifico en el backend-, asi que su
     * presencia dice "esto es de pago" con independencia de `plan`.
     */
    ['de pago con `plan` puesto a mano en trial, pero con marcas de soporte', {
      success: true, plan: 'trial', maxRegisters: 99, customerName: 'Cliente',
      supportUntil: en30dias, supportActive: true, revalidateBy: en30dias,
      issuedAt: new Date().toISOString(),
    }],
    ['de pago con `plan` en trial y soporte ya vencido', {
      success: true, plan: 'trial', supportUntil: null, supportActive: false,
      revalidateBy: en30dias,
    }],

    /* Y una de pago a la que le falta TODO menos la revalidacion: sigue sin
       tener `expiresAt`, asi que sigue siendo de pago. */
    ['de pago pelada, solo revalidateBy', { success: true, revalidateBy: en30dias }],
  ];

  for (const [nombre, forma] of FORMAS_DE_PAGO) {
    licenseStore.clearLicense();
    licenseStore.saveLicense(MAQUINA, forma);
    const st = licenseStore.computeStatus(MAQUINA);
    check(st.state === 'active' && st.type === 'paid',
      `una licencia ${nombre} NO se convierte en prueba`,
      `state = ${st.state}, type = ${st.type}`);
  }

  seccion('Y todas las formas conocidas de PRUEBA se reconocen');
  const FORMAS_DE_PRUEBA = [
    ['actual, con type y plan trial', {
      success: true, type: 'trial', plan: 'trial', expiresAt: en30dias,
      revalidateBy: en30dias, customerName: 'Prueba',
    }],
    ['legada, sin type, con plan del negocio', {
      success: true, plan: 'mono', expiresAt: en30dias,
    }],
    ['legada, sin type y con revalidateBy tambien', {
      success: true, plan: 'mono', expiresAt: en30dias, revalidateBy: en30dias,
    }],
    ['legada, sin type ni plan', { success: true, expiresAt: en30dias }],
  ];

  for (const [nombre, forma] of FORMAS_DE_PRUEBA) {
    licenseStore.clearLicense();
    licenseStore.saveLicense(MAQUINA, forma);
    const st = licenseStore.computeStatus(MAQUINA);
    check(st.state === 'trial' && st.type === 'trial',
      `una prueba ${nombre} se reconoce como prueba`,
      `state = ${st.state}, type = ${st.type}`);
  }

  seccion('Una demo no es una licencia, y no se confunde con una prueba');
  {
    /* Se resuelve por el ESPACIO, no por un archivo: no hay nada que
       falsificar, y una instalacion de cliente nunca declara este espacio. */
    licenseStore.clearLicense();
    licenseStore.usarEspacio('demo');
    const st = licenseStore.computeStatus(MAQUINA);
    check(st.state === 'demo' && st.type === 'demo',
      'en el espacio de demo el estado es demo, sin archivo ninguno',
      `state = ${st.state}`);
    licenseStore.usarEspacio('');
    const vuelta = licenseStore.computeStatus(MAQUINA);
    check(vuelta.state === 'none',
      'y al salir del espacio de demo vuelve a no haber licencia',
      `state = ${vuelta.state}`);
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
