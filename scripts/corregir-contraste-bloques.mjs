/**
 * Corrige las combinaciones texto/fondo que el auditor por bloques encontro
 * por debajo de AA.
 *
 * Los fallos caen en cuatro familias, y cada una tiene una causa distinta:
 *
 *   A. Texto claro sobre un relleno de color (cyan o verde). Es el error mas
 *      comun: se asume que sobre color va blanco, pero el cyan y el verde de
 *      marca son claros y el blanco encima da 2-3:1. Va tinta oscura.
 *
 *   B. `#4F9BB8` usado como TEXTO sobre superficie clara. Ese cyan esta hecho
 *      para rellenar, no para escribir: sobre blanco da 2.8:1.
 *
 *   C. `--wx-text-muted` / `--wx-text-dim` sobre la cabecera navy fija de los
 *      dialogos de facturacion. Esos tokens estan calibrados contra las
 *      superficies del tema, no contra un navy puesto a mano.
 *
 *   D. Estados `:disabled`. NO se tocan: WCAG exime a los controles
 *      deshabilitados, y subirles el contraste haria que no se distingan de
 *      los activos, que es justo lo que deben comunicar.
 *
 *    node scripts/corregir-contraste-bloques.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const DRY = process.argv.includes('--dry');

function archivos(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (['.css', '.ts'].includes(extname(p))) out.push(p);
  }
  return out;
}

/** Rellenos claros sobre los que el texto debe ser tinta oscura. */
const RELLENOS_CLAROS = /#45B3C3|#4F9BB8|#10b981|#22c55e|#16a34a|#10B981|#22C55E|#16A34A/;

let cambios = 0;
const detalle = [];

for (const f of archivos('src')) {
  const rel = f.replace(/\\/g, '/');
  if (rel.startsWith('src/styles')) continue;
  const orig = readFileSync(f, 'utf8');
  let s = orig;

  s = s.replace(/([^{}@;]+)\{([^{}]*)\}/g, (todo, sel, cuerpo) => {
    // D. Los deshabilitados se dejan como estan.
    if (/:disabled|\[disabled\]/.test(sel)) return todo;

    let nuevo = cuerpo;
    const bg = (cuerpo.match(/background(?:-color)?\s*:\s*([^;!]+)/) || [])[1] || '';

    // A. Texto claro sobre relleno claro de marca.
    if (RELLENOS_CLAROS.test(bg)) {
      nuevo = nuevo.replace(/(?<!-)\bcolor\s*:\s*(#fff\b|#ffffff\b|#E8EFF6\b|#e8eff6\b|var\(--wx-text\))/gi,
        'color: var(--wx-accent-ink)');
    }

    // C. Texto atenuado sobre la cabecera navy fija.
    if (/#0F2A3F|#0f2a3f/.test(bg)) {
      nuevo = nuevo.replace(/(?<!-)\bcolor\s*:\s*var\(--wx-text-(?:dim|muted)\)/g, 'color: #9DB2C4');
    }

    return nuevo === cuerpo ? todo : sel + '{' + nuevo + '}';
  });

  // C bis: los `<p>` de cabecera navy heredan el fondo del bloque padre, asi
  // que el reemplazo por bloque no los alcanza. Van por selector conocido.
  s = s.replace(/(\.(?:fc|fd|fn)-header p\s*\{[^}]*?)color:\s*var\(--wx-text-(?:dim|muted)\)/g,
    '$1color: #9DB2C4');

  // B. El cyan de relleno usado como texto pasa al cyan legible.
  s = s.replace(/(?<!-)\bcolor\s*:\s*#4F9BB8\b/gi, 'color: var(--wx-accent-text)');

  if (s !== orig) {
    cambios++;
    detalle.push(rel);
    if (!DRY) writeFileSync(f, s);
  }
}

console.log(`${DRY ? '[dry] ' : ''}archivos corregidos: ${cambios}`);
for (const d of detalle) console.log('  ' + d);
