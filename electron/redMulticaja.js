// redMulticaja.js
// De "compré MultiCaja" a "la otra caja ya conecta", sin tocar nada a mano.
//
// EL CASO REAL QUE RESUELVE
// -------------------------
// Un cliente instala Wybix en prueba (o con MonoCaja) y meses despues compra
// MultiCaja. En ese momento la pantalla de Cajas se le abre... y no sirve de
// nada, porque su maquina nunca quedo preparada para que OTRO equipo se
// conecte:
//
//   - el asistente no vuelve a correr, asi que nadie creo el login `ocus_app`
//     ni genero una contrasena de red;
//   - `startTrial()` ni siquiera pasa una contrasena la primera vez;
//   - y `ensureServerReady` se salta el script elevado ENTERO cuando SQL ya
//     responde, asi que el puerto 1433, el SQL Browser y el firewall se
//     quedaron sin configurar -lo mismo le pasa a cualquier equipo que ya
//     tuviera SQL Express instalado de antes-.
//
// Hasta ahora la unica salida era reinstalar desde cero o abrir SSMS. Este
// modulo hace exactamente lo mismo que el asistente, sobre una instalacion
// viva, y sin borrar nada.
//
// LA DECISION VIVE EN OTRO SITIO
// ------------------------------
// `electron/lib/red-principal.js` decide QUE falta y no depende de Electron ni
// de SQL: se puede probar sin una maquina con SQL Server. Aqui esta lo que
// ejecuta esa decision, que es lo que no se puede probar en seco.
//
// LA CONTRASENA
// -------------
// Nunca se guarda en claro. Se cifra con `safeStorage` del sistema operativo,
// que ata el secreto a ESTE usuario de Windows. Si el sistema no ofrece
// cifrado real, NO se guarda: se muestra una vez y punto. Guardar una
// credencial de red en base64 y llamarlo "guardado" seria peor que no
// guardarla, porque nadie volveria a preocuparse por ella.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { app, safeStorage } = require('electron');

const setupServer = require('./setupServer');
const db = require('./db');
const { servidorEsLocal } = require('./lib/host');
const { PUERTO, instanciaDe, generarContrasenaRed, evaluarRed, queHacer } = require('./lib/red-principal');

const USUARIO_RED = 'ocus_app';
const DB_NAME = 'Wybix_POS';

function log(msg) { console.log(`[RED] ${msg}`); }

// ===========================================================================
//  ALMACEN DE LA CONTRASENA
// ===========================================================================

function rutaRedConfig() {
  return path.join(app.getPath('userData'), 'red-config.json');
}

function leerRedConfig() {
  try {
    const p = rutaRedConfig();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('[RED] No se pudo leer red-config.json:', e.message);
  }
  return null;
}

function hayCifradoReal() {
  try { return !!(safeStorage && safeStorage.isEncryptionAvailable()); }
  catch { return false; }
}

/**
 * Guarda la contrasena cifrada, o no la guarda.
 *
 * Devuelve si quedo guardada para que la pantalla pueda decir la verdad: "la
 * puedes volver a ver aqui" o "apuntala ahora, no se va a poder recuperar".
 */
function guardarContrasena(plano) {
  if (!hayCifradoReal()) {
    log('El sistema no ofrece cifrado: la contrasena NO se guarda.');
    return { guardada: false, motivo: 'sin-cifrado' };
  }
  const cfg = {
    usuario: USUARIO_RED,
    passwordEnc: safeStorage.encryptString(String(plano)).toString('base64'),
    rotadaEn: new Date().toISOString(),
  };
  const p = rutaRedConfig();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
  return { guardada: true };
}

function leerContrasena() {
  const cfg = leerRedConfig();
  if (!cfg?.passwordEnc || !hayCifradoReal()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(cfg.passwordEnc, 'base64'));
  } catch (e) {
    // Pasa si el perfil de Windows cambio: la clave del sistema ya no abre
    // este secreto. No es corrupcion, y la salida es rotar, no reinstalar.
    console.error('[RED] No se pudo descifrar la contrasena de red:', e.message);
    return null;
  }
}

// ===========================================================================
//  SENALES DE LA MAQUINA
// ===========================================================================

