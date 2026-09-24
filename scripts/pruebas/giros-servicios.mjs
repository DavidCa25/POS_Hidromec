/**
 * LOS GIROS DE SERVICIOS: UNA SOLA DEFINICION.
 *
 *     node scripts/pruebas/giros-servicios.mjs
 *
 * Lo que esta prueba defiende no es una funcionalidad: es que no haya DOS
 * catalogos de giros. Uno para el onboarding de un cliente real y otro para
 * las demostraciones parecen lo mismo el dia que se escriben y dejan de
 * parecerlo tres meses despues, cuando se anade un giro en uno y no en el
 * otro. El sintoma aparece en una demostracion delante de un cliente, que es
 * el peor sitio posible.
 *
 * Por eso aqui se comprueba, sobre todo, DE DONDE sale cada lista.
 *
 * No toca la base de datos. Que los giros de verdad se enciendan y se siembren
 * lo comprueba scripts/db/pruebas/servicios-giros.mjs, contra SQL Server.
 */
import { createRequire } from 'node:module';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const raiz = process.cwd();
const leer = (...p) => readFileSync(join(raiz, ...p), 'utf8');

let pasos = 0, fallos = 0;
const check = (cond, titulo, detalle) => {
  pasos++;
  if (cond) { console.log(`   ok     ${titulo}${detalle ? `  · ${detalle}` : ''}`); }
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const PRESETS = require(join(raiz, 'electron/servicios/presets.js'));
const JSONCRUDO = JSON.parse(leer('electron', 'servicios', 'presets.json'));

// ===========================================================================
seccion('1. Hay UNA fuente, y los tres lados la leen');
// ===========================================================================

check(existsSync(join(raiz, 'electron/servicios/presets.json')),
  'la definicion vive en electron/servicios/presets.json',
  'bajo electron/ y no bajo src/ porque el empaquetado mete electron/** y de src/ solo el bundle');

const enRenderer = leer('src', 'core', 'presets-servicios.ts');
check(/from '\.\.\/\.\.\/electron\/servicios\/presets\.json'/.test(enRenderer),
  'la interfaz IMPORTA ese archivo, no lo copia');
check(!/id:\s*'TALLER_AUTOMOTRIZ'/.test(enRenderer),
  'y no tiene una lista de giros escrita a mano',
  'una copia que se separe es peor que no tener copia');

const enGestor = leer('electron', 'demo', 'gestor.js');
check(/require\('\.\.\/servicios\/presets'\)/.test(enGestor),
  'el gestor de demos lee la misma, por el mismo require');
check(!/TALLER_AUTOMOTRIZ|BELLEZA/.test(enGestor),
  'y tampoco nombra ningun giro',
  'el gestor ofrece los giros que existen, sin enterarse de cuales son');

const enIpc = leer('electron', 'ipc', 'servicios.js');
check(/require\('\.\.\/servicios\/presets'\)/.test(enIpc),
  'y el proceso principal valida contra ella');

// ===========================================================================
seccion('2. Cada giro esta completo');
// ===========================================================================

check(PRESETS.PRESETS.length >= 5, `hay ${PRESETS.PRESETS.length} giros`, PRESETS.IDS.join(', '));
check(PRESETS.IDS.includes('OTRO'), 'existe el generico, para quien no encaja en ninguno');
check(PRESETS.POR_DEFECTO === 'OTRO',
  'y es el que se aplica a quien no ha elegido',
  'toda instalacion anterior a esto encendio Servicios cuando los giros no existian');

const CAMPOS = ['id', 'nombre', 'ejemplos', 'icono', 'orden', 'modulos', 'inicio', 'agenda', 'activo'];
const DEL_ACTIVO = ['requerido', 'tipo', 'singular', 'plural', 'identificador'];
for (const p of PRESETS.PRESETS) {
  const faltan = CAMPOS.filter(c => p[c] === undefined);
  check(faltan.length === 0, `${p.id} tiene todo lo que hace falta`, faltan.join(' '));
  const faltanA = DEL_ACTIVO.filter(c => p.activo?.[c] === undefined);
  check(faltanA.length === 0, `  y describe sobre que se trabaja`, faltanA.join(' '));
  check(p.modulos.includes('servicios'), `  y enciende Servicios`);
  check(['ordenes', 'agenda'].includes(p.inicio),
    `  y abre en una pantalla que existe`, `abre en ${p.inicio}`);
}

check(new Set(PRESETS.IDS).size === PRESETS.IDS.length, 'no hay identificadores repetidos');

/* El giro decide vocabulario, no esquema: el tipo que propone tiene que ser
   uno de los que la pantalla de activos ya ofrece, o el desplegable se abriria
   sin nada seleccionado. */
const activos = leer('src', 'modulo-servicios', 'activos', 'activos.component.ts');
const clases = [...activos.matchAll(/\{ valor: '([A-Z]+)'/g)].map(m => m[1]);
const tiposMalos = PRESETS.PRESETS
  .map(p => p.activo.tipo).filter(Boolean)
  .filter(t => !clases.includes(t));
check(tiposMalos.length === 0,
  'las clases que proponen los giros existen en la pantalla de activos',
  tiposMalos.join(' ') || clases.join(', '));

// ===========================================================================
seccion('3. Elegir giro enciende el modulo, y no al reves');
// ===========================================================================

const proc = leer('sql', 'procedures', 'servicios', 'sp_set_services_preset.sql');
check(/EXEC dbo\.sp_set_business_module/.test(proc),
  'el procedimiento del giro llama al del registro de modulos',
  'y no duplica el MERGE: el registro sigue teniendo un unico sitio donde se escribe');
check(/BEGIN TRAN/.test(proc) && /COMMIT/.test(proc),
  'las dos cosas en la misma transaccion',
  'un modulo encendido sin giro es un estado a medias que habria que explicar despues');
check(/INSERT INTO @modulo/.test(proc),
  'y el resultado del otro procedimiento no se escapa al que llama',
  'si saliera, recordset[0].preset devolveria undefined sin que nada fallara');

const canales = leer('electron', 'seguridad', 'canales.js');
check(/'servicios:elegir-giro': CONFIGURACION_ADMINISTRAR/.test(canales),
  'el canal exige el mismo paquete que encender un modulo',
  'bajarlo a SERVICIOS_ADMINISTRAR seria la misma puerta con una cerradura peor');
check(/'modules:set': CONFIGURACION_ADMINISTRAR/.test(canales),
  'que es lo que exige modules:set');

/* Y NO puede exigir que el modulo ya este encendido: es el canal que lo
   enciende. Se comprueba mirando que no lleva la marca de modulo. */
const bloqueGiro = enIpc.slice(enIpc.indexOf("ipcMain.handle('servicios:elegir-giro'"),
                               enIpc.indexOf("//  CATALOGO DE SERVICIOS"));
check(!/CON_MODULO/.test(bloqueGiro),
  'y no exige que Servicios ya este encendido',
  'seria imposible de usar la primera vez, que es justo para lo que existe');

// ===========================================================================
seccion('4. El giro cambia lo que se ve, sin cerrar ninguna puerta');
// ===========================================================================

const shell = leer('src', 'modulo-servicios', 'servicios-shell.component.ts');
check(/giro\.usaAgenda/.test(shell) && /giro\.usaActivos/.test(shell),
  'la carcasa ofrece Agenda y Activos segun el giro');
check(/giro\.activoPlural/.test(shell),
  'y la pestana se llama como el giro: Vehiculos, Equipos');

const rutas = leer('src', 'app', 'app.routes.ts');
check(/redirectTo: \(\) => inject\(GiroServiciosService\)\.inicio/.test(rutas),
  'la pantalla de entrada del modulo la decide el giro');

const guard = leer('src', 'app', 'servicios.guard.ts');
check(/await giro\.cargar\(\)/.test(guard),
  'y el giro se carga ANTES de que se resuelva esa redireccion',
  'si no, la primera entrada de cada sesion caeria siempre en Ordenes');

const servicio = leer('src', 'core', 'giro-servicios.service.ts');
check(/buscarPreset/.test(servicio) && /this\.elegido\(\)/.test(servicio),
  'sin giro elegido se resuelve con el generico, no con un hueco');

const migracion = leer('sql', 'schema', 'changes', '0032_servicios-giro.sql');
check(!/CHECK \(preset IN/i.test(migracion),
  'la base NO lleva un CHECK con la lista de giros',
  'anadir el sexto giro obligaria a migrar todo el parque instalado');
check(/no hay nada que sembrar|nada que sembrar/i.test(migracion),
  'y no se le escribe un giro a quien no lo eligio');

// ===========================================================================
seccion('5. En el gestor de demos hay UNA tarjeta de Servicios');
// ===========================================================================

const perfiles = readdirSync(join(raiz, 'demo-profiles'))
  .filter(d => existsSync(join(raiz, 'demo-profiles', d, 'profile.json')));
const deServicios = perfiles.filter(d => /servicio/i.test(d));
check(deServicios.length === 1,
  'un solo perfil de Servicios, no uno por giro',
  deServicios.join(', ') || 'ninguno');
check(perfiles.includes('retail') && perfiles.includes('hospitality'),
  'y Retail y Hospitality siguen donde estaban',
  perfiles.join(', '));

const ficha = JSON.parse(leer('demo-profiles', 'servicios', 'profile.json'));
check(ficha.id === 'servicios', 'el identificador coincide con la carpeta');
check(ficha.presets === 'servicios',
  'el perfil NOMBRA el catalogo de giros del producto',
  'no trae su propia lista: de ahi salen las opciones');

check(existsSync(join(raiz, 'demo-profiles', 'servicios', 'comun.sql')),
  'lo que comparten todos los giros va una sola vez, en comun.sql');

const seeds = readdirSync(join(raiz, 'demo-profiles', 'servicios', 'seeds'))
  .filter(f => f.endsWith('.sql')).map(f => f.replace(/\.sql$/, ''));
const sinSemilla = PRESETS.IDS.filter(id => !seeds.includes(id));
check(sinSemilla.length === 0, 'cada giro tiene su propio conjunto de datos',
  sinSemilla.join(' ') || seeds.join(', '));
const semillaHuerfana = seeds.filter(s => !PRESETS.IDS.includes(s));
check(semillaHuerfana.length === 0, 'y no sobra ninguna', semillaHuerfana.join(' '));

/* Cada semilla tiene que encender su giro por el procedimiento REAL y dejarlo
   anotado. Sin lo segundo, Restablecer no sabria cual rehacer. */
for (const id of PRESETS.IDS) {
  const s = leer('demo-profiles', 'servicios', 'seeds', `${id}.sql`);
  check(new RegExp(`sp_set_services_preset\\s+@preset\\s*=\\s*N'${id}'`).test(s),
    `${id} se enciende con el procedimiento real, no escribiendo tablas a mano`);
  check(new RegExp(`'demo_preset', '${id}'`).test(s),
    `  y deja anotado el giro para Restablecer`);
  check(!/INSERT INTO dbo\.services\b/.test(s),
    `  sin tocar las tablas del modulo por su cuenta`);
}

// ===========================================================================
seccion('6. Crear pide el giro; Restablecer no vuelve a preguntarlo');
// ===========================================================================

const demoIpc = leer('electron', 'demo', 'ipc.js');
check(/motivo: 'FALTA_GIRO'/.test(demoIpc),
  'crear sin giro se niega, y dice por que');
check(/const giroPrevio = antes\?\.metadatos\?\.demo_preset/.test(demoIpc),
  'restablecer lee el giro ANTES de tirar la base',
  'despues ya no hay de donde leerlo');
check(/presetId: p\.giros \? giroPrevio : null/.test(demoIpc),
  'y rehace con ese mismo, sin volver a preguntar');
check(/motivo: 'SIN_GIRO_ANOTADO'/.test(demoIpc),
  'una demo sin giro anotado no se restablece a ciegas');

const ui = leer('electron', 'demo', 'ui', 'demo.html');
check(/name="giro-\$\{p\.id\}"/.test(ui), 'la ventana ofrece elegir el giro en la propia tarjeta');
check(!/checked/.test(ui.slice(ui.indexOf('giro__ops'), ui.indexOf('</div>', ui.indexOf('giro__ops')) + 200)),
  'ninguna opcion viene marcada de antemano',
  'un giro preseleccionado se acepta sin leerlo y la demo sale siendo otra cosa');
check(/Giro: <b>\$\{p\.presetNombre/.test(ui),
  'y la tarjeta de una demo existente dice de que giro es');
check(/localStorage|ultimoGiro|lastPreset/.test(ui) === false,
  'no se recuerda el giro de la vez anterior',
  'crear un taller creyendo que creabas una barberia es exactamente lo que no puede pasar');

// ===========================================================================
seccion('7. El aislamiento de las demos sigue intacto');
// ===========================================================================

const guardas = leer('electron', 'demo', 'guardas.js');
check(/wybix_pos/.test(guardas) && /wybix_template/.test(guardas),
  'la lista de bases intocables no se movio');
check(/\^Wybix_Demo_\[A-Za-z\]\[A-Za-z0-9\]\{1,30\}\$/.test(guardas),
  'y el patron de nombre sigue siendo el mismo',
  'el giro NO viaja en el nombre de la base: una sola Wybix_Demo_Servicios');
check(!/preset|giro/i.test(guardas),
  'las guardas no se enteraron de que existen los giros',
  'no tenian por que: el giro decide que se siembra, no de quien es la base');

const build = JSON.parse(leer('package.json')).build;
check(build.files.includes('!electron/demo') && build.files.includes('!electron/demo/**'),
  'el instalador publico sigue sin empaquetar el gestor de demos');

// ===========================================================================
console.log(`\n${fallos === 0 ? 'TODO BIEN' : 'HAY FALLOS'} · ${pasos - fallos}/${pasos}`);
process.exit(fallos === 0 ? 0 : 1);
