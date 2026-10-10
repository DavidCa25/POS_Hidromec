/**
 * ADDONS DE CLIENTE: lo que no se puede romper.
 *
 *     npm run test:addons
 *
 * 1. Sin addon el build no lleva nada de ningún cliente.
 * 2. Con addon se generan su import, sus imágenes y su canal.
 * 3. Un id o un manifiesto inválidos detienen el build.
 * 4. El núcleo (src/, electron/, shared/) nunca nombra a un cliente: los
 *    huecos se piden por nombre de hueco, no por cliente.
 * 5. Cada addon cumple el contrato (manifiesto completo, index que exporta).
 *
 * Que el addon COMPILE contra el núcleo actual lo garantiza tsconfig.app.json
 * (incluye custom-addons/): un cambio general que rompa un hueco hace fallar
 * `npm run build`, con o sin addon.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let fallos = 0, total = 0;
const check = (ok, msg, extra = '') => { total++; if (!ok) fallos++; console.log(`   ${ok ? 'ok   ' : 'FALLA'}  ${msg}${extra ? '  · ' + extra : ''}`); };
const gen = (id) => { try { execFileSync(process.execPath, ['scripts/addons.mjs', ...(id ? [id] : [])], { cwd: RAIZ, stdio: 'pipe', env: { ...process.env, WYBIX_ADDON: '' } }); return true; } catch { return false; } };
const leer = (p) => readFileSync(join(RAIZ, p), 'utf8');
const ADDONS = readdirSync(join(RAIZ, 'custom-addons')).filter((d) => statSync(join(RAIZ, 'custom-addons', d)).isDirectory());

try {
  console.log('\n-- 1. Sin addon');
  check(gen(null), 'el generador corre sin addon');
  check(/ADDONS: AddonWybix\[\] = \[\]/.test(leer('src/app/marca/addons.generated.ts')), 'la app no importa ningún addon');
  check(!existsSync(join(RAIZ, 'src/assets/addon')), 'no quedan imágenes de un addon anterior');
  check(!existsSync(join(RAIZ, 'electron/addon.generated.json')), 'sin canal propio: actualiza de latest.yml');

  for (const id of ADDONS) {
    console.log(`\n-- 2. Con ${id}`);
    const m = JSON.parse(leer(`custom-addons/${id}/manifest.json`));
    check(m.id === id && !!m.nombre && !!m.version && !!m.canal && m.canal !== 'latest', 'manifiesto completo y canal propio');
    check(/export default/.test(leer(`custom-addons/${id}/index.ts`)), 'index.ts exporta el addon');
    check(gen(id), 'el generador lo acepta');
    check(leer('src/app/marca/addons.generated.ts').includes(`custom-addons/${id}`), 'la app lo importa');
    const e = JSON.parse(leer('electron/addon.generated.json'));
    check(e.id === id && e.canal === m.canal, 'Electron conoce su canal', e.canal);
    if (existsSync(join(RAIZ, 'custom-addons', id, 'assets')))
      check(existsSync(join(RAIZ, 'src/assets/addon')), 'sus imágenes se copian a assets/addon');
  }

  console.log('\n-- 3. Entradas inválidas');
  check(!gen('wybix_no_existe'), 'un addon que no existe detiene el build');
  check(!gen('../src'), 'un id con ruta detiene el build');

  console.log('\n-- 4. El núcleo no nombra clientes');
  const nombres = ADDONS.map((id) => id.replace(/^wybix_/, ''));
  const malos = [];
  const recorrer = (dir) => {
    for (const f of readdirSync(join(RAIZ, dir))) {
      const p = join(dir, f), abs = join(RAIZ, p);
      if (/node_modules|addons\.generated|addon\.generated|assets[\\/]addon/.test(p)) continue;
      if (statSync(abs).isDirectory()) { recorrer(p); continue; }
      if (!/\.(ts|js|cjs|mjs|html|css)$/.test(f)) continue;
      const t = readFileSync(abs, 'utf8').toLowerCase();
      for (const n of nombres) if (t.includes(n)) malos.push(`${relative(RAIZ, abs)} (${n})`);
    }
  };
  for (const d of ['src', 'electron', 'shared']) recorrer(d);
  check(malos.length === 0, 'ningún archivo del núcleo menciona a un cliente', malos.slice(0, 5).join(', '));
} finally {
  gen(null);
}
console.log(`\nRESULTADO: ${fallos ? fallos + ' FALLO(S)' : 'OK'} (${total} comprobaciones)`);
process.exit(fallos ? 1 : 0);
