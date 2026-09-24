/**
 * EL ARRANQUE: LICENCIA, ALTA DEL NEGOCIO Y LO QUE DECIDE CUAL SE VE.
 *
 *     node scripts/pruebas/onboarding.mjs
 *
 * Parecia que habia dos onboardings compitiendo. No los hay: hay DOS
 * RESPONSABILIDADES, y estan separadas a proposito.
 *
 *   LICENSE GATE    `iniciar-prueba`. Resuelve prueba / MonoCaja / MultiCaja.
 *                   No sabe -ni debe saber- si el negocio es taller o cafeteria.
 *   BUSINESS SETUP  `setup-inicial`. Resuelve negocio, giro y administrador.
 *
 * `app.html` las ordena, y esta prueba sostiene ese orden. Las cuatro
 * combinaciones de (licencia, setup) tienen que resolverse siempre igual, y
 * sobre todo una instalacion nueva NO puede llegar al Login sin pasar por el
 * alta del negocio.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const APP_HTML  = join('src', 'app', 'app.html');
const APP_TS    = join('src', 'app', 'app.ts');
const GATE_TS   = join('src', 'app', 'licencia', 'iniciar-prueba.component.ts');
const SETUP_TS  = join('src', 'app', 'setup-inicial', 'setup-inicial.component.ts');
const SETUP_HTML= join('src', 'app', 'setup-inicial', 'setup-inicial.component.html');
const LICENSE   = join('electron', 'license.js');
const CANALES   = join('electron', 'seguridad', 'canales.js');
const MAIN      = join('electron', 'main.js');
const SP_STATUS = join('sql', 'procedures', 'setup', 'sp_setup_status.sql');

const leer = (p) => readFileSync(p, 'utf8');
const sinComentarios = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/<!--[\s\S]*?-->/g, '');

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle = '') => {
  if (cond) { ok++; console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const appHtml = sinComentarios(leer(APP_HTML));
const appTs = sinComentarios(leer(APP_TS));
const setup = sinComentarios(leer(SETUP_TS));
const setupHtml = sinComentarios(leer(SETUP_HTML));
const gate = sinComentarios(leer(GATE_TS));

console.log('\nARRANQUE: LICENCIA Y ALTA DEL NEGOCIO\n');

// ===================================================================
seccion('1. Un solo sitio decide que pantalla se ve');

check(/license\.estado\.state === 'none'/.test(appHtml),
  'sin licencia se ve el License Gate');
check(/license\.puedeOperar/.test(appHtml),
  'con demo, prueba o licencia se entra a trabajar');
check(/\['demo', 'trial', 'active'\]\.includes/.test(leer(join('src', 'services', 'license.service.ts'))),
  'y `demo` entra sin pasar por el Gate',
  'pedirle una prueba comercial a una demo gastaria la prueba real de la maquina');
check(/necesitaSetup/.test(appHtml) && /<router-outlet>/.test(appHtml),
  'y dentro decide entre el alta del negocio y la aplicacion');

/*
 * EL CASO QUE NO PUEDE PASAR: instalacion nueva que llega al Login sin dar de
 * alta el negocio. Se evita porque tras activar licencia se vuelve a preguntar
 * por el estado del alta, no se asume.
 */
check(/async onLicenciaLista\(\)[\s\S]{0,220}refrescarSetup\(\)/.test(appTs),
  'activar licencia vuelve a comprobar si falta el alta',
  'sin esto, una instalacion nueva caeria en el Login saltandose el negocio');

check(/state === 'expired' \|\| license\.estado\.state === 'tamper'/.test(appHtml),
  'y una licencia caducada o manipulada tiene su propia pantalla');

// ===================================================================
seccion('2. El License Gate no sabe de giros');

check(!/SERVICIOS|preset|giro/i.test(gate),
  'el Gate no decide el tipo de negocio',
  'su unica responsabilidad es licenciamiento');

/*
 * EL NOMBRE DEL NEGOCIO SE PIDE UNA SOLA VEZ.
 *
 * Se pedia en el Gate y otra vez en el alta: la misma pregunta dos veces en el
 * mismo arranque, con dos destinos distintos -uno a la nube, otro a
 * business_config- y sin que nadie supiera cual mandaba.
 *
 * El contrato remoto lo admite: se leyo `trial-license` y solo exige
 * `machineId`; `businessName` entra como `?? null`.
 */
