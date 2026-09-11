/**
 * Migración de iconografía: Bootstrap Icons -> Phosphor.
 *
 * Por qué Phosphor y no Lucide/Tabler:
 *  - Lucide es hoy la firma visual de casi toda interfaz generada por IA.
 *    Usarlo iría en contra del objetivo de esta pasada.
 *  - Tabler es correcto, pero muy cercano a Feather/Lucide en carácter.
 *  - Phosphor tiene geometría propia (terminaciones redondeadas, formas
 *    reconocibles), se lee excelente a 16-20px y, sobre todo, trae una
 *    FAMILIA DE PESOS real: `regular` para reposo y `fill` para activo o
 *    seleccionado. Eso da un sistema de estados nativo, en vez de tener que
 *    inventar un segundo indicador.
 *
 * Este script solo reescribe nombres de clase. No toca lógica. Es idempotente.
 *
 *    node scripts/migrar-iconos.mjs --dry    (solo reporta)
 *    node scripts/migrar-iconos.mjs          (aplica)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const DRY = process.argv.includes('--dry');
const EXT = new Set(['.html', '.ts', '.css']);

/** 'nombre' = peso regular · 'fill:nombre' = peso fill (estados). */
const MAPA = {
  // Navegación y flechas
  'arrow-left': 'arrow-left', 'arrow-right': 'arrow-right',
  'arrow-right-short': 'arrow-right', 'arrow-left-right': 'arrows-left-right',
  'arrow-clockwise': 'arrow-clockwise', 'arrow-counterclockwise': 'arrow-counter-clockwise',
  'arrow-repeat': 'arrows-clockwise', 'arrow-up-circle': 'arrow-circle-up',
  'arrow-down-circle': 'arrow-circle-down',
  'chevron-down': 'caret-down', 'chevron-left': 'caret-left', 'chevron-right': 'caret-right',
  'link-45deg': 'link-simple', 'box-arrow-up-right': 'arrow-square-out',
  'box-arrow-in-down': 'arrow-line-down',

  // Acciones
  'plus': 'plus', 'plus-lg': 'plus', 'plus-circle': 'plus-circle',
  'plus-circle-fill': 'fill:plus-circle', 'plus-circle-dotted': 'plus-circle',
  'folder-plus': 'folder-plus', 'dash': 'minus', 'x': 'x', 'x-lg': 'x',
  'check': 'check', 'check-lg': 'check', 'check2': 'check',
  'pencil': 'pencil-simple', 'pencil-square': 'pencil-simple-line',
  'trash': 'trash', 'trash3': 'trash', 'save': 'floppy-disk',
  'search': 'magnifying-glass', 'download': 'download-simple', 'upload': 'upload-simple',
  'printer': 'printer', 'paperclip': 'paperclip', 'eye': 'eye', 'eye-slash': 'eye-slash',
  'power': 'power', 'magic': 'sparkle', 'tools': 'wrench', 'wrench-adjustable': 'wrench',
  'sliders': 'sliders-horizontal', 'sliders2': 'sliders-horizontal',
  'gear': 'gear', 'gear-fill': 'fill:gear', 'gear-wide-connected': 'gear-six',
  'palette2': 'palette',

  // Estado y avisos
  'check-circle': 'check-circle', 'check-circle-fill': 'fill:check-circle',
  'check2-circle': 'check-circle', 'patch-check-fill': 'fill:seal-check',
  'x-circle': 'x-circle', 'x-circle-fill': 'fill:x-circle', 'x-octagon': 'x-circle',
  'exclamation-triangle': 'warning', 'exclamation-triangle-fill': 'fill:warning',
  'exclamation-circle': 'warning-circle', 'info-circle': 'info',
  'question-circle': 'question', 'cone-striped': 'traffic-cone', 'bug': 'bug',
  'activity': 'pulse', 'lightning-charge': 'lightning', 'hourglass-split': 'hourglass',
  'snow': 'snowflake', 'rocket-takeoff': 'rocket-launch', 'circle': 'circle',
  'toggle-on': 'toggle-right', 'toggle-off': 'toggle-left',

  // Dinero y venta
  'cash': 'money', 'cash-coin': 'coins', 'cash-stack': 'money',
  'credit-card': 'credit-card', 'credit-card-2-back': 'credit-card',
  'credit-card-2-back-fill': 'fill:credit-card', 'credit-card-2-front': 'credit-card', 'wallet2': 'wallet', 'bank': 'bank',
  'receipt': 'receipt', 'receipt-cutoff': 'receipt', 'cart-check': 'shopping-cart-simple',
  'bag': 'bag', 'bag-check': 'bag', 'basket': 'basket', 'shop': 'storefront',
  'calculator': 'calculator', 'calculator-fill': 'fill:calculator', 'tags': 'tag',
  'piggy-bank': 'piggy-bank',

  // Inventario y logística
  'box-seam': 'package', 'truck': 'truck', 'inbox': 'tray',
  'clipboard': 'clipboard', 'clipboard-check': 'clipboard-text',
  'list-check': 'list-checks', 'list-ul': 'list-bullets',
  'upc-scan': 'barcode', 'qr-code-scan': 'qr-code', 'battery-half': 'battery-medium',
  'capsule': 'pill',

  // Personas
  'people': 'users', 'person-badge': 'identification-badge',
  'person-dash': 'user-minus', 'person-check': 'user-check',
  'hand-index': 'hand-pointing',

  // Archivos
  'file-earmark-excel': 'file-xls', 'file-earmark-spreadsheet': 'file-xls',
  'file-earmark-pdf': 'file-pdf', 'file-earmark-text': 'file-text',
  'file-earmark-zip': 'file-zip', 'file-earmark-lock': 'file-lock',
  'filetype-xml': 'file-code', 'folder2-open': 'folder-open', 'sticky': 'note',

  // Seguridad
  'key': 'key', 'key-fill': 'fill:key', 'lock-fill': 'fill:lock',
  'shield-check': 'shield-check', 'shield-lock': 'shield',
  'shield-lock-fill': 'fill:shield', 'shield': 'shield',
  'shield-exclamation': 'shield-warning', 'safe2': 'vault',

  // Fechas y tiempo
  'calendar3': 'calendar-blank', 'calendar-day': 'calendar-dot',
  'calendar-week': 'calendar', 'calendar-x': 'calendar-x',
  'calendar-minus': 'calendar-minus', 'calendar2-check': 'calendar-check',
  'clock': 'clock', 'clock-history': 'clock-counter-clockwise',

  // Datos y sistema
  'database': 'database', 'database-fill': 'fill:database', 'database-down': 'database',
  'graph-up': 'trend-up', 'bar-chart-line': 'chart-line', 'speedometer2': 'gauge',
  'display': 'monitor', 'pc-display': 'desktop-tower', 'pc-display-horizontal': 'monitor',
  'phone': 'device-mobile', 'whatsapp': 'whatsapp-logo', 'wifi': 'wifi-high',
  'cloud-arrow-up': 'cloud-arrow-up', 'cloud-upload': 'cloud-arrow-up',
  'cloud-download': 'cloud-arrow-down', 'usb-plug': 'usb', 'usb-symbol': 'usb',
  'plug': 'plug', 'envelope-paper': 'envelope', 'bell': 'bell', 'list': 'list',
  'box': 'package', 'cart-plus': 'shopping-cart-simple', 'bag-plus': 'bag',
  'box-arrow-up': 'arrow-square-up', 'box-arrow-left': 'sign-out',
  'box-arrow-right': 'sign-in', 'table': 'table', 'file-earmark-arrow-up': 'file-arrow-up',
  'moon-stars-fill': 'fill:moon', 'sun-fill': 'fill:sun',
};

