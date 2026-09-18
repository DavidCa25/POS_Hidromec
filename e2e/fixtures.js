/**
 * LA APLICACION DE VERDAD, ARRANCADA DE VERDAD.
 *
 * Aqui no se simula HTML ni se lee el fuente: se lanza Electron, con su
 * proceso principal, su preload y su conexion a SQL Server, y se opera la
 * ventana como la operaria una persona. Es la unica forma de comprobar que la
 * autorizacion existe de punta a punta, porque la pregunta interesante -«¿que
 * pasa si alguien invoca el canal a mano?»- solo tiene respuesta cuando hay un
 * canal de verdad al otro lado.
 *
 * AISLAMIENTO
 * -----------
 * Cada arranque recibe su propio `--user-data-dir` (ver `perfil.js`). Ahi
 * dentro caen la configuracion de base de datos, la licencia y las
 * preferencias, asi que la instalacion real de quien ejecute las pruebas no se
 * entera de nada: ni se lee ni se escribe. Al terminar, la carpeta se borra.
 *
 * Y la base es `Wybix_E2E_Core`, preparada por `e2e/preparar-bases.mjs`. Las
 * guardas de `exigirTemporal` hacen imposible que estas herramientas toquen
 * `Wybix_POS`, `Wybix_Production` o `Wybix_Template`.
 */
const { test: base, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const { nuevoPerfil, opcionesDeArranque, BASE_CORE, BASE_SERVICIOS } = require('./perfil');

/** Las mismas credenciales que siembra `preparar-bases.mjs`. */
const CUENTAS = {
  admin:     { usuario: 'e2e_admin',      password: 'e2e-admin-1234',     etiqueta: 'Administrador' },
  encargado: { usuario: 'e2e_encargado',  password: 'e2e-encargado-1234', etiqueta: 'Encargado' },
  operador:  { usuario: 'e2e_operador',   password: 'e2e-operador-1234',  etiqueta: 'Operador' },
  heredado:  { usuario: 'e2e_heredado',   password: 'e2e-heredado-1234',  etiqueta: 'Sin rol asignado' },
};

/** El puente del renderer, para llamar canales tal cual lo hace la interfaz. */
async function invocar(ventana, metodo, ...args) {
  return ventana.evaluate(
    ([m, a]) => (window).electronAPI[m](...a),
    [metodo, args]);
}

/**
 * Arranca la aplicacion contra una base y la deja en la pantalla de acceso.
 *
 * Una sola funcion para las dos bases: Core y Servicios se abren exactamente
 * igual, y lo unico que cambia es a que base apunta la configuracion. Dos
 * copias de esto se habrian separado en cuanto una de las dos necesitara algo.
 */
async function arrancar(base, use, testInfo) {
  const perfil = await nuevoPerfil(base);
  const app = await electron.launch(opcionesDeArranque(perfil));

  /* La salida del proceso principal se adjunta al informe cuando algo falla.
     El motivo casi siempre esta ahi y no en el DOM. */
  const registro = [];
  app.process().stdout.on('data', (d) => registro.push(String(d)));
  app.process().stderr.on('data', (d) => registro.push('[err] ' + String(d)));

  const ventana = await app.firstWindow({ timeout: 120000 });
  await ventana.waitForFunction(() => !!(window).electronAPI, null, { timeout: 60000 });
  await ventana.waitForSelector('#username', { timeout: 60000 });

  await use({ app, ventana, perfil, base, invocar: (m, ...a) => invocar(ventana, m, ...a) });

  if (testInfo.status !== testInfo.expectedStatus && registro.length) {
    await testInfo.attach('proceso-principal.log',
      { body: registro.join(''), contentType: 'text/plain' });
  }
  await app.close().catch(() => {});
  try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* noop */ }
}

const test = base.extend({
  /** Contra `Wybix_E2E_Core`: Core 0, con el modulo Servicios apagado. */
  app: async ({}, use, testInfo) => { await arrancar(BASE_CORE, use, testInfo); },

  /** Contra `Wybix_E2E_Servicios`: el modulo encendido y listo para trabajar. */
  appServicios: async ({}, use, testInfo) => { await arrancar(BASE_SERVICIOS, use, testInfo); },
});

module.exports = { test, expect, CUENTAS, BASE_CORE, BASE_SERVICIOS, invocar };
