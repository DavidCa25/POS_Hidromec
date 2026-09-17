/**
 * QUE LA DEMO Y LA INSTALACION REAL NO SE PISEN LA LICENCIA.
 *
 *     node scripts/pruebas/licencia-aislamiento.mjs
 *
 * EL DEFECTO QUE ESTO IMPIDE
 * --------------------------
 * La licencia se guarda por duplicado a proposito:
 *
 *     userData/license.json   principal
 *     appData/.wxsys.dat      espejo, en OTRA carpeta
 *
 * El gestor de demos mueve `userData` entero, asi que la copia principal ya
 * estaba separada. El espejo no: `appData` es `%APPDATA%` a secas y es el
 * MISMO directorio para las dos instalaciones. Con un solo nombre de archivo,
 * Wybix Demo y Wybix normal escribian encima del espejo del otro en la misma
 * maquina. Y como el almacen reconcilia las dos copias -vencimiento mas
 * temprano, reloj mas avanzado-, la instalacion real acababa leyendo datos que
 * no eran suyos sin que nadie hubiera manipulado nada.
 *
 * QUE NO ES ESTO
 * --------------
 * No es un permiso ni un control. Solo decide DONDE se guarda el archivo. La
 * huella, el machineId y las validaciones son exactamente las de antes, y hay
 * comprobaciones aqui abajo que lo verifican en vez de afirmarlo.
 *
 * `electron` se sustituye por un doble: el modulo solo usa `app.getPath`.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';
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
/* Las dos instalaciones comparten `appData` -esa es justo la condicion que
   provocaba el choque- y tienen su propio `userData`, como en la maquina
   real. */
const RAIZ = mkdtempSync(join(tmpdir(), 'wybix-lic-aisl-'));
const APPDATA = join(RAIZ, 'appData');
const RUTAS = {
  normal: join(APPDATA, 'wybix-pos'),
  demo: join(APPDATA, 'wybix-pos-demo'),
};
for (const d of [APPDATA, ...Object.values(RUTAS)]) mkdirSync(d, { recursive: true });

let cual = 'normal';
const Module = require_('module');
const cargarOriginal = Module._load;
Module._load = function (peticion) {
  if (peticion === 'electron') {
    return {
      app: {
        getName: () => 'wybix-pos',
        getPath: (k) => (k === 'appData' ? APPDATA : k === 'userData' ? RUTAS[cual] : RAIZ),
        setPath: () => {},
      },
    };
  }
  return cargarOriginal.apply(this, arguments);
};

const licencia = require_('../../electron/license.js');
const { construirHuella, compararHuella } = require_('../../electron/lib/huella.js');
const { mainPath, mirrorPath } = licencia._internos;

/** Se pone uno de los dos espacios delante: instalacion o demo. */
function comoNormal() { cual = 'normal'; licencia.usarEspacio(''); }
function comoDemo() { cual = 'demo'; licencia.usarEspacio(require_('../../electron/demo/index.js').ESPACIO); }

// ----------------------------------------------------------------- equipo
const PC = {
  uuid: '4C4C4544-0037-3010-8046-B7C04F383233',
  discos: ['WD-WCC4N7KL9F2Z'],
  macs: ['a4:bb:6d:12:34:56'],
  host: 'CAJA-PRINCIPAL',
  plat: 'win32', arch: 'x64',
};
const idV1 = (partes) =>
  crypto.createHash('sha256').update(partes.filter(Boolean).join('|')).digest('hex').slice(0, 32);
const MACHINE_ID = idV1([PC.uuid, PC.discos[0], PC.host, PC.plat, PC.arch]);
const CTX = { machineIdV1: MACHINE_ID, candidatosV1: [MACHINE_ID], huella: construirHuella(PC) };

const licenciaDe = (quien) => ({
  type: 'paid', plan: 'mono', customerName: quien,
  revalidateBy: '2027-01-01T00:00:00.000Z',
});

// ===================================================================
seccion('A. La copia principal resuelve a rutas distintas');

comoNormal(); const principalNormal = mainPath();
comoDemo();   const principalDemo = mainPath();

check(principalNormal !== principalDemo, 'normal y demo no comparten license.json',
  `${basename(dirname(principalNormal))} · ${basename(dirname(principalDemo))}`);
check(basename(principalNormal) === 'license.json' && basename(principalDemo) === 'license.json',
  'las dos se siguen llamando license.json: lo que cambia es la carpeta');

// ===================================================================
seccion('B. El espejo resuelve a rutas distintas');

comoNormal(); const espejoNormal = mirrorPath();
comoDemo();   const espejoDemo = mirrorPath();

check(espejoNormal !== espejoDemo, 'normal y demo no comparten el espejo',
  `${basename(espejoNormal)} · ${basename(espejoDemo)}`);
check(basename(espejoNormal) === '.wxsys.dat',
  'el de la instalacion normal se sigue llamando .wxsys.dat');
