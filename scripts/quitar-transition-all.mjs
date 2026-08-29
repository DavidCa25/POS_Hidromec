/**
 * Sustituye `transition: all` por la lista explícita de lo que debe animarse.
 *
 * `all` anima cualquier propiedad que cambie, incluidas las que provocan
 * layout, y es imposible razonar qué está en movimiento. Es además la
 * primera cosa que se marca en cualquier revisión de motion (Emil).
 *
 *    node scripts/quitar-transition-all.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const DRY = process.argv.includes('--dry');
const EXT = new Set(['.css', '.ts']);
const OMITIR = ['src/styles.css', 'src/styles/'];

const EXPLICITA =
  'background-color var(--wx-dur-micro) ease, ' +
  'border-color var(--wx-dur-micro) ease, ' +
  'color var(--wx-dur-micro) ease, ' +
  'opacity var(--wx-dur-micro) ease, ' +
  'box-shadow var(--wx-dur-micro) ease, ' +
  'transform var(--wx-dur-press) var(--wx-ease-out)';

function archivos(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (EXT.has(extname(p))) out.push(p);
  }
  return out;
}

let tocados = 0, n = 0;
for (const f of archivos('src')) {
  const rel = f.replace(/\\/g, '/');
  if (OMITIR.some(o => rel === o || rel.startsWith(o))) continue;

  const orig = readFileSync(f, 'utf8');
  const s = orig.replace(/transition\s*:\s*all\b[^;}]*/g, () => { n++; return `transition: ${EXPLICITA}`; });
  if (s !== orig) { tocados++; if (!DRY) writeFileSync(f, s); }
}
console.log(`${DRY ? '[dry] ' : ''}archivos: ${tocados} · transition-all sustituidos: ${n}`);
