// red-principal.js
// Que le falta a ESTA maquina para poder servirle a otras cajas.
//
// EL AGUJERO QUE TAPA
// -------------------
// El asistente de instalacion ya deja todo listo cuando alguien instala de
// cero, elige "Servidor Principal" y escribe una contrasena de red. Pero ese
// no es el camino normal de un cliente: el camino normal es probar 30 dias, o
// empezar con MonoCaja, y comprar MultiCaja despues. En ese caso:
//
//   - el asistente NO vuelve a correr (ya existe install-config.json), asi que
//     nadie crea el login `ocus_app` ni genera contrasena;
//   - y aunque corriera, `ensureServerReady` se salta el script elevado entero
//     cuando SQL ya responde, de modo que el puerto TCP, el SQL Browser y las
//     reglas de firewall se quedan sin configurar.
//
// El resultado es un cliente que compro MultiCaja y no puede usarla sin que
// alguien le abra SSMS. Este modulo es la parte que DECIDE; la que ejecuta
// esta en electron/redMulticaja.js.
//
// Vive aparte y sin dependencias -ni Electron, ni SQL, ni PowerShell- para
// que la decision se pueda probar sola, sin una maquina con SQL Server.

const crypto = require('crypto');
const { instanciaDe: instanciaDeServidor } = require('./servidor-sql');

// ---------------------------------------------------------------------------
// LA CONTRASENA DE RED
// ---------------------------------------------------------------------------

/**
 * El alfabeto NO es el completo a proposito.
 *
 * Esta contrasena la teclea una persona en OTRA maquina, normalmente leyendola
 * de una pantalla o de un papel. Cada caracter ambiguo es una llamada a
 * soporte, asi que fuera:
 *
 *   O 0 o   I l 1   (se confunden entre si en casi cualquier tipografia)
 *
 * Y fuera tambien todo lo que rompe una cadena de conexion de SQL Server o una
 * linea de comandos: comillas, punto y coma, llaves, barras, espacios. Lo que
 * queda sigue dando ~5.9 bits por caracter; con 20 caracteres son ~118 bits,
 * mas que de sobra para una cuenta que solo existe dentro de una LAN.
 */
const MAYUS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';       // sin I ni O
const MINUS = 'abcdefghijkmnpqrstuvwxyz';       // sin l ni o
const DIGIT = '23456789';                       // sin 0 ni 1
const SIMBOLO = '#$%+=?@';                      // ni ; ni { } ni comillas ni \
const ALFABETO = MAYUS + MINUS + DIGIT + SIMBOLO;

const LARGO = 20;

/** Un entero en [0, max) sin sesgo de modulo. */
function alAzar(max) {
  const limite = Math.floor(256 / max) * max;
  for (;;) {
    const b = crypto.randomBytes(1)[0];
    if (b < limite) return b % max;
  }
}

function tomar(alfabeto) {
  return alfabeto[alAzar(alfabeto.length)];
}

/**
 * Contrasena para el login `ocus_app`.
 *
 * Se crea con una de cada clase ANTES de rellenar y luego se baraja. SQL
 * Server tiene CHECK_POLICY encendido en esta cuenta, y la politica de Windows
 * exige tres de las cuatro clases: dejarlo al azar significaria que de vez en
 * cuando `CREATE LOGIN` falla con "la contrasena no cumple los requisitos", un
 * error que el cliente no puede interpretar ni arreglar.
 *
 * Se entrega en grupos de cinco separados por guion. El guion ya cuenta como
 * la cuarta clase, pero sobre todo hace que se pueda dictar por telefono.
 */
function generarContrasenaRed() {
  const chars = [tomar(MAYUS), tomar(MINUS), tomar(DIGIT), tomar(SIMBOLO)];
  while (chars.length < LARGO) chars.push(tomar(ALFABETO));

  // Barajado de Fisher-Yates con la misma fuente criptografica. Ordenar por
  // Math.random() es el error clasico y aqui no seria inofensivo: dejaria las
  // cuatro clases obligatorias sesgadas hacia el principio.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = alAzar(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  const s = chars.join('');
  return [s.slice(0, 5), s.slice(5, 10), s.slice(10, 15), s.slice(15, 20)].join('-');
}

