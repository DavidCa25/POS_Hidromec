/**
 * DE PRUEBA / MONOCAJA A MULTICAJA, SIN QUE NADIE TOQUE SQL.
 *
 *     node scripts/pruebas/red-principal.mjs
 *
 * QUE SE ESTABA ROMPIENDO
 * -----------------------
 * El asistente de instalacion deja todo listo cuando alguien instala de cero y
 * elige "Servidor Principal". Pero ese no es el camino normal de un cliente:
 * el normal es probar 30 dias -o empezar con MonoCaja- y comprar MultiCaja
 * despues. Entonces:
 *
 *   - el asistente NO vuelve a correr (ya existe install-config.json), asi que
 *     nadie crea el login `ocus_app` ni genera contrasena de red;
 *   - `startTrial()` ni siquiera pasa una contrasena la primera vez;
 *   - y `ensureServerReady` se salta el script elevado ENTERO cuando SQL ya
 *     responde, de modo que el puerto 1433, el SQL Browser y el firewall se
 *     quedan sin configurar. Lo mismo le pasa a cualquier equipo que ya
 *     tuviera SQL Express instalado de antes.
 *
 * QUE SE COMPRUEBA AQUI
 * ---------------------
 * La parte que DECIDE (`electron/lib/red-principal.js`), que es pura y no
 * necesita una maquina con SQL Server: la contrasena y el diagnostico. Mas la
 * sintaxis del script elevado, porque un error de sintaxis ahi no se veria
 * hasta estar en la maquina de un cliente, con el UAC ya abierto.
 *
 * Lo que se ejecuta de verdad -crear el login, tocar el firewall- se prueba a
 * mano sobre la VM: exige permisos de administrador y cambia el equipo.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const red = require('../../electron/lib/red-principal.js');

let fallos = 0, pasos = 0;
const check = (cond, titulo, detalle = '') => {
  pasos++;
  if (cond) console.log(`   ok     ${titulo}${detalle ? '  · ' + detalle : ''}`);
  else { fallos++; console.log(`   FALLA  ${titulo}${detalle ? '  · ' + detalle : ''}`); }
};
const seccion = (t) => console.log(`\n-- ${t}`);

const de = (veredicto, clave) => veredicto.puntos.find(p => p.clave === clave);

console.log('\nPREPARAR LA RED PARA MULTICAJA');

// ===========================================================================
seccion('1. La contrasena de red');

const p1 = red.generarContrasenaRed();
const a1 = red.analizarContrasena(p1);

check(a1.largo === 20, 'tiene 20 caracteres', `${a1.largo}`);
check(a1.mayusculas && a1.minusculas && a1.digitos && a1.simbolos,
  'cumple las CUATRO clases de caracteres',
  'SQL Server tiene CHECK_POLICY encendido en esta cuenta y la politica de Windows exige tres');
check(!a1.ambiguos, 'no trae caracteres ambiguos (O 0 o / I l 1)',
  'alguien la va a teclear en OTRA maquina leyendola de una pantalla');
check(!a1.peligrosos, 'no trae nada que rompa una cadena de conexion ni PowerShell');
check(/^[^-]{5}-[^-]{5}-[^-]{5}-[^-]{5}$/.test(p1), 'viene en grupos de cinco, para poder dictarla', p1);

// Mil intentos: ninguno puede saltarse la politica ni repetirse.
const muchas = Array.from({ length: 1000 }, () => red.generarContrasenaRed());
const todasCumplen = muchas.every(p => {
  const a = red.analizarContrasena(p);
  return a.largo === 20 && a.mayusculas && a.minusculas && a.digitos && a.simbolos &&
         !a.ambiguos && !a.peligrosos;
});
check(todasCumplen, 'mil contrasenas seguidas cumplen TODAS la politica',
  'sin esto, de vez en cuando CREATE LOGIN fallaria con un error que el cliente no puede arreglar');
check(new Set(muchas).size === muchas.length, 'y las mil son distintas entre si');

/* Las cuatro clases obligatorias se colocan primero y DESPUES se baraja. Si el
   barajado no fuera real, las mayusculas se acumularian en la posicion 0 y una
   contrasena "aleatoria" seria adivinable por su forma. */
