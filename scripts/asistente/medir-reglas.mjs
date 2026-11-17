/**
 * Mide cuántas variantes de las acciones por REGLA entiende el intérprete.
 *
 *     node scripts/asistente/medir-reglas.mjs            # resumen + fallas
 *     node scripts/asistente/medir-reglas.mjs --json     # para la prueba
 *
 * Banco: electron/asistente/lenguaje/frases-reglas.txt («@ intent» y una
 * variante por línea). Usa el intérprete real con un negocio de prueba que
 * tiene todos los módulos encendidos.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { crearInterprete, prepararCatalogo } = require(path.join(RAIZ, 'electron/asistente/lenguaje/interprete.js'));

export const META = 0.9;

const PRODUCTOS = ['Concha', 'Coca Cola 600 ml', 'Sabritas 45 g', 'Café americano', 'Latte', 'Taco al pastor', 'Agua de jamaica',
  'Hamburguesa sencilla', 'Carne molida', 'Queso amarillo', 'Pan de hamburguesa', 'Harina', 'Azúcar', 'Cambio de aceite',
  'Corte de cabello', 'Tinte', 'Balatas delanteras', 'Cigarro suelto', 'Cajetilla de cigarros', 'Pepsi 600 ml', 'Donas glaseadas'];

export function negocio() {
  return {
    catalogo: prepararCatalogo(PRODUCTOS.map((nombre, i) => ({ id: i + 1, nombre }))),
    personas: prepararCatalogo([{ id: 1, nombre: 'Doña Mary', tipo: 'cliente' }, { id: 2, nombre: 'Juan Pérez', tipo: 'cliente' },
      { id: 3, nombre: 'Bimbo', tipo: 'proveedor' }, { id: 4, nombre: 'Coca-Cola FEMSA', tipo: 'proveedor' },
      { id: 5, nombre: 'Laura López', tipo: 'profesional' }]),
    usuarios: [{ id: 2, nombre: 'pedro' }, { id: 3, nombre: 'ana' }],
    socios: [{ id: 1, nombre: 'Luis Gómez' }, { id: 2, nombre: 'Marta' }],
    estaciones: [{ id: 1, nombre: 'Barra' }, { id: 2, nombre: 'Cocina' }],
    categorias: [{ id: 10, nombre: 'Panadería' }, { id: 11, nombre: 'Bebidas' }],
    conceptos: [{ id: 1, nombre: 'Luz' }, { id: 2, nombre: 'Gasolina' }, { id: 3, nombre: 'Renta' }],
    modulos: null,
    ahora: new Date(2026, 10, 14, 12, 0, 0),
  };
}

export function banco(archivo = path.join(RAIZ, 'electron/asistente/lenguaje/frases-reglas.txt')) {
  const grupos = new Map();
  let actual = null;
  for (const l of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const s = l.trim();
    if (!s || s.startsWith('#')) continue;
    if (s.startsWith('@')) { actual = s.slice(1).trim(); grupos.set(actual, []); continue; }
    if (actual) grupos.get(actual).push(s);
  }
  return grupos;
}

export function medir() {
  const interprete = crearInterprete();
  const datos = negocio();
  const porIntent = [];
  let bien = 0, total = 0;
  for (const [intent, frases] of banco()) {
    const fallas = [];
    for (const f of frases) {
      let r;
      try { r = interprete.interpretar(f, datos); } catch (e) { r = { intent: `ERROR ${e.message}` }; }
      if (r?.intent === intent) bien++; else fallas.push({ frase: f, dio: r?.intent ?? null });
      total++;
    }
    porIntent.push({ intent, frases: frases.length, fallas });
  }
  return { bien, total, pct: total ? bien / total : 0, porIntent };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = medir();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r)); process.exit(0); }
  for (const g of r.porIntent) for (const x of g.fallas) console.log(`✗ ${g.intent.padEnd(26)} ← «${x.frase}» (dio ${x.dio})`);
  const perfectos = r.porIntent.filter((g) => !g.fallas.length).length;
  console.log(`\nreglas: ${r.bien}/${r.total} variantes (${(r.pct * 100).toFixed(1)} %), ${perfectos}/${r.porIntent.length} acciones al 100 %, meta ${META * 100} %`);
}
