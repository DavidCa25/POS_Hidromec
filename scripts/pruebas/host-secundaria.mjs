/**
 * Frontera HOST / caja secundaria.
 *
 *     node scripts/pruebas/host-secundaria.mjs
 *
 * Comprueba, sin abrir la aplicacion, la regla que decide quien puede
 * respaldar la base de la sucursal: el equipo que tiene el SQL Server. La
 * deteccion tiene que acertar con instancias con nombre, puertos y con el
 * hostname propio, porque de ella depende que una caja de mostrador no pida
 * privilegios administrativos que no le corresponden.
 */
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { servidorEsLocal } = require('../../electron/lib/host.js');

const equipo = os.hostname();
const casos = [
  // El host: SQL Server en la misma maquina.
  ['localhost', true],
  ['localhost\\SQLEXPRESS', true],
  ['LOCALHOST\\SQLEXPRESS', true],
  ['127.0.0.1', true],
  ['::1', true],
  ['.', true],
  ['(local)', true],
  ['localhost,1433', true],
  [equipo, true],
  [`${equipo}\\SQLEXPRESS`, true],
  [equipo.toUpperCase(), true],

  // Cajas secundarias: el servidor esta en otra computadora.
  ['192.168.1.50', false],
  ['192.168.1.50\\SQLEXPRESS', false],
  ['192.168.1.50,1433', false],
  ['CAJA-PRINCIPAL', false],
  ['caja-principal\\SQLEXPRESS', false],
  ['2.tcp.us-cal-1.ngrok.io', false],

  // Sin configuracion no se asume nada.
  ['', false],
  [null, false],
  [undefined, false],
];

let ok = 0;
const fallos = [];
for (const [entrada, esperado] of casos) {
  const r = servidorEsLocal(entrada);
  if (r === esperado) ok++;
  else fallos.push(`${JSON.stringify(entrada)} -> ${r}, se esperaba ${esperado}`);
  console.log(`  ${r === esperado ? 'ok   ' : 'FALLA'} ${JSON.stringify(entrada) || 'undefined'}`.padEnd(46) +
              `es host: ${r}`);
}

console.log(`\n${ok}/${casos.length} correctos`);
if (fallos.length) {
  console.log('\nFALLAS:');
  fallos.forEach(f => console.log('  ' + f));
  process.exit(1);
}
console.log('La frontera host/secundaria se resuelve bien en todos los casos.');