/** Lo que la contrasena cumple, para poder afirmarlo en una prueba. */
function analizarContrasena(p) {
  const s = String(p ?? '');
  const soloChars = s.split('-').join('');
  return {
    largo: soloChars.length,
    mayusculas: /[A-Z]/.test(soloChars),
    minusculas: /[a-z]/.test(soloChars),
    digitos: /[0-9]/.test(soloChars),
    simbolos: new RegExp('[' + SIMBOLO.replace(/[$]/g, '\\$') + ']').test(soloChars),
    ambiguos: /[O0oIl1]/.test(soloChars),
    // Lo que romperia una cadena de conexion o una linea de PowerShell.
    peligrosos: /['";{}\\\s]/.test(s),
  };
}

// ---------------------------------------------------------------------------
// EL DIAGNOSTICO
// ---------------------------------------------------------------------------

const PUERTO = 1433;

/**
 * El nombre de instancia de un servidor, o cadena vacia si no lo dice.
 *
 *   'localhost\SQLEXPRESS'   ->  'SQLEXPRESS'
 *   'EQUIPO\SQLEXPRESS,1433' ->  'SQLEXPRESS'
 *   'localhost'               ->  ''          <- y esto NO es 'MSSQLSERVER'
 *
 * Suponer la instancia predeterminada cuando nadie la nombra es un error real,
 * y ya se vio: una maquina puede estar configurada como `localhost` y tener
 * solo SQLEXPRESS -con el puerto 1433 fijo, que es justo lo que hace que el
 * nombre de instancia sobre en la cadena de conexion-. Preguntar por
 * 'MSSQLSERVER' en el registro devuelve entonces "no existe", y el diagnostico
 * se queda sin poder ver el puerto de una maquina perfectamente normal.
 *
 * Quien deshace la ambiguedad es el registro de Windows, que sabe que
 * instancias hay instaladas. Aqui solo se dice lo que la cadena dice.
 *
 * El troceo lo hace `servidor-sql.js`: es la MISMA gramatica que usa el
 * asistente para construirla. Tenerla escrita dos veces fue como se llego a
 * que el asistente generara `IP\SQLEXPRESS\SQLEXPRESS` sin que nada avisara.
 */
function instanciaDe(server) {
  return instanciaDeServidor(server);
}

/**
 * Traduce las senales crudas de la maquina a "que falta y quien lo arregla".
 *
 * Cada punto puede estar en tres estados, no en dos:
 *
 *   ok            comprobado y correcto
 *   falta         comprobado y hay que hacer algo
 *   desconocido   no se pudo preguntar (sin permisos, servicio ausente...)
 *
 * El tercero es el que suele faltar en este tipo de pantallas, y es el que
 * evita el peor mensaje posible: decirle a alguien que su firewall esta bien
 * cuando en realidad no se pudo mirar.
 *
 * `elevacion` distingue lo que Wybix puede hacer con la sesion actual (crear
 * el login, dar permisos) de lo que exige permisos de administrador (registro,
 * servicios, firewall). Asi la pantalla puede pedir el UAC una sola vez, y
 * solo cuando de verdad hace falta.
 */
function evaluarRed(senales = {}) {
  const s = senales || {};
  const puntos = [];
  const punto = (clave, estado, titulo, detalle, elevacion = false) =>
    puntos.push({ clave, estado, titulo, detalle, elevacion });

  // --------------------------------------------------------------- el motor
  if (s.servidorEsLocal === false) {
    punto('servidor', 'falta',
      'Esta máquina no es el servidor',
      'La base de datos vive en otro equipo. Prepara la red en la máquina que tiene SQL Server, ' +
      'no en esta.', false);
    return { listo: false, puntos, requiereElevacion: false, faltaContrasena: false, esServidor: false };
  }

  // ------------------------------------------------------- modo de autenticacion
  // Sin modo mixto, `ocus_app` existe pero no puede iniciar sesion: SQL Server
  // rechaza toda autenticacion que no sea de Windows, y una caja secundaria no
  // es un usuario de Windows de este equipo.
  if (s.modoAutenticacion === 'MIXTA') {
    punto('modoMixto', 'ok', 'Autenticación mixta', 'SQL Server acepta cuentas propias, no solo de Windows.');
  } else if (s.modoAutenticacion === 'SOLO_WINDOWS') {
    punto('modoMixto', 'falta', 'Falta la autenticación mixta',
      'Ahora mismo SQL Server solo acepta cuentas de Windows, así que ninguna otra caja podría entrar.', true);
  } else {
    punto('modoMixto', 'desconocido', 'Autenticación',
      'No se pudo consultar el modo de autenticación del servidor.', true);
  }

  // ------------------------------------------------------------------ puerto
  if (s.puertoTcp === PUERTO) {
    punto('puerto', 'ok', `Puerto ${PUERTO} fijo`, 'Las demás cajas saben dónde encontrar el servidor.');
  } else if (s.puertoTcp == null) {
    punto('puerto', 'desconocido', 'Puerto de red',
      'No se pudo saber en qué puerto escucha SQL Server.', true);
  } else {
    punto('puerto', 'falta', 'El puerto no está fijo',
      `SQL Server escucha en el puerto ${s.puertoTcp}. Con un puerto que cambia en cada arranque, ` +
      'las otras cajas dejan de encontrarlo.', true);
  }

  // ----------------------------------------------------------------- browser
  if (s.browser === 'CORRIENDO') {
    punto('browser', 'ok', 'SQL Browser activo', 'Permite conectarse por nombre de instancia.');
  } else if (s.browser === 'DETENIDO' || s.browser === 'DESHABILITADO') {
    punto('browser', 'falta', 'SQL Browser detenido',
      'Es quien le dice a las otras cajas dónde está la instancia.', true);
  } else if (s.browser === 'AUSENTE') {
    punto('browser', 'desconocido', 'SQL Browser',
      'Este equipo no tiene el servicio. No es grave si el puerto está fijo.', false);
  } else {
    punto('browser', 'desconocido', 'SQL Browser', 'No se pudo consultar el servicio.', true);
  }

  // ---------------------------------------------------------------- firewall
  const fw = (clave, valor, titulo) => {
    if (valor === true) punto(clave, 'ok', titulo, 'Regla de entrada activa.');
    else if (valor === false) punto(clave, 'falta', titulo,
      'Sin esta regla, Windows bloquea a las otras cajas antes de que lleguen a SQL Server.', true);
    else punto(clave, 'desconocido', titulo, 'No se pudo consultar el firewall.', true);
  };
  fw('firewallSql', s.firewallSql, `Firewall: SQL Server (TCP ${PUERTO})`);
  fw('firewallBrowser', s.firewallBrowser, 'Firewall: SQL Browser (UDP 1434)');

  // -------------------------------------------------------------------- rol
  // `ocus_app_full_role` vivia UNICAMENTE dentro del template.bak hecho a
  // mano. Hay bases que no lo tienen, y sin el la cuenta de red se crea, entra
  // y no puede hacer absolutamente nada: el sintoma es "la otra caja no ve
  // nada", que no se parece en nada a la causa. Es un punto propio y NO se
  // mezcla con la membresia: son dos problemas con dos arreglos distintos.
  if (s.rolExiste === true) {
    punto('rol', 'ok', 'Rol de la aplicación',
      'Existe el rol con los permisos que necesita una caja para operar.');
  } else if (s.rolExiste === false) {
    punto('rol', 'falta', 'Falta el rol de la aplicación',
      'Sin él, la cuenta de red se conecta y no puede leer ni escribir nada. Wybix lo crea por ti.', false);
  } else {
    punto('rol', 'desconocido', 'Rol de la aplicación',
      'No se pudo consultar el rol ocus_app_full_role.', false);
  }

  // ------------------------------------------------------------------ login
  if (s.loginExiste === true && s.loginHabilitado !== false) {
    punto('login', 'ok', 'Cuenta de red creada',
      'La cuenta ocus_app existe y tiene acceso a la base de Wybix.');
  } else if (s.loginExiste === true) {
    punto('login', 'falta', 'La cuenta de red está deshabilitada',
      'La cuenta ocus_app existe pero no puede iniciar sesión.', false);
  } else if (s.loginExiste === false) {
    punto('login', 'falta', 'Falta la cuenta de red',
      'Es la cuenta con la que las cajas secundarias se conectan a esta base.', false);
  } else {
    punto('login', 'desconocido', 'Cuenta de red', 'No se pudo consultar la cuenta ocus_app.', false);
  }

  if (s.loginExiste === true && s.loginConPermisos === false) {
    punto('permisos', 'falta', 'La cuenta de red no tiene permisos',
      'Existe, pero no es miembro del rol de la aplicación: entraría y no podría hacer nada.', false);
  }

  // -------------------------------------------------------------- contrasena
  // No es un punto del diagnostico del SERVIDOR -el servidor esta bien sin
  // ella-, es lo que le falta a la PERSONA para configurar la otra caja.
  const faltaContrasena = !s.contrasenaGuardada;

  const hayFaltas = puntos.some(p => p.estado === 'falta');
  return {
    esServidor: true,
    listo: !hayFaltas && s.loginExiste === true,
    puntos,
    requiereElevacion: puntos.some(p => p.estado === 'falta' && p.elevacion),
    faltaContrasena,
  };
}

/**
 * La instruccion de una linea para quien esta mirando la pantalla.
 * Se decide aqui y no en la plantilla para poder comprobarla en una prueba.
 */
function queHacer(veredicto, plan) {
  if (veredicto.esServidor === false) return 'no-es-servidor';
  if (!String(plan || '').toLowerCase().includes('multi')) return 'necesita-multicaja';
  if (!veredicto.listo) return 'preparar';
  if (veredicto.faltaContrasena) return 'falta-contrasena';
  return 'listo';
}

module.exports = {
  PUERTO,
  instanciaDe,
  generarContrasenaRed,
  analizarContrasena,
  evaluarRed,
  queHacer,
};
