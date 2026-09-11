/**
 * Normaliza los bloques `:host-context(html.dark)` de cada componente.
 *
 * Cada pantalla traía su propio bloque de modo oscuro con colores escritos a
 * mano (195 reglas en total). Eso es lo que hacía que el oscuro se sintiera de
 * segunda: no era un tema, era una lista de parches, y algunos ya
 * contradecían al resto de la app (por ejemplo un segmento activo en azul
 * #2563eb cuando el color de acción de Wybix es cyan).
 *
 * Aquí esos colores pasan a tokens. Como los tokens ya cambian solos con el
 * tema, los bloques quedan consistentes y, en la mayoría de los casos,
 * redundantes: cada pantalla que se revise puede ir borrándolos.
 *
 *    node scripts/normalizar-dark.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const DRY = process.argv.includes('--dry');
const EXT = new Set(['.css', '.ts']);

/* Paleta oscura que usaban los componentes -> token equivalente. */
const TEXTO = {
  '#f1f5f9': 'var(--wx-text)', '#e2e8f0': 'var(--wx-text)', '#e5e9f0': 'var(--wx-text)',
  '#f8fafc': 'var(--wx-text)', '#fff': 'var(--wx-text)', '#ffffff': 'var(--wx-text)',
  '#cbd5e1': 'var(--wx-text-muted)', '#94a3b8': 'var(--wx-text-muted)',
  '#9aa7bd': 'var(--wx-text-muted)', '#8fa0b4': 'var(--wx-text-muted)',
  '#64748b': 'var(--wx-text-dim)', '#7e8da4': 'var(--wx-text-dim)',
  '#60a5fa': 'var(--wx-accent-text)', '#4c8dff': 'var(--wx-accent-text)',
  '#38bdf8': 'var(--wx-accent-text)',
};
const FONDO = {
  '#16233a': 'var(--wx-surface)', '#131f31': 'var(--wx-surface)',
  '#1e2b44': 'var(--wx-raised)', '#1c2b45': 'var(--wx-raised)', '#26344f': 'var(--wx-raised)',
  '#0f1826': 'var(--wx-sunken)', '#0b1220': 'var(--wx-canvas)', '#0a1119': 'var(--wx-canvas)',
  '#2563eb': 'var(--wx-accent)', '#1d4ed8': 'var(--wx-accent)',
};
const BORDE = {
  'rgba(255,255,255,.09)': 'var(--wx-edge)', 'rgba(255,255,255,.1)': 'var(--wx-edge)',
  'rgba(255,255,255,.08)': 'var(--wx-edge-soft)', 'rgba(255,255,255,.12)': 'var(--wx-edge)',
  'rgba(255,255,255,.14)': 'var(--wx-edge-strong)', 'rgba(255,255,255,.16)': 'var(--wx-edge-strong)',
  'rgba(255,255,255,.18)': 'var(--wx-edge-strong)',
  '#1e2b44': 'var(--wx-edge)', '#334155': 'var(--wx-edge-strong)',
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
  if (p === 'color' || p === 'fill') return TEXTO;
  if (p.includes('border') || p.includes('outline')) return BORDE;
  if (p.includes('background')) return FONDO;
  return null;
}

let tocados = 0, cambios = 0;

for (const f of archivos('src')) {
  const orig = readFileSync(f, 'utf8');
  if (!orig.includes('host-context(html.dark)') && !orig.includes('html.dark')) continue;

  // Solo dentro de reglas de modo oscuro.
  const s = orig.replace(
    /((?::host-context\(html\.dark\)|html\.dark)[^{}]*)\{([^{}]*)\}/g,
    (m, selector, cuerpo) => {
      const nuevo = cuerpo.replace(/([a-z-]+)\s*:\s*([^;}]+)/g, (d, prop, valor) => {
        const tabla = tablaPara(prop);
        if (!tabla) return d;
        if (valor.includes('--wx-')) return d;
        const clave = valor.trim().toLowerCase().replace(/\s+/g, '');
        if (tabla[clave]) { cambios++; return `${prop}: ${tabla[clave]}`; }
        const v = valor.replace(/#[0-9a-fA-F]{3,8}/g, hex => {
          const t = tabla[hex.toLowerCase()];
          if (!t) return hex;
          cambios++;
          return t;
        });
        return `${prop}: ${v}`;
      });
      return `${selector}{${nuevo}}`;
    },
  );

  if (s !== orig) { tocados++; if (!DRY) writeFileSync(f, s); }
}

console.log(`${DRY ? '[dry] ' : ''}archivos: ${tocados} · colores de modo oscuro tokenizados: ${cambios}`);
