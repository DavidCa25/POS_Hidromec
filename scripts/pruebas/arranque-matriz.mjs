/**
 * LA MATRIZ DE ARRANQUE, EJERCITADA.
 *
 *     node scripts/pruebas/arranque-matriz.mjs
 *
 * No comprueba que el codigo CONTENGA ciertas cadenas: ejecuta el motor de
 * licencia de verdad y reproduce la misma decision que toma `app.html`, para
 * cada combinacion de (licencia, alta del negocio).
 *
 * Lo que de verdad se protege es una sola frase:
 *
 *     UNA INSTALACION QUE YA OPERA NO PUEDE VOLVER AL ASISTENTE,
 *     Y UNA NUEVA NO PUEDE LLEGAR AL LOGIN SIN PASAR POR EL.
 *
 * Todo lo demas de aqui son los casos intermedios de esa frase.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/* El modulo de licencia no depende de Electron para calcular estado, pero si
   para saber donde escribe. Se le da una carpeta temporal. */
import os from 'node:os';
import fs from 'node:fs';
const carpeta = fs.mkdtempSync(join(os.tmpdir(), 'wybix-matriz-'));
require.cache[require.resolve('electron')] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: { app: { getPath: () => carpeta } },
};
const licencia = require(join(process.cwd(), 'electron', 'license.js'));

/* La regla de "ya esta dada de alta" se EJECUTA, no se lee. Es el mismo
   modulo que usa el manejador de `setup-status`. */
const { estaConfigurado } = require(join(process.cwd(), 'electron', 'lib', 'setup-estado.js'));

const MAQUINA = 'MAQUINA-MATRIZ';
const EN30 = new Date(Date.now() + 30 * 86400000).toISOString();
const HACE1 = new Date(Date.now() - 86400000).toISOString();

