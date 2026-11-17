/**
 * Hoja de muestra del catálogo de frutería: cada producto con su ilustración,
 * para revisar a ojo. Escribe tmp/hoja-fruteria.html.
 *
 *     node scripts/giros/hoja-fruteria.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { FRUTERIA } from './fruteria.mjs';
import { ilustracionDe } from '../../shared/ilustraciones.ts';

const svg = (t) => {
  if (t.t === 'r') return `<rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="${t.r ?? 0}" fill="${t.f}"/>`;
  if (t.t === 'c') return `<circle cx="${t.x}" cy="${t.y}" r="${t.r}" fill="${t.f}"/>`;
  if (t.t === 'e') return `<ellipse cx="${t.x}" cy="${t.y}" rx="${t.rx}" ry="${t.ry}" fill="${t.f}" transform="rotate(${((t.rot ?? 0) * 180) / Math.PI} ${t.x} ${t.y})"/>`;
  if (t.t === 'p') return `<path d="${t.d}" fill="${t.f}"/>`;
  return `<path d="${t.d}" fill="none" stroke="${t.s}" stroke-width="${t.w}" stroke-linecap="round" stroke-linejoin="round"/>`;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const tarjetas = FRUTERIA.map(([nombre, categoria, unidad, precio], i) => {
  const il = ilustracionDe({ id: i + 1, nombre, categoria, giro: 'RETAIL', inventario: 'DIRECT' });
  return `<figure><svg viewBox="0 0 192 192"><defs><linearGradient id="g${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${il.fondoArriba}"/><stop offset="1" stop-color="${il.fondoAbajo}"/></linearGradient></defs>`
    + `<rect width="192" height="192" rx="24" fill="url(#g${i})"/>${il.trazos.map(svg).join('')}</svg>`
    + `<figcaption><b>${esc(nombre)}</b><span>${esc(il.forma)} · $${precio}/${unidad}</span></figcaption></figure>`;
}).join('\n');

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/hoja-fruteria.html', `<!doctype html><meta charset="utf-8"><title>Frutería · ilustraciones</title>
<style>body{font:13px system-ui;margin:16px;background:#fafaf7}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px}
figure{margin:0;background:#fff;border-radius:12px;padding:8px;box-shadow:0 1px 3px #0002}svg{width:100%;display:block}
figcaption{display:flex;flex-direction:column;gap:2px;margin-top:4px}figcaption span{color:#667;font-size:11px}</style>
<h1>Frutería · ${FRUTERIA.length} productos</h1><main>${tarjetas}</main>`);
console.log('tmp/hoja-fruteria.html');
