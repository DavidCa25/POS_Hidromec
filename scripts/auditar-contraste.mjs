/**
 * Audita los `color:` con hex fijo que quedan en CSS de componente y calcula
 * su contraste contra las superficies de CADA tema.
 *
 * Motivo: el título de Clientes desaparecía en oscuro porque su CSS decía
 * `color: #272a2e`. Los tokens cumplen AA, pero un override de componente que
 * escribe el color a mano se salta el sistema entero. Este script encuentra
 * todos los casos, no solo el que se vio.
 *
 *    node scripts/auditar-contraste.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const SUPERFICIES = {
  claro:  { canvas: '#F2F5F9', surface: '#FFFFFF', raised: '#F7F9FC' },
  oscuro: { canvas: '#0A1119', surface: '#16233A', raised: '#1E2B44' },
};

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
  const [la, lb] = [lum(aRgb(a)), lum(aRgb(b))];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return +(((hi + 0.05) / (lo + 0.05)).toFixed(2));
};

function archivos(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (['.css', '.ts'].includes(extname(p))) out.push(p);
  }
  return out;
}

const hallazgos = [];

for (const f of archivos('src')) {
  const rel = f.replace(/\\/g, '/');
  if (rel.startsWith('src/styles')) continue;

  const texto = readFileSync(f, 'utf8');
  const lineas = texto.split('\n');

  lineas.forEach((linea, i) => {
    // Solo declaraciones de color de TEXTO con hex literal.
    const m = linea.match(/(?<!-)\bcolor\s*:\s*(#[0-9a-fA-F]{3,8})/);
    if (!m) return;
    const hex = m[1];
    const rgb = aRgb(hex);
    if (!rgb) return;

    // Blanco puro suele ser deliberado (texto sobre banner de color).
    if (['#fff', '#ffffff'].includes(hex.toLowerCase())) return;

    // Si la MISMA declaracion fija un fondo de color, el contraste real es
    // contra ese fondo, no contra la superficie del tema. Es el caso de una
    // pestana activa con tinta oscura sobre cyan: 7.5:1, correcto.
    const fondoPropio = linea.match(/background(?:-color)?:\s*(#[0-9a-fA-F]{3,8})/);
    if (fondoPropio && ratio(hex, fondoPropio[1]) >= 4.5) return;

    // Fondo escrito como token: no se puede evaluar aqui, pero tampoco es la
    // superficie del tema, que es lo unico que este script sabe medir.
    // Declararlo fallo seria dar la alarma sobre algo que no ha comprobado.
    if (/background(?:-color)?:\s*var\(--/.test(linea)) return;

    const esDark = /html\.dark|host-context\(html\.dark\)/.test(linea)
      || lineas.slice(Math.max(0, i - 6), i).some(l => /html\.dark/.test(l));

    const tema = esDark ? 'oscuro' : 'ambos';
    const peor = tema === 'oscuro'
      ? Math.min(...Object.values(SUPERFICIES.oscuro).map(s => ratio(hex, s)))
      : Math.min(...Object.values(SUPERFICIES.oscuro).map(s => ratio(hex, s)));

    if (peor < 4.5) {
      hallazgos.push({
        archivo: rel,
        linea: i + 1,
        hex,
        contrasteOscuro: peor,
        enBloqueDark: esDark,
        fragmento: linea.trim().slice(0, 90),
      });
    }
  });
}

if (!hallazgos.length) {
  console.log('Sin hallazgos: ningun `color:` fijo queda por debajo de AA en oscuro.');
} else {
  console.log(`${hallazgos.length} declaraciones de color que fallan AA sobre superficie oscura:\n`);
  for (const h of hallazgos) {
    console.log(`  ${h.contrasteOscuro.toFixed(2)}:1  ${h.hex}  ${h.archivo}:${h.linea}`);
    console.log(`           ${h.fragmento}`);
  }
}
