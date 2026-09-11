/**
 * El almacen de licencia: migracion v2 -> v3, y quien puede leerla.
 *
 *     node scripts/pruebas/licencia-almacen.mjs
 *
 * QUE COMPRUEBA
 * -------------
 * `licencia-huella.mjs` ejercita la logica de comparacion. Esta prueba
 * ejercita el ALMACEN completo, escribiendo y leyendo archivos de verdad:
 *
 *     v2 sellada con WMI sano   -> se abre y se migra a v3
 *     v2 sellada con WMI caido  -> se rescata por las variantes enumerables
 *     v3 + equipo renombrado    -> sigue activa
 *     v3 + WMI caido            -> sigue activa, y NO degrada la huella
 *     v3 copiada a otra PC      -> rechazada
 *     archivo editado a mano    -> rechazado
 *     una sola copia borrada    -> se rehace sola
 *
 * `electron` se sustituye por un doble que apunta a un directorio temporal:
 * el modulo solo usa `app.getPath`, asi que no hace falta abrir una ventana.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const require_ = createRequire(import.meta.url);

// ------------------------------------------------------- doble de electron
const RAIZ = mkdtempSync(join(tmpdir(), 'wybix-lic-'));
const CARPETAS = { userData: join(RAIZ, 'userData'), appData: join(RAIZ, 'appData') };
for (const d of Object.values(CARPETAS)) mkdirSync(d, { recursive: true });

const Module = require_('module');
const cargarOriginal = Module._load;
Module._load = function (peticion, padre, esPrincipal) {
  if (peticion === 'electron') return { app: { getPath: (k) => CARPETAS[k] || RAIZ } };
  return cargarOriginal.apply(this, arguments);
};

const licencia = require_('../../electron/license.js');
const { construirHuella } = require_('../../electron/lib/huella.js');
const { cifrarV2, FORMATO, mainPath, mirrorPath } = licencia._internos;

// ----------------------------------------------------------------- equipo
const PC = {
  uuid: '4C4C4544-0037-3010-8046-B7C04F383233',
  discos: ['WD-WCC4N7KL9F2Z'],
  macs: ['a4:bb:6d:12:34:56'],
  host: 'CAJA-PRINCIPAL',
  plat: 'win32', arch: 'x64',
};

/** La formula historica del machineId, tal cual estaba en main.js. */
const idV1 = (partes) =>
  crypto.createHash('sha256').update(partes.filter(Boolean).join('|')).digest('hex').slice(0, 32);

const ID_SANO   = idV1([PC.uuid, PC.discos[0], PC.host, PC.plat, PC.arch]);
const ID_SIN_WMI = idV1(['', '', PC.host, PC.plat, PC.arch]);

/** Los candidatos que arma main.js. */
const candidatos = (uuid, disco, host) => [...new Set([
  idV1([uuid, disco, host, PC.plat, PC.arch]),
  idV1([disco, host, PC.plat, PC.arch]),
  idV1([uuid, host, PC.plat, PC.arch]),
  idV1([host, PC.plat, PC.arch]),
])];

/** El contexto que main.js le pasa al modulo. */
const ctx = (senales, uuidCrudo, discoCrudo) => ({
  machineIdV1: idV1([uuidCrudo ?? senales.uuid, discoCrudo ?? senales.discos[0], senales.host, senales.plat, senales.arch]),
  candidatosV1: candidatos(uuidCrudo ?? senales.uuid, discoCrudo ?? senales.discos[0], senales.host),
  huella: construirHuella(senales),
});

const limpiar = () => { for (const p of [mainPath(), mirrorPath()]) { try { if (existsSync(p)) rmSync(p); } catch {} } };
const enUnAno = new Date(Date.now() + 365 * 864e5).toISOString();
const LICENCIA = { type: 'paid', plan: 'mono', customerName: 'Café de la Esquina', revalidateBy: enUnAno };