check(/^\.wxsys-demo\.dat$/.test(basename(espejoDemo)),
  'y el de la demo lleva su espacio en el nombre', basename(espejoDemo));

/* El espejo tiene que seguir estando en OTRA carpeta que la copia principal:
   si acabaran juntos, borrar una sola carpeta se llevaria las dos y la
   proteccion contra la edicion a mano se perderia. */
check(dirname(espejoDemo) !== dirname(principalDemo),
  'y la demo conserva sus dos copias en carpetas distintas',
  `${dirname(principalDemo)} · ${dirname(espejoDemo)}`);

// ===================================================================
seccion('C. Escribir en la demo no toca los archivos de la normal');

comoNormal();
licencia.saveLicense(CTX, licenciaDe('Cliente Real'));
const antes = {
  principal: readFileSync(principalNormal, 'utf8'),
  espejo: readFileSync(espejoNormal, 'utf8'),
};

comoDemo();
licencia.saveLicense(CTX, licenciaDe('Demostracion'));

check(readFileSync(principalNormal, 'utf8') === antes.principal,
  'license.json de la instalacion normal queda igual, byte por byte');
check(readFileSync(espejoNormal, 'utf8') === antes.espejo,
  '.wxsys.dat de la instalacion normal queda igual, byte por byte');
check(existsSync(principalDemo) && existsSync(espejoDemo),
  'y la demo escribio los suyos');

comoNormal();
check(licencia.readLicense(CTX).data?.customerName === 'Cliente Real',
  'la instalacion normal sigue leyendo SU licencia');

// ===================================================================
seccion('D. Escribir en la normal no toca los archivos de la demo');

comoDemo();
const antesDemo = {
  principal: readFileSync(principalDemo, 'utf8'),
  espejo: readFileSync(espejoDemo, 'utf8'),
};

comoNormal();
licencia.saveLicense(CTX, licenciaDe('Cliente Real Reactivado'));

check(readFileSync(principalDemo, 'utf8') === antesDemo.principal,
  'license.json de la demo queda igual, byte por byte');
check(readFileSync(espejoDemo, 'utf8') === antesDemo.espejo,
  'el espejo de la demo queda igual, byte por byte');

comoDemo();
check(licencia.readLicense(CTX).data?.customerName === 'Demostracion',
  'la demo sigue leyendo LA SUYA');

// ===================================================================
seccion('E. Los rescates de lectura no cruzan de un espacio al otro');

/* El almacen rehace la copia que falte a partir de la otra. Esa red no puede
   pasar por encima del aislamiento: sin NINGUNA copia propia, el resultado
   tiene que ser "no hay licencia", no la del vecino. */
comoDemo();
rmSync(principalDemo, { force: true });
rmSync(espejoDemo, { force: true });

const huerfana = licencia.readLicense(CTX);
check(huerfana.data === null, 'sin copias propias, la demo no encuentra licencia',
  huerfana.data ? `leyo la de ${huerfana.data.customerName}` : '');
check(huerfana.tampered === false,
  'y no lo confunde con una manipulacion: no hay archivo, no hay delito');

check(!existsSync(principalDemo) && !existsSync(espejoDemo),
  'y no se rehizo ninguna copia de la demo a partir de la normal');

comoNormal();
check(licencia.readLicense(CTX).data?.customerName === 'Cliente Real Reactivado',
  'mientras la normal sigue intacta');

/* Y al reves: borrar las de la instalacion normal no puede resucitar desde la
   demo, que es el caso que se da al desinstalar Wybix y dejar la demo. */
comoDemo();
licencia.saveLicense(CTX, licenciaDe('Demostracion'));
comoNormal();
rmSync(principalNormal, { force: true });
rmSync(espejoNormal, { force: true });
check(licencia.readLicense(CTX).data === null,
  'y borrar las de la normal tampoco lee las de la demo');

// ===================================================================
seccion('F. El build publico se comporta igual que antes');

/* Sin declarar espacio -que es lo unico que ocurre en el instalador publico,
   porque electron/demo no viaja en el- las rutas son las historicas. */
licencia.usarEspacio('');
cual = 'normal';
check(mirrorPath() === join(APPDATA, '.wxsys.dat'),
  'sin espacio declarado, el espejo es el de siempre', mirrorPath());
check(mainPath() === join(RUTAS.normal, 'license.json'),
  'y la copia principal tambien', mainPath());

/* Un valor basura no puede componer una ruta a medias ni salirse de la
   carpeta: se limpia a lo que puede ser un nombre de archivo. */
for (const basura of ['../../otro', 'DEMO/../x', '  ', null, undefined, 'a'.repeat(200)]) {
  licencia.usarEspacio(basura);
  const r = mirrorPath();
  check(dirname(r) === APPDATA && /^\.wxsys(-[a-z0-9-]{1,24})?\.dat$/.test(basename(r)),
    `un espacio invalido (${JSON.stringify(basura)}) no compone una ruta rara`, basename(r));
}
licencia.usarEspacio('');

