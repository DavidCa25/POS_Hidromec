/**
 * SESION Y PERMISOS DEL PROCESO PRINCIPAL.
 *
 *     node scripts/pruebas/sesion-permisos.mjs
 *
 * QUE SE COMPRUEBA AQUI
 * ---------------------
 * Que la autorizacion existe de verdad y no solo en la interfaz. Una pantalla
 * escondida no es seguridad: cualquiera con la consola de Electron abierta
 * puede invocar el canal a mano. Lo que decide es el proceso principal, y eso
 * es lo que se ejercita.
 *
 * Tres bloques:
 *
 *   1. El CATALOGO -tres roles, siete paquetes- y que nadie pueda anadir un
 *      paquete sin decidir quien lo tiene.
 *   2. La COBERTURA: que cada `ipcMain.handle` del proyecto este clasificado
 *      como protegido o como abierto-con-motivo, y que cada protegido este
 *      realmente envuelto en `sesion.proteger` en el fuente.
 *   3. El COMPORTAMIENTO: se carga el modulo de sesion con dependencias
 *      falsas -sin Electron y sin SQL Server- y se comprueba que hace lo que
 *      dice cuando la base responde, cuando no responde y cuando alguien
 *      cambia de rol desde otra caja.
 *
 * QUE NO SE COMPRUEBA AQUI
 * ------------------------
 * Que la aplicacion real arranque y que un cajero de verdad reciba el error en
 * pantalla. Eso es trabajo de las pruebas de extremo a extremo, que levantan
 * Electron y SQL Server. Aqui no hay simulacion de HTML: lo que se ejecuta es
 * el modulo de produccion, tal cual.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const raiz = process.cwd();

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const permisos = require(join(raiz, 'electron/seguridad/permisos.js'));
const canales = require(join(raiz, 'electron/seguridad/canales.js'));
const sesion = require(join(raiz, 'electron/seguridad/sesion.js'));
const B = permisos.BUNDLES;

// ===========================================================================
seccion('1. El catalogo: tres roles, siete paquetes');
// ===========================================================================

check(permisos.PERMISOS.length === 7, 'hay siete paquetes', permisos.PERMISOS.join(' '));
check(Object.keys(permisos.ROLES).length === 3, 'hay tres roles',
  Object.keys(permisos.ROLES).join(' '));

// Los codigos guardados NO se reescriben: una base de hace un ano sigue
// diciendo `cajero`, y este binario tiene que entenderla.
check(
  ['admin', 'supervisor', 'cajero'].every(r => r in permisos.ROLES),
  'los codigos persistidos siguen siendo admin/supervisor/cajero');
check(permisos.ETIQUETAS.admin === 'Administrador'
   && permisos.ETIQUETAS.supervisor === 'Encargado'
   && permisos.ETIQUETAS.cajero === 'Operador',
  'cambia el nombre en pantalla, no el valor guardado');

const deAdmin = permisos.permisosDeRol('admin');
const deEncargado = permisos.permisosDeRol('supervisor');
const deOperador = permisos.permisosDeRol('cajero');

check(deAdmin.size === 7, 'Administrador tiene los siete');
check(deEncargado.size === 6 && !deEncargado.has(B.CONFIGURACION_ADMINISTRAR),
  'Encargado tiene seis y NO configuracion', [...deEncargado].join(' '));
check(deOperador.size === 2
   && deOperador.has(B.VENTAS_OPERAR) && deOperador.has(B.SERVICIOS_OPERAR),
  'Operador tiene solo lo del dia', [...deOperador].join(' '));

// El septimo paquete existe por esto: administrar Servicios sin recibir de
// paso los respaldos, los usuarios y la configuracion fiscal.
check(deEncargado.has(B.SERVICIOS_ADMINISTRAR) && !deEncargado.has(B.CONFIGURACION_ADMINISTRAR),
  'un Encargado administra Servicios sin administrar el negocio');

// Un rol que este binario no conoce no hereda nada. No se mapea al mas
// restringido: Operador puede vender, y regalar eso a un valor que nadie
// entiende seria peor que dejar a la persona sin acceso.
check(permisos.normalizarRol('consulta') === permisos.SIN_ROL, 'un rol desconocido es "sin rol"');
check(permisos.permisosDeRol('consulta').size === 0, 'un rol desconocido no recibe ningun paquete');
check(permisos.permisosDeRol(null).size === 0, 'un rol vacio no recibe ningun paquete');
check(permisos.etiquetaDeRol('consulta') === 'Sin rol asignado', 'y se dice asi en pantalla');

// La prueba que impide que un paquete nuevo se cuele sin dueno. Administrador
// se define con comodin, asi que sin la lista de reservados no habria forma de
// distinguir 'solo suyo' de 'nadie lo repartio'. De ahi la lista SOLO_ADMIN.
check(permisos.catalogoCompleto().sinDecidir.length === 0,
  'ningun paquete quedo sin decidir quien lo tiene',
  permisos.catalogoCompleto().sinDecidir.join(' ') || 'ninguno');
check(permisos.catalogoCompleto().soloAdmin.includes(B.CONFIGURACION_ADMINISTRAR),
  'y los reservados al Administrador estan dichos, no heredados por comodin');

// Sin comodines fuera de Administrador: el dia que exista un paquete clinico
// nadie debe heredarlo por escribir `servicios.*`.
check(Object.entries(permisos.ROLES).filter(([r, v]) => r !== 'admin' && v === '*').length === 0,
  'ningun rol salvo Administrador se define por comodin');

seccion('1b. No quedan excepciones por usuario');
const fuentesSeguridad = ['electron/seguridad/permisos.js', 'electron/seguridad/canales.js',
  'electron/seguridad/sesion.js', 'electron/main.js', 'electron/preload.js',
  'scripts/db/lib/catalogo.mjs', 'sql/procedures/security/sp_authorize_supervisor.sql'];
const conOverrides = fuentesSeguridad.filter(f =>
  /user_permission_overrides|permisosEfectivos|users:set-override|users:overrides/.test(
    readFileSync(join(raiz, f), 'utf8')));
check(conOverrides.length === 0,
  'ni tabla, ni canal, ni funcion de excepciones por usuario', conOverrides.join(' ') || 'limpio');

// ===========================================================================
seccion('2. Cobertura: ningun canal sin clasificar');
// ===========================================================================

function archivosJs(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!/^(node_modules|migrations)$/.test(e.name)) archivosJs(p, acc); }
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

/**
 * Los canales reales, leidos del fuente.
 *
 * El patron tolera saltos de linea y las tres comillas a proposito: un
 * `ipcMain.handle(\n  'canal',` escrito en dos lineas es igual de real, y una
 * auditoria que no lo vea da un aprobado falso. Ya paso: dos canales de
 * clientes se registraban asi y una version anterior de esta prueba los daba
 * por inexistentes.
 */
