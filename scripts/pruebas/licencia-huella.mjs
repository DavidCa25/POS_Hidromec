/**
 * La licencia sobrevive a la maquina, pero no se muda a otra.
 *
 *     node scripts/pruebas/licencia-huella.mjs
 *
 * QUE SE ROMPIO
 * -------------
 * La huella de maquina ERA la llave de cifrado de la licencia:
 *
 *     keyFor(machineId) = sha256(SECRET || machineId)
 *     machineId = sha256(uuidPlaca | serialDisco | hostname | plat | arch)
 *
 * Eso mezclaba dos preguntas distintas -"¿puedo leer el archivo?" y "¿es la
 * misma maquina?"- y hacia que un cambio benigno respondiera la peor de las
 * dos. Dos formas de romper una licencia legitima:
 *
 *   1. RENOMBRAR EL EQUIPO. `os.hostname()` entra en el hash. Cualquier area
 *      de sistemas renombra una maquina al darla de alta.
 *   2. WMI INCOMPLETO. `.filter(Boolean)` DESCARTA las partes vacias, asi que
 *      un `wmic` que no responde produce un hash distinto en silencio.
 *
 * En los dos casos el archivo dejaba de descifrar, el modulo concluia
 * "manipulada" y la aplicacion se bloqueaba. Le paso a esta maquina de
 * desarrollo a mitad del QA.
 *
 * QUE COMPRUEBA
 * -------------
 * La logica de comparacion de huellas y las decisiones que se derivan, sobre
 * el modulo puro. Los cuatro escenarios del encargo:
 *
 *     mismo hardware + otro hostname   -> misma identidad
 *     WMI temporalmente incompleto     -> no se acusa de nada
 *     otro equipo real                 -> se rechaza
 *     licencia v1 existente            -> transicion sin bloquear
 */
import { construirHuella, compararHuella, conviene_resellar, fuerza }
  from '../../electron/lib/huella.js';
import crypto from 'node:crypto';

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

/** El equipo del cliente, tal como lo lee el sistema. */
const PC = {
  uuid: '4C4C4544-0037-3010-8046-B7C04F383233',
  discos: ['WD-WCC4N7KL9F2Z', 'S3Z1NB0K900123'],
  macs: ['a4:bb:6d:12:34:56', '00:15:5d:01:02:03'],
  host: 'CAJA-PRINCIPAL',
  plat: 'win32',
  arch: 'x64',
};
const original = construirHuella(PC);

console.log('\nLA HUELLA DE MAQUINA');

// =============================================================== 1
seccion('1. Mismo hardware, otro nombre de Windows');
const renombrada = construirHuella({ ...PC, host: 'CAJA-01-SUCURSAL-NORTE' });
check(compararHuella(original, renombrada) === 'misma',
  'renombrar el equipo NO cambia la identidad',
  `${PC.host} -> ${renombrada.host}`);
check(conviene_resellar(original, renombrada),
  'y la huella se actualiza con el nombre nuevo');

// El hostname es informativo: ni siquiera participa en la decision.
const soloNombreIgual = construirHuella({
  uuid: 'OTRO-UUID', discos: ['OTRO-DISCO'], macs: ['ff:ff:ff:ff:ff:ff'],
  host: PC.host, plat: 'win32', arch: 'x64',
});
check(compararHuella(original, soloNombreIgual) === 'otra',
  'y coincidir SOLO en el nombre no basta para aceptar nada');

// =============================================================== 2
seccion('2. WMI temporalmente incompleto');
const sinWmi = construirHuella({ ...PC, uuid: '', discos: [] });
check(compararHuella(original, sinWmi) === 'misma',
  'sin uuid ni discos, la MAC sostiene la identidad',
  'la MAC no pasa por WMI');
check(!conviene_resellar(original, sinWmi),
  'y NO se re-sella: una huella pobre no debe sustituir a una buena',
  `fuerza ${fuerza(original)} -> ${fuerza(sinWmi)}`);

const soloUuid = construirHuella({ ...PC, discos: [], macs: [] });
check(compararHuella(original, soloUuid) === 'misma',
  'con solo el uuid tambien alcanza');

const nada = construirHuella({ uuid: '', discos: [], macs: [], host: PC.host, plat: 'win32', arch: 'x64' });
check(compararHuella(original, nada) === 'indeterminada',
  'sin NINGUNA senal dura se dice "indeterminada", no "otra maquina"',
  'no se puede afirmar lo que no se pudo leer');
check(!conviene_resellar(original, nada),
  'y tampoco se re-sella');

// =============================================================== 3
seccion('3. Otro equipo real');
const otraPc = construirHuella({
  uuid: '8F1A2B3C-9999-4000-A000-1122334455AA',
  discos: ['SEAGATE-ZZZ99'],
  macs: ['b8:27:eb:aa:bb:cc'],
  host: 'CAJA-PRINCIPAL',        // hasta con el MISMO nombre
  plat: 'win32', arch: 'x64',
});
check(compararHuella(original, otraPc) === 'otra',
  'copiar la licencia a otra PC se rechaza',
  'ninguna senal dura en comun');
