/**
 * El vaso de una receta (shared/vaso.ts): de las líneas al dibujo.
 *
 *   npm run test:vaso
 *
 *  1. Cada ingrediente cae en su clase: capa, hielo, crema o topping.
 *  2. El tamaño sale del nombre de la variante (oz, ml, L) y, si no lo dice,
 *     de su lugar; nunca inventa mililitros cuando todas lo dicen.
 *  3. Las capas suman lo servido y el hielo sube el nivel.
 *  4. Pasarse de la capacidad se avisa; el dibujo nunca truena.
 *  5. Todo número del dibujo es finito (sin NaN en el SVG).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claseDe, colorDe, capacidadDeNombre, capacidades, dibujarVaso, miniVaso, servido } from '../../shared/vaso.ts';

const FRAPPE = [
  { nombre: 'Hielo', cantidad: 160, dimension: 'WEIGHT' },
  { nombre: 'Leche entera', cantidad: 220, dimension: 'VOLUME' },
  { nombre: 'Café espresso', cantidad: 60, dimension: 'VOLUME' },
  { nombre: 'Jarabe de moka', cantidad: 40, dimension: 'WEIGHT' },
  { nombre: 'Crema batida', cantidad: 30, dimension: 'WEIGHT' },
  { nombre: 'Chispas de chocolate', cantidad: 6, dimension: 'WEIGHT' },
];

test('cada ingrediente cae en su clase', () => {
  assert.deepEqual(FRAPPE.map(l => claseDe(l.nombre, l.dimension)), ['hielo', 'liquido', 'liquido', 'liquido', 'crema', 'topping']);
  assert.equal(claseDe('Galleta oreo', 'COUNT'), 'topping');
  assert.equal(claseDe('Agua natural', 'VOLUME'), 'liquido');
  assert.equal(claseDe('Canela molida', 'WEIGHT'), 'topping');
});

test('colores: con pista, su color; sin pista, estable', () => {
  assert.equal(colorDe('Café espresso'), '#4B2E1F');
  assert.equal(colorDe('Leche de almendra'), '#E4CBA4');
  assert.equal(colorDe('Dona glaseada'), '#D99A55');
  assert.equal(colorDe('Ingrediente raro'), colorDe('Ingrediente raro'));
});

test('el tamaño sale del nombre o de su lugar', () => {
  assert.equal(capacidadDeNombre('Chico 12 oz'), 355);
  assert.equal(capacidadDeNombre('Grande 500 ml'), 500);
  assert.equal(capacidadDeNombre('Jarra 1.5 L'), 1500);
  assert.equal(capacidadDeNombre('Venti'), null);
  assert.deepEqual(capacidades(['Chico 12 oz', 'Mediano 16 oz', 'Grande 20 oz'], 400), [355, 473, 591]);
  const sinNombre = capacidades(['Chico', 'Mediano', 'Grande'], 400);
  assert.ok(sinNombre[0] < sinNombre[1] && sinNombre[1] < sinNombre[2], sinNombre.join(','));
});

test('capas y hielo: lo servido sube el nivel', () => {
  const d = dibujarVaso(FRAPPE, 473);
  assert.equal(d.capas.length, 3);
  assert.equal(servido(FRAPPE), Math.round(160 * 0.9 + 220 + 60 + 40));
  assert.ok(d.cubos.length >= 3, 'hay cubos de hielo');
  assert.ok(d.domo, 'la crema hace domo');
  assert.ok(d.trocitos.length > 0, 'las chispas van encima');
  assert.equal(d.desborda, false);
  const sinHielo = dibujarVaso(FRAPPE.slice(1), 473);
  assert.ok(Math.min(...d.capas.map(c => c.y)) < Math.min(...sinHielo.capas.map(c => c.y)), 'con hielo el nivel queda más alto');
});

test('pasarse se avisa y nunca truena', () => {
  assert.equal(dibujarVaso([{ nombre: 'Leche', cantidad: 900, dimension: 'VOLUME' }], 355).desborda, true);
  const vacio = dibujarVaso([], 355);
  assert.equal(vacio.capas.length, 0);
  assert.equal(vacio.lleno, 0);
  const raro = dibujarVaso([{ nombre: 'Leche', cantidad: -5, dimension: 'VOLUME' }, { nombre: 'X', cantidad: 0, dimension: 'COUNT' }], 0);
  assert.equal(raro.capas.length, 0);
});

test('todo número del dibujo es finito', () => {
  const d = dibujarVaso(FRAPPE, 591);
  const nums = [d.vaso, d.domo, d.brillo, d.popote].join(' ').match(/-?\d+(\.\d+)?/g).map(Number)
    .concat(d.capas.flatMap(c => [c.y, c.h]), d.cubos.flatMap(c => [c.x, c.y]), d.trocitos.flatMap(t => [t.x, t.y, t.giro]));
  assert.ok(nums.every(Number.isFinite));
  const m = miniVaso(355, 0.7, 591);
  assert.ok(!/NaN|Infinity/.test(m.contorno + m.nivel));
});
