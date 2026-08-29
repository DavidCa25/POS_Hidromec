/**
 * Corrige los `color:` con hex fijo que fallaban AA sobre superficie oscura.
 *
 * El caso que se vio a simple vista fue el título de Clientes
 * (`color: #272a2e`, 1.02:1 sobre navy: prácticamente invisible), pero la
 * auditoría encontró 61. Todos son overrides de componente que escriben el
 * color a mano y por tanto se saltan el sistema de tokens.
 *
 * Se mapean por ROL, no por parecido de tono: un azul oscuro en un título es
 * texto, en un badge de "transferencia" es un estado.
 *
 *    node scripts/corregir-contraste.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const DRY = process.argv.includes('--dry');

/* Texto principal: títulos de pantalla y cuerpo. */
const TEXTO = ['#272a2e', '#2b2b2b', '#2c3e50', '#222', '#333', '#0b1b4d', '#000080'];
/* Texto atenuado. */
const MUTED = ['#444', '#555', '#6C7B8B', '#7a7a7a'];
/* Azules de marca usados como texto informativo. */
const ACENTO = ['#1e3a8a', '#2E3A8C', '#1e40af', '#245b6e'];
/* Estados. */
const EXITO = ['#166534'];
const AVISO = ['#92400e', '#a16207', '#B8860B'];
const PELIGRO = ['#8B1A1A'];
/* Morados: no pertenecen a la paleta de Wybix. Pasan al cyan de marca, que
   los mantiene distinguibles del azul de "tarjeta" sin abrir un color nuevo. */
const MORADO = ['#7c3aed', '#5b21b6', '#6d28d9'];

const MAPA = new Map();
for (const c of TEXTO) MAPA.set(c.toLowerCase(), 'var(--wx-text)');
for (const c of MUTED) MAPA.set(c.toLowerCase(), 'var(--wx-text-muted)');
for (const c of ACENTO) MAPA.set(c.toLowerCase(), 'var(--wx-accent-text)');
for (const c of EXITO) MAPA.set(c.toLowerCase(), 'var(--wx-success)');
for (const c of AVISO) MAPA.set(c.toLowerCase(), 'var(--wx-warning)');
for (const c of PELIGRO) MAPA.set(c.toLowerCase(), 'var(--wx-danger)');
for (const c of MORADO) MAPA.set(c.toLowerCase(), 'var(--wx-accent-text)');

/* Fondos pálidos que acompañaban a esos textos. */
const FONDOS = new Map(Object.entries({
  '#f5f3ff': 'var(--wx-accent-soft)',
  '#fde68a': 'var(--wx-warning-soft)',
  '#ddd6fe': 'var(--wx-accent-line)',
}));

function archivos(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (['.css', '.ts'].includes(extname(p))) out.push(p);
  }
  return out;
}

let tocados = 0, textos = 0, fondos = 0, saltados = 0;

for (const f of archivos('src')) {
  const rel = f.replace(/\\/g, '/');
  if (rel.startsWith('src/styles')) continue;

  const orig = readFileSync(f, 'utf8');
  let s = orig;

  s = s.split('\n').map(linea => {
    // Si la MISMA declaración fija también un fondo de color fuerte, el
    // contraste real es contra ese fondo, no contra la superficie del tema.
    // Es el caso de la pestaña activa de Servicios: tinta sobre cyan.
    const fondoFuerte = /background:\s*#[0-9a-fA-F]{3,8}/.test(linea)
      && !/background:\s*(#f5f3ff|#fde68a|#ddd6fe)/i.test(linea);

    let l = linea;

    l = l.replace(/((?<!-)\bcolor\s*:\s*)(#[0-9a-fA-F]{3,8})/g, (m, pre, hex) => {
      const t = MAPA.get(hex.toLowerCase());
      if (!t) return m;
      if (fondoFuerte) { saltados++; return m; }
      textos++;
      return pre + t;
    });

    l = l.replace(/(\bbackground(?:-color)?\s*:\s*)(#[0-9a-fA-F]{3,8})/g, (m, pre, hex) => {
      const t = FONDOS.get(hex.toLowerCase());
      if (!t) return m;
      fondos++;
      return pre + t;
    });

    l = l.replace(/(\bborder-color\s*:\s*)(#ddd6fe)/gi, (m, pre) => {
      fondos++;
      return pre + 'var(--wx-accent-line)';
    });

    return l;
  }).join('\n');

  if (s !== orig) { tocados++; if (!DRY) writeFileSync(f, s); }
}

console.log(
  `${DRY ? '[dry] ' : ''}archivos: ${tocados} · textos: ${textos} · fondos: ${fondos} · saltados por fondo propio: ${saltados}`,
);