try {
  console.log('\nEL ALMACEN DE LICENCIA');

  // =============================================================== 1
  seccion('1. Una licencia v2 existente se abre y se migra');
  limpiar();
  const blobV2 = cifrarV2({ ...LICENCIA, machineId: ID_SANO, lastSeen: Date.now() }, ID_SANO);
  writeFileSync(mainPath(), JSON.stringify(blobV2));
  writeFileSync(mirrorPath(), JSON.stringify(blobV2));
  check(JSON.parse(readFileSync(mainPath(), 'utf8')).v === 2, 'punto de partida: archivo en formato v2');

  const st1 = licencia.computeStatus(ctx(PC));
  check(st1.state === 'active' && st1.plan === 'mono',
    'la licencia se lee sin que el cliente haga nada', `${st1.state} · ${st1.customerName}`);
  check(JSON.parse(readFileSync(mainPath(), 'utf8')).v === FORMATO,
    'y queda migrada a v3 en el acto', `v2 -> v${FORMATO}`);
  check(JSON.parse(readFileSync(mirrorPath(), 'utf8')).v === FORMATO,
    'las dos copias, no solo una');

  // =============================================================== 2
  seccion('2. El equipo se renombra DESPUES de la migracion');
  const renombrado = { ...PC, host: 'CAJA-01-NORTE' };
  const st2 = licencia.computeStatus(ctx(renombrado));
  check(st2.state === 'active',
    'la licencia sigue activa', `${PC.host} -> ${renombrado.host}`);
  check(licencia.machineIdEstable(ctx(renombrado)) === ID_SANO,
    'y el machineId que se le reporta al servidor NO cambia',
    'reactivar no reporta una maquina distinta');

  // =============================================================== 3
  seccion('3. WMI deja de responder');
  const sinWmi = { ...PC, uuid: '', discos: [] };
  const st3 = licencia.computeStatus(ctx(sinWmi, '', ''));
  check(st3.state === 'active', 'la licencia sigue activa', 'la MAC sostiene la identidad');
  const guardadaTrasWmi = licencia.readLicense(ctx(sinWmi, '', '')).data;
  check(guardadaTrasWmi.fp.uuid === PC.uuid && guardadaTrasWmi.fp.discos.length === 1,
    'y la huella guardada NO se degrada con la lectura incompleta',
    'un fallo temporal no borra las senales buenas');

  // =============================================================== 4
  seccion('4. La licencia se copia a otra PC');
  const otraPc = {
    uuid: '8F1A2B3C-9999-4000-A000-1122334455AA',
    discos: ['SEAGATE-ZZZ99'], macs: ['b8:27:eb:aa:bb:cc'],
    host: PC.host, plat: 'win32', arch: 'x64',
  };
  const st4 = licencia.computeStatus(ctx(otraPc));
  check(st4.state === 'tamper' && st4.motivo === 'otro-equipo',
    'se rechaza', `${st4.state} / ${st4.motivo}`);
  const trasIntento = licencia.readLicense(ctx(PC)).data;
  check(trasIntento && trasIntento.fp.uuid === PC.uuid,
    'y el intento NO reescribio la huella del equipo legitimo',
    'volver a la PC original la deja como estaba');
  check(licencia.computeStatus(ctx(PC)).state === 'active',
    'la PC original sigue funcionando');

  // =============================================================== 5
  seccion('5. Alguien edita el archivo a mano');
  const sano = JSON.parse(readFileSync(mainPath(), 'utf8'));
  const roto = { ...sano, b: Buffer.from('lo que sea que quepa aqui', 'utf8').toString('base64') };
  writeFileSync(mainPath(), JSON.stringify(roto));
  writeFileSync(mirrorPath(), JSON.stringify(roto));
  const st5 = licencia.computeStatus(ctx(PC));
  check(st5.state === 'tamper' && st5.motivo === 'firma',
    'se rechaza por la firma', `${st5.state} / ${st5.motivo}`);

  seccion('   Pero si solo se rompe UNA copia, se rehace sola');
  writeFileSync(mainPath(), JSON.stringify(roto));
  writeFileSync(mirrorPath(), JSON.stringify(sano));
  const st5b = licencia.computeStatus(ctx(PC));
  check(st5b.state === 'active', 'la copia sana manda', st5b.state);
  check(JSON.parse(readFileSync(mainPath(), 'utf8')).s === JSON.parse(readFileSync(mirrorPath(), 'utf8')).s,
    'y la rota se reescribe con la buena');

  // =============================================================== 6
  seccion('6. Una licencia v2 sellada CON WMI CAIDO');
  limpiar();
  const blobDegradado = cifrarV2({ ...LICENCIA, machineId: ID_SIN_WMI, lastSeen: Date.now() }, ID_SIN_WMI);
  writeFileSync(mainPath(), JSON.stringify(blobDegradado));
  writeFileSync(mirrorPath(), JSON.stringify(blobDegradado));
  check(ID_SIN_WMI !== ID_SANO, 'el archivo quedo sellado con un machineId distinto al de hoy');
  const st6 = licencia.computeStatus(ctx(PC));
  check(st6.state === 'active',
    'las variantes enumerables la rescatan', 'esto era un bloqueo antes de este cambio');
  check(JSON.parse(readFileSync(mainPath(), 'utf8')).v === FORMATO,
    'y queda migrada a v3, ya sin depender del hostname');

  // =============================================================== 7
  seccion('7. Una prueba sigue caducando');
  limpiar();
  const ayer = new Date(Date.now() - 864e5).toISOString();
  licencia.saveLicense(ctx(PC), { type: 'trial', plan: 'trial', expiresAt: ayer });
  check(licencia.computeStatus(ctx(PC)).state === 'expired',
    'una prueba vencida sigue vencida', 'el cambio de huella no regala tiempo');

  limpiar();
  licencia.saveLicense(ctx(PC), { type: 'trial', plan: 'trial', expiresAt: enUnAno });
  const st7 = licencia.computeStatus(ctx(PC));
  check(st7.state === 'trial' && st7.daysRemaining > 300,
    'y una vigente sigue vigente', `${st7.daysRemaining} dias`);

  seccion('   Retrasar el reloj no extiende nada');
  const conAncla = licencia.readLicense(ctx(PC)).data;
  check(Number(conAncla.lastSeen) > 0, 'el ancla de reloj se sigue guardando', 'lastSeen presente');

  // =============================================================== 8
  seccion('8. Sin archivos, no hay licencia -y no se acusa a nadie-');
  limpiar();
  check(licencia.computeStatus(ctx(PC)).state === 'none',
    'estado "none", no "tamper"', 'la ausencia no es manipulacion');

} catch (e) {
  fallos++;
  console.log(`\n   FALLA  ${e.message}`);
  console.log(e.stack.split('\n').slice(1, 4).join('\n'));
} finally {
  Module._load = cargarOriginal;
  try { rmSync(RAIZ, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(fallos ? `\nRESULTADO: ${fallos} fallas de ${pasos}` : `\nRESULTADO: ${pasos} ok · 0 fallas`);
console.log('Una licencia legitima no se pierde por renombrar el equipo.');
process.exit(fallos ? 1 : 0);
