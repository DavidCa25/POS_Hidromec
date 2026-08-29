/**
 * Normalización mecánica de los CSS de componente a los tokens del sistema.
 *
 * Tres cosas, las tres necesarias para esta pasada:
 *
 *  1. TIPOGRAFÍA. Raleway y Poppins se cargaban desde Google Fonts por CDN.
 *     Al empaquetar las fuentes localmente (para que la app funcione sin
 *     internet) esas familias dejaron de existir, así que cada
 *     `font-family: 'Raleway'` caería a la fuente del sistema. Además había
 *     cinco pilas distintas conviviendo.
 *
 *  2. COLOR. Los componentes escribían hex a mano, y por eso el modo oscuro
 *     necesitaba una lista de ~320 parches. El token se elige MIRANDO LA
 *     PROPIEDAD: `#0f172a` en `color:` es texto, en `background:` es una
 *     superficie oscura. Sin esa distinción una sustitución global rompería
 *     las pantallas.
 *
 *  3. PESO TIPOGRÁFICO. `font-weight: 800/900` en cada etiqueta es una de
 *     las señales más reconocibles de plantilla, y en texto pequeño reduce
 *     legibilidad. La escala del sistema llega a 600.
 *
 * Lo que NO toca, a propósito:
 *  - `border-radius`: las esquinas amables son parte del carácter de Wybix.
 *  - Píldoras (`999px`) ni círculos (`50%`).
 *  - Las sombras: se recalibran en el CSS global, no aquí.
 *  - Degradados: ahí el color suele ser translúcido y sustituirlo por un
 *    token opaco cambiaría el diseño.
 *
 *    node scripts/normalizar-estilos.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const DRY = process.argv.includes('--dry');
const EXT = new Set(['.css', '.ts']);

/* Ya escritos contra el sistema. */
const OMITIR = [
  'src/styles.css', 'src/styles/',
  'src/dashboard/dashboard.css',
];

const ES_MONO = /(monospace|ui-monospace|SFMono|Menlo|Consolas|Courier)/i;

const TEXTO = {
  '#0f172a': 'var(--wx-text)', '#111827': 'var(--wx-text)', '#0f2a3f': 'var(--wx-text)',
  '#1f2937': 'var(--wx-text)', '#1e293b': 'var(--wx-text)', '#212529': 'var(--wx-text)',
  '#000': 'var(--wx-text)', '#000000': 'var(--wx-text)',
  '#334155': 'var(--wx-text-muted)', '#374151': 'var(--wx-text-muted)',
  '#475569': 'var(--wx-text-muted)', '#4b5563': 'var(--wx-text-muted)',
  '#64748b': 'var(--wx-text-muted)', '#6b7280': 'var(--wx-text-muted)',
  '#94a3b8': 'var(--wx-text-dim)', '#9ca3af': 'var(--wx-text-dim)',
  '#a0aec0': 'var(--wx-text-dim)', '#888': 'var(--wx-text-dim)', '#9fc3d4': 'var(--wx-text-dim)',
  '#2563eb': 'var(--wx-accent-text)', '#1d4ed8': 'var(--wx-accent-text)',
  '#3b82f6': 'var(--wx-accent-text)', '#0d6efd': 'var(--wx-accent-text)',
  '#16a34a': 'var(--wx-success)', '#15803d': 'var(--wx-success)', '#059669': 'var(--wx-success)',
  '#10b981': 'var(--wx-success)', '#198754': 'var(--wx-success)', '#188754': 'var(--wx-success)',
  '#065f46': 'var(--wx-success)',
  '#dc2626': 'var(--wx-danger)', '#ef4444': 'var(--wx-danger)', '#b00020': 'var(--wx-danger)',
  '#dc3545': 'var(--wx-danger)', '#e5484d': 'var(--wx-danger)', '#b91c1c': 'var(--wx-danger)',
  '#991b1b': 'var(--wx-danger)',
  '#d97706': 'var(--wx-warning)', '#f59e0b': 'var(--wx-warning)', '#b45309': 'var(--wx-warning)',
  '#8a6d3b': 'var(--wx-warning)', '#ca8a04': 'var(--wx-warning)',
};