const reHandle = /ipcMain\.handle\(\s*(['"`])([^'"`]+)\1/g;
const reales = new Map();
const fuentesElectron = archivosJs(join(raiz, 'electron'));
for (const f of fuentesElectron) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(reHandle)) reales.set(m[2], relative(raiz, f).replace(/\\/g, '/'));
}

check(reales.size > 200, 'se leyeron los canales del proyecto', `${reales.size} canales`);

const clasificados = new Set([...Object.keys(canales.EXIGE), ...Object.keys(canales.ABIERTOS)]);
const sinClasificar = [...reales.keys()].filter(c => !clasificados.has(c)).sort();
check(sinClasificar.length === 0,
  'cada canal esta en una de las dos tablas', sinClasificar.join(' ') || 'todos');

const fantasmas = [...clasificados].filter(c => !reales.has(c)).sort();
check(fantasmas.length === 0,
  'ninguna tabla protege un canal que no existe', fantasmas.join(' ') || 'ninguno');

const dobles = Object.keys(canales.EXIGE).filter(c => c in canales.ABIERTOS);
check(dobles.length === 0, 'ningun canal esta protegido y abierto a la vez', dobles.join(' ') || 'ninguno');

const sinMotivo = Object.entries(canales.ABIERTOS).filter(([, m]) => !m || String(m).trim().length < 10);
check(sinMotivo.length === 0,
  'cada canal abierto dice por que', sinMotivo.map(([c]) => c).join(' ') || 'todos lo dicen');

seccion('2b. Lo protegido esta realmente envuelto');
const todoElFuente = fuentesElectron.map(f => readFileSync(f, 'utf8')).join('\n');
const sinEnvolver = Object.keys(canales.EXIGE).filter(c =>
  !todoElFuente.includes(`sesion.proteger('${c}'`)
  && !todoElFuente.includes(`sesion.proteger("${c}"`));
check(sinEnvolver.length === 0,
  'cada canal protegido pasa por sesion.proteger',
  sinEnvolver.join(' ') || `${Object.keys(canales.EXIGE).length} canales`);

// Las tres operaciones contra las que nacio el blindaje anti robo hormiga.
for (const c of ['sp-refund-sale', 'sp-update-sale', 'open-cash-drawer']) {
  check(canales.exigePara(c) === B.VENTAS_SUPERVISAR, `${c} exige supervisar la venta`);
}
check(canales.exigePara('sp-register-sale') === B.VENTAS_OPERAR, 'vender exige solo operar');
check(canales.exigePara('users:create') === B.CONFIGURACION_ADMINISTRAR, 'crear usuarios exige administrar');
check(canales.exigePara('sp-get-products') === null, 'leer el catalogo no exige nada');

// El asistente de primera ejecucion corre sin usuarios: protegerlo haria
// imposible instalar Wybix. Es una decision, y esta escrita.
check('setup-inicial' in canales.ABIERTOS && 'sp-iniciar-sesion' in canales.ABIERTOS,
  'el primer arranque y el login se quedan abiertos a proposito');

// ===========================================================================
seccion('3. Comportamiento: la sesion contra una base falsa');
// ===========================================================================

/** Una base de mentira con la que se puede simular corte de red y cambios. */
function baseFalsa({ revision = 1, usuarios = {}, modulos = ['retail'] } = {}) {
  const estado = { revision, usuarios, modulos: new Set(modulos), caida: false, lecturas: 0 };
  sesion.cerrarTodas();
  sesion.configurar({
    leerRevision: async () => {
      estado.lecturas++;
      if (estado.caida) throw new Error('base no disponible');
      return estado.revision;
    },
    leerUsuario: async (id) => {
      if (estado.caida) throw new Error('base no disponible');
      return estado.usuarios[id] ?? null;
    },
    modulosActivos: async () => {
      if (estado.caida) throw new Error('base no disponible');
      return estado.modulos;
    },
    registrar: () => {},
  });
  return estado;
}

const ADMIN = { id: 1, usuario: 'duena', rol: 'admin', active: 1 };
const ENCARGADO = { id: 2, usuario: 'turno', rol: 'supervisor', active: 1 };
const OPERADOR = { id: 3, usuario: 'caja1', rol: 'cajero', active: 1 };

seccion('3a. El renderer no declara quien es');
{
  baseFalsa({ usuarios: { 3: OPERADOR } });
  let lanzo = false;
  try { await sesion.abrir(10, { rol: 'admin' }); } catch { lanzo = true; }
  check(lanzo, 'no se abre sesion sin una fila validada por SQL');

  const s = await sesion.abrir(10, OPERADOR);
  check(s.userId === 3 && s.rol === 'cajero', 'la identidad sale de la fila, no del parametro');
  check(!s.permisos.has(B.VENTAS_SUPERVISAR), 'y con ella los paquetes de su rol');
}

seccion('3b. La sesion va por ventana, no es global');
{
  baseFalsa({ usuarios: { 1: ADMIN, 3: OPERADOR } });
  await sesion.abrir(10, ADMIN);

  // La pantalla de cliente, la vista previa, la impresion y el gestor de demos
  // nunca inician sesion. Con un unico objeto global bastaria con conocer el
  // nombre del canal; con el mapa por ventana, simplemente no tienen sesion.
  const otraVentana = await sesion.comprobar(99, B.VENTAS_OPERAR);
  check(!otraVentana.ok && otraVentana.motivo === 'SIN_SESION',
    'otra ventana no hereda la sesion de la principal');

  const propia = await sesion.comprobar(10, B.CONFIGURACION_ADMINISTRAR);
  check(propia.ok, 'la ventana que inicio sesion si puede');

  // Un webContents NUEVO tras un fallo del renderer vuelve al login.
  sesion.cerrar(10);
  const trasCaida = await sesion.comprobar(10, B.VENTAS_OPERAR);
  check(!trasCaida.ok && trasCaida.motivo === 'SIN_SESION',
    'un webContents nuevo tras un fallo vuelve al login');
}

seccion('3c. Los permisos no se congelan al entrar');
{
  const base = baseFalsa({ revision: 1, usuarios: { 2: { ...ENCARGADO } } });
  await sesion.abrir(20, base.usuarios[2]);
  check((await sesion.comprobar(20, B.VENTAS_SUPERVISAR)).ok,
    'el Encargado puede devolver al entrar');

  // Desde otra caja le bajan el rol. Sin `security_revision` esto no surtiria
  // efecto hasta que cerrara sesion: en un turno de ocho horas, una tarde.
  base.usuarios[2] = { ...ENCARGADO, rol: 'cajero' };
  base.revision = 2;
  sesion.invalidarRevision();   // lo mismo que hace el proceso al cambiar un rol
  const r = await sesion.comprobar(20, B.VENTAS_SUPERVISAR);
  check(!r.ok && r.motivo === 'SIN_PERMISO',
    'bajarle el rol desde otra caja surte efecto sin cerrar sesion');
  check((await sesion.comprobar(20, B.VENTAS_OPERAR)).ok,
    'y conserva lo que su nuevo rol si tiene');

  // Desactivarlo lo echa.
  base.usuarios[2] = { ...ENCARGADO, rol: 'cajero', active: 0 };
  base.revision = 3;
  sesion.invalidarRevision();
  const fuera = await sesion.comprobar(20, B.VENTAS_OPERAR);
  check(!fuera.ok && fuera.motivo === 'SIN_SESION', 'desactivar a alguien cierra su sesion');
}

seccion('3d. La revision se lee como mucho una vez cada TTL');
{
  const base = baseFalsa({ usuarios: { 3: OPERADOR } });
  await sesion.abrir(30, OPERADOR);
  const antes = base.lecturas;
  for (let i = 0; i < 20; i++) await sesion.comprobar(30, B.VENTAS_OPERAR);
  check(base.lecturas === antes,
    'veinte ventas seguidas no son veinte consultas', `${base.lecturas - antes} lecturas`);
  check(sesion.TTL_REVISION_MS === 5000, 'el TTL es de cinco segundos, escrito y no "instantaneo"');
}

seccion('3e. No hay fail-open general');
{
  const base = baseFalsa({ usuarios: { 1: ADMIN, 2: ENCARGADO, 3: OPERADOR } });
  await sesion.abrir(40, ENCARGADO);
  await sesion.abrir(41, OPERADOR);
  await sesion.comprobar(40, B.VENTAS_OPERAR);   // calienta la cache
  await sesion.comprobar(41, B.VENTAS_OPERAR);
  base.caida = true;
  sesion.invalidarRevision();   // como si el TTL acabara de vencer

  // Alto riesgo: si no se puede comprobar, no se ejecuta. Punto.
  for (const p of [B.VENTAS_SUPERVISAR, B.INVENTARIO_OPERAR,
                   B.CONFIGURACION_ADMINISTRAR, B.SERVICIOS_ADMINISTRAR, B.REPORTES_VER]) {
    const r = await sesion.comprobar(40, p);
    check(!r.ok && r.motivo === 'SIN_VERIFICAR', `sin base, ${p} NO se ejecuta`);
  }

  // Venta: una caja con sesion valida y permisos ya comprobados sigue
  // vendiendo dentro de la ventana de cache. Dejar de vender por un corte de
  // red de un segundo es un fallo peor que el que se intenta evitar.
  const venta = await sesion.comprobar(41, B.VENTAS_OPERAR);
  check(venta.ok, 'sin base, una caja con sesion valida sigue vendiendo');

  // Pero eso NO es un comodin: quien no tenia el paquete sigue sin tenerlo.
  const supervisarOperador = await sesion.comprobar(41, B.VENTAS_SUPERVISAR);
  check(!supervisarOperador.ok, 'y un Operador sigue sin poder devolver');

  // Y sin sesion no hay excepcion que valga.
  const anonimo = await sesion.comprobar(77, B.VENTAS_OPERAR);
  check(!anonimo.ok && anonimo.motivo === 'SIN_SESION', 'sin sesion no se vende ni con la base caida');
}

seccion('3f. Capacidad no es permiso');
{
  const base = baseFalsa({ usuarios: { 1: ADMIN }, modulos: ['retail'] });
  await sesion.abrir(50, ADMIN);

  const apagado = await sesion.comprobar(50, B.SERVICIOS_OPERAR, { modulo: 'servicios' });
  check(!apagado.ok && apagado.motivo === 'MODULO_APAGADO',
    'el Administrador tiene el paquete pero el modulo esta apagado');

  base.modulos.add('servicios');
  // Las capacidades no viven en la sesion: se preguntan cada vez.
  const encendido = await sesion.comprobar(50, B.SERVICIOS_OPERAR, { modulo: 'servicios' });
  check(encendido.ok, 'encenderlo desde otra caja surte efecto sin cerrar sesion');

  base.caida = true;
  sesion.invalidarRevision();
  const indeterminado = await sesion.comprobar(50, B.SERVICIOS_OPERAR, { modulo: 'servicios' });
  check(!indeterminado.ok && ['MODULO_INDETERMINADO', 'SIN_VERIFICAR'].includes(indeterminado.motivo),
    'si no se puede saber si el modulo esta encendido, no se ejecuta');
}

seccion('3g. El mensaje que ve la persona');
{
  const textos = Object.values(sesion.MENSAJES);
  check(textos.length >= 5, 'hay un mensaje por motivo', `${textos.length}`);
  const filtra = /admin|supervisor|cajero|VENTAS_|INVENTARIO_|CONFIGURACION_|SERVICIOS_|REPORTES_/;
  const filtrados = textos.filter(t => filtra.test(t));
  check(filtrados.length === 0,
    'ningun mensaje filtra codigos internos ni nombres de rol', filtrados.join(' | ') || 'ninguno');
  check(textos.every(t => /[a-z]/.test(t) && t.length < 120), 'y todos estan escritos para una persona');
}

seccion('3h. proteger() corta antes de tocar la base');
{
  baseFalsa({ usuarios: { 3: OPERADOR } });
  await sesion.abrir(60, OPERADOR);

  let ejecutado = 0;
  const handler = sesion.proteger('sp-refund-sale', async () => { ejecutado++; return { success: true }; });
  const r = await handler({ sender: { id: 60 } }, { saleId: 1 });
  check(ejecutado === 0, 'el handler de una devolucion NI SE LLAMA si no hay paquete');
  check(r.success === false && typeof r.error === 'string', 'y devuelve un error, no una excepcion');

  const permitido = sesion.proteger('sp-register-sale', async (_e, p, s) => ({ success: true, quien: s.userId }));
  const ok = await permitido({ sender: { id: 60 } }, {});
  check(ok.success === true && ok.quien === 3,
    'y el handler permitido recibe la sesion como ultimo argumento');

  // Un canal sin paquete exige sesion pero no permiso.
  const soloSesion = sesion.proteger('canal-sin-paquete', async () => ({ success: true }));
  check((await soloSesion({ sender: { id: 60 } })).success === true, 'un canal sin paquete solo exige sesion');
  check((await soloSesion({ sender: { id: 61 } })).success === false, 'pero exige sesion');
}

// ===========================================================================
seccion('4. Autorizacion presencial: dos identidades, no una');
// ===========================================================================
{
  const main = readFileSync(join(raiz, 'electron/main.js'), 'utf8');
  const i = main.indexOf("ipcMain.handle('security:authorize'");
  const handler = i < 0 ? '' : main.slice(i, i + 2600);

  check(i >= 0, 'el canal de autorizacion presencial sigue existiendo');
  check(/performedBy/.test(handler) && /authorizedBy/.test(handler),
    'devuelve quien opera y quien autoriza');
  check(/sesion\.de\(/.test(handler),
    'quien opera sale de la sesion de la ventana, no del renderer');
  check(/Number\(row\.id\) === Number\(actor\.userId\)/.test(handler),
    'rechaza que la misma persona se autorice a si misma');
  check(/permisos\.permisosDeRol\(/.test(handler) && !/rol === 'supervisor'/.test(handler),
    'decide por paquete, no por rol');

  const sp = readFileSync(join(raiz, 'sql/procedures/security/sp_authorize_supervisor.sql'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
  check(!/rol\s+IN\s*\(/i.test(sp), 'el procedimiento ya no congela el modelo de roles en SQL');
  check(/HASHBYTES\('SHA2_256'/.test(sp), 'y sigue validando la contrasena contra la base');
}

// ===========================================================================
seccion('5. La interfaz pregunta lo mismo que autoriza el proceso principal');
// ===========================================================================
{
  const auth = readFileSync(join(raiz, 'src/services/auth.service.ts'), 'utf8');

  /* El renderer lleva una copia de los nombres de paquete para poder escribirlos
     en las plantillas. Una copia que se separe del original es peor que no
     tenerla: la interfaz ofreceria cosas que el backend rechaza, o esconderia
     cosas que si se permiten. De ahi esta comprobacion. */
  const copiados = [...auth.matchAll(/^\s{2}([A-Z_]+):\s*'([A-Z_]+)',$/gm)].map(m => m[2]);
  check(copiados.length === permisos.PERMISOS.length
     && permisos.PERMISOS.every(p => copiados.includes(p)),
    'la copia de los paquetes en el renderer no se separo del catalogo',
    copiados.join(' ') || '(no se encontro PAQUETES)');

  /* Y no recalcula permisos a partir del rol: los recibe ya calculados. */
  check(!/rol === 'supervisor'|rol === 'cajero'/.test(auth),
    'el renderer no deduce permisos del nombre del rol');
  check(/auth:sesion|api\?\.sesion/.test(auth),
    'los pide al proceso principal');

  /* EL MENU SE MUDO AL DOCK.
     El rail lateral ya no existe: la navegacion vive en `wx-dock`, y ahi se
     DECLARA como datos en vez de como marcado. Lo que esta prueba protege no
     cambia ni un apice -que lo que se ofrece salga del paquete que exige la
     operacion, y no del nombre del rol-, solo cambia el archivo donde mirar. */
  const menu = readFileSync(join(raiz, 'src/app/wx-dock/wx-dock.component.ts'), 'utf8');
  check(!/auth\.esAdmin/.test(menu),
    'el menu ya no se dibuja preguntando si es administrador',
    'eso dejaba al Encargado sin inventario, sin compras y sin el corte del dia');

  for (const g of ['verNumeros', 'supervisarVentas', 'operarVentas',
                   'operarInventario', 'administrarNegocio']) {
    check(menu.includes(`get ${g}(`) && menu.includes(`this.${g}`),
      `el menu pregunta por ${g}`);
  }
  /* El rol se sigue escribiendo en la cabecera del panel, junto al nombre del
     negocio: eso no era navegacion y no se mudo al dock. */
  const tablero = readFileSync(join(raiz, 'src/dashboard/dashboard.ts'), 'utf8');
  check(/rolEtiqueta\(\)/.test(tablero),
    'y el rol se escribe con la etiqueta del catalogo, no con un ternario');

  /* La autorizacion presencial manda el CANAL, no el paquete: asi no hay dos
     sitios donde decidir que exige cada operacion. */
  const sup = readFileSync(join(raiz, 'src/services/supervisor.service.ts'), 'utf8');
  check(/canal,/.test(sup) && /performedBy/.test(sup) && /authorizedBy/.test(sup),
    'la autorizacion presencial manda el canal y registra las dos identidades');
  check(!/this\.auth\.esAdmin/.test(sup),
    'y ya no se salta el candado por ser administrador, sino por tener el paquete');

  /*
   * CERRAR SESION TIENE QUE CERRAR LA SESION.
   *
   * El boton del rail solo navegaba a `/login`. La sesion seguia abierta en el
   * proceso principal -que es quien autoriza-, asi que quien llegara despues a
   * esa ventana heredaba los permisos del anterior sin identificarse, y un
   * canal sensible invocado desde la consola se ejecutaba con ellos.
   *
   * `auth.salir()` ya existia y hacia lo correcto. No la llamaba nadie.
   */
  /* El boton se mudo del dock a la cabecera del panel: la barra de trabajo es
     para navegar, y quien ha entrado es contexto. La comprobacion sigue siendo
     la misma, en el archivo donde ahora vive. */
  const carcasa = readFileSync(join(raiz, 'src/dashboard/dashboard.ts'), 'utf8');
  check(/await this\.auth\.salir\(\)/.test(carcasa),
    'cerrar sesion avisa al proceso principal, no solo cambia de pantalla',
    'si no, la ventana se queda con los permisos del anterior');
  check(/async salir\(\)/.test(auth) && /api\?\.cerrarSesion\?\.\(\)/.test(auth),
    'y el servicio lo pide por su canal');

  const cajon = readFileSync(join(raiz, 'src/venta/appCajon/abrirCajon.ts'), 'utf8');
  check(/'open-cash-drawer', PAQUETES\.VENTAS_SUPERVISAR/.test(cajon),
    'abrir el cajon sin venta pide el paquete de supervision');
  const venta = readFileSync(join(raiz, 'src/venta/appVenta/venta.ts'), 'utf8');
  check(/'sp-refund-sale', PAQUETES\.VENTAS_SUPERVISAR/.test(venta),
    'y devolver, tambien');
}

// ===========================================================================
console.log(`\n${fallos === 0 ? 'TODO BIEN' : 'HAY FALLOS'} · ${pasos - fallos}/${pasos}`);
process.exit(fallos === 0 ? 0 : 1);
