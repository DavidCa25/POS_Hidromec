/**
 * Pruebas de extremo a extremo: Electron de verdad, IPC de verdad, SQL de verdad.
 *
 *     npm run e2e            prepara las bases y las ejecuta
 *     npm run e2e:core       solo Core 0
 *
 * SIN PARALELISMO
 * ---------------
 * Las pruebas comparten una base de SQL Server con nombre fijo. Dos ficheros a
 * la vez se pisarian: una prueba borraria la base que otra esta usando, y el
 * fallo aparecerian en la prueba equivocada. Ya paso con las pruebas de base de
 * datos, y se arreglo exactamente asi.
 *
 * SIN REINTENTOS
 * --------------
 * Un reintento convierte «esto falla una de cada tres veces» en «esto pasa», y
 * eso es peor que no tener la prueba. Si una es inestable, se arregla.
 */
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.js/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 20000 },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    video: 'off',
  },
});
