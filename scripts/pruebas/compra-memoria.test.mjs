/**
 * La compra que aprende (shared/compra-memoria.ts).
 *
 *   npm run test:compra-memoria
 *
 * Con lo último que se le compró a un proveedor: avisos de una captura fuera
 * de lo normal (cantidad o costo) y los textos bajo la línea.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avisosDeCaptura, textoUltimaCompra, textoMasBarato } from '../../shared/compra-memoria.ts';

const memoria = (x = {}) => ({
  product_id: 1, de_este: 1, presentation_id: 7, presentation_name: 'Cartón 24', factor: 24,
  unit_price: 480, costo_base: 20, fecha: null, profit_percent: 25,
  qty_tipica: 48, qty_max: 72, compras: 4,
  mejor_supplier_id: null, mejor_supplier: null, mejor_costo_base: null, mejor_fecha: null, ...x,
});
const linea = (qtyBase, costoBase) => ({ nombre: 'Cerveza', qtyBase, costoBase, baseUom: 'pza' });

test('sin memoria o con lo de siempre: nada que avisar', () => {
  assert.deepEqual(avisosDeCaptura(linea(5760, 1), null), []);
  assert.deepEqual(avisosDeCaptura(linea(48, 20), memoria()), []);
  assert.deepEqual(avisosDeCaptura(linea(96, 21), memoria()), [], 'el doble de lo normal todavía es una compra grande, no un error');
});

test('240 cartones en vez de 2: avisa la cantidad', () => {
  const a = avisosDeCaptura(linea(240 * 24, 20), memoria());
  assert.equal(a.length, 1);
  assert.match(a[0], /5,760 pza/);
  assert.match(a[0], /Normalmente compras 48/);
});

test('con una sola compra no hay normal contra qué comparar la cantidad', () => {
  assert.deepEqual(avisosDeCaptura(linea(5760, 20), memoria({ compras: 1 })), []);
});

test('el costo brincó 35 % o más, para arriba o para abajo', () => {
  assert.match(avisosDeCaptura(linea(48, 200), memoria())[0], /900 % más que la última compra \(\$20\.00\)/);
  assert.match(avisosDeCaptura(linea(48, 2), memoria())[0], /90 % menos/);
  assert.deepEqual(avisosDeCaptura(linea(48, 24), memoria()), [], '20 % es una subida, no un error de dedo');
});

test('última compra: por su presentación, y si fue a otro proveedor se dice', () => {
  assert.equal(textoUltimaCompra(memoria(), '12 nov'), 'Última compra: $480.00 por Cartón 24 · 12 nov');
  assert.equal(textoUltimaCompra(memoria({ de_este: 0, factor: 1, unit_price: 20 }), ''), 'Última compra (a otro proveedor): $20.00 por pza');
  assert.equal(textoUltimaCompra(memoria({ unit_price: 0 }), 'x'), null);
});

test('otro proveedor más barato', () => {
  const m = memoria({ mejor_supplier: 'Distribuidora B', mejor_costo_base: 18.4 });
  assert.equal(textoMasBarato(m, '3 nov'), 'Con Distribuidora B costó $18.40 por pza (8 % menos) · 3 nov');
  assert.equal(textoMasBarato(memoria(), ''), null);
});