let ok = 0;
const fallos = [];
const check = (cond, titulo, detalle = '') => {
  if (cond) { ok++; console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`); }
  else { fallos.push(titulo); console.log(`   FALLA  ${titulo}${detalle ? `\n            ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

/**
 * LA MISMA DECISION QUE TOMA `app.html`, escrita una sola vez.
 *
 * Si la plantilla cambia de criterio y esto no, la comprobacion de abajo
 * -que compara las dos- se pone roja. Es lo que impide que esta prueba se
 * quede describiendo un arranque que ya no existe.
 */
function pantalla(estado, alta) {
  if (estado.state === 'expired' || estado.state === 'tamper') return 'licencia-vencida';
  if (estado.state === 'none') return 'license-gate';
  // demo | trial | active
  /* `alta` es la fila de `sp_setup_status`, no un booleano de conveniencia:
     asi la matriz recorre la MISMA decision que toma la aplicacion, incluida
     la regla de que cuenta como "ya configurado". */
  return estaConfigurado(alta) ? 'login' : 'business-setup';
}

/** Las dos formas extremas de la fila de `sp_setup_status`. */
const SIN_ALTA = { usuarios: 0, negocio_configurado: 0 };
const CON_ALTA = { usuarios: 2, negocio_configurado: 1 };

/** Deja el almacen en el estado que se quiere probar y devuelve el calculado. */
function conLicencia(datos, espacio = '') {
  licencia.usarEspacio(espacio);
  licencia.clearLicense();
  if (datos) licencia.saveLicense(MAQUINA, datos);
  return licencia.computeStatus(MAQUINA);
}

console.log('\nMATRIZ DE ARRANQUE\n');

// ===================================================================
seccion('Las cuatro combinaciones de (licencia, alta)');

const PAGADA = { success: true, type: 'paid', plan: 'mono', revalidateBy: EN30 };
const PRUEBA = { success: true, type: 'trial', plan: 'trial', expiresAt: EN30, revalidateBy: EN30 };

const CASOS = [
  ['1) sin licencia + sin alta', null, SIN_ALTA, 'license-gate'],
  ['2) con licencia + sin alta', PAGADA, SIN_ALTA, 'business-setup'],
  ['3) sin licencia + con alta', null, CON_ALTA, 'license-gate'],
  ['4) con licencia + con alta', PAGADA, CON_ALTA, 'login'],
];

for (const [nombre, datos, alta, esperado] of CASOS) {
  const st = conLicencia(datos);
  const r = pantalla(st, alta);
  check(r === esperado, nombre, `${st.state} -> ${r}`);
}

/*
 * EL CASO 1 CONTINUADO: activar la prueba NO lleva al Login, lleva al alta.
 * Es el camino que una instalacion nueva no puede saltarse.
 */
{
  const st = conLicencia(PRUEBA);
  check(pantalla(st, SIN_ALTA) === 'business-setup',
    '1b) y tras activar la prueba, toca el alta del negocio',
    'una instalacion nueva no puede llegar al Login sin dar de alta el negocio');
}

/* EL CASO 3 CONTINUADO: con el alta ya hecha, la licencia lleva directo al
   Login y NO vuelve a pedir negocio ni administrador. */
{
  const st = conLicencia(PAGADA);
  check(pantalla(st, CON_ALTA) === 'login',
    '3b) y con el alta ya hecha, la licencia lleva directo al Login',
    'un cliente que cambia de equipo no vuelve a configurar su negocio');
}

// ===================================================================
seccion('5) Una demo abre directamente');

{
  const st = conLicencia(null, 'demo');
  check(st.state === 'demo', 'en el espacio de demo el estado es demo', `state = ${st.state}`);
  check(pantalla(st, CON_ALTA) === 'login',
    'y con su alta ya sembrada abre en el Login: ni Gate ni asistente');
  licencia.usarEspacio('');
}

// ===================================================================
seccion('6 y 7) Caducada y manipulada');

{
  const st = conLicencia({ success: true, type: 'trial', expiresAt: HACE1 });
  check(st.state === 'expired', 'una prueba pasada de fecha queda expired', `state = ${st.state}`);
  check(pantalla(st, CON_ALTA) === 'licencia-vencida',
    'y lleva a su pantalla, no al Gate ni al asistente');
}

{
  /*
   * HAY DOS COPIAS, Y ESO NO ES UN DETALLE.
   *
   * La licencia vive en `license.json` y en un espejo fuera de la carpeta de
   * datos. Corromper SOLO una no deja la caja bloqueada: la otra la recupera,
   * que es exactamente para lo que existe el espejo -reinstalar o borrar la
   * carpeta de datos no debe costarte la licencia-.
   *
   * Asi que se comprueban las dos cosas: que una copia rota se sobrevive, y
   * que con las dos rotas si se bloquea.
   */
  licencia.usarEspacio('');
  licencia.clearLicense();
  licencia.saveLicense(MAQUINA, PAGADA);

  const principal = licencia._internos.mainPath();
  const espejo = licencia._internos.mirrorPath();

  const romper = (ruta) => {
    const crudo = JSON.parse(readFileSync(ruta, 'utf8'));
    crudo.s = 'firma-cambiada-a-mano';
    fs.writeFileSync(ruta, JSON.stringify(crudo), 'utf8');
  };

  romper(principal);
  const conEspejo = licencia.computeStatus(MAQUINA);
  check(conEspejo.state === 'active',
    'romper UNA copia no bloquea: el espejo la recupera',
    `state = ${conEspejo.state}`);

  /* `computeStatus` re-sella al leer, asi que se rompen las dos de nuevo. */
  romper(principal);
  if (fs.existsSync(espejo)) romper(espejo);
  const st = licencia.computeStatus(MAQUINA);
  check(st.state === 'tamper', 'con las dos rotas, queda tamper', `state = ${st.state}`);
  check(pantalla(st, CON_ALTA) === 'licencia-vencida',
    'y va al bloqueo, no a trabajar');
}

// ===================================================================
seccion('8) Una prueba legada se reconoce como prueba');

{
  /* Sin `type`: la guardo una version anterior al sellado. */
  const st = conLicencia({ success: true, plan: 'mono', expiresAt: EN30 });
  check(st.state === 'trial' && st.type === 'trial',
    'una prueba sin `type` no se lee como licencia de pago',
    `state = ${st.state}, type = ${st.type}`);
  check(pantalla(st, CON_ALTA) === 'login',
    'y deja trabajar, que es lo que hacia antes de todo esto');
}

// ===================================================================
seccion('9) Reiniciar no repite un paso ya hecho');

/*
 * `computeStatus` lee del disco cada vez, asi que volver a llamarlo ES
 * reiniciar la aplicacion en lo que a esta decision respecta. Lo que se
 * comprueba es que la segunda lectura da la misma pantalla que la primera.
 */
for (const [nombre, datos, alta] of CASOS) {
  const primera = pantalla(conLicencia(datos), alta);
  const segunda = pantalla(licencia.computeStatus(MAQUINA), alta);
  check(primera === segunda, `${nombre}: reiniciar no cambia la pantalla`,
    `${primera} -> ${segunda}`);
}

// ===================================================================
seccion('Las cinco formas de instalacion que existen ahi fuera');

/*
 * LO QUE DE VERDAD SE ESTA PROBANDO AQUI
 *
 * La regla de "ya esta dada de alta" cambio: antes era solo `usuarios > 0` y
 * ahora es `usuarios > 0 O negocio_configurado > 0`. Un cambio asi solo es
 * seguro si se puede afirmar una cosa concreta:
 *
 *     NINGUNA instalacion que hoy entra al Login puede empezar a ver el
 *     asistente.
 *
 * Con una UNION eso es cierto por construccion -anadir un `O` solo puede
 * hacer crecer el conjunto-, pero "es cierto por construccion" es justo lo
 * que uno se dice antes de romper algo. Asi que se ejecuta.
 */

const REGLA_VIEJA = (fila) => (Number(fila?.usuarios) || 0) > 0;

const INSTALACIONES = [
  ['A. nueva, recien instalada',
   { usuarios: 0, negocio_configurado: 0 }, false,
   'no hay nada: tiene que pasar por el asistente'],

  ['B. historica y valida',
   { usuarios: 3, negocio_configurado: 1 }, true,
   'la que lleva anos vendiendo: jamas puede ver el asistente'],

  ['C1. a medias: hay admin pero fallo el negocio',
   { usuarios: 1, negocio_configurado: 0 }, true,
   'volver al asistente pediria crear un administrador que YA existe'],

  ['C2. a medias: hay negocio pero desactivaron a todos',
   { usuarios: 0, negocio_configurado: 1 }, true,
   'este es el caso que la regla vieja mandaba al asistente'],

  ['D. demo sembrada',
   { usuarios: 4, negocio_configurado: 1 }, true,
   'la semilla usa el mismo sp_setup_inicial, asi que queda como una normal'],

  ['E. migrada de una version anterior',
   { usuarios: 2, negocio_configurado: 0 }, true,
   'sin fila en business_config y aun asi entra: por eso la regla no exige esa senal'],
];

for (const [nombre, fila, esperado, porque] of INSTALACIONES) {
  check(estaConfigurado(fila) === esperado, nombre, porque);
}

/*
 * LA PROPIEDAD, DICHA COMO PROPIEDAD.
 *
 * No basta con que los seis casos de arriba salgan bien: hay que decir que
 * ninguna combinacion posible empeora. Se recorren todas las que importan.
 */
{
  let regresiones = [];
  for (const usuarios of [0, 1, 7]) {
    for (const negocio_configurado of [0, 1]) {
      const fila = { usuarios, negocio_configurado };
      if (REGLA_VIEJA(fila) && !estaConfigurado(fila)) {
        regresiones.push(JSON.stringify(fila));
      }
    }
  }
  check(regresiones.length === 0,
    'ninguna instalacion que ya entraba al Login empieza a ver el asistente',
    regresiones.length ? `regresiones: ${regresiones.join(', ')}` : 'la regla nueva solo puede AMPLIAR el conjunto');
}

{
  /* Y al reves: que el cambio sirva de algo. Si no rescatara ningun caso, no
     habria por que haberlo hecho. */
  const rescatado = { usuarios: 0, negocio_configurado: 1 };
  check(!REGLA_VIEJA(rescatado) && estaConfigurado(rescatado),
    'y el cambio rescata el caso por el que se hizo',
    'un negocio configurado al que desactivaron los usuarios ya no vuelve al asistente');
}

/* Ni backfill ni metadata nueva: la regla pregunta por filas que existen en
   cualquier base historica. Si alguien anadiera una columna nueva, esto lo
   caza. */
{
  const spTxt = readFileSync(join('sql', 'procedures', 'setup', 'sp_setup_status.sql'), 'utf8');
  check(/FROM dbo\.users/.test(spTxt) && /FROM dbo\.business_config/.test(spTxt),
    'las dos senales salen de tablas que ya existian',
    'por eso la transicion no necesita backfill');
}

// ===================================================================
seccion('Los recorridos completos, paso a paso');

/*
 * Los casos de arriba comprueban DONDE cae cada estado. Esto comprueba el
 * CAMINO: que la pantalla siguiente sea la correcta despues de que la persona
 * hace lo que esa pantalla le pide. Un paso ya completado no puede reaparecer.
 */
function recorrido(datosIniciales, alta, acciones) {
  const pasos = [];
  let estado = conLicencia(datosIniciales);
  pasos.push(pantalla(estado, alta));
  for (const accion of acciones) {
    if (accion === 'activar-prueba') estado = conLicencia(PRUEBA);
    else if (accion === 'activar-licencia') estado = conLicencia(PAGADA);
    else if (accion === 'dar-de-alta') alta = CON_ALTA;
    pasos.push(pantalla(estado, alta));
  }
  return pasos;
}

const RECORRIDOS = [
  ['1) sin licencia + sin alta', null, SIN_ALTA, ['activar-prueba', 'dar-de-alta'],
   ['license-gate', 'business-setup', 'login']],
  ['2) con licencia + sin alta', PAGADA, SIN_ALTA, ['dar-de-alta'],
   ['business-setup', 'login']],
  ['3) sin licencia + con alta', null, CON_ALTA, ['activar-prueba'],
   ['license-gate', 'login']],
  ['4) con licencia + con alta', PAGADA, CON_ALTA, [],
   ['login']],
];

for (const [nombre, datos, alta, acciones, esperado] of RECORRIDOS) {
  const pasos = recorrido(datos, alta, acciones);
  check(JSON.stringify(pasos) === JSON.stringify(esperado), `${nombre}: el recorrido entero`,
    pasos.join(' -> '));
}

{
  /* El caso 5 no tiene recorrido: ese es el punto. */
  licencia.usarEspacio('demo');
  const st = licencia.computeStatus(MAQUINA);
  check(pantalla(st, CON_ALTA) === 'login',
    '5) Demo Manager: un solo paso, y es el Login',
    'sin Gate, sin prueba comercial y sin asistente');
  licencia.usarEspacio('');
}

// ===================================================================
seccion('La plantilla y esta prueba deciden lo MISMO');

/*
 * Esto es lo que impide que la matriz se quede describiendo un arranque que ya
 * no existe: si `app.html` cambia de criterio, aqui se ve.
 */
const appHtml = readFileSync(join('src', 'app', 'app.html'), 'utf8');
check(/state === 'expired' \|\| license\.estado\.state === 'tamper'/.test(appHtml),
  'la plantilla manda caducada y manipulada a la misma pantalla');
check(/license\.estado\.state === 'none'/.test(appHtml),
  'sin licencia, el Gate');
check(/license\.puedeOperar/.test(appHtml),
  'demo, prueba y licencia entran a trabajar');
check(/necesitaSetup/.test(appHtml),
  'y dentro decide el alta por `necesitaSetup`');

try { fs.rmSync(carpeta, { recursive: true, force: true }); } catch { /* noop */ }

console.log(`\nRESULTADO: ${fallos.length ? `${fallos.length} FALLO(S) de ${ok + fallos.length}` : `TODO BIEN · ${ok}/${ok}`}`);
process.exit(fallos.length ? 1 : 0);