/** Las IPv4 de esta maquina, para poder dictarselas a la caja secundaria. */
function direccionesLocales() {
  const salida = [];
  const ifaces = os.networkInterfaces();
  for (const nombre of Object.keys(ifaces)) {
    for (const dir of ifaces[nombre] || []) {
      if (dir.family !== 'IPv4' && dir.family !== 4) continue;
      if (dir.internal) continue;
      salida.push({ interfaz: nombre, ip: dir.address });
    }
  }
  return salida;
}

function servidorConfigurado() {
  try { return db.getConnectionConfig().server || 'localhost\\SQLEXPRESS'; }
  catch { return 'localhost\\SQLEXPRESS'; }
}

function ejecutarPs(script) {
  return new Promise((resolve) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return resolve(null);
        try { return resolve(JSON.parse(String(stdout).trim())); }
        catch { return resolve(null); }
      });
  });
}

/**
 * Lo que solo sabe Windows: servicios, firewall y el puerto del registro.
 *
 * Cada dato va en su propio try: que no se pueda leer el firewall -cosa
 * perfectamente posible sin permisos de administrador- no puede dejar sin
 * respuesta a las otras tres preguntas. Lo que no se pudo mirar vuelve como
 * `null`, y `evaluarRed` lo reporta como "no se pudo comprobar", no como
 * "esta bien".
 */