check(!conviene_resellar(original, otraPc),
  'y jamas se re-sella sobre una maquina que no coincide');

check(compararHuella(original, construirHuella({ ...PC, plat: 'darwin' })) === 'otra',
  'otra plataforma se rechaza aunque el resto coincida');
check(compararHuella(original, construirHuella({ ...PC, arch: 'arm64' })) === 'otra',
  'otra arquitectura tambien');

seccion('   Reparaciones legitimas del MISMO equipo');
check(compararHuella(original, construirHuella({ ...PC, uuid: 'PLACA-NUEVA' })) === 'misma',
  'cambiar la placa, conservando discos y red, sigue siendo la misma');
check(compararHuella(original, construirHuella({ ...PC, discos: ['DISCO-NUEVO'] })) === 'misma',
  'cambiar el disco tambien');
check(compararHuella(original, construirHuella({ ...PC, discos: [...PC.discos, 'DISCO-EXTRA'] })) === 'misma',
  'y agregar un disco no rompe nada',
  'los seriales se comparan por interseccion, no por igualdad');
check(compararHuella(original, construirHuella({
        uuid: 'PLACA-NUEVA', discos: ['DISCO-NUEVO'], macs: ['ff:ee:dd:cc:bb:aa'],
        host: PC.host, plat: 'win32', arch: 'x64' })) === 'otra',
  'pero cambiarlo TODO a la vez ya es otro equipo');

seccion('   El orden de los discos no importa');
check(compararHuella(original, construirHuella({ ...PC, discos: [...PC.discos].reverse() })) === 'misma',
  'wmic no garantiza el orden y la huella no depende de el');
check(compararHuella(original, construirHuella({ ...PC, discos: PC.discos.map(d => d.toLowerCase()) })) === 'misma',
  'ni de mayusculas o espacios');

// =============================================================== 4
seccion('4. Licencia v1 existente: la transicion');

// La formula historica, tal cual estaba en main.js.
const machineIdV1 = (partes) =>
  crypto.createHash('sha256').update(partes.filter(Boolean).join('|')).digest('hex').slice(0, 32);

const idSano   = machineIdV1([PC.uuid, PC.discos[0], PC.host, PC.plat, PC.arch]);
const idSinWmi = machineIdV1(['', '', PC.host, PC.plat, PC.arch]);
const idRenombrada = machineIdV1([PC.uuid, PC.discos[0], 'NOMBRE-NUEVO', PC.plat, PC.arch]);

check(idSano !== idSinWmi,
  'confirmado: con WMI caido, el machineId v1 cambiaba',
  `${idSano.slice(0, 8)}… vs ${idSinWmi.slice(0, 8)}…`);
check(idSano !== idRenombrada,
  'y al renombrar el equipo, tambien',
  `${idSano.slice(0, 8)}… vs ${idRenombrada.slice(0, 8)}…`);

// Las variantes que main.js prueba para rescatar una licencia v1.
const candidatos = (uuid, disco, host) => [...new Set([
  machineIdV1([uuid, disco, host, PC.plat, PC.arch]),
  machineIdV1([disco, host, PC.plat, PC.arch]),
  machineIdV1([uuid, host, PC.plat, PC.arch]),
  machineIdV1([host, PC.plat, PC.arch]),
])];

check(candidatos(PC.uuid, PC.discos[0], PC.host).includes(idSano),
  'con WMI sano, el id correcto esta entre los candidatos');
check(candidatos('', '', PC.host).includes(idSinWmi),
  'y con WMI caido tambien',
  'la licencia se abre y se migra a v3 en el acto');
// Lo importante: con WMI caido HOY, ¿se recupera una licencia sellada CON WMI?
check(candidatos('', '', PC.host).includes(idSano) === false,
  'lo que NO se puede es adivinar un uuid que hoy no se lee',
  'por eso la MAC entra en la huella v2: no depende de WMI');
check(candidatos(PC.uuid, PC.discos[0], 'NOMBRE-NUEVO').includes(idSano) === false,
  'y un hostname viejo no se puede enumerar: ese caso se reactiva',
  'es el unico irrecuperable, y ya lo estaba antes de este cambio');

seccion('   Una licencia v1 no trae huella');
check(compararHuella(null, original) === 'sin-huella',
  'sin huella guardada no se acusa a nadie');
check(compararHuella({ v: 1, uuid: 'x' }, original) === 'sin-huella',
  'una huella de version anterior tampoco');

console.log(fallos ? `\nRESULTADO: ${fallos} fallas de ${pasos}` : `\nRESULTADO: ${pasos} ok · 0 fallas`);
console.log('Cambiar el nombre del equipo no puede costarle la licencia a nadie.');
process.exit(fallos ? 1 : 0);
