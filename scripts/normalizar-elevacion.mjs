/**
 * Normaliza elevación y respuesta al puntero en los CSS de componente.
 *
 *  1. HOVER QUE LEVANTA. 35 reglas hacían `transform: translateY(-1..-3px)`
 *     al pasar el ratón, casi siempre acompañado de una sombra que crecía.
 *     Es el gesto de una landing: desplaza el objetivo justo en el momento en
 *     que el usuario va a hacer clic, y en una app que se usa todo el día
 *     resulta inquieto. Se sustituye por respuesta de color/superficie, que
 *     es más rápida de percibir y no mueve nada (Emil).
 *
 *  2. SOMBRAS. 91 declaraciones con difuminados de 18 a 60px, cada archivo
 *     con su propia receta. Se recalibran a la escala del sistema, que
 *     conserva la sensación de tarjeta pero mucho más fina.
 *
 * NO toca: sombras `inset`, anillos de foco (`0 0 0 Npx`), ni keyframes.
 *
 *    node scripts/normalizar-elevacion.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const DRY = process.argv.includes('--dry');
const EXT = new Set(['.css', '.ts']);
const OMITIR = ['src/styles.css', 'src/styles/'];

function archivos(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (EXT.has(extname(p))) out.push(p);
  }
  return out;
}

/** Mayor difuminado que aparece en la declaración. */
function blurMax(valor) {
  const nums = [...valor.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map(m => Math.abs(Number(m[1])));
  // Un box-shadow es `x y blur spread`: el tercer número de cada capa.
  return nums.length ? Math.max(...nums) : 0;
}

let tocados = 0, lifts = 0, sombras = 0;

for (const f of archivos('src')) {
  const rel = f.replace(/\\/g, '/');
  if (OMITIR.some(o => rel === o || rel.startsWith(o))) continue;

  const orig = readFileSync(f, 'utf8');
  let s = orig;

  // 1. Quitar el desplazamiento en hover, bloque a bloque.
  s = s.replace(/([^{}]*):hover([^{}]*)\{([^{}]*)\}/g, (m, pre, post, cuerpo) => {
    if (!/translateY\(\s*-/.test(cuerpo)) return m;
    lifts++;
    const limpio = cuerpo
      // `transform: translateY(-2px);` -> fuera
      .replace(/transform\s*:\s*translateY\(\s*-[^;)]*\)\s*;?/g, '')
      // `transform: translateY(-2px) scale(1.02);` -> conserva el resto
      .replace(/translateY\(\s*-[^;)]*\)\s*/g, '');
    return `${pre}:hover${post}{${limpio}}`;
  });

  // 2. Recalibrar sombras difusas.
  s = s.replace(/box-shadow\s*:\s*([^;}]+)([;}])/g, (m, valor, fin) => {
    if (/inset/i.test(valor)) return m;
    if (/var\(--wx-shadow/.test(valor)) return m;
    if (/^\s*none\s*$/i.test(valor)) return m;
    // Anillo de foco: sin difuminado, solo spread.
    if (/^\s*0\s+0\s+0\s/.test(valor)) return m;
    const b = blurMax(valor);
    if (b < 14) return m;
    sombras++;
    return `box-shadow: var(--wx-shadow-raised)${fin}`;
  });

  if (s !== orig) { tocados++; if (!DRY) writeFileSync(f, s); }
}

console.log(`${DRY ? '[dry] ' : ''}archivos: ${tocados} · hover-lift retirados: ${lifts} · sombras recalibradas: ${sombras}`);