const enPos0 = muchas.filter(p => /[A-Z]/.test(p[0])).length;
check(enPos0 > 100 && enPos0 < 400,
  'el barajado es real: la mayuscula obligatoria no se queda en la primera posicion',
  `${enPos0}/1000 empiezan por mayuscula`);

// ===========================================================================
seccion('2. La instancia de SQL no se supone');

// Defecto encontrado ejecutando el diagnostico contra una maquina real: la
// configuracion decia `localhost` -sin instancia, porque el puerto 1433 esta
// fijo- y el codigo daba por hecho 'MSSQLSERVER'. El registro respondia "esa
// propiedad no existe" y el puerto, el TCP y la instancia entera se quedaban
// en "no se pudo comprobar" en un equipo perfectamente normal. Quien resuelve
// la ambiguedad es el registro de Windows, no una suposicion.
check(red.instanciaDe('localhost\\SQLEXPRESS') === 'SQLEXPRESS', 'lee la instancia cuando la hay');
check(red.instanciaDe('192.168.1.10\\SQLEXPRESS,1433') === 'SQLEXPRESS', 'y descarta el puerto');
check(red.instanciaDe('localhost') === '',
  'sin instancia devuelve vacio, NO "MSSQLSERVER"',
  'suponerla dejaba el diagnostico ciego en una maquina normal');
check(red.instanciaDe('') === '' && red.instanciaDe(null) === '', 'y aguanta una cadena vacia o nula');

// ===========================================================================
seccion('3. Diagnostico: cliente que viene de la prueba (nada configurado)');

// Este es EL caso. SQL existe -lo instalo Wybix en modo prueba- pero sin
// puerto fijo, sin firewall, sin Browser y sin cuenta de red.
const trial = red.evaluarRed({
  servidorEsLocal: true,
  modoAutenticacion: 'MIXTA',
  puertoTcp: 51234,          // puerto dinamico: cambia en cada arranque
  browser: 'DETENIDO',
  firewallSql: false,
  firewallBrowser: false,
  loginExiste: false,
  contrasenaGuardada: false,
});

check(trial.listo === false, 'no esta listo');
check(de(trial, 'puerto').estado === 'falta', 'detecta el puerto dinamico', 'el 1433 del firewall no serviria de nada');
check(de(trial, 'browser').estado === 'falta', 'detecta el SQL Browser detenido');
check(de(trial, 'firewallSql').estado === 'falta', 'detecta que falta la regla de firewall');
check(de(trial, 'login').estado === 'falta', 'detecta que no existe la cuenta de red');
check(trial.faltaContrasena === true, 'y que no hay contrasena que darle a la otra caja');
check(trial.requiereElevacion === true, 'sabe que hara falta permiso de administrador');
check(red.queHacer(trial, 'multi') === 'preparar', 'la instruccion es: preparar');
check(red.queHacer(trial, 'mono') === 'necesita-multicaja',
  'con plan MonoCaja no ofrece preparar nada: primero la licencia');

// ===========================================================================
seccion('4. Diagnostico: equipo que YA tenia SQL Server instalado');

// El otro caso real: el instalador de Wybix se salto el script elevado porque
// SQL ya respondia. La cuenta si se creo -eso no depende del script- pero la
// red no se toco, y encima el motor estaba en modo "solo Windows".
const preexistente = red.evaluarRed({
  servidorEsLocal: true,
  modoAutenticacion: 'SOLO_WINDOWS',
  puertoTcp: null,
  browser: 'DETENIDO',
  firewallSql: false,
  firewallBrowser: false,
  loginExiste: true,
  loginHabilitado: true,
  loginConPermisos: true,
  rolExiste: true,
  contrasenaGuardada: true,
});

check(de(preexistente, 'modoMixto').estado === 'falta',
  'detecta que SQL solo acepta cuentas de Windows',
  'con esto, ocus_app existe y aun asi no puede entrar');
check(de(preexistente, 'login').estado === 'ok', 'la cuenta si esta bien: no la reporta como problema');
check(preexistente.listo === false, 'y el conjunto no esta listo');
check(preexistente.faltaContrasena === false, 'la contrasena ya la tiene guardada');

// ===========================================================================
seccion('5. Lo que no se pudo comprobar NO se da por bueno');