// ===================================================================
seccion('G. No se debilito nada de la identidad');

/* La huella y el machineId son los de antes. Se comprueba de verdad, no se
   afirma: si alguien aflojara la comparacion para que demo y normal convivan,
   estas dos lineas se caen. */
const otraPC = { ...PC, uuid: 'FFFFFFFF-0000-0000-0000-000000000000', discos: ['OTRO-DISCO'], macs: ['ff:ff:ff:ff:ff:ff'] };
check(compararHuella(construirHuella(PC), construirHuella(otraPC)) === 'otra',
  'una licencia copiada a otra PC se sigue rechazando');
check(compararHuella(construirHuella(PC), construirHuella({ ...PC, host: 'RENOMBRADA' })) === 'misma',
  'y renombrar el equipo se sigue aceptando');

/* El espacio NO entra en el machineId: sigue siendo el mismo hardware. */
comoNormal();
licencia.saveLicense(CTX, licenciaDe('Cliente Real'));
const idNormal = licencia.machineIdEstable(CTX);
comoDemo();
licencia.saveLicense(CTX, licenciaDe('Demostracion'));
const idDemo = licencia.machineIdEstable(CTX);
check(idNormal === MACHINE_ID && idDemo === MACHINE_ID,
  'el machineId reportado es el mismo en los dos espacios',
  'aislar el archivo no falsea la identidad de la maquina');

/* Y una licencia de otra maquina se sigue rechazando DENTRO de la demo: el
   aislamiento no puede haberse llevado por delante la comprobacion. */
const ajena = { machineIdV1: MACHINE_ID, candidatosV1: [MACHINE_ID], huella: construirHuella(otraPC) };
check(licencia.computeStatus(ajena).state === 'tamper',
  'y en la demo una licencia de otro equipo se sigue rechazando',
  licencia.computeStatus(ajena).state);

// ===================================================================
seccion('H. Eliminar la demo se lleva SU espejo y solo el suyo');

/* El espejo de la demo no esta dentro de su carpeta de datos -vive en
   `appData`-, asi que vaciar la carpeta no lo alcanza. Si se quedara, la
   siguiente demo encontraria media licencia de la anterior -espejo sin
   principal- y el almacen la daria por buena rehaciendo la copia que falta. */
comoNormal();
licencia.saveLicense(CTX, licenciaDe('Cliente Real'));
comoDemo();
licencia.saveLicense(CTX, licenciaDe('Demostracion'));
check(existsSync(espejoDemo) && existsSync(espejoNormal), 'de partida existen los dos espejos');

const { limpiarDatos } = require_('../../electron/demo/index.js');
const limpieza = limpiarDatos({ getPath: (k) => (k === 'appData' ? APPDATA : RUTAS.demo) }, { log: () => {} });

check(limpieza.ok && limpieza.borrada, 'la limpieza se ejecuta');
check(!existsSync(espejoDemo), 'el espejo de la demo ya no esta', espejoDemo);
check(!existsSync(principalDemo), 'ni su copia principal');
check(existsSync(espejoNormal), 'y el de la instalacion normal sigue ahi');
check(existsSync(principalNormal), 'con su copia principal intacta');

comoNormal();
check(licencia.readLicense(CTX).data?.customerName === 'Cliente Real',
  'la instalacion normal sigue activa despues de eliminar la demo');

/* Y la red de seguridad: si el espacio no estuviera declarado, el nombre a
   borrar seria `.wxsys.dat` -el de un cliente-. La limpieza lo comprueba y se
   niega. Se ejercita poniendo el espacio en blanco a proposito. */
licencia.usarEspacio('');
const conEspejoNormal = limpiarDatos({ getPath: (k) => (k === 'appData' ? APPDATA : RUTAS.demo) }, { log: () => {} });
check(conEspejoNormal.ok, 'sin espacio declarado la limpieza sigue corriendo');
check(existsSync(espejoNormal),
  'pero NO borra .wxsys.dat: no lleva el nombre de un espacio de demo',
  'es la linea que separa vaciar una demo de borrarle la licencia a un cliente');

// ===================================================================
seccion('Nada quedo fuera de su sitio');

comoNormal();
licencia.saveLicense(CTX, licenciaDe('Cliente Real'));
comoDemo();
licencia.saveLicense(CTX, licenciaDe('Demostracion'));

comoNormal();
const sueltos = readdirSync(APPDATA).filter(f => f.startsWith('.wxsys'));
check(sueltos.length === 2 && sueltos.includes('.wxsys.dat') && sueltos.includes('.wxsys-demo.dat'),
  'en appData hay exactamente dos espejos, uno por espacio', sueltos.join(', '));

Module._load = cargarOriginal;
try { rmSync(RAIZ, { recursive: true, force: true }); } catch { /* noop */ }

console.log(`\nRESULTADO: ${fallos ? `${fallos} FALLO(S) de ${pasos}` : `OK (${pasos} comprobaciones)`}`);
process.exit(fallos ? 1 : 0);
