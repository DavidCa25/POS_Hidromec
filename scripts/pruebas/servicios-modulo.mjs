/**
 * EL MODULO SERVICIOS, DEL LADO DEL PRODUCTO.
 *
 *     node scripts/pruebas/servicios-modulo.mjs
 *
 * La aritmetica y las reglas de negocio se prueban contra SQL Server en
 * `scripts/db/pruebas/servicios.mjs`. Aqui se congela lo que esa prueba no
 * puede ver: como esta cableado el modulo dentro de Wybix.
 *
 * LO QUE SE PROTEGE
 * -----------------
 *   - el prefijo de canal es `servicios:` y NO `services:`, que ya significa
 *     los servicios de Windows del panel de red;
 *   - cada escritura exige paquete Y modulo, que son dos preguntas distintas;
 *   - el usuario de cada operacion sale de la SESION, no del payload;
 *   - el modulo convive con Retail y con Hospitality, no los sustituye;
 *   - la pantalla no recalcula totales: los pide;
 *   - el testigo de version viaja en cada guardado de orden.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const raiz = process.cwd();
const leer = (...p) => readFileSync(join(raiz, ...p), 'utf8');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const canales = require(join(raiz, 'electron/seguridad/canales.js'));
const permisos = require(join(raiz, 'electron/seguridad/permisos.js'));
const ipc = leer('electron', 'ipc', 'servicios.js');
const preload = leer('electron', 'preload.js');

/**
 * Cada handler del IPC, recortado hasta donde empieza el siguiente.
 *
 * Con una ventana de tamano fijo -`slice(i, i + 2200)`- el texto de un handler
 * se metia en el del de al lado. Eso da falsos positivos, que se ven, y falsos
 * NEGATIVOS, que no: una comprobacion pasaba porque encontraba en el vecino lo
 * que faltaba en el propio.
 */