// Sin permisos de administrador, `Get-NetFirewallRule` puede no responder. El
// peor mensaje posible seria decirle a alguien que su firewall esta bien
// cuando en realidad no se pudo mirar.
const aciegas = red.evaluarRed({
  servidorEsLocal: true,
  modoAutenticacion: null,
  puertoTcp: null,
  browser: null,
  firewallSql: null,
  firewallBrowser: null,
  loginExiste: null,
  contrasenaGuardada: false,
});
check(aciegas.puntos.every(p => p.estado !== 'ok'), 'nada se reporta como correcto');
check(aciegas.puntos.filter(p => p.estado === 'desconocido').length >= 5,
  'todo queda como "no se pudo comprobar"');
check(aciegas.listo === false, 'y no se declara listo a ciegas');

// ===========================================================================
seccion('6. Todo en orden');

const listo = red.evaluarRed({
  servidorEsLocal: true,
  modoAutenticacion: 'MIXTA',
  puertoTcp: red.PUERTO,
  browser: 'CORRIENDO',
  firewallSql: true,
  firewallBrowser: true,
  loginExiste: true,
  loginHabilitado: true,
  loginConPermisos: true,
  rolExiste: true,
  contrasenaGuardada: true,
});
check(listo.listo === true, 'se declara listo');
check(listo.requiereElevacion === false, 'y ya no pide permiso de administrador para nada');
check(red.queHacer(listo, 'multi') === 'listo', 'la instruccion es: listo');

// El servidor esta bien pero la persona no tiene la contrasena: son dos cosas
// distintas y se dicen distinto.
const sinClave = red.evaluarRed({ ...{
  servidorEsLocal: true, modoAutenticacion: 'MIXTA', puertoTcp: red.PUERTO,
  browser: 'CORRIENDO', firewallSql: true, firewallBrowser: true,
  loginExiste: true, loginHabilitado: true, loginConPermisos: true, rolExiste: true,
}, contrasenaGuardada: false });
check(sinClave.listo === true && sinClave.faltaContrasena === true,
  'un servidor correcto SIN contrasena guardada se distingue de uno mal configurado');
check(red.queHacer(sinClave, 'multi') === 'falta-contrasena', 'y la instruccion lo dice');

// ===========================================================================
seccion('7. Una caja secundaria no debe intentar prepararse a si misma');

const secundaria = red.evaluarRed({ servidorEsLocal: false });
check(secundaria.esServidor === false, 'se reconoce como secundaria');
check(secundaria.puntos.length === 1, 'y no lista pasos que no le tocan a ella');
check(red.queHacer(secundaria, 'multi') === 'no-es-servidor', 'la instruccion es: no es el servidor');

// ===========================================================================
seccion('8. Una cuenta que existe y no puede hacer nada es un estado real');

const sinRol = red.evaluarRed({
  servidorEsLocal: true, modoAutenticacion: 'MIXTA', puertoTcp: red.PUERTO,
  browser: 'CORRIENDO', firewallSql: true, firewallBrowser: true,
  loginExiste: true, loginHabilitado: true, loginConPermisos: false, rolExiste: true,
  contrasenaGuardada: true,
});
check(de(sinRol, 'permisos')?.estado === 'falta',
  'la cuenta sin rol se reporta aparte de la cuenta inexistente',
  'entraria y no podria leer ni una venta');
check(sinRol.listo === false, 'y eso impide declararlo listo');

const deshabilitada = red.evaluarRed({
  servidorEsLocal: true, modoAutenticacion: 'MIXTA', puertoTcp: red.PUERTO,
  browser: 'CORRIENDO', firewallSql: true, firewallBrowser: true,
  loginExiste: true, loginHabilitado: false, loginConPermisos: true, rolExiste: true,
  contrasenaGuardada: true,
});
check(de(deshabilitada, 'login').estado === 'falta', 'una cuenta deshabilitada tampoco pasa por buena');

// ===========================================================================
seccion('9. El rol de la aplicacion es un punto propio');