const FONDO = {
  '#fff': 'var(--wx-surface)', '#ffffff': 'var(--wx-surface)',
  '#f8fafc': 'var(--wx-raised)', '#f9fafb': 'var(--wx-raised)', '#f8f9fa': 'var(--wx-raised)',
  '#fafafa': 'var(--wx-raised)', '#fbfdff': 'var(--wx-raised)', '#f6f8fa': 'var(--wx-raised)',
  '#f1f5f9': 'var(--wx-sunken)', '#f3f4f6': 'var(--wx-sunken)', '#eef2f7': 'var(--wx-sunken)',
  '#edf2f7': 'var(--wx-sunken)', '#eef6f9': 'var(--wx-sunken)',
  '#f7faf7': 'var(--wx-canvas)', '#f5f7fa': 'var(--wx-canvas)', '#f4f6fa': 'var(--wx-canvas)',
  '#e2e8f0': 'var(--wx-edge)', '#e5e7eb': 'var(--wx-edge)',
  '#0f172a': 'var(--wx-navy-800)', '#0b1220': 'var(--wx-navy-800)',
  '#16233a': 'var(--wx-surface)', '#0f1826': 'var(--wx-sunken)',
  '#dcfce7': 'var(--wx-success-soft)', '#d1fae5': 'var(--wx-success-soft)',
  '#fee2e2': 'var(--wx-danger-soft)', '#ffe0e0': 'var(--wx-danger-soft)',
  '#fef2f2': 'var(--wx-danger-soft)', '#fecaca': 'var(--wx-danger-soft)',
  '#fef3c7': 'var(--wx-warning-soft)', '#fff8e1': 'var(--wx-warning-soft)',
  '#fffbeb': 'var(--wx-warning-soft)',
  '#dbeafe': 'var(--wx-info-soft)', '#eff6ff': 'var(--wx-info-soft)',
  /* El hover amarillo de las tablas no correspondía a ningún estado. */
  '#fff7cc': 'var(--wx-user-accent-soft)',
};

const BORDE = {
  '#e2e8f0': 'var(--wx-edge)', '#e5e7eb': 'var(--wx-edge)', '#eee': 'var(--wx-edge)',
  '#e0e0e0': 'var(--wx-edge)', '#eef2f7': 'var(--wx-edge)',
  '#f1f5f9': 'var(--wx-edge-soft)', '#f3f4f6': 'var(--wx-edge-soft)',
  '#cbd5e1': 'var(--wx-edge-strong)', '#d1d5db': 'var(--wx-edge-strong)',
  '#ccc': 'var(--wx-edge-strong)', '#94a3b8': 'var(--wx-edge-strong)',
  '#2563eb': 'var(--wx-accent)', '#191970': 'var(--wx-accent)',
  '#f5c2c2': 'var(--wx-danger)', '#ffecb3': 'var(--wx-warning)', '#fecaca': 'var(--wx-danger)',
};

function archivos(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (EXT.has(extname(p))) out.push(p);
  }
  return out;
}

function tablaPara(prop) {
  const p = prop.toLowerCase();
  if (p === 'color') return TEXTO;
  if (p === 'fill' || p === 'stroke') return TEXTO;
  if (p.includes('border') || p.includes('outline')) return BORDE;
  if (p.includes('background')) return FONDO;
  return null;
}

let tocados = 0, fuentes = 0, colores = 0, pesos = 0;

for (const f of archivos('src')) {
  const rel = f.replace(/\\/g, '/');
  if (OMITIR.some(o => rel === o || rel.startsWith(o))) continue;

  const orig = readFileSync(f, 'utf8');
  let s = orig;

  // 1. font-family -> token
  s = s.replace(/font-family\s*:\s*([^;}]+?)\s*([;}])/g, (m, valor, fin) => {
    if (valor.includes('--wx-font')) return m;
    fuentes++;
    return `font-family: ${ES_MONO.test(valor) ? 'var(--wx-font-mono)' : 'var(--wx-font)'}${fin}`;
  });

  // 2. color -> token, según la propiedad
  s = s.replace(/([a-z-]+)\s*:\s*([^;{}]*#[0-9a-fA-F]{3,8}[^;{}]*)([;}])/g, (m, prop, valor, fin) => {
    const tabla = tablaPara(prop);
    if (!tabla) return m;
    if (/gradient|shadow/i.test(prop) || /gradient\(/i.test(valor)) return m;
    const v = valor.replace(/#[0-9a-fA-F]{3,8}/g, hex => {
      const t = tabla[hex.toLowerCase()];
      if (!t) return hex;
      colores++;
      return t;
    });
    return `${prop}: ${v}${fin}`;
  });

  // 3. peso tipográfico
  s = s.replace(/font-weight\s*:\s*(800|900)/g, () => { pesos++; return 'font-weight: 600'; });

  if (s !== orig) { tocados++; if (!DRY) writeFileSync(f, s); }
}

console.log(
  `${DRY ? '[dry] ' : ''}archivos: ${tocados} · fuentes: ${fuentes} · colores: ${colores} · pesos: ${pesos}`,
);