const handlers = [...ipc.matchAll(/ipcMain\.handle\('([a-z:-]+)'/g)]
  .map((m, i, todos) => ({
    canal: m[1],
    cuerpo: ipc.slice(m.index, todos[i + 1]?.index ?? ipc.length),
  }));
const cuerpoDe = (canal) => handlers.find(h => h.canal === canal)?.cuerpo ?? '';

// ===========================================================================
seccion('1. El prefijo de canal no choca con lo que ya existia');
// ===========================================================================

/* `services:` YA significa otra cosa: los servicios de WINDOWS que el panel de
   red arranca y para para SQL Server. Reutilizarlo habria puesto dos cosas sin
   relacion en la misma familia, y el dia que alguien filtrara por `services:`
   se llevaria las dos. */
const mios = Object.keys({ ...canales.EXIGE, ...canales.ABIERTOS })
  .filter(c => c.startsWith('servicios:'));
check(mios.length >= 25, 'el modulo declara sus canales con prefijo `servicios:`',
  `${mios.length} canales`);

const deWindows = Object.keys({ ...canales.EXIGE, ...canales.ABIERTOS })
  .filter(c => c.startsWith('services:'));
check(deWindows.length > 0 && deWindows.every(c => !c.startsWith('servicios')),
  'y `services:` sigue siendo el de los servicios de Windows',
  deWindows.join(' '));
check(!mios.some(c => /^servicios:(operate|set-config|clear|validate|get-config)$/.test(c)),
  'ningun canal del modulo se confunde con uno del panel de red');

// ===========================================================================
seccion('2. Cada escritura exige paquete Y modulo');
// ===========================================================================

/* Son dos preguntas distintas: "¿esta persona puede?" y "¿el negocio tiene
   esta funcion?". Un Administrador de un negocio sin Servicios encendido no
   puede abrir una orden, y eso no es un fallo de permisos. */
const protegidos = mios.filter(c => canales.EXIGE[c]);
check(protegidos.length >= 23, 'las escrituras del modulo estan protegidas',
  `${protegidos.length} de ${mios.length}`);

/* El handler declara `CON_MODULO` como tercer argumento de `proteger`. */
const sinModulo = protegidos.filter(c => !cuerpoDe(c).includes('CON_MODULO'));
check(sinModulo.length === 0,
  'y ademas exigen que el modulo este encendido', sinModulo.join(' ') || 'todas');

check(/const CON_MODULO = \{ modulo: 'servicios' \}/.test(ipc),
  'la capacidad se pide por su clave del registro, no por el perfil del negocio');

// ---------------------------------------------------- el reparto de paquetes
const B = permisos.BUNDLES;
const esperado = {
  'servicios:orden-crear': B.SERVICIOS_OPERAR,
  'servicios:linea-agregar': B.SERVICIOS_OPERAR,
  'servicios:cita-guardar': B.SERVICIOS_OPERAR,
  'servicios:guardar-servicio': B.SERVICIOS_ADMINISTRAR,
  'servicios:guardar-profesional': B.SERVICIOS_ADMINISTRAR,
  'servicios:comisiones': B.REPORTES_VER,
};
for (const [canal, paquete] of Object.entries(esperado)) {
  check(canales.EXIGE[canal] === paquete, `${canal} exige ${paquete}`,
    canales.EXIGE[canal] || '(sin clasificar)');
}

/* El septimo paquete existe exactamente para esto: un Encargado da de alta un
   servicio sin recibir de paso los respaldos y la configuracion fiscal. */
const delEncargado = permisos.permisosDeRol('supervisor');
check(delEncargado.has(B.SERVICIOS_ADMINISTRAR) && !delEncargado.has(B.CONFIGURACION_ADMINISTRAR),
  'un Encargado administra Servicios sin administrar el negocio');
const delOperador = permisos.permisosDeRol('cajero');
check(delOperador.has(B.SERVICIOS_OPERAR) && !delOperador.has(B.SERVICIOS_ADMINISTRAR),
  'y un Operador opera Servicios sin poder cambiar el catalogo');

// ===========================================================================
seccion('3. Quien hace la operacion sale de la sesion, no del payload');
// ===========================================================================

/* El renderer no puede decir que la orden la abrio otra persona. Lo mismo que
   en la autorizacion presencial: el actor sale de la ventana. */
const conUsuario = [
  'servicios:orden-crear', 'servicios:orden-actualizar', 'servicios:orden-estado',
  'servicios:orden-autorizar', 'servicios:orden-cancelar',
  'servicios:linea-agregar', 'servicios:linea-actualizar',
  'servicios:cita-guardar', 'servicios:cita-a-orden',
];
const malos = conUsuario.filter(c => !/user_id', sql\.Int, s\?\.userId/.test(cuerpoDe(c)));
check(malos.length === 0,
  'el user_id de cada operacion viene de la sesion', malos.join(' ') || 'todos');
/*
 * Hay UNA excepcion, y conviene decirla en vez de aflojar la regla.
 *
 * En `guardar-profesional`, `user_id` NO es quien opera: es el usuario de Wybix
 * con el que se enlaza esa persona. Es un dato del negocio -como su telefono-,
 * no una identidad que el renderer declare. Cualquier otro canal que tome el
 * usuario del payload si seria el problema que esta seccion vigila.
 */
const delPayload = handlers
  .filter(h => /user_id', sql\.Int, num\(p\./.test(h.cuerpo))
  .map(h => h.canal);
check(delPayload.length === 1 && delPayload[0] === 'servicios:guardar-profesional',
  'y el unico que lo toma del payload es el enlace con un usuario',
  delPayload.join(' ') || 'ninguno');

// ===========================================================================
seccion('4. El modulo se SUMA, no sustituye');
// ===========================================================================

const caps = leer('src', 'core', 'capability.service.ts');
check(/servicios: this\.modulos\(\)\.has\('servicios'\)/.test(caps),
  'la capacidad sale del registro de modulos');
check(!/businessProfile === 'SERVICIOS'|profile === 'SERVICIOS'/.test(caps),
  'y NO de un perfil de negocio nuevo',
  'los perfiles se excluyen entre si; un taller es Retail + Servicios');

const modulos = leer('src', 'core', 'modulos.ts');
check(/id: 'servicios'/.test(modulos) && /capability: 'servicios'/.test(modulos),
  'esta en el catalogo de Aplicaciones, que es desde donde se enciende');

const ddl = leer('sql', 'schema', 'changes', '0031_servicios.sql');
check(/VALUES \('servicios', 0, SYSDATETIME\(\)\)/.test(ddl),
  'y la migracion lo registra APAGADO',
  'una instalacion que actualiza no despierta con un modulo que nadie pidio');

// ===========================================================================
seccion('5. Un servicio es un producto');
// ===========================================================================

const sp = leer('sql', 'procedures', 'servicios', 'sp_service_save.sql');
check(/INSERT INTO dbo\.products/.test(sp),
  'dar de alta un servicio escribe en products');
check(/inventory_mode = 'NONE'/.test(sp),
  'y lo deja sin existencias, venga de donde venga',
  'cobrar una hora de trabajo no puede restar piezas de un almacen');
check(/@product_id IS NULL/.test(sp) && /ELSE\s+BEGIN/.test(sp),
  'y un producto que ya existia se puede convertir en servicio');

const esquema = leer('sql', 'schema', 'changes', '0031_servicios.sql');
check(/CONSTRAINT PK_services PRIMARY KEY CLUSTERED \(product_id\)/.test(esquema)
   && /CONSTRAINT FK_services_product FOREIGN KEY \(product_id\)/.test(esquema),
  'la relacion 1 a 1 la dice el esquema, no una convencion');
check(!/price\s+DECIMAL/.test(esquema.slice(esquema.indexOf('CREATE TABLE dbo.services'),
                                            esquema.indexOf('END;'))),
  'y `services` no duplica el precio',
  'dos copias obligan a elegir cual creer el dia que difieran');

// ===========================================================================
seccion('6. El estado economico no se guarda: se deriva');
// ===========================================================================

check(!/economic_status\s+NVARCHAR|paid\s+BIT|pagada\s+BIT/i.test(esquema),
  'no hay ninguna columna que diga si esta pagada');
const get = leer('sql', 'procedures', 'servicios', 'sp_service_order_get.sql');
check(/CASE WHEN o\.sale_id IS NULL THEN 'SIN_COBRAR'/.test(get),
  'se calcula al leer, contra la venta enlazada',
  'un abono en otra caja no puede dejarlo mintiendo');
check(/quote_version > o\.authorized_version/.test(get),
  'y la reautorizacion es una comparacion, no un estado guardado');

// ===========================================================================
seccion('7. La pantalla pide, no calcula');
// ===========================================================================

const servicio = leer('src', 'modulo-servicios', 'servicios.service.ts');
check(/private conTestigo\(p: any\)/.test(servicio),
  'el testigo de version se pone en un solo sitio',
  'olvidarlo en una pantalla bastaria para perder el diagnostico de alguien');
const conTestigo = ['actualizarOrden', 'cambiarEstado', 'autorizar', 'cancelarOrden'];
for (const m of conTestigo) {
  const i = servicio.indexOf(`async ${m}(`);
  check(i > 0 && servicio.slice(i, i + 400).includes('conTestigo'),
    `${m} lo manda`);
}

const orden = leer('src', 'modulo-servicios', 'orden', 'orden.component.ts');
check(/CONFLICTO_DE_VERSION/.test(orden),
  'el conflicto de version se explica y se ofrece recargar',
  'reintentar en silencio seria justo lo que el testigo existe para impedir');
check(!/reduce\(\(s[^)]*\) => s \+ [^)]*line_total/.test(orden),
  'y los totales no se recalculan en el renderer',
  'con dos personas en la misma orden, esa cuenta estaria mal la mitad del tiempo');

// ===========================================================================
seccion('8. Las pantallas preguntan por su paquete');
// ===========================================================================

const shell = leer('src', 'modulo-servicios', 'servicios-shell.component.ts');
check(/SERVICIOS_ADMINISTRAR/.test(shell) && /REPORTES_VER/.test(shell),
  'la carcasa esconde lo que esta persona no puede usar');
const guard = leer('src', 'app', 'servicios.guard.ts');
check(/caps\.servicios/.test(guard) && /SERVICIOS_OPERAR/.test(guard),
  'el guard pregunta por la capacidad Y por el permiso');
check(/await caps\.load\(\)/.test(guard),
  'y lo comprueba en cada navegacion',
  'apagar el modulo desde otra caja surte efecto sin cerrar sesion');

const rail = leer('src', 'dashboard', 'dashboard.html');
check(/operarServicios && caps\.servicios/.test(rail),
  'la entrada del menu tambien');
check((rail.match(/routerLink="\/dashboard\/ordenes-de-servicio"/g) || []).length === 1,
  'y es UNA sola entrada, no cinco',
  'el rail ya tiene dieciocho y cinco mas lo vuelven ilegible');

/* `servicios` YA estaba ocupado por Pago de servicios -recargas y recibos-, que
   lleva tiempo en produccion. Angular resuelve la PRIMERA ruta que coincide, asi
   que reutilizarla habria dejado el modulo nuevo inalcanzable sin que nada
   fallara al compilar. */
const rutas = leer('src', 'app', 'app.routes.ts');
check((rutas.match(/path: 'servicios'/g) || []).length === 1,
  'la ruta `servicios` sigue siendo la de Pago de servicios');
check(/path: 'ordenes-de-servicio'/.test(rutas),
  'y el modulo nuevo vive en su propia ruta');

// ===========================================================================
seccion('9. El modulo se pinta con el color del negocio');
// ===========================================================================

/*
 * Inventario, Compras y Ventas llevan anos pintandose con el color que el
 * cliente eligio. Una pantalla nueva en el cian corporativo de Wybix se siente
 * traida de otro programa, y eso fue justo lo que paso la primera vez.
 *
 * Lo que responde al color: la cabecera de la tabla, la pestana activa, la
 * fila bajo el cursor y el boton principal. Lo que NO: los estados, porque
 * verde es cobrado y ambar es pendiente en todos los negocios, y tenirlos
 * haria que en un taller con acento rojo "todo bien" y "cancelado" se vieran
 * igual.
 */
const hojas = {
  'servicios.css': leer('src', 'modulo-servicios', 'servicios.css'),
  'orden.component.css': leer('src', 'modulo-servicios', 'orden', 'orden.component.css'),
  'agenda.component.css': leer('src', 'modulo-servicios', 'agenda', 'agenda.component.css'),
  'servicios-shell.component.ts': leer('src', 'modulo-servicios', 'servicios-shell.component.ts'),
};

check(/background: var\(--inv-main, var\(--wx-accent\)\)/.test(hojas['servicios.css']),
  'la cabecera de la tabla usa el color del negocio, como la de Compras');
check(/--wx-user-accent-soft/.test(hojas['servicios.css']),
  'la fila bajo el cursor tambien');

/* Ningun acento FIJO sin respaldo al del usuario. La forma correcta siempre
   es `var(--wx-user-accent…, var(--wx-accent…))` o `var(--inv-main, …)`. */
for (const [nombre, css] of Object.entries(hojas)) {
  const fijos = [...css.matchAll(/var\(--wx-(accent[a-z-]*)\)/g)]
    .filter(m => {
      const antes = css.slice(Math.max(0, m.index - 80), m.index);
      /* Vale si es el respaldo de una variable de usuario o de --inv-main. */
      return !/--wx-user-accent[a-z-]*,\s*$/.test(antes)
          && !/--inv-main[a-z-]*,\s*$/.test(antes)
          && !/--wx-cyan-700,\s*$/.test(antes)
          && !/--ag-(color|suave),\s*$/.test(antes);
    })
    .map(m => m[0]);
  check(fijos.length === 0, `${nombre} no usa el acento fijo de Wybix`,
    fijos.join(' ') || 'limpio');
}

/* Y los estados NO se tinen: son los mismos en todos los negocios. */
check(/\.srv-badge--ok \{ background: var\(--wx-success-soft\)/.test(hojas['servicios.css'])
   && /\.srv-badge--warn \{ background: var\(--wx-warning-soft\)/.test(hojas['servicios.css']),
  'pero los estados siguen siendo verde y ambar, no el color del cliente');

// ===========================================================================
seccion('10. La agenda es de columnas por persona');
// ===========================================================================

const agendaTs = leer('src', 'modulo-servicios', 'agenda', 'agenda.component.ts');
const agendaHtml = leer('src', 'modulo-servicios', 'agenda', 'agenda.component.html');

check(/plantillaColumnas\(\)/.test(agendaTs) && /repeat\(\$\{n\}, minmax\(0, 1fr\)\)/.test(agendaTs),
  'una columna por persona, no una lista');
check(/class="ag-col"/.test(agendaHtml) && /ag-bloque/.test(agendaHtml),
  'las citas son bloques colocados, no filas de tabla');

/* La ventana horaria sale de lo que hay: un taller que abre a las nueve no
   scrollea seis horas vacias cada manana. */
check(/private readonly ventana = computed/.test(agendaTs),
  'la ventana horaria se calcula del horario y de lo agendado');

/* Una cita FUERA de horario se permite a proposito; lo que no puede es
   quedarse fuera de la pantalla, porque entonces nadie la ve. */
check(/for \(const c of this\.citas\(\)\)[\s\S]{0,200}minutos\.push/.test(agendaTs),
  'y las citas fuera de horario entran en ella igualmente');

check(/ag-ausencia/.test(agendaHtml) && /repeating-linear-gradient/.test(hojas['agenda.component.css']),
  'las ausencias se rayan: "no esta" no es lo mismo que "no tiene cita"');
check(/professional_color/.test(agendaTs),
  'cada bloque toma el color de SU profesional, que es un dato del negocio');

// ===========================================================================
seccion('11. Cada capacidad tiene una pantalla detras');
// ===========================================================================

/*
 * LA COMPROBACION QUE FALTABA, Y LO QUE COSTO NO TENERLA.
 *
 * `test:ipc` comprueba que el renderer, el preload y el proceso principal se
 * correspondan. Lo que NO comprobaba nadie es el eslabon de arriba: que la
 * capacidad llegue a una PANTALLA.
 *
 * Por ese hueco pasaron dos cosas enteras. `enlazarVenta` existia en SQL, en
 * el IPC y en el servicio de Angular, y ninguna pantalla la llamaba: el boton
 * "Cobrar" navegaba a la venta y la orden no se ataba nunca. Y `guardarActivo`
 * igual: la tabla, el procedimiento y el canal existian, y el coche del
 * cliente no se podia registrar desde la aplicacion.
 *
 * Las dos suites decian "verde" mientras el modulo estaba a medias.
 */
function archivosDe(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) archivosDe(p, acc);
    else if (/\.(ts|html)$/.test(e.name) && !p.includes('servicios.service')) acc.push(p);
  }
  return acc;
}

const servicioTs = leer('src', 'modulo-servicios', 'servicios.service.ts');
const metodos = [...servicioTs.matchAll(/^  async ([a-zA-Z]+)\(/gm)].map(m => m[1]);
const pantallas = archivosDe(join(raiz, 'src')).map(f => readFileSync(f, 'utf8')).join('\n');
const sinPantalla = metodos.filter(m => !pantallas.includes('.' + m + '('));

check(metodos.length >= 30, 'el servicio expone las capacidades del modulo',
  `${metodos.length} metodos`);
check(sinPantalla.length === 0,
  'y ninguna se queda sin una pantalla que la use',
  sinPantalla.join(' ') || 'todas tienen');

/* El cobro, en concreto: es el que estuvo roto y el que mas caro sale. */
const venta = leer('src', 'venta', 'appVenta', 'venta.ts');
check(/queryParamMap\.get\('ordenServicio'\)/.test(venta),
  'la pantalla de venta LEE la orden que se le manda a cobrar',
  'antes se le mandaba por la URL y nadie la leia: se llegaba a una venta vacia');
check(/enlazarOrdenDeServicio\(res\.saleId/.test(venta),
  'y ata la venta a su orden en cuanto se registra');
check((venta.match(/if \(orden\) await this\.enlazarOrdenDeServicio/g) || []).length === 2,
  'por los DOS caminos de cobro: el normal y el de terminal',
  'uno de los dos sin atar deja ordenes cobradas que parecen impagadas');
check(/const orden = this\.ordenServicio;[\s\S]{0,400}await this\.sale\.checkout/.test(venta),
  'y la lee ANTES de cobrar',
  'checkout cierra la cuenta activa: despues ya no hay de donde sacarla');

const ordenTs = leer('src', 'modulo-servicios', 'orden', 'orden.component.ts');
check(/queryParams: \{ ordenServicio: o\.cabecera\.id \}/.test(ordenTs),
  'y la orden es la que la manda');

/* Los activos: la otra mitad que faltaba. */
const activos = leer('src', 'modulo-servicios', 'activos', 'activos.component.ts');
check(/guardarActivo/.test(activos) && /async asistente\(\)/.test(activos),
  'los activos tienen pantalla, con su asistente de vinculacion');
check(/elegirActivo\(/.test(ordenTs),
  'y una orden puede decir sobre que se trabaja',
  'en un taller, una orden sin coche es una orden a medias');

// ===========================================================================
seccion('12. La hora de una franja, venga como venga de SQL');
// ===========================================================================

/*
 * SQL guarda las franjas como TIME(0), y al cruzar el puente llegan con el 1
 * de enero de 1970 pegado delante: "1970-01-01T09:00:00.000Z". Quien esperaba
 * "09:00" y hacia split(':') obtenia NaN, y con un NaN dentro TODA la ventana
 * horaria de la agenda se volvia NaN: los bloques perdian su posicion y se
 * apilaban arriba. La agenda se rompia justo al declarar un horario, que es lo
 * primero que hace un negocio.
 *
 * Y la pantalla de horarios recortaba los cinco primeros caracteres: el campo
 * salia con "1970-" y el horario guardado parecia perdido.
 */
const servicioFuente = leer('src', 'modulo-servicios', 'servicios.service.ts');
const cuerpoHelper = servicioFuente.slice(
  servicioFuente.indexOf('export function horaDeFranja'),
  servicioFuente.indexOf('/** Lo que devuelve cualquier llamada'));

check(cuerpoHelper.length > 0, 'existe un unico sitio que normaliza la hora');

/* Se EJECUTA, no se lee: una comprobacion de texto habria pasado con la
   funcion devolviendo siempre "00:00".
   Se le quitan las anotaciones de tipo, que es lo unico de TypeScript que
   tiene: el cuerpo es JavaScript corriente. */
const enJs = cuerpoHelper
  .replace('export function', 'function')
  .replace(/\(v: unknown\)/, '(v)')
  .replace(/\): string \{/, ') {')
  .replace(/const (\w+): \w+ =/g, 'const $1 =');
const horaDeFranja = new Function(`${enJs}; return horaDeFranja;`)();

const casos = [
  ['1970-01-01T09:00:00.000Z', '09:00', 'lo que manda SQL de verdad'],
  ['1970-01-01T18:30:00.000Z', '18:30', 'con minutos'],
  ['09:00', '09:00', 'lo que manda el formulario'],
  ['9:05', '09:05', 'sin cero delante'],
  ['09:00:00', '09:00', 'con segundos'],
  ['', '00:00', 'vacio'],
  [null, '00:00', 'nulo'],
];
for (const [entrada, esperado, porque] of casos) {
  const dado = horaDeFranja(entrada);
  check(dado === esperado, `${JSON.stringify(entrada)} -> ${esperado}`, `${porque}${dado === esperado ? '' : ' · dio ' + dado}`);
}

/* La zona horaria NO se aplica: lo que hay ahi no es un instante, es una hora
   del reloj de pared. Con getHours(), las nueve de la manana se convertian en
   las tres en Mexico. */
check(/getUTCHours/.test(cuerpoHelper) && !/[^C]getHours/.test(cuerpoHelper),
  'se leen las horas en UTC, no en la zona del equipo',
  'con la zona local, las 09:00 de una franja pasaban a ser las 03:00');

const agendaFuente = leer('src', 'modulo-servicios', 'agenda', 'agenda.component.ts');
const profFuente = leer('src', 'modulo-servicios', 'profesionales', 'profesionales.component.ts');
check(/horaDeFranja/.test(agendaFuente) && /horaDeFranja/.test(profFuente),
  'y las dos pantallas que leen franjas lo usan');
check(!/starts_at\)\.slice\(0, 5\)/.test(profFuente),
  'la pantalla de horarios ya no recorta los cinco primeros caracteres');

// ===========================================================================
seccion('13. Todo el SQL del modulo esta en el catalogo y en la migracion');
// ===========================================================================

const archivos = readdirSync(join(raiz, 'sql', 'procedures', 'servicios'))
  .filter(f => f.endsWith('.sql')).map(f => f.replace(/\.sql$/, ''));
const catalogo = leer('scripts', 'db', 'lib', 'catalogo.mjs');
const faltan = archivos.filter(n => !catalogo.includes(`'${n}'`));
check(faltan.length === 0, 'cada procedimiento esta declarado en el catalogo',
  faltan.join(' ') || `${archivos.length} procedimientos`);

const migracion = leer('electron', 'migrations', '0031_servicios.sql');
const sinMigrar = archivos.filter(n => !migracion.includes(`[${n}]`) && !migracion.includes(`dbo.${n}`));
check(sinMigrar.length === 0, 'y viaja en la migracion 0031',
  sinMigrar.join(' ') || 'todos');
check(!/\nGO\s*\nGO\s*\n/.test(migracion.replace(/\r\n/g, '\n')),
  'la migracion no tiene dos GO seguidos',
  'el runner los parte y SQL Server busca un procedimiento llamado GO');

// ===========================================================================
seccion('14. El modulo recien encendido dice que hacer');
// ===========================================================================

/* Un modulo que se enciende y ensena una tabla vacia no se usa: quien la mira
   no sabe que primero hace falta catalogo. La pantalla de ordenes tiene que
   distinguir los dos vacios -- "todavia no hay nada montado" y "montado pero
   sin trabajo hoy" -- y el primero tiene que llevar a donde se monta. */

const ordFuente = leer('src', 'modulo-servicios', 'ordenes', 'ordenes.component.ts');
check(/sinCatalogo\(\)/.test(ordFuente),
  'la pantalla de ordenes distingue el vacio de primer uso del vacio de hoy');
check(/routerLink="\.\.\/catalogo"/.test(ordFuente) && /routerLink="\.\.\/profesionales"/.test(ordFuente),
  'y los pasos llevan al catalogo y a profesionales');
check(/puedeAdministrar/.test(ordFuente),
  'sin ofrecerle al operador un enlace que no puede abrir',
  'el paquete SERVICIOS_ADMINISTRAR es el que monta el catalogo');
check(/hayCatalogo\(\) === false/.test(ordFuente),
  'y no parpadea entre los dos mensajes mientras carga',
  'el tercer estado (todavia no se sabe) no ensena ninguno de los dos');
check(/\.srv-pasos\b/.test(leer('src', 'modulo-servicios', 'servicios.css')),
  'los pasos tienen estilo propio');

// ===========================================================================
console.log(`\n${fallos === 0 ? 'TODO BIEN' : 'HAY FALLOS'} · ${pasos - fallos}/${pasos}`);
process.exit(fallos === 0 ? 0 : 1);