// `ocus_app_full_role` vivia solo dentro del template.bak hecho a mano. Hay
// bases que no lo tienen, y sin el la cuenta de red entra y no puede hacer
// nada. "No existe el rol" y "la cuenta no es miembro" parecen lo mismo en
// pantalla y son dos arreglos distintos.
const sinRolBase = red.evaluarRed({
  servidorEsLocal: true, modoAutenticacion: 'MIXTA', puertoTcp: red.PUERTO,
  browser: 'CORRIENDO', firewallSql: true, firewallBrowser: true,
  loginExiste: true, loginHabilitado: true, loginConPermisos: false,
  rolExiste: false, contrasenaGuardada: true,
});
check(de(sinRolBase, 'rol').estado === 'falta', 'detecta que el rol no existe',
  'el sintoma en el cliente era "la otra caja no ve nada"');
check(sinRolBase.listo === false, 'y eso impide declarar la red lista');
check(red.queHacer(sinRolBase, 'multi') === 'preparar', 'la instruccion es: preparar');
check(de(sinRolBase, 'rol').elevacion === false,
  'y no hace falta permiso de administrador para arreglarlo',
  'es una operacion de base de datos, no del sistema');

const rolDesconocido = red.evaluarRed({
  servidorEsLocal: true, modoAutenticacion: 'MIXTA', puertoTcp: red.PUERTO,
  browser: 'CORRIENDO', firewallSql: true, firewallBrowser: true,
  loginExiste: true, loginHabilitado: true, loginConPermisos: true,
  rolExiste: null, contrasenaGuardada: true,
});
check(de(rolDesconocido, 'rol').estado === 'desconocido',
  'y si no se pudo consultar, no se da por bueno');

// ===========================================================================
seccion('10. El script elevado');

const ps = join('installer', 'preparar-red.ps1');
check(existsSync(ps), `${ps} existe`);

if (existsSync(ps)) {
  const texto = readFileSync(ps, 'utf8');

  // Reiniciar el servicio de SQL corta las conexiones de quien este cobrando.
  // Solo puede pasar si de verdad hubo un cambio que lo exija.
  check(texto.includes('if ($requiereReinicio)'),
    'solo reinicia el servicio si algun cambio lo exige',
    'corre sobre una maquina viva, quiza con alguien vendiendo');
  check(texto.includes("Set-ItemProperty -Path $tcpAll -Name \"TcpDynamicPorts\" -Value \"\""),
    'vacia el puerto dinamico, no solo fija el 1433',
    'mientras exista el dinamico, SQL Server lo prefiere y el 1433 abierto no sirve');
  check(texto.includes("Name 'LoginMode'") || texto.includes('-Name "LoginMode"'),
    'configura el modo mixto de autenticacion');
  check(texto.includes('Get-NetFirewallRule') && texto.includes('New-NetFirewallRule'),
    'comprueba la regla de firewall antes de crearla (idempotente)');
  check(texto.includes('$instalados.Count -eq 1') && texto.includes('$instalados -notcontains'),
    'resuelve la instancia contra el registro en vez de suponerla',
    'dar por hecho MSSQLSERVER fallaria con "no existe el servicio" en una maquina normal');
  check(texto.includes('$ResultFile') && texto.includes('WriteAllText'),
    'devuelve lo que hizo paso a paso, no solo un codigo de salida',
    'sin esto, un fallo a medias no se podria contar');

  // Un error de sintaxis en un script elevado no se veria hasta estar en la
  // maquina de un cliente, con el UAC ya abierto delante de el.
  let sintaxis = null;
  try {
    const salida = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `
      $e = $null; $t = $null
      [void][System.Management.Automation.Language.Parser]::ParseFile(
        (Resolve-Path '${ps.split('\\').join('\\\\')}').Path, [ref]$t, [ref]$e)
      if ($e -and $e.Count -gt 0) { $e[0].Message } else { 'OK' }`],
      { encoding: 'utf8', timeout: 30000 });
    sintaxis = String(salida).trim();
  } catch (e) {
    sintaxis = 'no se pudo analizar: ' + String(e.message).split('\n')[0];
  }
  check(sintaxis === 'OK', 'PowerShell lo analiza sin errores de sintaxis', sintaxis);
}

console.log(fallos ? `\nRESULTADO: ${fallos} FALLO(S) de ${pasos}` : `\nRESULTADO: OK (${pasos} comprobaciones)`);
process.exit(fallos ? 1 : 0);
