/**
 * Corre un script con el Node de Electron (ELECTRON_RUN_AS_NODE=1).
 *
 * El driver de SQL Server del proyecto (msnodesqlv8) esta compilado para
 * Electron: con el Node del sistema no carga. Asi las pruebas que hablan con
 * una base de verdad usan exactamente el mismo driver que la aplicacion.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');
const r = spawnSync(electron, process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(r.status ?? 1);
