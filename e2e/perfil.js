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
 */
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
    env: { ...process.env, WYBIX_UI_DIST: '1', WYBIX_E2E: '1' },
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
  await v.evaluate(() => window.electronAPI.licenseSave({
    type: 'paid', plan: 'mono', customerName: 'Pruebas E2E',
  }));
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