async function senalesDeWindows(instancia) {
  const inst = String(instancia || '').replace(/'/g, "''");
  const script = `
$r = @{ browser = $null; puertoRegistro = $null; tcpHabilitado = $null; firewallSql = $null; firewallBrowser = $null; instancia = $null }
try {
  $b = Get-Service -Name 'SQLBrowser' -ErrorAction Stop
  $r.browser = if ($b.Status -eq 'Running') { 'CORRIENDO' } else { 'DETENIDO' }
} catch { $r.browser = 'AUSENTE' }
try {
  $ruta = 'HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\Instance Names\\SQL'
  $props = Get-ItemProperty -Path $ruta -ErrorAction Stop
  $nombres = @($props.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { $_.Name })
  # Si la configuracion nombra la instancia, manda ella. Si no la nombra y en
  # esta maquina solo hay una, es esa. Si hay varias y no se dijo cual, no se
  # adivina: se devuelve null y se reporta como "no se pudo comprobar".
  $elegida = $null
  if ('${inst}' -ne '' -and $nombres -contains '${inst}') { $elegida = '${inst}' }
  elseif ('${inst}' -eq '' -and $nombres.Count -eq 1) { $elegida = $nombres[0] }
  if ($null -ne $elegida) {
    $r.instancia = $elegida
    $id = $props.$elegida
    $tcp = "HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\$id\\MSSQLServer\\SuperSocketNetLib\\Tcp"
    $r.tcpHabilitado = [bool]((Get-ItemProperty -Path $tcp -Name 'Enabled' -ErrorAction Stop).Enabled -eq 1)
    $fijo = [string](Get-ItemProperty -Path "$tcp\\IPAll" -Name 'TcpPort' -ErrorAction SilentlyContinue).TcpPort
    if ($fijo -ne '') { $r.puertoRegistro = [int]$fijo }
  }
} catch { }
try {
  $r.firewallSql = [bool](Get-NetFirewallRule -DisplayName 'SQL Server (TCP ${PUERTO})' -ErrorAction Stop | Where-Object { $_.Enabled -eq 'True' })
} catch { }
try {
  $r.firewallBrowser = [bool](Get-NetFirewallRule -DisplayName 'SQL Browser (UDP 1434)' -ErrorAction Stop | Where-Object { $_.Enabled -eq 'True' })
} catch { }
ConvertTo-Json -InputObject $r -Compress`;
  return (await ejecutarPs(script)) || {};
}

/**
 * Lo que solo sabe SQL Server. Cada pregunta por separado, por la misma razon.
 *
 * `sys.dm_tcp_listener_states` es mejor fuente que el registro: dice en que
 * puerto escucha DE VERDAD ahora mismo, no en cual deberia escuchar. Pero
 * exige VIEW SERVER STATE, asi que puede no responder; entonces se cae al
 * registro, que es lo que mira `senalesDeWindows`.
 */
async function senalesDeSql() {
  const out = {
    modoAutenticacion: null, puertoTcp: null,
    loginExiste: null, loginHabilitado: null, loginConPermisos: null,
    rolExiste: null,
  };
  let pool;
  try { pool = await db.getPool(); } catch (e) { log('Sin conexion a SQL: ' + e.message); return out; }

  const preguntar = async (sql, fn) => {
    try { fn((await pool.request().query(sql)).recordset?.[0] ?? null); }
    catch (e) { log('No se pudo consultar: ' + String(e.message).split('\n')[0]); }
  };

  await preguntar(
    "SELECT CAST(SERVERPROPERTY('IsIntegratedSecurityOnly') AS INT) AS soloWindows",
    f => { if (f && f.soloWindows != null) out.modoAutenticacion = f.soloWindows === 1 ? 'SOLO_WINDOWS' : 'MIXTA'; });

  await preguntar(
    `SELECT TOP 1 port FROM sys.dm_tcp_listener_states
     WHERE type = 0 AND state_desc = 'ONLINE' AND ip_address <> '127.0.0.1' ORDER BY port`,
    f => { if (f && f.port) out.puertoTcp = Number(f.port); });

  await preguntar(
    `SELECT is_disabled FROM sys.server_principals WHERE name = N'${USUARIO_RED}' AND type = 'S'`,
    f => { out.loginExiste = !!f; if (f) out.loginHabilitado = f.is_disabled === false || f.is_disabled === 0; });

  /* El ROL, antes que la membresia.
     `ocus_app_full_role` vivia solo dentro del template.bak heredado, asi que
     hay bases que no lo tienen. Preguntar unicamente por la membresia devolvia
     "no es miembro" en los dos casos -rol ausente y rol presente sin la cuenta
     dentro- y son dos problemas distintos con dos arreglos distintos. */
  await preguntar(
    `SELECT COUNT(*) AS n FROM sys.database_principals
      WHERE name = 'ocus_app_full_role' AND type = 'R'`,
    f => { if (f) out.rolExiste = Number(f.n) > 0; });

  // El rol es lo que convierte a la cuenta en util. Existir y no poder hacer
  // nada es un estado real y hay que poder nombrarlo.
  await preguntar(
    `SELECT COUNT(*) AS n
       FROM sys.database_role_members m
       JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
       JOIN sys.database_principals u ON u.principal_id = m.member_principal_id
      WHERE r.name = 'ocus_app_full_role' AND u.name = N'${USUARIO_RED}'`,
    f => { if (f) out.loginConPermisos = Number(f.n) > 0; });

  return out;
}

// ===========================================================================
//  API
// ===========================================================================

/** Estado actual, sin cambiar nada. Es lo que pinta la pantalla al abrirse. */
async function diagnosticar(plan) {
  const server = servidorConfigurado();
  const local = servidorEsLocal(server);

  const win = local ? await senalesDeWindows(instanciaDe(server)) : {};
  const sqlS = local ? await senalesDeSql() : {};

  const senales = {
    servidorEsLocal: local,
    modoAutenticacion: sqlS.modoAutenticacion ?? null,
    // El puerto que SQL declara manda; el del registro es el respaldo.
    puertoTcp: sqlS.puertoTcp ?? win.puertoRegistro ?? null,
    tcpHabilitado: win.tcpHabilitado ?? null,
    browser: win.browser ?? null,
    firewallSql: win.firewallSql ?? null,
    firewallBrowser: win.firewallBrowser ?? null,
    loginExiste: sqlS.loginExiste ?? null,
    loginHabilitado: sqlS.loginHabilitado ?? null,
    loginConPermisos: sqlS.loginConPermisos ?? null,
    rolExiste: sqlS.rolExiste ?? null,
    contrasenaGuardada: !!leerRedConfig()?.passwordEnc && hayCifradoReal(),
  };

  const veredicto = evaluarRed(senales);
  const cfg = leerRedConfig();

  return {
    servidor: server,
    // La que dijo el registro, si supo cual; si no, la que nombre la
    // configuracion. Nunca una supuesta.
    instancia: win.instancia || instanciaDe(server) || null,
    usuario: USUARIO_RED,
    baseDatos: DB_NAME,
    puerto: PUERTO,
    ips: direccionesLocales(),
    equipo: os.hostname(),
    rotadaEn: cfg?.rotadaEn ?? null,
    puedeGuardarContrasena: hayCifradoReal(),
    accion: queHacer(veredicto, plan),
    ...veredicto,
  };
}

/**
 * Deja esta maquina lista para servir a otras cajas. Idempotente.
 *
 * ORDEN, Y POR QUE ESE
 * --------------------
 *   1. La red (elevado): modo mixto, puerto, Browser, firewall. Va primero
 *      porque el modo mixto exige reiniciar el servicio, y crear el login
 *      antes de eso significaria crearlo y perder la conexion a continuacion.
 *   2. El login y sus permisos: con la sesion normal de Wybix, que ya es la
 *      que administra esta base. No hace falta elevar para esto.
 *   3. Guardar la contrasena cifrada.
 *
 * `rotar` sirve para los dos casos que parecen uno solo: generar la primera
 * contrasena, y cambiar una que ya existe. Rotar reescribe el login con
 * `ALTER LOGIN`, asi que las secundarias que ya estaban conectadas tendran que
 * volver a introducirla. Eso no es un efecto colateral: es lo que se le pide
 * a una rotacion, y la pantalla lo advierte antes.
 */
async function preparar({ rotar = false } = {}) {
  const server = servidorConfigurado();
  if (!servidorEsLocal(server)) {
    return { ok: false, error: 'La base de datos está en otro equipo. Prepara la red en esa máquina.' };
  }

  const previo = leerContrasena();
  const contrasena = (!rotar && previo) ? previo : generarContrasenaRed();
  const esNueva = contrasena !== previo;

  // ------------------------------------------------------------ 1) la red
  const paths = setupServer.resolvePaths();
  const resultFile = path.join(os.tmpdir(), `wybix_red_${Date.now()}.json`);
  let red = null;

  if (!fs.existsSync(paths.psRed)) {
    return { ok: false, error: `No se encontró el script de red en: ${paths.psRed}` };
  }

  try {
    await setupServer.runElevated(paths.psRed, {
      InstanceName: instanciaDe(server),
      Port: String(PUERTO),
      ResultFile: resultFile,
    });
    red = leerResultado(resultFile);
  } catch (e) {
    // El script escribe su resultado ANTES de salir con codigo 1, asi que
    // aqui todavia se puede decir en que paso exacto se quedo, en vez de
    // devolver "fallo la configuracion" y nada mas.
    red = leerResultado(resultFile);
    const detalle = red?.error || e.message;
    return { ok: false, error: detalle, pasos: red?.pasos ?? [], fase: 'red' };
  }

  if (red && red.ok === false) {
    return { ok: false, error: red.error || 'No se pudo preparar la red.', pasos: red.pasos ?? [], fase: 'red' };
  }

  // El servicio pudo reiniciarse: el pool que tuviera Wybix ya no sirve.
  if (red?.reinicioServicio) {
    log('El servicio SQL se reinicio: reconectando.');
    try { await db.reconnect(); } catch (e) { log('Reconexion: ' + e.message); }
  }

  // ------------------------------------------------ 2) la cuenta y sus permisos
  try {
    await setupServer.ensureLogin(server, DB_NAME, USUARIO_RED, contrasena);
    await setupServer.ensureSchemaPermissions(server, DB_NAME);
  } catch (e) {
    return { ok: false, error: `No se pudo crear la cuenta de red: ${e.message}`, pasos: red?.pasos ?? [], fase: 'cuenta' };
  }

  // --------------------------------------------------------- 3) la contrasena
  const guardado = guardarContrasena(contrasena);

  return {
    ok: true,
    rotada: esNueva,
    contrasena,
    guardada: guardado.guardada,
    pasos: red?.pasos ?? [],
    reinicioServicio: !!red?.reinicioServicio,
    servidor: server,
    usuario: USUARIO_RED,
    baseDatos: DB_NAME,
    puerto: PUERTO,
    ips: direccionesLocales(),
    equipo: os.hostname(),
  };
}

function leerResultado(ruta) {
  try {
    if (!fs.existsSync(ruta)) return null;
    const j = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    return j;
  } catch { return null; }
  finally { try { fs.unlinkSync(ruta); } catch { /* noop */ } }
}

/** Volver a ver la contrasena guardada, para dar de alta una tercera caja. */
function revelarContrasena() {
  const p = leerContrasena();
  if (!p) {
    return {
      ok: false,
      error: hayCifradoReal()
        ? 'No hay ninguna contraseña guardada en este equipo. Genera una nueva.'
        : 'Este equipo no puede guardar contraseñas de forma segura, así que no se guardó ninguna. Genera una nueva.',
    };
  }
  return { ok: true, contrasena: p, usuario: USUARIO_RED, servidor: servidorConfigurado(), ips: direccionesLocales() };
}

module.exports = {
  USUARIO_RED,
  diagnosticar,
  preparar,
  revelarContrasena,
  direccionesLocales,
  instanciaDe,
};
