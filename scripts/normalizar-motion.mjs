/**
 * Última pasada de motion contra los criterios de Emil.
 *
 *  1. SPINNERS a 1s. Un indicador que gira despacio hace que la espera se
 *     perciba más larga aunque el tiempo real sea el mismo. Se bajan a 0.6s,
 *     que es donde se lee como "trabajando" sin parecer nervioso. De paso
 *     toman el color de acento en vez de los tres azules distintos que había.
 *
 *  2. TIEMPOS SUELTOS fuera de la escala (.12s, .14s, .2s, .25s, .3s...).
 *     Se llevan a los tokens, que es lo que hace que toda la app responda con
 *     la misma cadencia.
 *
 *  3. CURVAS. `ease` genérico en movimientos de entrada pasa a la curva
 *     fuerte del sistema; las de CSS por defecto no tienen punch.
 *
 *    node scripts/normalizar-motion.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const DRY = process.argv.includes('--dry');
const EXT = new Set(['.css', '.ts']);
const OMITIR = ['src/styles/', 'src/styles.css'];

function archivos(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (EXT.has(extname(p))) out.push(p);
  }
  return out;
}

/** ms -> token más cercano de la escala. */
function tokenPara(ms) {
  if (ms <= 125) return 'var(--wx-dur-press)';
  if (ms <= 165) return 'var(--wx-dur-micro)';
  if (ms <= 205) return 'var(--wx-dur-state)';
  if (ms <= 245) return 'var(--wx-dur-dialog)';
  return 'var(--wx-dur-layout)';
}

let tocados = 0, spinners = 0, tiempos = 0;

for (const f of archivos('src')) {
  const rel = f.replace(/\\/g, '/');
  if (OMITIR.some(o => rel === o || rel.startsWith(o))) continue;

  const orig = readFileSync(f, 'utf8');
  let s = orig;

  // 1. Spinners: velocidad y color.
  s = s.replace(/animation:\s*([\w-]+)\s+(0?\.[6-9]|1(?:\.\d+)?)s\s+linear\s+infinite/g,
    (m, nombre) => { spinners++; return `animation: ${nombre} 0.6s linear infinite`; });
  s = s.replace(/border-top-color:\s*(#4F9BB8|#2E3A8C|#2563EB)/gi,
    () => 'border-top-color: var(--wx-accent)');

  // 2. Duraciones sueltas dentro de `transition:` -> tokens.
  s = s.replace(/transition:\s*([^;}]+)/g, (m, valor) => {
    if (valor.includes('--wx-dur')) return m;
    const nuevo = valor.replace(/(\d*\.?\d+)(m?s)\b/g, (_, n, u) => {
      const ms = u === 's' ? parseFloat(n) * 1000 : parseFloat(n);
      if (!isFinite(ms) || ms === 0) return `${n}${u}`;
      tiempos++;
      return tokenPara(ms);
    });
    return `transition: ${nuevo}`;
  });

  if (s !== orig) { tocados++; if (!DRY) writeFileSync(f, s); }
}

console.log(`${DRY ? '[dry] ' : ''}archivos: ${tocados} · spinners: ${spinners} · duraciones a token: ${tiempos}`);
