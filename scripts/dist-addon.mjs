/**
 * INSTALADOR DE UN CLIENTE CON SU ADDON.
 *
 *     npm run dist:addon -- wybix_idonut
 *
 * Igual que `npm run dist`, pero:
 *   - compila con el addon (scripts/addons.mjs con WYBIX_ADDON);
 *   - deja el instalador en release-<canal>/ (fuera del repositorio);
 *   - su archivo de actualización es <canal>.yml, no latest.yml, y la app del
 *     cliente lo busca en SU repositorio de releases (manifest.publicacion),
 *     nunca en el general (ver setupAutoUpdater en electron/main.js).
 *
 * Mismo appId que Wybix POS: se instala ENCIMA del Wybix que ya tiene el
 * cliente y conserva su base, licencia y configuración.
 *
 * No publica nada, salvo con --publicar (lo usa `npm run publish -- --addon <id>`,
 * que pone el token). Al terminar, el árbol vuelve a quedar sin addon para que el
 * siguiente `npm run build` sea el Wybix general.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
const publicar = process.argv.includes('--publicar');
const notas = process.env.WYBIX_NOTAS;
if (!id) { console.error('Uso: npm run dist:addon -- wybix_<cliente>'); process.exit(1); }

const { canal, publicacion } = JSON.parse(readFileSync(join(RAIZ, 'custom-addons', id, 'manifest.json'), 'utf8'));
const correr = (cmd, env = {}) => execSync(cmd, { cwd: RAIZ, stdio: 'inherit', env: { ...process.env, ...env } });

try {
  correr('node scripts/verificar-llaves-licencia.mjs');
  correr('npm run db:check-template');
  correr('npm run build', { WYBIX_ADDON: id });
  correr([
    `npx electron-builder --publish ${publicar ? 'always' : 'never'}`,
    `-c.publish.channel=${canal}`,
    // El instalador queda apuntando al repositorio de releases del cliente.
    `-c.publish.owner=${publicacion.owner}`,
    `-c.publish.repo=${publicacion.repo}`,
    `-c.directories.output=release-${canal}`,
    `-c.nsis.artifactName=Wybix-Setup-${canal}.exe`,
    ...(notas ? [`"-c.releaseInfo.releaseNotesFile=${notas}"`] : []),
  ].join(' '));
  console.log(`\nInstalador: release-${canal}/Wybix-Setup-${canal}.exe  (actualizaciones: ${canal}.yml)`);
} finally {
  correr('node scripts/addons.mjs');
}
