/**
 * MIDE AL INTÉRPRETE contra la verdad de cada ticket de prueba.
 *
 *     node scripts/pruebas/compras-documentos/medir.mjs
 *
 * Usa los .ocr.json que deja leer.cjs (el OCR real) y compara campo por
 * campo: encabezado, cada renglón (descripción, cantidad, presentación,
 * precio, importe, IVA) y los totales.
 *
 * Dos grupos:
 *   · SINTÉTICOS (generar-tickets.cjs): tienen que salir al 100 %. Si uno
 *     falla, el script sale con error.
 *   · REALES (real-*.json, fotos de proveedores): se reporta qué tanto se
 *     leyó. El renglón se busca por su código o por su importe (en una foto
 *     real faltan renglones y el orden no sirve). Una foto mala baja el
 *     porcentaje, no rompe la prueba.
 * Un real-*.png sin su .json (la foto de Coca con un dedo encima) solo se
 * reporta: cuántos renglones salieron y si cuadra.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { interpretar } = require('../../../electron/ocr/ticket.cjs');

const base = dirname(fileURLToPath(import.meta.url));
/* tickets/: sintéticos y fotos de proveedores que nos mandaron (se versionan).
   tickets-web/: bajados de la web; su imagen no se versiona (datos de
   terceros), solo su verdad. Sin la imagen leída, se salta. */
const DIRS = [join(base, 'tickets'), join(base, 'tickets-web')].filter(existsSync);
const grupos = { sinteticos: { campos: 0, bien: 0, fallas: [] }, reales: { campos: 0, bien: 0, fallas: [] } };
const igual = (a, b) => (typeof b === 'number' ? typeof a === 'number' && Math.abs(a - b) <= 0.02 : a === b);
function cmp(g, doc, que, a, b) { g.campos++; if (igual(a, b)) g.bien++; else g.fallas.push(`${doc} · ${que}: leyó ${JSON.stringify(a)}, era ${JSON.stringify(b)}`); }

const faltan = [];
for (const dir of DIRS) {
for (const f of readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.ocr.json'))) {
  if (!existsSync(join(dir, f.replace('.json', '.ocr.json')))) faltan.push(f.replace('.json', ''));
}
for (const f of readdirSync(dir).filter(f => f.endsWith('.ocr.json'))) {
  const id = f.replace('.ocr.json', '');
  const ocr = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const d = interpretar(ocr.renglones);
  const resumen = `${id.padEnd(28)} ${d.lineas.length} renglones · cuadra ${d.cuadre.ok ? 'sí' : 'no'} · IVA ${d.impuestos.iva.metodo} · IEPS ${d.impuestos.ieps.metodo}${d.avisos.length ? ' · avisos: ' + d.avisos.length : ''}`;
  if (!existsSync(join(dir, id + '.json'))) { console.log(resumen + ' · (sin verdad: solo se reporta)'); continue; }
  const v = JSON.parse(readFileSync(join(dir, id + '.json'), 'utf8'));

  if (v.real) {
    const g = grupos.reales;
    /* El nombre del proveedor se compara sin puntos, comas ni mayúsculas: «S.A DE C.V» = «S.A. de C.V.». */
    const norm = (x) => (x == null ? null : String(x).replace(/[^a-z0-9]/gi, '').toLowerCase());
    cmp(g, id, 'proveedor', norm(d.proveedor), norm(v.proveedor));
    const usadas = new Set();
    v.lineas.forEach((lv) => {
      const ld = d.lineas.find(l => !usadas.has(l) && lv.codigo && l.codigo === lv.codigo)
        || d.lineas.find(l => !usadas.has(l) && !l.dudoso && Math.abs(l.importe - lv.importe) <= 0.02 && (lv.importe > 0 || l.cantidad === lv.cantidad));
      const que = `«${lv.descripcion}»`;
      if (!ld) { g.campos += lv.factor != null ? 4 : 3; g.fallas.push(`${id} · ${que}: no se leyó`); return; }
      usadas.add(ld);
      cmp(g, id, `${que} cantidad`, ld.cantidad, lv.cantidad);
      if (lv.factor != null) cmp(g, id, `${que} piezas por presentación`, ld.factor, lv.factor);
      cmp(g, id, `${que} precio`, ld.precio_unitario, lv.precio_unitario);
      cmp(g, id, `${que} importe`, ld.importe, lv.importe);
    });
    cmp(g, id, 'total', d.totales.total, v.total);
    console.log(resumen);
    continue;
  }

  const g = grupos.sinteticos;
  cmp(g, id, 'rfc', d.rfc, v.rfc);
  cmp(g, id, 'folio', d.folio, v.folio);
  cmp(g, id, 'renglones', d.lineas.length, v.lineas.length);
  v.lineas.forEach((lv, i) => {
    const ld = d.lineas[i] || {};
    cmp(g, id, `#${i + 1} descripción`, ld.descripcion, lv.descripcion);
    cmp(g, id, `#${i + 1} cantidad`, ld.cantidad, lv.cantidad);
    cmp(g, id, `#${i + 1} piezas por presentación`, ld.factor, lv.factor);
    cmp(g, id, `#${i + 1} precio`, ld.precio_unitario, lv.precio_unitario);
    cmp(g, id, `#${i + 1} importe`, ld.importe, lv.importe);
    cmp(g, id, `#${i + 1} IVA`, ld.tasa_iva, lv.tasa_iva);
    cmp(g, id, `#${i + 1} IEPS`, ld.ieps ?? 0, lv.ieps);
  });
  for (const k of ['subtotal', 'descuento', 'ieps', 'iva', 'envases', 'total']) cmp(g, id, k, d.totales[k] ?? 0, v[k] ?? 0);
  cmp(g, id, 'cuadra', d.cuadre.ok, true);
  console.log(resumen);
}
}
if (faltan.length) console.log(`
(sin imagen leída, se saltan: ${faltan.join(', ')})`);

for (const [nombre, g] of Object.entries(grupos)) {
  if (!g.campos) continue;
  console.log(`\n${nombre.toUpperCase()}: ${g.bien}/${g.campos} campos correctos (${(100 * g.bien / g.campos).toFixed(1)}%)`);
  g.fallas.forEach(f => console.log('  ' + f));
}
process.exit(grupos.sinteticos.fallas.length ? 1 : 0);