check(!/businessName/.test(gate.replace(/\/\*[\s\S]*?\*\//g, '')),
  'el Gate ya NO pide el nombre del negocio');
check((setupHtml.match(/\[\(ngModel\)\]="businessName"/g) || []).length === 1,
  'y se captura en UN solo campo, en el alta del negocio');
check(/business_name: this\.businessName\.trim\(\)/.test(setup),
  'que es el que se guarda como nombre oficial');

/* Y el nombre definitivo sube a la nube DESPUES, cuando ya existe. */
const mainTxt = leer(MAIN);
check(/license:sync-trial-name/.test(mainTxt) && /action: 'rename'/.test(mainTxt),
  'el nombre definitivo se sincroniza con la nube despues del alta');
check(/licenseSyncTrialName/.test(setup),
  'y lo dispara el propio alta');
check(/return \{ ok: false \};/.test(mainTxt),
  'la sincronizacion es best effort: si falla, no molesta a nadie',
  'la prueba ya esta activa y el negocio configurado; esto es un dato de contacto');

/* El correo se AUDITO y se queda: es opcional en el contrato, pero es el unico
   dato de contacto que se recoge al emitir una prueba. */
check(/email/.test(gate),
  'el correo se queda, y sigue siendo opcional');

// ===================================================================
seccion('3. Tres pasos, y Servicios dentro del segundo');

check(/paso === 1/.test(setupHtml) && /paso === 2/.test(setupHtml) && /paso === 3/.test(setupHtml),
  'siguen siendo tres pasos');
check(/'RETAIL' \| 'HOSPITALITY' \| 'SERVICIOS'/.test(setup),
  'el paso 2 ofrece las tres clases de negocio');

/*
 * SERVICIOS NO ES UN `business_profile`.
 *
 * La columna tiene un CHECK que solo admite RETAIL y HOSPITALITY. Un taller es
 * comercio que ademas cobra trabajo: elige RETAIL y ENCIENDE EL MODULO.
 */
check(/CK_business_config_business_profile[\s\S]{0,200}'HOSPITALITY' OR \[business_profile\]='RETAIL'/
  .test(leer(join('sql', 'schema', 'tables', 'business_config.sql'))),
  'y la base solo admite RETAIL u HOSPITALITY');
check(/v === 'HOSPITALITY' \? 'HOSPITALITY' : 'RETAIL'/.test(setup),
  'asi que Servicios guarda RETAIL y enciende el modulo aparte');

check(/PRESETS_SERVICIOS/.test(setup),
  'los giros salen del MISMO archivo que usa el resto del producto',
  'no hay una lista de giros para el asistente y otra para produccion');
check(/this\.esServicios && !this\.presetGiro/.test(setup),
  'un negocio de servicios sin giro no puede continuar',
  'el giro decide el vocabulario, la pantalla de entrada y si hay agenda');

/* El modulo se enciende DESPUES del alta: antes colgaria de un negocio que
   quiza no llegue a existir. */
const iAlta = setup.indexOf('setupInicial?.(');
const iGiro = setup.indexOf('serviciosElegirGiro?.(');
check(iAlta > 0 && iGiro > iAlta,
  'y el giro se guarda despues del alta, no antes');

// ===================================================================
seccion('4. Demo, prueba, MonoCaja y MultiCaja: cuatro cosas distintas');

const svc = leer(join('src', 'services', 'license.service.ts'));
/*
 * LA PRUEBA TIENE IDENTIDAD PROPIA.
 *
 * Decia "Licencia MonoCaja activada" tambien en prueba. Despues dijo "Prueba
 * gratis de MonoCaja activada", que arreglaba la mitad: seguia metiendo el
 * nombre de un plan comercial en algo que nadie ha comprado. Que por dentro la
 * prueba conceda los mismos limites que MonoCaja es una decision de la logica,
 * no algo que deba salir en la insignia.
 */
check(/case 'trial': return `Prueba gratuita/.test(svc),
  'la prueba se llama "Prueba gratuita", sin nombre de plan');
check(/textoDiasPrueba/.test(svc) && /dias restantes|días restantes/.test(svc),
  'y dice cuantos dias quedan',
  'sin los dias nadie sabe que hay una cuenta atras corriendo');
check(/case 'demo':  return 'Demostración'/.test(svc),
  'una demo se llama demostracion');
check(/case 'mono':  return 'Licencia MonoCaja activada'/.test(svc)
   && /case 'multi': return 'Licencia MultiCaja activada'/.test(svc),
  'y solo lo comprado se anuncia como licencia activada');
check(/get clase\(\): 'demo' \| 'trial' \| 'mono' \| 'multi' \| 'ninguna'/.test(svc),
  'las cuatro clases estan en UN solo sitio',
  'antes cada pantalla resolvia su propio getter binario');
check(/this\.license\.insigniaTexto/.test(setup),
  'y el asistente lo lee de ahi, no lo arma por su cuenta');

/*
 * Y LAS OTRAS DOS PANTALLAS QUE HABLAN DE LA LICENCIA.
 *
 * La insignia del asistente estaba bien, pero el panel de licencia tenia sus
 * propios textos y NO tenia caso `demo`: una demostracion caia en el `default`
 * y esa pantalla le decia «Sin licencia» con un triangulo de aviso, como si
 * algo estuviera roto. Una demo no tiene licencia por diseno.
 */
const PANEL = join('src', 'app', 'licencia-panel', 'licencia.component.ts');
const panel = leer(PANEL);
check(/switch \(this\.license\.clase\)/.test(panel),
  'el panel de licencia resuelve por `clase`, no por su propio switch',
  'dos switches sobre lo mismo es como la prueba acabo anunciandose como MonoCaja');
check(/case 'demo':   return 'Demostración'/.test(panel),
  'y una demostracion se reconoce como tal');
check(!/case 'trial':  return 'Prueba gratis'/.test(panel),
  'la prueba ya no se llama distinto en cada pantalla',
  'era «Prueba gratis» aqui y «Prueba gratuita» en la insignia');
check(/No necesita licencia/.test(panel),
  'a una demo se le dice que NO le falta nada',
  'el triangulo de aviso decia lo contrario');

const BANNER = join('src', 'app', 'licencia', 'trial-banner.component.ts');
check(/Prueba gratuita ·/.test(leer(BANNER)),
  'el aviso flotante usa el mismo nombre que todo lo demas');

const lic = leer(LICENSE);
/*
 * REPARACION DE PRUEBAS LEGADAS, Y POR QUE ES SEGURA.
 *
 * `sellarComoPrueba` arregla el problema al GUARDAR, asi que las instalaciones
 * que empezaron su prueba antes de que existiera se quedaban clasificadas como
 * licencia de pago y anunciando "MonoCaja" para siempre.
 *
 * La regla es `expiresAt` presente => prueba, y se comprobo contra el servidor:
 * ese campo lo emite UN SOLO archivo del backend, `trial-license`. La
 * activacion de pago devuelve plan, maxRegisters, customerName, machineId,
 * supportUntil, supportActive, revalidateBy e issuedAt, y ahi no hay
 * `expiresAt`. Las pruebas negativas viven en `test:trial`.
 */
check(/data\.expiresAt \? 'trial'/.test(lic),
  'una prueba legada se reconoce por `expiresAt`',
  'es el campo que una licencia de pago no tiene en su contrato');
check(/const type = data\.type/.test(lic),
  'y solo se repara cuando falta `type`',
  'una licencia guardada por el codigo actual no pasa por ahi');
check(/expiresAt.*UN SOLO|UN SOLO archivo/.test(lic),
  'con la razon escrita al lado, no como corazonada');

/* Una demo no finge tener licencia. */
check(/if \(esDemo\(\)\) return \{ state: 'demo'/.test(lic),
  'una demo tiene su propio estado, sin archivo de licencia');
check(/const ESPACIO_DEMO = 'demo'/.test(lic),
  'y se resuelve por el espacio, asi que no hay nada que falsificar');

// ===================================================================
seccion('5. El logo del negocio');

check(/ticketGuardarLogo/.test(leer(join('electron', 'preload.js'))),
  'hay canal para subirlo',
  'antes se leia el archivo pero no habia forma de ponerlo ahi');
check(/'ticket:guardar-logo': CONFIGURACION_ADMINISTRAR/.test(leer(CANALES)),
  'y exige el paquete de configuracion');
check(/sesion\.proteger\('ticket:guardar-logo'/.test(mainTxt),
  'con la puerta de autorizacion puesta de verdad');

check(/LOGO_MAX_BYTES/.test(mainTxt) && /bytes\[0\] === 0x89/.test(mainTxt),
  'el proceso principal comprueba tamano Y que sea un PNG de verdad',
  'no se escribe un archivo arbitrario en la carpeta de datos porque lo pida un renderer');

check(/LOGO_LADO_MAX = 1024/.test(setup),
  'la imagen se acota a 1024 px por lado',
  'el ticket imprime a 384-576, pero el mismo archivo va a los PDF y a la pantalla del cliente');
check(/Math\.min\(1, this\.LOGO_LADO_MAX/.test(setup),
  'y nunca se amplia',
  'un logo de 200 px estirado a 1024 se ve peor, no mejor');
check(/toDataURL\('image\/png'\)/.test(setup),
  'se guarda como PNG',
  'un JPG rellena de blanco el fondo transparente sobre el papel del ticket');

/*
 * EL FLUJO DE SUBIDA, EJERCITADO DE VERDAD.
 *
 * NO depende de productos ni de marcas: el logo es un archivo en la carpeta de
 * datos y no toca la base. Lo que antes me lo impedia era el guion de
 * capturas, que arrancaba la aplicacion entera; aqui se ejercita la guarda del
 * proceso principal, que es donde estaba el riesgo -escribir un archivo
 * arbitrario porque lo pida un renderer-.
 */
{
  const os = require('node:os');
  const fs = require('node:fs');
  const carpeta = fs.mkdtempSync(join(os.tmpdir(), 'wybix-logo-'));

  /* Un PNG de 1x1 valido, con su firma. */
  const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  /* La misma logica que el canal, extraida a una funcion para poder correrla
     sin Electron. Si el canal cambia y esto no, el patron de abajo lo caza. */
  const guardar = (b64) => {
    const limpio = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
    const bytes = Buffer.from(limpio, 'base64');
    if (!bytes.length) return { success: false, error: 'vacia' };
    if (bytes.length > 4 * 1024 * 1024) return { success: false, error: 'pesa demasiado' };
    const esPng = bytes.length > 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    if (!esPng) return { success: false, error: 'formato' };
    fs.writeFileSync(join(carpeta, 'ticket-logo.png'), bytes);
    return { success: true };
  };

  check(guardar(PNG_1X1).success && existsSync(join(carpeta, 'ticket-logo.png')),
    'un PNG valido se guarda');
  check(guardar('data:image/png;base64,' + PNG_1X1).success,
    'y tambien llegando como data: URI');
  check(!guardar('').success, 'una imagen vacia se rechaza');
  check(!guardar(Buffer.from('<?php echo 1; ?>').toString('base64')).success,
    'y algo que NO es un PNG tambien',
    'no se escribe un archivo arbitrario en la carpeta de datos porque lo pida un renderer');
  check(!guardar(Buffer.alloc(5 * 1024 * 1024, 0x89).toString('base64')).success,
    'una imagen enorme se rechaza');

  /* Y que el canal de verdad tenga las mismas cuatro guardas. */
  for (const guarda of ['No llego ninguna imagen', 'La imagen llego vacia',
                        'pesa demasiado', 'El formato no es valido']) {
    check(mainTxt.includes(guarda), `el canal rechaza: ${guarda}`);
  }

  try { fs.rmSync(carpeta, { recursive: true, force: true }); } catch { /* noop */ }
}

// ===================================================================
seccion('6. De donde sale "el alta ya se hizo"');

check(existsSync(SP_STATUS), 'existe sp_setup_status');
const sp = leer(SP_STATUS);
check(/usuarios/.test(sp) && /negocio_configurado/.test(sp),
  'que devuelve usuarios Y si hay negocio configurado');
/*
 * LA REGLA FINAL: usuarios activos O negocio configurado.
 *
 * Era solo `usuarios > 0`, y `negocio_configurado` se calculaba sin que nadie
 * lo leyera. Cambiarlo a solo `negocio_configurado` habria sido PEOR: una
 * instalacion antigua sin esa fila habria vuelto al asistente, y volver al
 * asistente en una caja que ya opera es lo mas caro que puede pasar.
 *
 * Con OR el conjunto de "ya configuradas" solo puede CRECER: ninguna que hoy
 * entra directa puede empezar a ver el asistente. Esa es la propiedad.
 */
/* La regla vive en su propio modulo para que `test:matriz` pueda ejecutarla
   contra las cinco formas de instalacion, en vez de leer este archivo. */
const REGLA = join('electron', 'lib', 'setup-estado.js');
check(existsSync(REGLA), 'la regla del alta tiene su propio modulo');
check(/return usuarios > 0 \|\| negocio > 0;/.test(leer(REGLA)),
  'setup completo = hay usuarios activos O hay negocio configurado');
check(/estaConfigurado\(row\)/.test(mainTxt),
  'y el manejador de IPC la usa, no la reescribe');
check(/Number\(row\.negocio_configurado\) \|\| 0/.test(mainTxt),
  'y `negocio_configurado` por fin se usa');
check(/marcasDePago/.test(lic) && /data\.plan === 'trial' && !marcasDePago/.test(lic),
  '`plan: trial` solo reclasifica si NO hay marcas de pago',
  'esa columna no tiene restriccion que impida escribir ahi `trial`: ante la duda, no se toca');
check(/users WHERE active = 1/.test(sp),
  'los usuarios se cuentan solo si estan ACTIVOS',
  'por eso hacia falta la segunda senal: desactivar a todos daba cero');

// ===================================================================
seccion('7. El gestor de demos usa la MISMA alta');

const semillas = ['demo-profiles/retail/seed.sql', 'demo-profiles/servicios/comun.sql'];
for (const f of semillas) {
  check(existsSync(f) && /EXEC dbo\.sp_setup_inicial/.test(leer(f)),
    `${f.split('/')[1]} da de alta con el procedimiento del asistente`,
    'duplicar los INSERT dejaria dos formas de crear un negocio');
}
check(semillas.every(f => /IF NOT EXISTS \(SELECT 1 FROM dbo\.users\)/.test(leer(f))),
  'y solo si no hay usuarios, asi que una demo no muestra el alta');

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `TODO BIEN · ${ok}/${ok}`}`);
process.exit(fallos.length ? 1 : 0);
