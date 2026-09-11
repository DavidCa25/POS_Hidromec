/**
 * Contraste POR BLOQUE DE REGLA.
 *
 * El auditor por lineas (`auditar-contraste.mjs`) solo ve `color:` con hex
 * literal contra las superficies del tema. Se le escapan dos casos reales que
 * apareceieron en el modal de cobro:
 *
 *   .cobro-total-card { background: #0F2A3F }
 *   .cobro-total-card .label { color: var(--wx-text-dim) }   -> 2.98:1
 *
 *   .pay-pill.active { background: var(--wx-accent); color: var(--wx-text) }
 *                                                            -> 2.12:1
 *
 * Es decir: token de texto sobre fondo fijo, y token sobre token. Este script
 * resuelve los tokens de `tokens.css` en los dos lados y compara dentro del
 * mismo bloque, y ademas hereda el fondo del selector padre cuando el bloque
 * solo declara color.
 *
 *    node scripts/auditar-contraste-bloques.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

// ---------------------------------------------------------------- tokens
function leerTokens() {
  const css = readFileSync('src/styles/tokens.css', 'utf8');
  const claro = {}, oscuro = {};
  const iDark = css.indexOf('html.dark');
  const trozo = (t) => [...t.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)];
  for (const [, k, v] of trozo(css.slice(0, iDark))) claro[k] = v.trim();
  for (const [, k, v] of trozo(css.slice(iDark))) oscuro[k] = v.trim();
  return { claro: { ...claro }, oscuro: { ...claro, ...oscuro } };
}

/** Resuelve var(--x) encadenados hasta dar con un hex. */
function resolver(valor, mapa, saltos = 0) {
  if (!valor || saltos > 8) return null;
  const v = valor.trim();
  const hex = v.match(/#[0-9a-fA-F]{3,8}/);
  if (hex && !v.startsWith('var(')) return hex[0];
  const m = v.match(/var\(\s*(--[\w-]+)/);
  if (m && mapa[m[1]]) return resolver(mapa[m[1]], mapa, saltos + 1);
  return hex ? hex[0] : null;
}

const aRgb = (hex) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16));
};
const lum = (rgb) => {
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const ra = aRgb(a), rb = aRgb(b);
  if (!ra || !rb) return null;
  const [x, y] = [lum(ra), lum(rb)];
  return +(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05))).toFixed(2);
};

// ---------------------------------------------------------------- archivos
function archivos(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (['.css', '.ts'].includes(extname(p))) out.push(p);
  }
  return out;
}

const T = leerTokens();
const hallazgos = [];

for (const f of archivos('src')) {
  const rel = f.replace(/\\/g, '/');
  if (rel.startsWith('src/styles')) continue;
  const css = readFileSync(f, 'utf8');

  // Bloques `selector { ... }` sin anidamiento (el CSS del proyecto es plano).
  const bloques = [...css.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)];

  // Fondos declarados por selector, para poder heredar al hijo.
  const fondoDe = new Map();
  for (const [, sel, cuerpo] of bloques) {
    const bg = cuerpo.match(/background(?:-color)?\s*:\s*([^;]+)/);
    if (bg) for (const s of sel.split(',')) fondoDe.set(s.trim(), bg[1]);
  }

  for (const [todo, selRaw, cuerpo] of bloques) {
    const col = cuerpo.match(/(?<!-)\bcolor\s*:\s*([^;!]+)/);
    if (!col) continue;
    const sel = selRaw.trim();

    // WCAG 1.4.3 exime a los controles deshabilitados. Ademas, subirles el
    // contraste los haria indistinguibles de los activos, que es justo lo
    // contrario de lo que deben comunicar.
    if (/:disabled|\[disabled\]/.test(sel)) continue;
    const esDark = /html\.dark/.test(sel);
    const mapa = esDark ? T.oscuro : T.claro;

    let bgRaw = (cuerpo.match(/background(?:-color)?\s*:\s*([^;!]+)/) || [])[1];
    // Si el bloque no declara fondo, se busca el del ancestro mas cercano.
    if (!bgRaw) {
      const partes = sel.split(/\s+/);
      for (let i = partes.length - 1; i > 0 && !bgRaw; i--) {
        bgRaw = fondoDe.get(partes.slice(0, i).join(' '));
      }
    }
    if (!bgRaw) continue;
    // Fondos no evaluables (degradados, transparentes, imagenes).
    if (/gradient|transparent|none|url\(/i.test(bgRaw)) continue;

    const fg = resolver(col[1], mapa);
    const bg = resolver(bgRaw, mapa);
    if (!fg || !bg) continue;
    const r = ratio(fg, bg);
    if (r === null || r >= 4.5) continue;

    const linea = css.slice(0, css.indexOf(todo)).split('\n').length;
    hallazgos.push({ archivo: rel, linea, sel: sel.slice(0, 70), fg, bg, r, tema: esDark ? 'oscuro' : 'claro' });
  }
}

if (!hallazgos.length) {
  console.log('Sin hallazgos: ningun texto queda por debajo de AA sobre el fondo de su propio bloque.');
} else {
  hallazgos.sort((a, b) => a.r - b.r);
  console.log(`${hallazgos.length} combinaciones texto/fondo por debajo de AA:\n`);
  for (const h of hallazgos) {
    console.log(`  ${String(h.r).padStart(5)}:1  ${h.fg} sobre ${h.bg}  [${h.tema}]`);
    console.log(`           ${h.archivo}:${h.linea}  ${h.sel}`);
  }
}
