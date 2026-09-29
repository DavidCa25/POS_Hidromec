/**
 * LA CARPETA DE DATOS DE UNA EJECUCION.
 *
 * Electron guarda en `userData` la conexion a la base, la licencia y las
 * preferencias. Darle una carpeta nueva a cada arranque es lo que hace que
 * estas pruebas no vean —ni toquen— la instalacion real de quien las ejecuta.
 *
 * POR QUE LA LICENCIA SE SIEMBRA ARRANCANDO LA APLICACION
 * ------------------------------------------------------
 * Esta cifrada y atada a la huella del equipo. Fabricarla desde la prueba
 * significaria reimplementar su formato aqui, y entonces la prueba dejaria de
 * comprobar el formato de verdad para comprobar su propia copia. Asi que se
 * arranca una vez, se pide por su canal, y la carpeta resultante se usa como
 * molde para las demas: el archivo lo escribio el producto, no la prueba.
 *
 * Se hace UNA vez por ejecucion, no una por prueba, porque arrancar Electron
 * cuesta unos segundos y multiplicarlo por cada caso no compra nada.
 *
 * LA LICENCIA ES UN CERTIFICADO FIRMADO DE VERDAD (licencias v2). Cada worker
 * genera una clave efímera; el POS confía en ella SOLO con WYBIX_E2E=1 y sin
 * empaquetar (WYBIX_E2E_LLAVE_PUBLICA). El certificado se firma aquí con el
 * mismo formato que el servidor, para el machineId que reporta la app, con
 * los tres giros: estas pruebas recorren Comercio, Restaurante y Servicios.
 */
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { TODOS } = require('../electron/licencia/entitlements.js');

const PAR = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const LLAVE_PUBLICA = PAR.publicKey.export({ type: 'spki', format: 'pem' });

/** Un certificado ACTIVE de un año, MonoCaja, tres giros y pantallas ilimitadas, para ESTE equipo. */
function certificadoDePruebas(machineId) {
  const ahora = Date.now(), DIA = 86400000, iso = (t) => new Date(t).toISOString();
  const pagado = ahora + 365 * DIA;
  const payload = {
    schema: 1, kind: 'LICENSE', license_id: 'e2e', customer: 'Pruebas E2E', machine_id: machineId,
    edition: 'mono', registers_max: 1, verticals: ['COMMERCE', 'HOSPITALITY', 'SERVICES'],
    /* Pantallas ilimitadas por giro (como SCREENS_UNLIMITED): estas pruebas
       recorren el emparejamiento, no la cuota, que se prueba aparte
       (test:licencia-v2 y test:licencia-integracion). */
    screens: { COMMERCE: null, HOSPITALITY: null, SERVICES: null }, entitlements: [...TODOS].sort(), addons: [],
    trial_started_at: null, trial_ends_at: null, first_activated_at: iso(ahora), paid_until: iso(pagado),
    grace_days: 45, grace_until: iso(pagado + 45 * DIA), offline_days: 45, issued_at: iso(ahora), valid_until: iso(ahora + 45 * DIA),
  };
  const cuerpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign('sha256', Buffer.from(cuerpo), { key: PAR.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return { format: 'wybix-license', v: 1, kid: 'e2e-1', payload: cuerpo, sig };
}

const RAIZ = path.join(__dirname, '..');
const SERVIDOR = process.env.WYBIX_DB_SERVER || 'localhost';
const BASE_CORE = process.env.WYBIX_E2E_DB || 'Wybix_E2E_Core';
const BASE_SERVICIOS = process.env.WYBIX_E2E_DB_SERVICIOS || 'Wybix_E2E_Servicios';

/** Los archivos que el proceso principal lee ANTES de abrir ninguna ventana. */
function escribirConfiguracion(dir, base) {
  fs.writeFileSync(path.join(dir, 'db-config.json'), JSON.stringify({
    server: SERVIDOR,
    database: base,
    auth: 'windows',
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  }, null, 2), 'utf8');

  /* El arranque decide si abrir el asistente mirando este archivo, y prepara
     el servidor con `install.dbName` ANTES de conectarse. Sin el nombre aqui
     caia en la constante `Wybix_POS`, que no es la base de estas pruebas. */
  fs.writeFileSync(path.join(dir, 'install-config.json'), JSON.stringify({
    role: 'principal',
    server: SERVIDOR,
    dbName: base,
    configuredAt: new Date().toISOString(),
  }, null, 2), 'utf8');
}

/** Opciones de arranque comunes a todos los usos. */
function opcionesDeArranque(perfil) {
  return {
    args: [path.join(RAIZ, 'electron', 'main.js'), `--user-data-dir=${perfil}`],
    cwd: RAIZ,
    /* La interfaz sale del bundle ya construido: levantar `ng serve` solo para
       las pruebas anadiria un minuto a cada ejecucion y fallos que no tienen
       que ver con lo que se prueba. */
    env: { ...process.env, WYBIX_UI_DIST: '1', WYBIX_E2E: '1', WYBIX_E2E_LLAVE_PUBLICA: LLAVE_PUBLICA },
    timeout: 120000,
  };
}

/* Un molde por base: la licencia se siembra una vez y se copia. */
const moldes = new Map();

/** Una carpeta con la licencia ya sembrada por la propia aplicacion. */
async function obtenerMolde(base = BASE_CORE) {
  if (moldes.has(base)) return moldes.get(base);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wybix-molde-'));
  escribirConfiguracion(dir, base);

  const app = await electron.launch(opcionesDeArranque(dir));
  const v = await app.firstWindow({ timeout: 120000 });
  await v.waitForFunction(() => !!(window).electronAPI, null, { timeout: 60000 });
  /* La licencia se aplica desde el proceso principal: el renderer ya no
     puede escribir una (licencias v2). Solo existe con WYBIX_E2E. */
  const machineId = await app.evaluate(() => global.__wybixE2E.machineId());
  const sembrado = await app.evaluate((_e, cert) => global.__wybixE2E.sembrarCertificado(cert), certificadoDePruebas(machineId));
  if (!sembrado?.ok) throw new Error(`El certificado de pruebas no se aplicó: ${JSON.stringify(sembrado)}`);
  const estado = await v.evaluate(() => window.electronAPI.licenseStatus());
  await app.close();

  if (estado?.state !== 'active') {
    throw new Error(`La licencia de pruebas no quedo activa: ${JSON.stringify(estado)}`);
  }
  moldes.set(base, dir);
  return dir;
}

/** Una copia del molde, para una prueba. */
async function nuevoPerfil(base = BASE_CORE) {
  const origen = await obtenerMolde(base);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wybix-e2e-'));
  fs.cpSync(origen, dir, { recursive: true });
  escribirConfiguracion(dir, base);   // por si la prueba pide otra base
  return dir;
}

function borrarMolde() {
  for (const dir of moldes.values()) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
  moldes.clear();
}

module.exports = { nuevoPerfil, opcionesDeArranque, borrarMolde, escribirConfiguracion,
                   SERVIDOR, BASE_CORE, BASE_SERVICIOS, RAIZ };