// ---------------------------------------------------------------------------
// Verificación previa: ningún destino puede ser un icono inexistente.
// ---------------------------------------------------------------------------
const cssRegular = readFileSync('node_modules/@phosphor-icons/web/src/regular/style.css', 'utf8');
const cssFill = readFileSync('node_modules/@phosphor-icons/web/src/fill/style.css', 'utf8');

const faltantes = [];
for (const [bi, destino] of Object.entries(MAPA)) {
  const fill = destino.startsWith('fill:');
  const nombre = fill ? destino.slice(5) : destino;
  const css = fill ? cssFill : cssRegular;
  const clase = fill ? `.ph-fill.ph-${nombre}:before` : `.ph-${nombre}:before`;
  if (!css.includes(clase)) faltantes.push(`${bi} -> ${destino}`);
}
if (faltantes.length) {
  console.error('Iconos de destino que NO existen en Phosphor:');
  faltantes.forEach(f => console.error('  ' + f));
  process.exit(1);
}

// ---------------------------------------------------------------------------
function archivos(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (EXT.has(extname(p))) out.push(p);
  }
  return out;
}

const clase = d => (d.startsWith('fill:') ? `ph-fill ph-${d.slice(5)}` : `ph ph-${d}`);
const claseSuelta = d => (d.startsWith('fill:') ? `ph-fill ph-${d.slice(5)}` : `ph-${d}`);

let tocados = 0, subs = 0;
const sinMapear = new Map();

for (const f of archivos('src')) {
  const orig = readFileSync(f, 'utf8');
  let s = orig;

  // `bi bi-nombre` -> `ph ph-otro`
  s = s.replace(/\bbi bi-([a-z0-9-]+)/g, (m, n) => {
    const d = MAPA[n];
    if (!d) { sinMapear.set(n, (sinMapear.get(n) || 0) + 1); return m; }
    subs++; return clase(d);
  });

  // `bi-nombre` suelto (dentro de [ngClass], strings, datos)
  s = s.replace(/\bbi-([a-z0-9-]+)/g, (m, n) => {
    const d = MAPA[n];
    if (!d) { sinMapear.set(n, (sinMapear.get(n) || 0) + 1); return m; }
    subs++; return claseSuelta(d);
  });

  // El `bi` base que queda suelto tras sustituir su icono
  s = s.replace(/class="bi"/g, 'class="ph"').replace(/class="bi /g, 'class="ph ');

  if (s !== orig) { tocados++; if (!DRY) writeFileSync(f, s); }
}

console.log(`${DRY ? '[dry] ' : ''}archivos: ${tocados} · sustituciones: ${subs}`);
if (sinMapear.size) {
  console.log('\nSin mapear (siguen en Bootstrap Icons):');
  [...sinMapear.entries()].sort((a, b) => b[1] - a[1]).forEach(([n, c]) => console.log(`  ${c}x  bi-${n}`));
} else {
  console.log('Sin pendientes: no queda ningun icono de Bootstrap.');
}
