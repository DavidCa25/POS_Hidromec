/**
 * Lo pedido contra lo que llegó (shared/pedido.ts).
 *
 *   npm run test:pedido
 *
 * Registrar compra se llena con el pedido sugerido; al subir el ticket, cada
 * renglón dice si llegó completo, si faltó, si sobró, si el ticket no lo trae
 * o si no estaba pedido, y si cambió el costo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoRenglon, cambioDeCosto, seAcaba } from '../../shared/pedido.ts';

test('sin ticket todavía: solo se marca lo pedido', () => {
  assert.deepEqual(estadoRenglon(3, null, false), { texto: 'Pedido: 3', tono: 'info' });
  assert.equal(estadoRenglon(null, null, false), null);
});

test('con ticket: completo, faltó, sobró, no vino, no estaba pedido', () => {
  assert.deepEqual(estadoRenglon(3, 3, true), { texto: 'Completo', tono: 'ok' });
  assert.deepEqual(estadoRenglon(3, 2.5, true), { texto: 'Faltaron 0.5', tono: 'aviso' });
  assert.deepEqual(estadoRenglon(3, 4, true), { texto: 'Llegaron 1 de más', tono: 'aviso' });
  assert.deepEqual(estadoRenglon(3, null, true), { texto: 'No viene en el ticket', tono: 'aviso' });
  assert.deepEqual(estadoRenglon(null, 2, true), { texto: 'No estaba en el pedido', tono: 'info' });
});

test('costo: subió, bajó o igual; sin costo anterior no se compara', () => {
  assert.equal(cambioDeCosto(100.8, 106.8), 'subió 6.00');
  assert.equal(cambioDeCosto(316.8, 300), 'bajó 16.80');
  assert.equal(cambioDeCosto(10, 10.004), null);
  assert.equal(cambioDeCosto(0, 12), null);
  assert.equal(cambioDeCosto(null, 12), null);
});

test('cuándo se acaba: con existencia nunca dice agotado', () => {
  assert.equal(seAcaba(0, 9), 'hoy');
  assert.equal(seAcaba(0, 0), 'agotado');
  assert.equal(seAcaba(1.4, 10), 'mañana');
  assert.equal(seAcaba(5.9, 30), '5 d');
});
