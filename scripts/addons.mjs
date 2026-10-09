/**
 * ELIGE EL ADDON DE CLIENTE DE ESTE BUILD.
 *
 *     node scripts/addons.mjs                  Wybix de siempre (sin addon)
 *     WYBIX_ADDON=wybix_idonut node scripts/addons.mjs
 *     node scripts/addons.mjs wybix_idonut
 *
 * Corre antes de cada `ng build` / `ng serve` (ver package.json). Escribe tres
 * cosas que NO se versionan (.gitignore):
 *
 *   src/app/marca/addons.generated.ts   qué addon importa la app
 *   src/assets/addon/                   las imágenes del addon
 *   electron/addon.generated.json       id y canal de actualización
 *
 * Sin addon los tres quedan vacíos o no existen: un build normal no lleva nada
 * de ningún cliente aunque el anterior haya sido de uno.
 *
 * Comprueba el manifiesto: que el addon exista, que su id sea el de su carpeta
 * y que la versión de Wybix sea al menos la que pide (`wybixMin`).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const id = (process.argv[2] ?? process.env.WYBIX_ADDON ?? '').trim();

const GENERADO = join(RAIZ, 'src/app/marca/addons.generated.ts');
const ASSETS = join(RAIZ, 'src/assets/addon');
const ELECTRON = join(RAIZ, 'electron/addon.generated.json');
const CABECERA = '// Generado por scripts/addons.mjs. No editar ni versionar.\n';

const version = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0);
const menor = (a, b) => { const x = version(a), y = version(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) < (y[i] ?? 0); return false; };

function fallar(msg) { console.error(`addons: ${msg}`); process.exit(1); }

rmSync(ASSETS, { recursive: true, force: true });
rmSync(ELECTRON, { force: true });

if (!id) {
  writeFileSync(GENERADO, `${CABECERA}import type { AddonWybix } from './marca';\n\nexport const ADDONS: AddonWybix[] = [];\n`);
  console.log('addons: build sin addon de cliente');
  process.exit(0);
}

if (!/^wybix_[a-z0-9_]+$/.test(id)) fallar(`"${id}" no es un id válido (wybix_<cliente>, minúsculas).`);
const carpeta = join(RAIZ, 'custom-addons', id);
const rutaManifiesto = join(carpeta, 'manifest.json');
if (!existsSync(rutaManifiesto)) fallar(`no existe custom-addons/${id}/manifest.json`);

const manifiesto = JSON.parse(readFileSync(rutaManifiesto, 'utf8'));
const wybix = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version;
if (manifiesto.id !== id) fallar(`el manifiesto dice "${manifiesto.id}" y la carpeta "${id}".`);
if (!manifiesto.canal || !/^[a-z0-9-]+$/.test(manifiesto.canal) || manifiesto.canal === 'latest')
  fallar('el manifiesto necesita un "canal" propio (minúsculas, distinto de "latest").');
if (!manifiesto.publicacion?.owner || !manifiesto.publicacion?.repo)
  fallar('el manifiesto necesita "publicacion": { "owner", "repo" } (repositorio de releases del cliente).');
if (manifiesto.wybixMin && menor(wybix, manifiesto.wybixMin))
  fallar(`${id} pide Wybix ${manifiesto.wybixMin} o mayor y este es ${wybix}.`);

writeFileSync(GENERADO, `${CABECERA}import type { AddonWybix } from './marca';\nimport addon from '../../../custom-addons/${id}';\n\nexport const ADDONS: AddonWybix[] = [addon];\n`);

const assets = join(carpeta, 'assets');
if (existsSync(assets)) { mkdirSync(ASSETS, { recursive: true }); cpSync(assets, ASSETS, { recursive: true }); }

writeFileSync(ELECTRON, JSON.stringify({ id, nombre: manifiesto.nombre, version: manifiesto.version, canal: manifiesto.canal }, null, 2) + '\n');
console.log(`addons: ${id} ${manifiesto.version} (canal "${manifiesto.canal}")`);
